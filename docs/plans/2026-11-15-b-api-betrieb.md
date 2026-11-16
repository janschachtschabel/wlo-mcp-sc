# Betrieb hinter der B-API: Messung und Entwurf (2026-11-15)

Ziel des Nutzers: Der Dienst soll **wahlweise** hinter dem Proxy der B-API laufen, dann auch andere
Dienste über die B-API rufen, und selbst erkennen, wo er sitzt. Der heutige Betrieb ohne B-API bleibt.

Stand: **Entwurf, nichts gebaut.** Nachtrag des Nutzers (15.11.): Von den edu-sharing-Pfaden der B-API ist
bisher nur das Lesen von Metadaten in Betrieb; der Betrieb dahinter bleibt eine Option für später und darf den
heutigen nicht stören. Die Anmeldung aus der Sitzung ist getrennt gelöst (`POST /auth/session`). Abschnitt 1 ist gemessen, Abschnitt 2 folgt daraus, Abschnitt 3
ist der Vorschlag, Abschnitt 4 nennt, was sich nur mit einem Proxy-Eintrag messen lässt.

## 1. Gemessen gegen `b-api.staging.openeduhub.net` (2026-11-15, nur lesend)

Mit einem gewöhnlichen Schlüssel (kein Admin-Recht), ohne einen Modellaufruf, nichts angelegt.

| Frage | Ergebnis |
|---|---|
| Schlüssel als `Authorization: Bearer` und als `X-API-KEY` | beide 200 (`/api/v1/llm/openai/models`); ohne Schlüssel 401 ohne Text |
| Proxy-Eintrag `wlo-mcp` | fehlt: `400 {"error":"Proxy wlo-mcp not found"}` |
| Beschreibung der B-API | `/v3/api-docs` (82 Pfade) und je Gruppe `/v3/api-docs/<gruppe>`; 14 Gruppen, darunter `text-extraction`, `edu-sharing`, `jobs`, `router` |
| Textextraktion über den Proxy | angeboten: `/api/v1/proxy/text-extraction/from-url` (und `/metrics`) |
| edu-sharing über die B-API | **zehn** Pfade unter `/api/v1/edu-sharing/repo/…`: Suche (`search/v1/queries`), Knoten-Metadaten lesen und schreiben, Inhalt schreiben, `textContent`, Download, Sammlung lesen, Kind-Sammlungen, Referenzen einer Sammlung, Referenz hinzufügen (mit `asProposal`), Material in einem Ordner anlegen |
| Diese Pfade nur mit Schlüssel | **`400 {"error":"EDU_USER_REQUIRED"}`** — für Suche, Sammlung, Kind-Sammlungen und Metadaten gleich |
| Mit einer selbst gesetzten `X-Edu-User-Id` | **`403 {"error":"EDU_USER_NOT_VERIFIED"}`** — eine Personenkennung wird geprüft, nicht geglaubt |
| Ein Pfad, den die B-API nicht anbietet (`node/…/children`) | 404 |

Nachtrag 2026-11-16 — die Gruppen der B-API, gelesen aus der öffentlichen Beschreibung
(`/v3/api-docs/swagger-config`, ohne Schlüssel lesbar; Pfade gezählt, nicht einzeln ausprobiert):

| Gruppe | Pfade | Inhalt |
|---|---|---|
| `openai`, `academiccloud` | je 245 | die vollständige OpenAI-Schnittstelle je Anbieter (Chat, Responses, Embeddings, Bilder, Audio, Assistants, Agents …) |
| `router` | 15 | dieselben Funktionen über Routennamen, dazu `routes` (verwalten) und `models` |
| `edu-sharing` | 18 | zehn Repository-Pfade (siehe oben) und sieben KI-Funktionen des Repositorys: `chat/completion`, `responses`, `images/generations` je auch als `…/limited`, `qas`, `suggestions` |
| `jobs` | 5 | Kestra: Jobs auflisten, abfragen, löschen, Ergebnisdateien; ein freigegebener Flow `edusharing.chatbot/node-metadata-write` |
| Proxy-Dienste | | `text-extraction` (2), `kidra` (9), `topic-tree` (2), `compendious-text-generator` (9), `metadata-agent-canvas` (16), `badboerdichat` (77), `photon_geocoding` (2) |
| `administration`, `loggers` | — / 2 | Verwaltung (Beschreibung nicht öffentlich lesbar); `/actuator/loggers` in der Beschreibung sichtbar, Absicherung nicht geprüft |

Aufgefallen: Die Beschreibung eines Proxy-Dienstes wird öffentliche B-API-Dokumentation. `badboerdichat` zeigt dort
auch Konfiguration (Sicherung, Wiederherstellung, Datenschutz, MCP-Server), Auswertung und einen Debug-Pfad.


Aus der Beschreibung gelesen, nicht ausprobiert (braucht Admin-Recht):

- **Ein Proxy-Eintrag** (`ServiceConfiguration`) hat: `name`, `baseUrl`, `openApiPath`,
  `responseTimeout`, `pathToIgnore`, `pathMappings`, **`allowedRequestHeaders`**,
  **`allowedResponseHeaders`**, **`allowedResponseContentTypes`**, und für die Weitergabe
  **`forwardDelegation`**, **`delegationHeader`**, **`delegationScopes`**,
  **`delegationLifetimeSeconds`**. Ein Feld `forwardApiKey` gibt es in dieser Fassung nicht mehr:
  weitergereicht wird offenbar ein befristetes, auf Rechte begrenztes Token, in einer Kopfzeile, deren
  Name einstellbar ist.
- **Eine edu-sharing-Registrierung** (`EduSharingRegistration`) trägt `appId`, `privateKey`,
  `repoPublicKeys`, `signatureAlgorithm`, `url`, `user`: Die B-API ist beim Repository als Anwendung
  eingetragen, und das Repository weist Personen mit seiner Signatur aus. Daher `…_NOT_VERIFIED`.
- Keine Kopfzeile für die Person, keine Trace-Kopfzeile und kein `text/event-stream` ist in der
  Beschreibung benannt.

## 2. Was daraus folgt

1. **Personen kommen über die B-API an, aber nur vom Repository ausgewiesen.** Der Weg ist
   Browser → edu-sharing (`…/rest/bapi/…`) → B-API. Das passt zum Chatbot als Widget in der
   Redaktionsumgebung. Wie die Person in der Anfrage steht, sagt die Beschreibung nicht.
2. **Ohne Person liest die B-API nichts aus dem Repository.** Der anonyme Betrieb für ChatGPT und
   andere externe Clients geht darüber nicht; er bleibt beim direkten Zugriff auf das Repository.
3. **Die zehn Pfade decken einen Bruchteil ab.** Unser Server braucht zusätzlich unter anderem die
   Kinderliste eines Knotens (die Quelle jedes „es gibt keine“), Eltern und Pfad, Verwendungen,
   Vorschläge, Workflow, Rechte, Löschen, Verschieben, Reihenfolge, Vokabulare und Themenseiten.
   **Das Repository ganz über die B-API zu sprechen ist heute nicht möglich.**
4. **`Authorization` ist hinter dem Proxy belegt.** Die Proxy-Einstellung kennt aber erlaubte
   Anfrage-Kopfzeilen. Eine eigene Kopfzeile für unsere persönliche Anmeldung kann also durchkommen,
   wenn der Administrator sie freigibt.
5. **SSE und OAuth-Seiten hinter dem Proxy sind ungeklärt** (erlaubte Antwort-Typen, Pfad-Präfix).

## 3. Vorschlag: zwei Wege in einem Dienst

**Weg A — direkt (wie heute, unverändert).** Externe MCP-Clients, anonym oder mit persönlicher
Anmeldung über OAuth, Zugangsblock oder Ticket-Tausch. Repository direkt.

**Weg B — hinter dem Proxy der B-API.** Eingeschaltet vom Betreiber mit `B_API_BASE_URL`; ohne die
Variable ändert sich nichts. Je Anfrage erkennt der Dienst dann selbst:

| Was ankommt | Bedeutung |
|---|---|
| `Authorization: Bearer <unser Zugangsblock>` | persönliche Anmeldung, wie heute |
| ein anderer `Bearer` oder das Delegations-Token in seiner Kopfzeile | Aufruf über die B-API: kein 401, sondern anonymes Lesen; der Wert wird für diese eine Anfrage gehalten |
| zusätzlich `X-WLO-Authorization` (neu, Name zu entscheiden) | die persönliche Anmeldung des Menschen, vom Chatbot mitgegeben — derselbe Zugangsblock, nur in einer Kopfzeile, die der Proxy durchlässt |

- **Andere Dienste über die B-API:** Die Textextraktion geht an `/api/v1/proxy/text-extraction` mit
  dem durchgereichten Wert der Anfrage; `B_API_KEY` ist der Rückfall für Aufrufe ohne Kopfzeile, und
  eine Metrik zählt Rückfälle. Heute gibt es nur den festen Schlüssel
  (`WLO_TEXT_EXTRACTION_API_KEY`); er bleibt gültig.
- **Repository:** bleibt direkt. Schreiben als Person läuft weiter über unsere eigene Anmeldung, im
  Proxy-Betrieb über die zusätzliche Kopfzeile. Das ist der einzige Weg, der alle 26
  Kuratier-Werkzeuge trägt.
- **Regeln, die bleiben:** Der durchgereichte Wert geht nur an die B-API, nie ans Repository, nie
  ins Log, in keinen Cache. Ein Aufruf mit durchgereichtem Wert liest wie ein anonymer; was eine
  persönliche Anmeldung las, wird nie geteilt (`sharedReadScope()` unverändert).
- **Schutz:** Im Proxy-Betrieb prüft der Dienst den Schlüssel nicht selbst; die NetworkPolicy lässt
  dann nur die B-API auf den öffentlichen Port. Ohne diese Sperre ist Weg B nicht einzuschalten.

Nicht vorgeschlagen: eine Erkennung ganz ohne Schalter. Ein direkt erreichbarer Dienst würde sonst
jeden fremden `Bearer` an die B-API weiterreichen.

## 4. Nur mit einem Proxy-Eintrag messbar

Ein B-API-Administrator müsste auf Staging `wlo-mcp` eintragen (`baseUrl` auf eine erreichbare
Instanz). Dann:

1. Was kommt an: `Authorization`, das Delegations-Token (Kopfzeile, Form, Lebensdauer), eine Kennung
   der Person, `x-client-trace-id`, B3?
2. Kommt eine freigegebene eigene Kopfzeile (`allowedRequestHeaders`) unverändert durch?
3. Trägt der Proxy `text/event-stream` (`allowedResponseContentTypes`), und wie lange?
4. Welches `responseTimeout` braucht die längste Antwort (Baumliste mit Zahlen: 7 s; Stapel-Schritte)?
5. Reicht das Delegations-Token mit dem Scope `proxy:text-extraction` für den Rückweg?

Fragen an das B-API-Team, die keine Messung beantwortet:

- Wie steht die vom Repository ausgewiesene Person in einer Anfrage an einen Proxy-Dienst?
- Kommen weitere edu-sharing-Pfade dazu (Kinderliste eines Knotens zuerst)?
- Gibt es einen Lesezugriff ohne Person, für öffentliche Inhalte?
