# WLO MCP Server

> 🇩🇪 Deutsch · 🇬🇧 [English version](README.md)

Ein [Model-Context-Protocol](https://modelcontextprotocol.io)-(MCP-)Server, der
KI-Agenten das **Suchen und Abrufen offener Bildungsressourcen (OER)** aus
[WirLernenOnline (WLO)](https://wirlernenonline.de) über die öffentliche
edu-sharing-REST-API ermöglicht.

Er stellt **28 lesende Werkzeuge** bereit (alle immer; `get_url_text` lässt sich per `WLO_DISABLE_UNSAFE_TOOLS` entfernen) für Volltextsuche, Sammlungs-/Themenseiten-
Navigation, Metadaten-Abfrage und Vokabular-Auflösung bereit — allesamt gegen die
anonyme, nur lesende öffentliche API. Ohne Anmeldung ist das die ganze
Oberfläche: keine Authentifizierung, keine Schreibzugriffe.

Dazu kommen **vierzehn kuratierende Werkzeuge** (Anlegen, Bearbeiten,
Einreichen, Sammlungen, Kompendialtexte, Metadaten-Vorschläge, welche Variante
eine Themenseite rendert, Löschen). Sie
werden für alle Aufrufenden *gelistet* — nur so erfährt ein Client, dass sich
eine Anmeldung lohnt — und **verweigern ohne sie**: die Antwort trägt die
Aufforderung, mit der der Client die Anmeldung startet. Jede Änderung wird vorher
gezeigt und bestätigt und hinterher zurückgelesen — siehe
[Kuratieren](#kuratieren-schreiben-in-wlo).

---

## Inhaltsverzeichnis

- [Konzept](#konzept)
- [Funktionen](#funktionen)
- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Konfiguration](#konfiguration)
- [Server starten](#server-starten)
- [REST-API](#rest-api-öffentlich-nur-lesend)
- [Prompt-Launcher](#prompt-launcher)
- [Tools](#tools)
- [Anmelden per OAuth](#anmelden-per-oauth)
- [Kuratieren](#kuratieren-schreiben-in-wlo)
- [Ausgabeformate](#ausgabeformate)
- [Filter & Vokabular](#filter--vokabular)
- [Deployment](#deployment)
- [Sicherheit & Betrieb](#sicherheit--betrieb)
- [Architektur](#architektur)
- [Entwicklung](#entwicklung)
- [Weitere Dokumente](#weitere-dokumente)

---

## Konzept

In WLO bündelt eine **Sammlung** (collection) Bildungsinhalte nach Thema, Fach
oder Bildungsstufe; Untersammlungen sind Unterthemen. Eine Sammlung mit einer
`ccm:page_config_ref`-Eigenschaft besitzt zusätzlich eine kuratierte
**Themenseite**: ein Seiten-Layout aus **Schwimmlinien** (Karussells) mit
zielgruppenspezifischen Varianten (Lehrende / Lernende / allgemein).

Beides ist also **nicht** dasselbe. Jede Themenseite ist eine Sammlung, aber nur
manche Sammlungen haben eine — gemessen für „Mathematik": 5 Sammlungen, davon 1
mit Themenseite. `search_wlo_collections` findet alle,
`search_wlo_topic_pages` die Teilmenge mit kuratierter Seite.

Alles, was der Server zurückgibt, sind öffentliche OER-Metadaten; der Server ist
ein schlanker, zustandsloser Proxy vor edu-sharing.

## Funktionen

- **28 lesende MCP-Tools** — Inhaltssuche, Sammlungssuche, kombinierte Suche,
  Themenseiten und deren Swimlane-Inhalte, Fachportale, Baum-Navigation,
  Node-Details (einzeln & im Bulk), Vokabular-Abfrage, Anbieter-Abfrage,
  Health-Check, Wikipedia (Anriss oder GANZER Artikel per `fullText`), voller Kompendiumstext, Volltext
  eines Materials, Suche innerhalb einer Sammlung, verwandte Inhalte,
  Sammlungsstatistik, Node-Breadcrumb, Sammlungs-Zugehörigkeit eines Materials,
  Anmeldestatus, **WLO-Skill-Suche und Skill-Abruf** sowie die
  ChatGPT-`search`/`fetch`-Knowledge-Tools. Alle sind immer da;
  `WLO_SKILL_TOOL_MODE=one-tool` ersetzt `search_skill`+`get_skill` durch das
  einzelne `get_skill_for_task`. Dazu kommt
  `get_url_text` (Text einer beliebigen Web-Adresse), das als **unsicher**
  deklariert und über `WLO_DISABLE_UNSAFE_TOOLS` abschaltbar ist.
- **14 kuratierende MCP-Tools** — für ALLE sichtbar, aber nur mit Anmeldung benutzbar (sie verweigern beim Aufruf und fordern die Anmeldung an): Datensätze
  anlegen, ändern, einreichen und löschen; Sammlungen anlegen, umbenennen,
  befüllen, leeren und löschen; Kompendialtexte schreiben; Metadaten
  vorschlagen, auflisten und entscheiden. Jede Änderung läuft über eine
  Vorschau mit einmaligem Bestätigungs-Token und wird danach zurückgelesen.
  Vollständige Liste mit Chat-Triggern: [docs/TOOLS.md](docs/TOOLS.md).
- **OpenAI-Apps-SDK-Unterstützung** — Anzeige-Tools liefern `structuredContent`
  (Tool-`outputSchema`) mit read-only-`annotations`, der Server annonciert
  werkzeugübergreifende `instructions`, und **vier inline gebündelte
  `ui://`-Widgets bedienen zehn Tools** (Suchergebnisse — geteilt von jedem
  Werkzeug, das eine Trefferliste liefert, mit Detailansicht im Widget,
  Kachelauswahl und Folgeaktionen je Kachel; Themenseiten-Swimlanes unter einem
  Titel/Beschreibungs-Kopf, jede Karte aufklappbar; ein interaktiver
  Sammlungs-Browser; und eine Leseansicht für den Volltext eines Materials),
  jeweils mit Widget-`_meta` (Beschreibung, CSP, `prefersBorder`) — theme-fähig,
  WCAG 2.2 AA, DE/EN. Nicht-Apps-Clients bleiben unberührt.
  Buttons, die das Gespräch fortsetzen, speisen eine Chat-Nachricht ein — das
  ist eine **ChatGPT-Erweiterung** (`sendFollowUpMessage`). Die
  MCP-Apps-Standardbrücke hat kein Gegenstück, deshalb entfallen diese Buttons
  auf anderen Hosts, statt tot zu erscheinen; die Widgets sind dort reine
  Anzeige. Lokale Bedienung (Detailansicht, Zurück, Baum aufklappen) läuft
  überall.
- **Qualitäts-Reranking** — Multi-Query-Expansion (Synonyme, Keyword, Titel,
  Stoppwort-Varianten), fusioniert mit Reciprocal Rank Fusion (RRF) und einem
  Metadaten-Qualitätsscore. Deterministische Sortierung.
- **Zwei Transporte** — stdio und ein eigenständiger Streamable-HTTP-Server —
  beide aus einer transport-agnostischen Server-Factory.
- **Öffentliche REST-Schicht** (HTTP-Modus) — nur lesende
  `GET /api/{search,compendium,topic-page,wikipedia}`-Wrapper über dieselben
  Services, für Nicht-MCP-KI-Werkzeuge und den Prompt-Launcher. Rate-limitiert,
  CORS `GET`, validiert. Siehe [REST-API](#rest-api-öffentlich-nur-lesend).
- **Prompt-Launcher** (HTTP-Modus) — eine self-contained, zweisprachige (DE/EN)
  statische Seite unter `/launcher.html`, geführt von **Boerdi**, der WLO-Eule:
  KI wählen, ein **Öffnen**-Button übergibt dem Chat das Wissen, die WLO-Dienste
  selbst zu nutzen (Suche + rohes JSON + fertige Skills aus `GET /api/collection`),
  als Claude/ChatGPT/Copilot/Gemini-Nachricht. Erweiterte Felder sind standardmäßig
  eingeklappt; ein Bookmarklet füllt eine Auswahl vor. Siehe [Prompt-Launcher](#prompt-launcher).
- **Persönliche Zugangsblöcke** (HTTP-Modus, per `WLO_AUTH_PRIVATE_KEY`
  einschaltbar) — eine Seite unter `/auth`, auf der sich jemand mit dem eigenen
  WLO-Konto anmeldet und einen Zugangsblock erhält, dessen Passwort **im
  Browser** verschlüsselt wurde. Einmal ins KI-Programm eintragen, sperren unter
  `/auth-revoke.html`. Anders als ein Basic-Header ist der Block für den
  KI-Anbieter unlesbar, außerhalb dieses Servers wertlos und ohne
  Passwortwechsel zurücknehmbar.
- **Deutsch ⇄ URI-Vokabular** — Filter akzeptieren deutsche Labels
  (`Mathematik`, `Grundschule`, `Lehrer/in`, `Video`) oder vollständige URIs.
- **Gehärteter HTTP-Modus** — Upstream-Timeouts, Größenbegrenzung des
  Request-Bodys, Rate-Limiting pro IP, URL-kodierte Node-IDs, strukturiertes
  JSON-Logging.

## Voraussetzungen

- **Node.js ≥ 20** (in `package.json` `engines` festgelegt; CI und das
  Docker-Image bauen/testen gegen Node 20).
- **npm ≥ 9**.

## Installation

```bash
git clone <repo-url>
cd wlo-mcp-server
npm install
npm run build
```

**Optional — damit sich Leute mit ihrem eigenen WLO-Konto anmelden können**
(HTTP-Modus). Ohne diesen Schritt liest der Server anonym, und `/auth` sagt, dass
dieser Server keine Zugänge ausgibt.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out authkey.pem
[ -n "$(tail -c1 .env)" ] && echo >> .env   # .env endet evtl. ohne Zeilenumbruch
printf 'WLO_AUTH_PRIVATE_KEY="%s"\n' "$(cat authkey.pem)" >> .env
chmod 600 authkey.pem .env
docker compose config > /dev/null && echo "env OK"   # unter Docker: Parse-Test
```

Eine `.env` ist **keine Shell**: Wer dort `WLO_AUTH_PRIVATE_KEY="$(cat key.pem)"`
hineinschreibt, speichert genau diesen Text, und der Schlüssel wird beim Start
abgelehnt. Das `printf` oben trägt den PEM selbst ein. Der `tail -c1`-Schutz ist
keine Zierde: Hängt man an eine Datei an, deren letzte Zeile keinen Umbruch hat,
klebt der Schlüssel an dieser Zeile — und Compose kann die Datei dann überhaupt
nicht mehr lesen (im Feld passiert, 2026-08-05). Der öffentliche Schlüssel
wird daraus abgeleitet — eine zweite Variable gibt es bewusst nicht. **Wer diesen
Schlüssel hat, kann jeden ausgestellten Block zu einem lebenden WLO-Passwort
entschlüsseln**: nur auf den Server, nie ins Image und nie ins Repository.

## Konfiguration

Die gesamte Konfiguration erfolgt über Umgebungsvariablen. Kopieren Sie
`.env.example` nach `.env` und passen Sie sie nach Bedarf an. Üblicherweise wird
nur `WLO_REPOSITORY_URL` geändert; alles andere hat sinnvolle Standardwerte.

| Variable | Standard | Geltungsbereich | Beschreibung |
|---|---|---|---|
| `WLO_REPOSITORY_URL` | `https://repository.staging.openeduhub.net/edu-sharing` | alle | edu-sharing-Instanz, mit der der Server kommuniziert. **Die Vorgabe ist STAGING; die Produktion muss ausdrücklich hingeschrieben werden** (geändert am 2026-08-06 — eine `.env` ohne diese Zeile legte einen Datensatz in der Live-Instanz an, während alles drumherum „staging" sagte). Die Pfade sind über alle Instanzen hinweg identisch, daher ist diese Basis-URL der einzige Umschalter zwischen Prod / Staging / einem eigenen Repository. Die Eingabe ist fehlertolerant: Leerzeichen, abschließende Slashes und ein abschließendes `/rest` werden entfernt; ein fehlendes Protokoll wird zu `https://`; ein reiner Host bekommt `/edu-sharing` angehängt. Verdächtige Werte (tiefe `/components/...`-Links, doppeltes `/edu-sharing`) erzeugen beim Start eine Warnung. |
| `WLO_ROOT_COLLECTION_ID` | pro Host | alle | Wurzelknoten der Sammlungshierarchie — **an das Repository gebunden**. Die bekannten WLO-Hosts (Prod `redaktion.openeduhub.net`, Staging `repository.staging.openeduhub.net`) bekommen automatisch einen Host-Default (heute auf beiden dieselbe ID, live verifiziert 2026-07-17, aber pro Host gepflegt). Jede **andere** edu-sharing-Instanz muss den Wert explizit setzen — sonst loggt der Server eine Start-Warnung und fällt auf die WLO-ID zurück, die dort nicht existiert. |
| `WLO_SKILLS_COLLECTION_ID` | _(nicht gesetzt)_ | alle | nodeId der WLO-Sammlung mit den Launcher-**Skills** (hochgeladene Markdown-Dateien). Wenn gesetzt, nutzt `GET /api/collection` ohne `nodeId` diese als Default, und `search_skill` grenzt auf diesen Teilbaum ein. Nicht gesetzt → Aufrufer geben `?nodeId=` explizit an. |
| `WLO_SKILL_TOOL_MODE` | _(nicht gesetzt)_ | alle | `one-tool` ersetzt `search_skill` + `get_skill` durch ein einziges `get_skill_for_task`, das in einem Aufruf auswählt und lädt — 41 statt 42 Werkzeuge. Weniger Roundtrips, weniger Kontrolle über die Auswahl. Jeder andere Wert lässt beide Werkzeuge stehen. |
| `WLO_SKILL_CACHE` | _an_ | alle | Hält den Katalog freigegebener Skills je Sammlung im Hintergrund warm, damit ein Sammlungs-Ergebnis ihn für **0** Zusatzabrufe mitbringt. Auf `off` (oder `0`/`false`/`no`) gesetzt, entfällt die Hintergrundarbeit **und** der Live-Rückfall je Anfrage — die Ausgabe trägt dann wieder den kostenlosen Hinweis auf `get_skill_registry`. Siehe [Der Skill-Registry-Cache](#der-skill-registry-cache). |
| `WLO_SKILL_CACHE_REFRESH_MS` | `300000` | alle | Wie oft der Hintergrund-Takt die Warteschlange abarbeitet und abgelaufene Einträge erneuert. Begrenzt auf 60 000 – 3 600 000. |
| `WLO_SKILL_CACHE_TTL_MS` | `600000` | alle | Wie lange eine gemerkte Antwort gilt, bevor sie neu geprüft wird. Nie kleiner als das Takt-Intervall. Eine vor zwei Minuten angelegte Registry erscheint also verzögert — `get_skill_registry` und `includeSkillRegistry: true` lesen live und kennen sie sofort. |
| `WLO_POOL_SIZE` | `25` | alle | Größe des Kandidaten-Pools **pro Suchvariante** für das Reranking (`enhancedSearch`) — **nicht** die Anzahl der zurückgegebenen Treffer (das ist `maxResults`). Kleiner = schneller/kleinere Abrufe bei minimal geringerer Recall-Quote. |
| `WLO_FETCH_TIMEOUT_MS` | `20000` | alle | Timeout pro Anfrage (ms) für jeden Upstream-edu-sharing-Aufruf. Verhindert, dass ein hängender Backend-Socket einen Tool-Aufruf blockiert. Aus Messung abgeleitet (Staging, 2026-08-02): Anlegen eines Datensatzes 4,2–8,0 s, jeder andere Aufruf unter 2,5 s. |
| `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` | _(nicht gesetzt)_ | alle | Optionales Dienstkonto. Nicht gesetzt (Standard) → der Server liest **anonym**, nur öffentliche Inhalte, exakt wie bisher. Beide gesetzt → jeder Aufruf meldet sich per HTTP Basic mit diesem einen Konto an, **alle** Nutzenden dieses MCP sehen also dieselben erweiterten Inhalte. Dafür ein eigens angelegtes, schreibgeschütztes Konto verwenden: was es sieht, sieht jede:r, und im edu-sharing-Protokoll steht das Dienstkonto statt der Person. Eine halbe Angabe gilt als keine. **Falsche Zugangsdaten schalten nicht auf „nur öffentlich“ zurück** — das Repository antwortet mit `401` (gemessen gegen die Produktion am 2026-07-31, auf dem Identitäts- wie auf dem Such-Endpunkt), damit schlägt jede Abfrage fehl und der Server liefert gar nichts. Wer anonym lesen will, lässt beide Variablen weg. Mit dem Werkzeug `wlo_auth_status` prüfen: `mode: "service"` zusammen mit `authenticated: false` heißt, die Zugangsdaten werden abgelehnt. HTTP Basic, weil es neben dem Session-Cookie das einzige Schema ist, das die edu-sharing-OpenAPI deklariert. **Geltungsbereich:** Das Dienstkonto gilt nur für den MCP-Endpunkt. Die öffentliche REST-Schnittstelle (`GET /api/*`) und die Launcher-Seite bleiben bewusst anonym — sie sind ohne Anmeldung aus dem Internet erreichbar; würden sie das Konto erben, wäre alles, was es sieht, für jede:n lesbar. Bei einer Repository-URL ohne `https` gehen die Zugangsdaten im Klartext über die Leitung (Basic ist base64, keine Verschlüsselung); der Server warnt darüber beim Start. |
| `WLO_ALLOW_SERVICE_WRITES` | _(nicht gesetzt)_ | alle | Erlaubt dem **Dienstkonto** die kuratierenden (schreibenden) Werkzeuge. Standardmäßig aus: eine Änderung unter einem gemeinsamen Konto ist niemandem zuzuordnen — in der Historie des Repositorys steht der Kontoname, nicht die Person, die sie angefordert hat. Wer sich mit dem eigenen WLO-Login meldet, darf immer schreiben und braucht hier nichts; anonyme Aufrufende dürfen nie — sie sehen die Werkzeuge (nur so lernt ihr Client, eine Anmeldung anzubieten), und jeder Aufruf wird abgelehnt. Gilt ebenso für den stdio-Modus, wo die Zugangsdaten aus der Umgebung kommen und daher als Dienstkonto gelten. Gültige Werte: `1`, `true`, `yes`, `on`; alles andere (auch `false`) lässt es aus. Siehe [Kuratieren](#kuratieren-schreiben-in-wlo). |
| `WLO_AUTH_PRIVATE_KEY` | _(nicht gesetzt)_ | http | PKCS#8-PEM, das **persönliche Zugangsblöcke** einschaltet: Wer sich unter `/auth` einen verschlüsselten Block holt, trägt ihn einmal als `Bearer …` in das Authorization-Feld seines KI-Programms ein und kann ihn unter `/auth-revoke.html` (oder `/auth/revoke` — dieselbe Seite) sperren: entweder durch Einfügen des Blocks oder per WLO-Anmeldung, die alle Zugänge des Kontos auf einmal beendet. Der zweite Weg ist der einzige für OAuth-Nutzer, die ihren Block nie zu sehen bekommen. Pro Konto gelten die zehn zuletzt geholten Blöcke. Nicht gesetzt heißt: Funktion komplett aus — die `/auth/…`-Endpunkte antworten 404, die Seiten sagen es, ein Bearer-Header wird abgelehnt wie bisher. Der öffentliche Schlüssel wird hieraus **abgeleitet**, es gibt also keine zweite Variable, die auseinanderdriften könnte. Erzeugen mit `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`. **Dieser Schlüssel entschlüsselt jeden ausgestellten Block zu einem lebenden WLO-Passwort** — er gehört in die `.env` auf dem Server, nie ins Image und nie ins Repository. |
| `WLO_AUTH_PRIVATE_KEY_PREVIOUS` | _(nicht gesetzt)_ | http | Der vorherige Schlüssel während eines Wechsels. Ausgestellt wird immer mit dem aktuellen, geöffnet mit beiden — sonst würde ein Wechsel alle Nutzerkonfigurationen gleichzeitig ungültig machen. Nach dem Überlappungsfenster wieder entfernen. Ein unbrauchbarer Wert schaltet die Funktion **aus**, statt das Fenster still zu verwerfen: sonst bräche genau das, wofür es existiert, und man erführe es von Nutzerbeschwerden statt aus dem Start-Log. |
| `WLO_AUTH_REGISTRY_PATH` | `/data/access-registry.json` | http | Ablageort der Positivliste ausgestellter Zugangs-IDs. Sie enthält IDs, Benutzernamen und Ausstellungszeitpunkt — **nie ein Credential**. Es ist eine POSITIV-Liste: Geht sie verloren, funktioniert kein Block mehr (unbequem) statt dass jeder widerrufene wieder gilt (unsicher). In Docker ist das das einzige beschreibbare Volume; `read_only: true` gilt für alles andere weiter. **Sichern.** |
| `WLO_PUBLIC_BASE_URL` | _(nicht gesetzt)_ | http | Die öffentliche Adresse, die Clients eintragen, z. B. `https://wlo-mcp.example.org` — Schema und Host, ohne Pfad. Sie steht in den OAuth-Discovery-Dokumenten (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) als Adresse der eigenen Endpunkte. Nicht gesetzt heißt: diese Pfade antworten 404 — außer bei `TRUST_PROXY=1`, dann wird die Adresse aus dem `Host`-Kopf der Anfrage abgeleitet, und der kommt vom AUFRUFER. Setzen: ein gefälschter Kopf schickte sonst den Browser eines Nutzers auf eine Anmeldeseite, die uns nicht gehört. Nur scheinbar unabhängig von den Zugangsblöcken — ohne `WLO_AUTH_PRIVATE_KEY` ist beides aus, denn eine OAuth-Anmeldung stellt genau denselben Block aus. |
| `WLO_INBOX_ID` | _(nicht gesetzt)_ | alle | nodeId des gemeinsamen Posteingangs, in dem neue Datensätze landen, wenn der Server unter dem **Dienstkonto** schreibt. Wer mit eigenem Login arbeitet, legt in `-userhome-` an und braucht hier nichts. Bewusst ohne Vorgabewert: nodeIds gelten nur für ein Repository, eine fest eingebaute würde auf Staging in eine andere Sammlung zeigen als auf der Produktion und anderswo auf gar nichts. Nicht gesetzt heißt: Anlegen im Dienstkonto-Modus wird mit Hinweis auf diese Variable abgelehnt — besser als ein Datensatz, den niemand findet. |
| `AUTH_CREDENTIAL_LIMIT` | `10` | HTTP-Modus | Wie viele **verschiedene** Logins eine Client-Adresse innerhalb von 10 Minuten vorzeigen darf; darüber 429. Der Server reicht einen mitgeschickten `Authorization`-Header nach oben weiter, könnte also zum Durchprobieren von WLO-Logins unter *unserer* Adresse dienen. Eine Anfragen-pro-Minute-Grenze wäre hier das falsche Mittel — ein Modus-3-Client sendet den Header bei **jedem** Aufruf. Das Signal sind verschiedene Logins: eine echte Person hat genau eines. `0` schaltet die Prüfung ab. |
| `TICKET_CREDENTIAL_LIMIT` | `200` | HTTP-Modus | Dieselbe Schranke für `POST /auth/ticket`, wo ein eingebettetes Widget das Ticket der auf der Gastgeberseite angemeldeten Person eintauscht — mit **eigenem** Budget und eigenen Töpfen, damit die Seitenaufrufe eines Besuchers nicht das `/auth/issue`-Budget derselben Adresse aufzehren. Zwanzigmal so hoch wie die Zeile darüber, und zwar aus dem Grund, auf dem die CORS-Ausnahme dieses Endpunkts ohnehin ruht: ein Ticket vergibt das Repositorium, es ist nicht ratbar — die Anzahl *verschiedener* Tickets von einer Adresse sagt also nichts über einen Angriff aus, während die Adresse im Regelfall geteilt ist: ein Widget auf einer Portalseite hängt eine ganze Klasse hinter eine NAT-Adresse. Bei `10` bekam die elfte angemeldete Person des Tages eine Absage. Unbegrenzt ist es trotzdem nicht: der Zähler behält je verschiedenem Ticket einen Hashwert für das Zeitfenster, und genau das wird hier begrenzt. Die schärfere Bremse ist ohnehin `API_RATE_LIMIT_RPM` mit rund 300 Versuchen im selben Fenster. `0` schaltet die Prüfung ab. |
| `WLO_DISABLE_UNSAFE_TOOLS` | *(nicht gesetzt — nichts abgeschaltet; ausgeliefert als `all`)* | alle | Schaltet Werkzeuge ab, die sich als **unsicher** deklarieren. Namensliste (Komma oder Leerzeichen) oder `all` (auch `1`/`true`/`yes`/`on`). Nicht gesetzt heißt: unsichere Werkzeuge SIND registriert, und der Server warnt beim Start mit Name und Begründung — ein Risiko, das nur im Changelog steht, liest niemand, der ein Deployment erbt. `.env.example` und `docker-compose.yml` liefern `all` aus, in einem echten Deployment sind sie also **ab Werk aus**; auf einen leeren Wert setzen schaltet sie an. Betroffen ist derzeit genau ein Werkzeug: `get_url_text`. `get_wlo_content_text` ausdrücklich **nicht** — siehe [Als unsicher deklarierte Werkzeuge](#als-unsicher-deklarierte-werkzeuge). |
| `WLO_TEXT_EXTRACTION_URL` | *(keiner — nicht gesetzt = aus)* | alle | Basis-URL des Text-Extraktionsdienstes, auf den `get_wlo_content_text` bei extern verlinktem Material (`ccm:wwwurl`) zurückfällt, dessen Text das Repository nicht gespeichert hat. Jede Instanz betreibt üblicherweise einen eigenen, deshalb gibt es **keinen Default**: nicht gesetzt (oder leer) schaltet den externen Weg ab und loggt den Grund, dann bleibt `/textContent` des Repositories die einzige Quelle. Ein Wert, der nicht als Basis taugt (kein Schema, kein http(s), oder mit Query/Fragment), schaltet ihn ebenfalls ab und warnt, damit ein Tippfehler keine Material-URLs an einen nicht gewählten Host schickt. Auf den Extraktionsdienst *deines* Repositories zeigen lassen — ein Default auf den Staging-Dienst hat Produktions-Material-URLs in eine andere Umgebung geschickt. |
| `WLO_TEXT_TIMEOUT_MS` | `25000` | alle | Timeout (ms) für Volltext-Abrufe — sowohl `/textContent` als auch den Extraktionsdienst. Bewusst größer als `WLO_FETCH_TIMEOUT_MS`: `/textContent` wurde mit 4,6 s Median und 9,2 s Maximum gemessen. Volltext ist der eine Aufruf, der länger dauern darf als alles andere. |
| `WLO_TOPIC_POOL` | `10` | alle | Fächerbreite für die Anreicherung von Themenseiten-Kandidaten (parallel abgesetzte Metadaten-Abrufe). Höher = weniger sequenzielle Wellen bei mehr gleichzeitiger Upstream-Last. |
| `PORT` | `3000` | HTTP-Modus | Port für den eigenständigen HTTP-Server. |
| `MCP_SSE` | `false` | HTTP-Modus | Bei wahrem Wert (`1`/`true`/`yes`) wird `POST /mcp` als echter Server-Sent-Events-Stream ausgeliefert (vom ChatGPT-Entwicklermodus benötigt). Standard sind Einzel-JSON-Antworten (maximale Client-Kompatibilität). Hinter einem Reverse-Proxy **muss** das Buffering für die `/mcp`-Location deaktiviert sein — siehe [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Das Docker-Image setzt dies standardmäßig auf `1`. |
| `WLO_WIDGET_MIME` | `text/html;profile=mcp-app` | alle | MIME-Type der inline-Apps-SDK-Widget-Ressourcen. Standard ist der MCP-Apps-Standard (portabel). Auf `text/html+skybridge` setzen, falls eine Legacy-ChatGPT-Runtime die Widgets mit dem Standardwert nicht rendert. |
| `WLO_WIDGET_DOMAIN` | nicht gesetzt | alle | App-Identitäts-Domain für die ChatGPT-Plugin-Submission (dort Pflicht + pro App eindeutig; Widgets rendern unter `<domain>.web-sandbox.oaiusercontent.com`). Wenn gesetzt, wird sie auf `_meta.ui.domain` **und** dem Alias `openai/widgetDomain` ausgewiesen; **wenn nicht gesetzt, auf keinem von beiden** — ein Host validiert die Domain gegen sein eigenes Sandbox-Format und verwirft bei fremden Werten das ganze Widget (und bricht den zugehörigen Tool-Call ab): Claude erwartet `{hash}.claudemcpcontent.com` und normalisiert den Vendor-Alias auf den Standard-Key, es reicht also nicht, nur einen wegzulassen. Für Claude und jeden Nicht-ChatGPT-Host nicht setzen. Die Widget-CSP bleibt unabhängig davon auf der edu-sharing-Origin. |
| `MAX_BODY_BYTES` | `4194304` (4 MB) | HTTP-Modus | Maximale Request-Body-Größe **in Bytes**; größere POSTs erhalten `413`. Begrenzt einen Speichererschöpfungs-Vektor. Nur reine Ziffern — `1MB` wird mit einer Warnung abgelehnt und der Standard behalten, statt als `1` Byte gelesen zu werden (womit jede Anfrage `413` bekäme). |
| `RATE_LIMIT_RPM` | `120` | HTTP-Modus | Anfragen/Minute **pro Client-IP** am MCP-Endpunkt; über dem Limit wird `429` zurückgegeben. `/health` ist ausgenommen. `0` zum Deaktivieren (z. B. hinter einem WAF-/Plattform-Limiter). |
| `API_RATE_LIMIT_RPM` | `30` | HTTP-Modus | Anfragen/Minute **pro Client-IP** an den öffentlichen REST-Endpunkten (`GET /api/*`); über dem Limit `429`. Strenger als `RATE_LIMIT_RPM`, da es eine anonyme öffentliche Oberfläche ist. `0` zum Deaktivieren. |
| `TRUST_PROXY` | `false` | HTTP-Modus | Bei wahrem Wert (`1`/`true`/`yes`) wird die Client-IP aus dem letzten (Proxy-angehängten) `X-Forwarded-For`-Hop statt aus der Socket-Adresse genommen — nötig für korrektes Rate-Limiting pro Client **hinter einem Reverse-Proxy**. Standardmäßig aus, da `X-Forwarded-For` auf einem direkt exponierten Server fälschbar ist. |

**Zahlenformate.** Jede numerische Variable oben nimmt reine Ziffern und sonst
nichts. Ein Wert mit Einheit oder Trennzeichen (`20s`, `1MB`, `120/min`) wird
**abgelehnt** — mit einer Warnung, die die Variable benennt — und der Standard
gilt weiter. `parseInt` würde sonst beim ersten Nicht-Ziffern-Zeichen stehen
bleiben und stillschweigend einen 20-Millisekunden-Timeout oder eine Ein-Byte-
Obergrenze erzeugen. Die Rate-Limits nehmen zusätzlich `0` an (bedeutet
„abgeschaltet"); jede andere numerische Variable verlangt mindestens `1`.

### Mit welchen Rechten der Server liest

Drei Modi, in der Reihenfolge, in der der Server sie pro Aufruf auflöst:

1. **Anonym** (Standard, keine Konfiguration) — nur öffentliche Inhalte. So
   arbeitet jede Installation, solange nichts gesetzt ist.
2. **Ein gemeinsames Dienstkonto** — `WLO_SERVICE_USER` und
   `WLO_SERVICE_PASSWORD` setzen. Alle Nutzenden dieses MCP-Servers sehen dann
   dieselben erweiterten Inhalte. Gilt nur für den MCP-Endpunkt; `GET /api/*`
   und die Launcher-Seite bleiben anonym.
3. **Jede Person mit ihrem eigenen WLO-Login.** Das KI-Programm sendet einen
   `Authorization`-Header, den der Server an genau diese eine Anfrage bindet —
   nichts wird gespeichert, und das Sprachmodell bekommt ihn nie zu sehen. Die
   Ergebnisse folgen den Rechten dieser Person, und im edu-sharing-Protokoll
   steht sie statt eines Sammelkontos. Für diesen Header gibt es zwei Wege, und
   sie sind nicht gleichwertig:

   - **Verschlüsselter Zugangsblock (empfohlen).** Ist `WLO_AUTH_PRIVATE_KEY`
     gesetzt, öffnet die Person `/auth`, meldet sich mit ihrem WLO-Konto an, und
     die Seite verschlüsselt das Passwort **im Browser** zu einem `wlo2.…`-Block,
     den nur dieser Server öffnen kann. Einmal als `Bearer wlo2.…` eintragen;
     sperren jederzeit unter `/auth-revoke.html`.
   - **`Authorization: Basic <base64(user:passwort)>`.** Funktioniert überall und
     braucht am Server nichts — aber base64 ist keine Verschlüsselung. Der Wert
     *ist* das Passwort, er ist für jeden lesbar, der ihn speichert, er
     funktioniert gegen **ganz WLO** statt nur gegen diesen Server, und
     zurücknehmen lässt er sich nur durch einen Passwortwechsel. Wer ihn auf der
     Kommandozeile baut, schreibt das Passwort in die Shell-History. Nutzen, wo
     der Block nicht angeboten wird.

Ein persönliches Login sticht für diese Anfrage das Dienstkonto; ohne beides
läuft der Aufruf anonym. Welcher Modus aktiv ist, sagt das Werkzeug
`wlo_auth_status` — wobei `authenticated` eine eigene Aussage ist, weil
edu-sharing falsche Zugangsdaten nicht ablehnt, sondern als Gast antwortet.

Ob Modus 3 zur Verfügung steht, hängt vom KI-Programm ab: es muss einen eigenen
Header für die Verbindung zulassen. Wo das nicht geht, bleiben Modus 1 und 2.

> **Ein Server = ein Repository.** Jeder Prozess zeigt auf genau eine
> edu-sharing-Instanz. Um Prod und Staging parallel zu bedienen, betreiben Sie
> zwei Instanzen mit unterschiedlichem `WLO_REPOSITORY_URL`.

## Server starten

```bash
node dist/stdio.js        # stdio transport (Claude Desktop, local clients)
node dist/http.js         # HTTP mode → http://localhost:3000/mcp

npm run dev               # stdio with auto-reload (tsx)
npm run dev:http          # HTTP with auto-reload (tsx)
npm test                  # offline unit/smoke tests (node:test)
npm run test:coverage     # dieselbe Suite plus Coverage-Bericht des Runners
npm run test:live         # Schreib-Vertragstests gegen STAGING (braucht .env-Zugangsdaten)
npm run typecheck         # Typ-Gate über src + tests + Widget-Einstiegspunkte
npm run lint              # ESLint, nur Korrektheitsregeln (siehe eslint.config.mjs)
```

## REST-API (öffentlich, nur lesend)

Im HTTP-Modus stellt der Server zusätzlich eine kleine **öffentliche REST-Schicht**
bereit — dünne `GET`-Wrapper über dieselben Services wie die MCP-Tools, für
Nicht-MCP-KI-Werkzeuge und den Prompt-Launcher. Nur lesend, `CORS *` für `GET`,
pro IP rate-limitiert (`API_RATE_LIMIT_RPM`, Standard 30/min), Eingaben
serverseitig validiert (Query ≤ 200 Zeichen, nodeId ≤ 50, ≤ 25 IDs). Antworten
sind JSON mit `Cache-Control: no-store` + `nosniff`; Fehler sind
`{ "error": "…" }` mit `4xx`/`5xx`-Status. Eine bewusste Ausnahme:
`GET /api/search` **ohne Suchbegriff** liefert statt 400 ein `200`-Hinweis-
Envelope (leere Buckets + `warnings`) — KI-Abrufschichten entfernen bei
selbst gebauten URLs den Query-String und zeigen dem Modell nur den Status,
die Anleitung muss also in einem lesbaren Body stehen. `?format=html` auf
`/api/search` (beide Formen) rendert dasselbe Envelope als schlichte,
selbstständige HTML-Seite — für KI-Browsing-Pipelines, die URLs öffnen, aber
nur Reader-Inhalte verwerten (rohes JSON fällt weg), und als menschenlesbarer
Share-Link. Die Fläche beschreibt sich für KI-Fetcher selbst über
[`/llms.txt`](public/llms.txt) und eine permissive
[`/robots.txt`](public/robots.txt).

| Endpunkt | Query-Parameter | Liefert |
|---|---|---|
| `GET /api/search/<Begriff>` | Pfad-Form von `/api/search` — der Begriff steht im **Pfad**, Filter bleiben optionale Query-Parameter. Für KI-Werkzeuge bevorzugt: Manche KI-Abrufschichten entfernen bei selbst gebauten URLs den Query-String (live diagnostiziert); die Pfad-Form übersteht das — es fehlen dann höchstens die Filter, nicht die Suche. Ein explizites `q` gewinnt gegen den Pfad-Begriff. | Dasselbe Envelope wie `GET /api/search`. |
| `GET /api/search` | `q` (Pflicht), `educationalContext`, `discipline`, `learningResourceType`, `userRole`, `publisher`, `license`, `maxContent`, `maxCollections`, `skipCount`, `include` (`content,collections,topicPages`), `includeCompendium`, `includeTextContent`, `includeWikipedia`, `includeTopicPageContent`, `maxPerSwimlane`, `includeFacets`, `fields` | Das kombinierte `search_wlo_all`-Envelope (`content` / `collections` / `topicPages`, optional `wikipedia`). Mit `license` meldet `content.licenseFilter: { checked, kept }` den Exaktheits-Pass (das Repository filtert nur Lizenz-FAMILIEN, die Feinauswahl passiert hier); `?format=html` sagt dasselbe in Worten. Ergänzt `unresolvedFilters` (nicht auflösbare Vokabel-Filter + „Meintest du?“-Vorschläge), und — mit `includeFacets=1` — `facets` (`{label, count, uri}` je Bucket; die `discipline`-Facette löst Hochschulfächer auf, siehe unten). Optionales `fields=title,url,…` kürzt jeden Treffer auf diese Schlüssel (`nodeId` bleibt immer) — Token-Ersparnis für LLM-Clients, die das rohe JSON lesen. |
| `GET /api/collection` | `nodeId` (Default `WLO_SKILLS_COLLECTION_ID`), `q` (optional, Suche innerhalb), `max`, `fields`, Vokabular-Filter | Die Inhalte einer Sammlung: `{ collectionId, query, total, results: [{ nodeId, title, description, learningResourceTypes, publisher, url, downloadUrl }] }`. Mit `q` oder einem Vokabular-Filter wird lokal gegen die direkten Kinder der Sammlung geprüft (bis zu 100 in einem Aufruf) — keine eingegrenzte Suche: `virtual:primaryparent_nodeid` beantwortet das Backend mit 400 — und `truncated` + `collectionTotal` kommen dazu, damit eine Stichprobe nicht wie eine vollständige Antwort aussieht. Ohne beides werden diese Kinder schlicht gelistet, mit Upstream-Paging. Mit `license` kommt `licenseFilter: { checked, kept }` dazu — `total` ist bereits gefiltert, ohne die beiden Zahlen ist ein geleertes Ergebnis von einer leeren Sammlung nicht zu unterscheiden. Optionales `fields=…` kürzt jeden Treffer (`nodeId` bleibt immer). Die **Skills**-Quelle des Launchers — je Treffer liefert `downloadUrl` das rohe Markdown. |
| `GET /api/compendium` | `ids` (kommagetrennt) oder `nodeId`, ≤ 25 | `{ entries: [{ nodeId, title, compendiumText }] }` — der VOLLE redaktionelle Kompendiumstext. |
| `GET /api/topic-page` | `collectionId` oder `variantId` (≥ 1 Pflicht), `targetGroup` (`teacher`/`learner`/`general`), `maxPerSwimlane` | Das render-fertige Swimlane-Payload (`variantTitle`, `topicPageUrl`, `swimlanes[]`). |
| `GET /api/wikipedia` | `q` (Pflicht), `lang` (Standard `de`), `sections` (1–3) | Eine Wikipedia-Einleitungszusammenfassung `{ title, extract, thumbnail?, url, lang, match }`, oder `404`, wenn kein Artikel passt. `match` ist `exact` (Titel wie gefragt oder eine Wikipedia-Weiterleitung darauf) oder `fuzzy` (kein Artikel dieses Namens; per Suche aufgelöst und auf Relevanz geprüft). Ein Kandidat, der nicht zum Thema gehört, ergibt `404` statt eines plausiblen falschen Artikels. |
| `GET /api/skills` | — | Der Skill-Katalog `{ skills: [{ id, name, description, path }] }` für KI-Apps (siehe [Prompt-Launcher](#prompt-launcher)). |
| `GET /api/skills/<id>` | — | Der **rohe Markdown-Text** eines Skills (`text/markdown`), oder `404` bei unbekannter id. `<id>` ist heute ein stabiler Slug (später vsl. eine WLO-nodeId). |

```bash
curl "http://localhost:3000/api/search?q=Photosynthese&includeWikipedia=1"
```

Die REST-Schicht wird nur von `http.ts` bedient — **nicht** vom
stdio-Einstiegspunkt.

## Prompt-Launcher

Im HTTP-Modus liefert der Server eine statische, zweisprachige (DE/EN)
**Prompt-Launcher**-Seite unter `GET /launcher.html` (und `GET /` als Komfort),
geführt von **Boerdi**, der WLO-Eule, die beim Einrichten der WLO-Dienste hilft. Es
ist eine self-contained Seite — keine Drittanbieter-Skripte, -Schriften oder
-Anfragen. Man wählt seine KI und klickt einen **Öffnen**-Button; der Launcher
übergibt diesem Chat das **Wissen**, die WLO-Dienste selbst zu nutzen. Die erzeugte
Nachricht erklärt

- wie man sucht — `GET /api/search?q=…` (+ die Filter `discipline` /
  `educationalContext` / `learningResourceType` und die Flags `includeWikipedia` /
  `includeCompendium`) — und das JSON-Ergebnis **roh** lädt und zusammenfasst,
- die weiteren Endpunkte (`/api/topic-page`, `/api/compendium`, `/api/wikipedia`), und
- wie man fertige **Skills** nutzt: Liste unter `GET /api/collection` (die
  konfigurierte WLO-Skill-Sammlung), das rohe Markdown je Skill über dessen
  `downloadUrl`.

Erweiterte Felder (Fach / Stufe / Typ) sind **standardmäßig eingeklappt**; ein
optionaler Suchbegriff wird als konkretes Beispiel eingewoben und treibt den Button
**RAW-Ergebnis laden**. Die Nachricht lässt sich in jeden Chat **kopieren** oder per
Deeplink in **Claude** (`claude.ai/new?q=`), **ChatGPT** (`chatgpt.com/?q=`) oder
**Microsoft Copilot** (`copilot.microsoft.com/?q=`) öffnen; bei **Gemini** (kein
natives URL-Prefill) öffnet die App und die Nachricht landet zum Einfügen in der
Zwischenablage. Nativ eingetragene MCP-Clients erhalten Skills über
`search_skill` + `get_skill`. Ein [Bookmarklet](public/bookmarklet.md) öffnet den Launcher
vorausgefüllt mit dem markierten Text (`/launcher.html?q=<Auswahl>`).

## Tools

| # | Tool | Zweck | Ausgabe |
|---|---|---|---|
| 1 | `search_wlo_collections` | Sammlungen/Themenseiten suchen (Keyword + Baum-Fallback) | markdown / json |
| 2 | `search_wlo_content` | Volltextsuche für einzelne Inhaltselemente; Filter für Fach, Stufe, Typ, Anbieter und **Lizenz** (exakt — der Repository-Schlüssel matcht sonst eine ganze CC-Familie) | markdown / json |
| 3 | `get_collection_contents` | Elemente / Untersammlungen einer Sammlung (paginiert, optional rekursiv) | markdown / json |
| 4 | `get_node_details` | Vollständige Metadaten eines Nodes + optional Volltext + Eltern + Roh-URIs | markdown / json |
| 5 | `search_wlo_all` | **Kombiniert**: Inhalte + Sammlungen + Themenseiten in einem parallelen Aufruf, getrennte Buckets | markdown / json |
| 6 | `lookup_wlo_vocabulary` | Gültige Labels/URIs für ein Filter-Vokabular auflisten | markdown |
| 7 | `search_wlo_topic_pages` | Themenseiten finden/auflisten, Zielgruppen-Varianten zusammenführen | markdown / json |
| 8 | `get_subject_portals` | Die obersten Fachportale unter der WLO-Wurzel | markdown / json |
| 9 | `browse_collection_tree` | In Untersammlungen navigieren (Tiefe 1–2), optional Dateizählungen | markdown / json |
| 10 | `wlo_health_check` | Erreichbarkeit + Latenz der WLO-API | json |
| 11 | `get_nodes_details` | Metadaten im Bulk für viele `nodeIds` parallel | json |
| 12 | `get_topic_page_content` | Die Swimlane-**Inhaltsstruktur** einer Themenseite, render-fertig | markdown / json |
| 13 | `get_wikipedia_summary` | Wikipedia zu einem Begriff: Anriss — oder der GANZE Artikeltext mit `fullText` | markdown / json |
| 14 | `get_compendium_text` | VOLLER redaktioneller Kompendiumstext einer/mehrerer Sammlungen (Bulk, ≤25) | markdown / json |
| 15 | `search_wlo_within_collection` | Gefilterte Suche über die Inhaltsliste einer Sammlung (auch nach Lizenz) | markdown / json |
| 16 | `search` | ChatGPT-Knowledge-Konvention: leichte Treffer `{id,title,url}` über WLO. Mit `WLO_SEARCH_OUTPUT_MODE=rich` zusätzlich die Töpfe und das Widget von `search_wlo_all` | json (+ Text) |
| 17 | `fetch` | ChatGPT-Knowledge-Konvention: volles Dokument eines Knotens `{id,title,text,url,metadata}`. Mit `WLO_SEARCH_OUTPUT_MODE=rich` zusätzlich der vollständige Datensatz (Vorschaubild, Download-Link) und die Detailansicht | json (+ Text) |
| 18 | `lookup_wlo_publishers` | Anbieter/Quellen mit Materialzahl je Anbieter auflisten (Facette) | markdown / json |
| 19 | `get_related_content` | „Mehr davon“: Inhalte mit gleichem Fach/gleicher Stufe wie ein Seed-Node (+ optional Geschwister) | markdown / json |
| 20 | `get_node_breadcrumb` | Ahnenpfad einer Sammlung (Wurzel → Node) im Inhaltsbaum | markdown / json |
| `get_node_collections` | In welchen Sammlungen ein Material geführt wird — die Umkehrung aller anderen Abfragen. Beantwortet „wo ist das eingeordnet?" und „wo finde ich mehr davon?". Löst eine Reference-ID zuerst auf ihr Original auf, damit eine ID aus einem Sammlungs-Listing genauso funktioniert wie eine aus der Suche. |
| 21 | `get_collection_stats` | Zusammensetzung einer Sammlung: Datei-/Untersammlungs-Zahlen + Typ/Fach/Stufe-Aufschlüsselung | markdown / json |
| 22 | `search_skill` | Passende WLO-„Skills“ (Inhaltsart `ai_skill`) finden — nodeId, Titel, Beschreibung, Keywords, ohne Anleitungstext | markdown / json |
| 23 | `get_skill` | Die an einen Skill angehängte Anleitung (SKILL.md) zu einer nodeId laden | markdown / json |
| 24 | `get_wlo_content_text` | Der **eigentliche Volltext** eines Materials (Arbeitsblatt, Artikel), nicht dessen Metadaten — Repository zuerst, verlinkte Seite als Rückfallebene | markdown / json |
| 25 | `get_node_collections` | In welchen Sammlungen ein Material liegt (Rückwärtssuche über `/usage/v1`) | markdown / json |
| 26 | `wlo_auth_status` | Mit welcher Identität diese Sitzung arbeitet und was sie darf | markdown / json |
| 27 | `get_url_text` | **UNSICHER** — der Text hinter einer BELIEBIGEN Web-Adresse, über den Extraktionsdienst. Nicht für WLO-Material (dafür 24). Über `WLO_DISABLE_UNSAFE_TOOLS` abschaltbar; **für den Produktivbetrieb nicht empfohlen** — siehe [Als unsicher deklarierte Werkzeuge](#als-unsicher-deklarierte-werkzeuge) | markdown / json |
| 28 | `get_skill_registry` | Welche Skills EINE Sammlung freigegeben hat — das in ihr abgelegte Registry-Dokument, sein Katalog und die Hinweise der Redaktion | markdown / json |

Die Anzeige-/Such-Tools liefern zusätzlich `structuredContent` (gegen ein
Tool-`outputSchema` validiert) und tragen `annotations` (`readOnlyHint`;
`openWorldHint` bei `get_wikipedia_summary`) — das Fundament für OpenAI Apps SDK
/ MCP Apps. Der Server annonciert werkzeugübergreifende `instructions`.

### Tool-Routing-Heuristik (für LLMs)

- Breites Thema, will Inhalte **und** Sammlungen **und** Themenseiten zusammen → `search_wlo_all`.
- Ein Material-/Ressourcentyp (Video, Arbeitsblatt, …) → `search_wlo_content`.
- Eine Themenseite / Sammlung zu einem Fach → `search_wlo_topic_pages` (Modus B, mit `query`).
- Ein Fach navigieren (Drilldown) → `get_subject_portals`, dann `browse_collection_tree`.
- Nutzer klickt eine Karte an → `get_node_details` mit dieser `nodeId`.
- Metadaten für N gezeigte Karten nötig → `get_nodes_details(nodeIds=[...])` (ein Aufruf, nicht N).
- Sehen, was **auf** einer Themenseite ist → `get_topic_page_content` (nach `search_wlo_topic_pages`).

### Tool-Details

**1. `search_wlo_collections`** — `query`, `parentNodeId?`, `educationalContext?`,
`discipline?`, `maxResults?` (1–50, Standard 5), `excludeNodeIds?` (≤200),
`includeSkillRegistry?`, `outputFormat?`. Versucht zuerst eine Keyword-Sammlungssuche, dann eine
begrenzte Baum-Traversierung ab Wurzel/Elternknoten.

**2. `search_wlo_content`** — `query` (erforderlich), `educationalContext?`,
`discipline?`, `userRole?`, `learningResourceType?`, `publisher?`, `maxResults?`
(1–50, Standard 8), `excludeNodeIds?` (≤200), `includeTextContent?` (Standard
false — holt zusätzlich den gespeicherten Volltext je Treffer, gekappt; ein
Round-Trip pro Treffer), `includeFacets?` (Standard false — Facetten-Zähler in
`_queryMeta.facets`, laufen parallel), `outputFormat?`.
Multi-Query-Expansion + Qualitäts-Reranking.

**3. `get_collection_contents`** — `nodeId` (erforderlich), `query?`, `contentFilter?`
(`files` | `folders` | `both`, Standard `files`), `includeSubcollections?`
(rekursiv, nur Dateien), `maxResults?` (1–100, Standard 20), `skipCount?`,
`excludeNodeIds?` (≤200), `outputFormat?`.

**4. `get_node_details`** — `nodeId` (erforderlich), `includeTextContent?`,
`includeParents?`, `includeRaw?`, `outputFormat?`. Gibt dieselbe
`FormattedNode`-Struktur zurück wie die Suchtools, dazu optional gespeicherten
Volltext, Eltern-Sammlungen und rohe `ccm:*`/`cclom:*`-URIs. Bei Sammlungen mit
gepflegtem **kompendialem Text** (`ccm:oeh_collection_compendium_text`) kommt
dieser als `compendiumText` mit — die sachrichtigste Quelle für eine
Sammlungszusammenfassung. Die Detail-Tools liefern den vollen Text
(`-all-`-Abfrage); Sammlungssuche/-liste/-browse liefern ihn ebenfalls (Teil von
`DISPLAY_PROPS`) — in `markdown` auf 500 Zeichen gekürzt, in `json` vollständig.

**5. `search_wlo_all`** — `query` (erforderlich), die sechs Filter (inkl. `license`), `maxContent?`
(1–50, Standard 8), `maxCollections?` (1–20, Standard 5), `include?`
(`['content','collections','topicPages']`), `excludeNodeIds?` (≤200),
`skipCount?` (Inhalts-Paging), `includeFacets?` (Standard false — Facetten-Zähler
in `_queryMeta.facets`, laufen parallel) sowie die optionalen Anreicherungs-Flags
`includeCompendium?` / `includeTextContent?` / `includeWikipedia?` /
`includeTopicPageContent?` (+ `maxPerSwimlane?`, 1–10, Standard 3),
`outputFormat?` (Standard `json`). Führt Inhalts-, Sammlungs- und (bei Bedarf)
Wikipedia-Suche parallel aus und gibt drei Buckets zurück (+ optional
`wikipedia`); Anreicherungen laufen gebündelt/parallel über die Ergebnisse.
Hinweis zu `total`: `content.total` ist die tatsächliche Backend-Trefferzahl;
`collections.total`/`topicPages.total` sind die angezeigten Anzahlen. Die Logik
liegt in `src/services/search.ts::searchAll` (geteilt mit REST-Schicht/Widgets).

**6. `lookup_wlo_vocabulary`** — `vocabulary` (`educationalContext` | `discipline`
| `userRole` | `lrt` | `license` | `targetGroup` | `universitySubject`). Listet
Labels + URIs; rein lokal, kein API-Aufruf. `universitySubject` (Hochschulfächer,
344 Konzepte) ist groß, daher mit einem freien `query` (z. B. `"Maschinenbau"`)
eine kurze Fuzzy-Auswahlliste `{label, uri}` abrufen — die gewählte `uri` ist
direkt als `discipline`-Filter nutzbar. Modellfrei (Levenshtein), nie automatisch aufgelöst.

**7. `search_wlo_topic_pages`** — `query?`, `targetGroup?` (`teacher` | `learner`
| `general`), `educationalContext?`, `collectionId?`, `withinCollectionId?`,
`mergeVariants?` (Standard true), `sort?` (`relevance` | `alpha`), `maxResults?`
(1–20, Standard 5), `includeContent?` (Standard false; JSON-Modus — hängt je
Seite die aufgelösten Swimlane-Inhalte `content` an, ≤5 parallel) +
`maxPerSwimlane?` (1–10, Standard 3), `outputFormat?`. Vier Modi: per
`collectionId` (hat DIESE Sammlung eine), per `withinCollectionId` (alle
Themenseiten im Teilbaum — für das Fachportal Physik 20+ statt 1), per `query`
(Suche → auf Themenseite prüfen) oder nur mit Filtern (alle auflisten). Beide
Profil-Filter lassen Varianten ohne den jeweiligen Wert stehen: rund 90 % der
Themenseiten tragen keinen, ein strikter Filter würde den Bestand verbergen
statt eingrenzen. Hat eine Seite mehrere Varianten, steht die tatsächlich
angezeigte vorn und trägt `isDefault`.

**8. `get_subject_portals`** — `educationalContext?`, `includeContentCounts?`,
`outputFormat?`. Die Sammlungen der ersten Ebene direkt unter der WLO-Wurzel
(Mathematik, Informatik, …), alphabetisch sortiert.

**9. `browse_collection_tree`** — `nodeId?` **oder** `subject?` (mindestens eines;
gib einen Fachportal-Namen wie `"Mathematik"`/`"Mathe"` an, der server-seitig zum
Portal aufgelöst wird — kein `get_subject_portals`-Round-Trip nötig; ein
unbekanntes Fach liefert die Liste der verfügbaren Portale), `depth?` (1–2,
Standard 1), `includeContentCounts?`, `includeContentPreview?` (1–5 — hängt je
Untersammlung die ersten N Inhalte als `contentPreview` an, gebündelter Durchlauf),
`maxResults?` (1–100, Standard 50), `outputFormat?`.

**10. `wlo_health_check`** — keine Parameter. Gibt `ok`, Latenz, Repository-URL
und aufgelösten Wurzel-Titel zurück.

**11. `get_nodes_details`** — `nodeIds` (Array, 1–50, erforderlich),
`includeTextContent?` (Standard false), `includeParents?` (Standard false).
Metadaten im Bulk (dieselbe `FormattedNode`-Struktur, nach nodeId indiziert),
je Knoten optional angereichert wie `get_node_details`. Fehlgeschlagene Abfragen
werden in einem `failed`-Array zurückgegeben, nicht als Gesamtfehler.

**12. `get_topic_page_content`** — `collectionId?` **oder** `variantId?` (mindestens
eines erforderlich), `targetGroup?`, `outputFormat?`, `maxPerSwimlane?` (1–10,
Standard 3). Gibt die Swimlane-Abschnitte der Themenseite zurück. Im JSON-Modus ist
jede Swimlane **render-fertig**: Sie trägt ihre Überschrift plus bis zu
`maxPerSwimlane` echte Inhaltskarten, aufgelöst durch Ausführen der gespeicherten
Query des Swimlane-Widgets, mit einem `hasMore`-Flag und einem
`topicPageUrl`-Sprunglink. Nach `search_wlo_topic_pages` verwenden.

**13. `get_wikipedia_summary`** — `query` (erforderlich, ≤200), `language?`
(ISO-639, Standard `de`), `sections?` (1–3 führende Absätze, Standard 1),
**`fullText?`** (Standard false), `maxChars?` (500–100000, Standard 8000),
`outputFormat?`. Liefert einen Wikipedia-Einleitungsauszug mit Link (und optional
Thumbnail); löst einen unscharfen/falsch geschriebenen Begriff via opensearch auf,
wenn der direkte Titel nicht trifft. Mit `fullText: true` kommt statt des Anrisses der GANZE Artikel als Klartext
(gemessen 2026-08-06: Apolda 366 Zeichen als Anriss, 123.682 als Artikel — daher
die Kappung über `maxChars` an einer Wortgrenze). Geholt wird der Artikel zum
AUFGELÖSTEN Titel, also nach der Relevanzprüfung; der zusätzliche Rundlauf ist
genau der Preis dieser Prüfung. Kein Extraktionsdienst beteiligt.
Für enzyklopädischen Kontext neben
WLO-Material — nicht für die OER-Materialsuche. `readOnlyHint` + `openWorldHint`.

**14. `get_compendium_text`** — `nodeId?` **oder** `nodeIds?` (Array, ≤25),
`outputFormat?`. Gibt den VOLLEN, ungekürzten redaktionellen Kompendiumstext der
angegebenen Sammlung(en) zurück — die maßgebliche Prosa-Übersicht — für den Fall,
dass ein Sammlungstreffer nur die 500-Zeichen-Vorschau zeigt. `compendiumText`
ist `null` für Knoten ohne die Eigenschaft.

**15. `search_wlo_within_collection`** — `nodeId` (erforderlich, die Sammlung),
`query?`, die sechs Vokabular-Filter (inkl. `license`), `maxResults?` (1–50,
Standard 10), `skipCount?`, `outputFormat?`. Suchbegriff und Filter werden
LOKAL gegen die Inhaltsliste der Sammlung geprüft — bis zu 100 direkte Kinder,
und die Ausgabe sagt es, wenn es mehr sind. Kein Teilbaum und kein
`virtual:primaryparent_nodeid`: dieses Kriterium beantwortet das Backend mit 400
(live geprüft 2026-07-17), deshalb ist die Inhaltsliste der Geltungsbereich. Für eine unbegrenzte Suche `search_wlo_content`, zum
ungefilterten Auflisten `get_collection_contents` nutzen.

**16. `search`** und **17. `fetch`** — die ChatGPT-*Knowledge-Konvention*, ein
festes Paar aus Namen und Formen, das ein Host für belegte Antworten von sich
aus aufrufen darf. `search` nimmt eine `query` und liefert bewusst leichte
Treffer (`{id, title, url}`), damit ein Modell zitieren kann, ohne volle
Datensätze zu bezahlen; `fetch` nimmt eine dieser `id`s und liefert das ganze
Dokument (`{id, title, text, url, metadata}`). Beide sind eine dünne Schicht
über derselben Pipeline wie 2 und 23 — angeboten unter den Namen, die die
Konvention verlangt, damit ein Host sie findet. Für alles, was eine Person in
Worten fragt, sind die reichhaltigeren Werkzeuge oben die bessere Wahl.

**18. `lookup_wlo_publishers`** — `query?`, `discipline?`, `educationalContext?`,
`maxResults?` (1–100, Standard 20), `outputFormat?`. Listet die Anbieter/Quellen
(`ccm:oeh_publisher_combined`) mit Materialzahl je Anbieter, per Facetten-Aggregation
über den Live-Index (größte zuerst). Optional auf Thema/Fach/Stufe begrenzt. Nützlich,
um gültige Werte für den `publisher`-Filter zu finden.

**19. `get_related_content`** — `nodeId` (erforderlich, der Seed), `maxResults?`
(1–30, Standard 8), `includeSiblings?` (Standard `false`), `outputFormat?`. Liest
Fächer + Bildungsstufen des Seed-Nodes und findet anderes Material mit gleichem
Profil (der Seed wird ausgeschlossen); `includeSiblings` liefert zusätzlich die
übrigen Inhalte der primären Eltern-Sammlung. „Was passt noch dazu?“

**20. `get_node_breadcrumb`** — `nodeId` (erforderlich), `outputFormat?`. Gibt den
Ahnenpfad des Nodes zurück, geordnet Wurzel → Node (ein `/parents`-Aufruf,
zyklus- und tiefengeschützt). Funktioniert für Sammlungs-Knoten; Datei-/Inhalts-
Knoten haben hier keinen Breadcrumb und liefern einen leeren Pfad.

**21. `get_collection_stats`** — `nodeId` (erforderlich), `outputFormat?`. Fasst
eine Sammlung zusammen: Gesamtzahl Dateien und Untersammlungen, plus eine
Aufschlüsselung ihrer Dateien nach Ressourcentyp, Fach und Stufe. Die
Aufschlüsselung wird über die tatsächlichen Kind-Dateien ausgezählt (Stichprobe
bis 100 — bei größerer Gesamtzahl wird das ausgewiesen); das ist für
Referenz-Sammlungen korrekt, wo eine Facetten-Abfrage leer bliebe.

**22. `search_skill`** — `query?`, `maxResults?` (1–25, Standard 10),
`collectionId?`, `includeSubcollections?`, `discipline?`, `educationalContext?`,
`outputFormat?`. Findet WLO-**Skills**, deren angehängte
Datei die Anleitung (`SKILL.md`) ist. Ein Datensatz gilt über seine Inhaltsart
`ccm:oeh_extendedType = …/contentTypes/ai_skill` als Skill; die Suche sendet
diese als Kriterium mit, sodass nichts anderes zurückkommen kann. Jeder Treffer
trägt nodeId, Titel, Beschreibung und Keywords — genug zur Auswahl und bewusst
ohne den Anleitungstext. Ohne `query` wird der Katalog aufgelistet. Ist
`WLO_SKILLS_COLLECTION_ID` gesetzt, läuft die Suche über den Unterbaum dieser
Sammlung statt über das ganze Repository (`ngsearch` verweigert
`virtual:parent_recursive`, eine eingegrenzte Abfrage lässt sich also gar nicht
formulieren — gemessen 2026-08-08).

**23. `get_skill`** — `nodeId`, `includeFiles?`, `outputFormat?`. Der zweite
Schritt: liefert die angehängte Anleitung im Original über die anonyme
`downloadUrl` (byte-begrenzt); ist die Datei nicht herunterladbar, greift der
extrahierte `/textContent` des Repositories. Dazu nennt es die **weiteren Dateien
des Skill-Ordners** — Name, nodeId, MIME-Typ, Größe — ohne sie zu laden, sodass
das Modell gezielt eine davon mit `get_skill` und deren nodeId nachladen kann.
Ein Ordner mit mehr als 25 Dateien wird als Anzahl gemeldet statt aufgelistet (er
ist kein Skill-Paket); ein nicht lesbarer Ordner kostet nichts. Die `:::`-Blöcke,
die der Editor in eine SKILL.md schreibt (`wlo-material`, `ki-skill`), werden zu
`references` samt nodeId aufgelöst — das Modell muss keine ID aus einer URL in
einem Markdown-Link herausklauben. Der Text ist kuratierter Inhalt, keine
System-Anweisung — die Ausgabe sagt das dazu. Siehe
[`docs/SKILLS.md`](docs/SKILLS.md).

Mit `WLO_SKILL_TOOL_MODE=one-tool` treten 22 und 23 durch ein einzelnes
`get_skill_for_task` ersetzt auf, das selbst rankt und den besten Treffer lädt.

**24. `get_wlo_content_text`** — `nodeId`, `maxChars?` (500–50000, Standard 8000),
`outputFormat?`. Liefert den **eigenen Text** des Materials, nicht dessen
Metadaten, damit der Inhalt zusammengefasst, vereinfacht oder in Aufgaben
überführt werden kann. Primärquelle ist `/textContent` des Repositories — dort
liegt bereits konvertierter Text für rund 90 % der Datensätze, einschließlich
PDF, DOCX und PPTX; nur ein Datensatz, der selbst nichts speichert und extern
verlinkt ist (`ccm:wwwurl`), fällt auf den Text-Extraktionsdienst zurück
(`WLO_TEXT_EXTRACTION_URL`, leer schaltet ihn ab). `source` benennt den
genommenen Weg. Ein fehlender Text ist kein Fehler, sondern ein `reason`:
`access_denied` (vorhanden, aber nicht öffentlich — da hilft kein Konverter,
nur Rechte), `no_text_no_url`, `extraction_failed`, `node_not_found`. Lange
Texte werden gekürzt und als solche markiert (`truncated`).

**25. `get_node_collections`** — `nodeId`, `outputFormat?`. Der
umgekehrte Weg zum Stöbern: zu einem Material die kuratierten Sammlungen, die es
führen. Die Antwort auf „wo ist das eingeordnet?“ und „wo finde ich mehr davon?“
— vom einzelnen Fundstück zurück zur Sammlung. Für die Einordnung einer
*Sammlung* im Baum ist 20 (`get_node_breadcrumb`) zuständig.

**26. `wlo_auth_status`** — ohne Parameter. Mit welchen Rechten dieser Server
gerade liest: `anonymous` (nur öffentliche Daten, der Standard), `service` (ein
fest konfiguriertes Konto, dieselben Rechte für alle) oder `user` (die Rechte
der angemeldeten Person). `authenticated` ist eine **eigene** Aussage:
`service`/`user` bei `authenticated: false` heißt, WLO lehnt die hinterlegten
Zugangsdaten ab — dann schlagen *alle* Abfragen fehl, es kommen nicht etwa nur
öffentliche Inhalte, sondern gar keine. Ein Konfigurationsfehler, den man
benennen sollte, statt eine leere Welt zu melden.

**27. `get_url_text`** *(UNSICHER — siehe [Als unsicher deklarierte Werkzeuge](#als-unsicher-deklarierte-werkzeuge))*
— `url`, `method?` (`browser` Standard / `simple`), `maxChars?` (500–50000,
Standard 8000), `outputFormat?`. Der Text hinter einer **beliebigen**
Web-Adresse — für eine Adresse, die im Gespräch genannt wurde, nicht für einen
WLO-Datensatz. Für WLO-Material 23 nehmen: das liest direkt aus dem Repository,
ist schneller und funktioniert dort, wo dieses Werkzeug scheitert. Kein Text ist
eine normale Antwort mit `reason` — `not_http`, `private_host`, `dns_failed`,
`service_disabled` (eine Server-Einstellung fehlt, das liegt nicht an der Seite),
`extraction_failed`. Bei letzterem lohnt genau ein zweiter Versuch mit dem
anderen `method`: der Dienst rendert mit Playwright und hat bekannte Lücken
(geschützte oder bot-gesperrte Seiten, reine Mediendateien). Die gemeldete `url`
ist die **normalisierte** — die tatsächlich angefragte, die nicht immer die
übergebene Zeichenkette ist.

**28. `get_skill_registry`** — `collectionId`, `outputFormat?`. Welche Skills
**eine Sammlung freigegeben** hat — die Umkehrung dessen, was 22 beantwortet:
nicht „welche Skills gibt es", sondern „welche gelten *hier*". Eine Redaktion
legt dazu ein Registry-Dokument in die Sammlung — ein `ai_prompt`-Datensatz
mit angehängtem Markdown —, dessen `:::`-Blöcke die freigegebenen Skills nennen.
Zurück kommt der Katalog (je Skill Titel, nodeId, Beschreibung, Keywords) plus
die Prosa der Redaktion, in der die Anwendungshinweise stehen. Die Anleitungen
selbst kommen nicht mit: aus dem Katalog wählen, dann 23 aufrufen.

Was sich nicht klar sagen lässt, wird offengelegt statt geglättet: eine
mehrdeutige Auswahl, wenn eine Sammlung mehrere Prompt-Dokumente führt;
Verweise, die auf keinen lesbaren Datensatz zeigen; ein bei 100 Einträgen
gekappter Katalog; und eine bei 50 Dateien abgeschnittene Liste — bei einer
Sammlung mit 400 Dateien wäre „hier ist keine Registry" eine Behauptung, die der
Abruf nicht trägt.

### Mit Skills arbeiten

Drei Werkzeuge, und der Unterschied liegt in der Frage, die sie beantworten:

| Frage | Werkzeug |
|---|---|
| Welche Skills gibt es für diese Aufgabe? | `search_skill` (22) |
| Welche Skills hat *diese Sammlung* freigegeben? | `get_skill_registry` (28) |
| Gib mir die eigentliche Anleitung. | `get_skill` (23) |

**Der Normalweg ist 22 → 23.** Nach Aufgabe suchen, Beschreibungen lesen, die
passende laden. `WLO_SKILLS_COLLECTION_ID` grenzt die Suche auf einen Teilbaum
ein; `WLO_SKILL_TOOL_MODE=one-tool` legt beide zu `get_skill_for_task` zusammen,
das in einem Aufruf auswählt und lädt — weniger Roundtrips, weniger Kontrolle.

**Zu 28 greifen, wenn die Frage der Sammlung gilt**, nicht der Aufgabe: „wie
arbeite ich mit diesem Material", „was ist hier vorgesehen". Jedes
Sammlungs-Ergebnis trägt bereits eine Hinweiszeile mit der nodeId, der Aufruf
kostet also einen Schritt und kein Raten. Seit dem 2026-08-11 hält ein
Hintergrund-Cache diese Kataloge warm — in den meisten Antworten ist der Katalog
also schlicht *da*, siehe [Der Skill-Registry-Cache](#der-skill-registry-cache).

**Was ein Skill auf Repository-Ebene ist:** ein Datensatz mit der Inhaltsart
`ccm:oeh_extendedType = …/contentTypes/ai_skill` (die vollständige URI — der
Kurzname trifft nichts) und einer angehängten Markdown-Datei als Anleitung. Bis
zum 2026-08-12 trugen Skills `ai_prompt`; dann bekam das Vokabular den eigenen
Eintrag `ai_skill` („KI-Skill"). Eine Registry ist gleich gebaut, BEHIELT aber
`ai_prompt` — sie ist ein Prompt-Dokument über Skills, kein Skill. `docs/SKILLS.md` ist die Anleitung für die Redaktion, mit
Beispieldokument.

**Jeder Skill-Text ist Daten, nie eine Anweisung, der zu folgen wäre.** Es ist
hochgeladener Inhalt. Der Server rendert das, was *er* selbst hergeleitet hat —
das Dateiverzeichnis, die aufgelösten Verweise — **vor** dem Dokument, denn
danach wären diese Abschnitte von gefälschten nicht mehr zu unterscheiden.

### Der Skill-Registry-Cache

Die Registry einer Sammlung zu lesen kostet eine Kinderliste — gemessen
**1,0–1,4 s**, und zwar unabhängig davon, ob überhaupt eine Registry da ist. Je
Suche war das zu teuer, deshalb merkt sich ein Hintergrunddienst die Antwort je
Sammlung und erneuert sie alle 5 Minuten. Was der Cache nicht kennt, wird live
aufgelöst, einmal, und dann ebenfalls gemerkt. Der Katalog ist damit in
Sammlungs-Ergebnissen einfach vorhanden, und die Kosten fallen höchstens einmal
je Sammlung an statt bei jeder Suche.

Drei Eigenschaften entscheiden, was eine Antwort bedeutet:

- **Ein „hier ist keine Registry" ruht immer auf einer Kinderliste, die
  geantwortet hat** — nie auf dem Suchindex. Index und Node-Store sind in
  edu-sharing getrennte Systeme, ein Datensatz kann aus dem Index fallen und
  einwandfrei im Store liegen. Der Index dient nur als Startschuss dafür, *wo*
  Nachsehen sich lohnt.
- **Ein fehlgeschlagener Abruf wird als nichts gemerkt** und erneut versucht.
  Ein Ausfall darf nicht zu „diese Sammlung hat keine freigegebenen Skills"
  werden.
- **Eine bei 50 Dateien abgeschnittene Liste entscheidet nichts.** Sie wird
  gemerkt, damit dieselbe Seite nicht erneut gelesen wird, zählt aber nicht als
  geprüft — bei 400 Dateien kann die Registry schlicht hinter der Kappung
  liegen. Die Antwort behält dann ihre Hinweiszeile.

**Aktualität:** ein Eintrag gilt bis zu `WLO_SKILL_CACHE_TTL_MS` (10 min), eine
gerade angelegte Registry kann also nachhinken. `includeSkillRegistry: true` an
`search_wlo_all` / `search_wlo_collections` erzwingt einen frischen Abruf, und
`get_skill_registry` liest immer live — nach dem Anlegen oder Ändern einer
Registry zu einem von beiden greifen.

### Wikipedia-Auflösung

`get_wikipedia_summary` und `GET /api/wikipedia` antworten auf zwei Weisen, und
das Feld `match` sagt, auf welche:

- **`exact`** — Wikipedia hat einen Artikel unter dem gefragten Namen oder eine
  **Weiterleitung** darauf (`Bruchrechnen` → `Bruchrechnung`). Eine Weiterleitung
  ist eine redaktionelle Aussage, dass beide Namen dasselbe Thema meinen, und
  wird deshalb ungeprüft übernommen.
- **`fuzzy`** — kein Artikel dieses Namens. Die Anfrage geht an die
  Wikipedia-Suche, und es wird der Kandidat gewählt, um den es tatsächlich geht
  — nicht einfach der erste. `Feinoptik` → `Feinoptiker`, `Dreiecke` → `Dreieck`.

**Passt kein Kandidat zum Thema, lautet die Antwort „kein Artikel" — nie die
nächstliegende Zeichenkette.** Vor dieser Absicherung gemessen: `Stadt Berlin`
lieferte `Bern`, `Dreiecke` lieferte `Dreiecker`, einen Berg im Allgäu. Wer den
Extrakt zu Unterrichtsmaterial verarbeitet, hängt eine Quellenangabe auf den
Artikel an — ein plausibler falscher Artikel sieht dann nicht nur schief aus,
sondern veröffentlicht eine falsche Quellenangabe. Die verworfenen Kandidaten
stehen im Log, damit ein Fehlschlag nachvollziehbar bleibt.

Die Prüfung läuft nur auf den Suchkandidaten. Zwei Folgen sind wissenswert: eine
Weiterleitung wird nie angezweifelt (ohne Stemmer lässt sich „Bruchrechnen" und
„Bruchrechnung" durch keine Regel verbinden), und ein Artikel, der das Thema nur
*erwähnt*, wird dafür nicht angenommen — `Stabi Berlin` ist nicht die Antwort auf
`Stadt Berlin`, obwohl eine reine Wortvorkommen-Prüfung ihn nähme.

## Anmelden per OAuth

Wer mit den eigenen WLO-Rechten arbeiten will, meldet sich im Client an — ohne
irgendetwas zu kopieren. Voraussetzungen: `WLO_AUTH_PRIVATE_KEY` und
`WLO_PUBLIC_BASE_URL` sind gesetzt (ohne sie antworten alle OAuth-Pfade 404).

1. Im Client die MCP-Adresse eintragen und als Authentifizierung **OAuth**
   wählen. Der Client findet den Rahmen selbst über
   `/.well-known/oauth-authorization-server` und registriert sich.
2. Der Client schickt den Browser auf `/oauth/authorize`. Dort steht, **wer**
   fragt und wohin zurückgeleitet wird; darunter Benutzername und Passwort.
   Das Passwort wird **im Browser verschlüsselt** und verlässt das Gerät nur als
   unlesbarer Block — genauso wie auf `/auth`.
3. Zurück im Client funktionieren die Kurationswerkzeuge — gelistet waren sie
   die ganze Zeit, sie haben bis dahin nur verweigert.

**Oder ohne Konto verbinden.** Neben Anmelden und Ablehnen steht auf der
Zustimmungsseite ein dritter Knopf: *„Ohne eigenes WLO-Konto verbinden"*. Er
existiert, weil ein Client, der die Discovery-Dokumente gefunden hat, einen
Token WILL und nicht einfach nichts schicken kann — ohne ihn bleibt jemandem,
der nur suchen möchte, nur Anmelden oder Abbrechen, und Abbrechen ist keine
Verbindung (gemessen bei claude.ai am 2026-08-06). Der ausgestellte Token
gewährt exakt das, was ein Aufruf ohne `Authorization` gewährt — lesen ja,
schreiben nein. Warum er kein eigenes Schlüsselmaterial braucht, steht in
[`docs/AUTH.md`](docs/AUTH.md).

**Die Anmeldung kann aus einem Werkzeugaufruf heraus beginnen.** Die
Kurationswerkzeuge stehen auch ohne Identität in `tools/list`, als `oauth2`
deklariert; ein Aufruf ohne brauchbare Anmeldung liefert eine Fehlerantwort mit
`_meta["mcp/www_authenticate"]`, und das ist für den Client das Zeichen, den
obigen Ablauf zu starten. Sie stattdessen zu verstecken — was dieser Server bis
zum 2026-08-05 tat — hieß: das Modell ruft nie eines auf, also fordert nie
jemand eine Anmeldung an, und ein ohne OAuth eingerichteter Connector blieb für
immer anonym. Die Verweigerung selbst ist unverändert: anonym schreibt niemand.

**Es gibt kein zweites Geheimnis.** Der ausgegebene Zugangstoken *ist* der
`wlo2.…`-Block. Deshalb beendet ein einziger Widerruf auf
[`/auth-revoke.html`](#) beide Wege gleichzeitig — den eingefügten Block und die
OAuth-Verbindung. Es gibt kein `refresh_token` und keine Ablauffrist: der Zugang
endet, wenn er widerrufen oder das WLO-Passwort geändert wird.

**Wer nichts mitschickt, liest weiter anonym.** Eine Anfrage ohne
`Authorization` bekommt die **vollständige** Liste — alle 42 Werkzeuge, die
vierzehn Kurations-Werkzeuge eingeschlossen. Die sind für jeden *sichtbar* und
verweigern erst beim Aufruf, mit einer OAuth-Aufforderung: genau daran bietet
ein Host die Anmeldung an, denn ein Modell, das nie ein Schreibwerkzeug sieht,
fragt auch nie danach. Der `401` entsteht nur bei einem vorgelegten, aber
unbrauchbaren Token — und trägt dann den Verweis auf die Discovery-Dokumente.

> **In ChatGPT:** eine im Einstellungsdialog verbundene App ist in einer
> Unterhaltung noch nicht aktiv. ChatGPT zeigt dort eine eigene Karte
> („wlo verbinden"), und die erscheint erst, wenn eine Frage sie auslöst — einmal
> nach WLO fragen und bestätigen. Ohne das hat das Modell keine Werkzeuge, und
> ein Modell ohne Werkzeuge antwortet, als hätte es gesucht.

## Kuratieren (Schreiben in WLO)

Kuratierende Werkzeuge verändern Daten im Repository. Sie sind deshalb doppelt
abgesichert und handeln nie in einem Schritt.

**Wer schreiben darf.** Anonyme Aufrufende nie — die Werkzeuge werden gar nicht
erst registriert und tauchen in `tools/list` nicht auf. Wer sich mit dem eigenen
WLO-Login meldet, immer. Das eingerichtete Dienstkonto nur, wenn
`WLO_ALLOW_SERVICE_WRITES` gesetzt ist: eine Änderung unter einem gemeinsamen
Konto ist niemandem zuzuordnen, weil in der Historie des Repositorys der
Kontoname steht und nicht die Person, die sie angefordert hat. Das betrifft auch
den stdio-Modus, wo die Zugangsdaten aus der Umgebung kommen und daher als
Dienstkonto gelten.

Jedes Werkzeug verweigert zusätzlich zur Aufrufzeit — ein Host kann eine
Werkzeugliste ausliefern, die er in einer angemeldeten Sitzung zwischengespeichert
hat.

**Immer zwei Schritte.** Ein Aufruf ohne `confirmToken` schreibt nichts. Er liest
den Datensatz, zeigt genau, was sich ändern würde, und gibt einen einmalig
gültigen Schlüssel zurück, der zehn Minuten hält. Erst ein zweiter Aufruf mit
diesem Schlüssel schreibt. Der Schlüssel hängt an einer Prüfsumme der
geplanten Änderung — die Vorschau einer harmlosen Korrektur kann also keine
andere Änderung freigeben. Genau das bräuchte ein Prompt-Injection-Angriff.

**Nichts gilt als gespeichert, bis es zurückgelesen wurde.** edu-sharing
antwortet in drei gemessenen Fällen mit `200` und verwirft den Wert trotzdem:
wenn das Metadatenset die Eigenschaft herausfiltert, wenn dem Knoten der
tragende Aspect fehlt und wenn die aufrufende Person das Recht nicht hat. Nach
jedem Schreibvorgang wird der Datensatz erneut gelesen und je Feld berichtet, ob
der Wert gespeichert, verworfen oder vom Repository umgeschrieben wurde. Ein
verworfenes Feld wird nie als Erfolg gemeldet.

**Ein abgebrochener Aufruf lässt das Ergebnis offen — er wird nie als
Fehlschlag gemeldet.** Antwortet das Repository nicht rechtzeitig, trifft der
Abbruch die *Antwort*, nicht die Arbeit: auf Staging gemessen, hatte ein
zeitlich abgelaufenes Anlegen den Datensatz bereits erzeugt. Jedes
Kurationswerkzeug trennt deshalb „das Repository hat abgelehnt" (es ist nichts
passiert, und das wird klar gesagt) von „wir haben aufgehört zuzuhören" (das
Ergebnis ist offen, die Antwort sagt das und schickt zum Nachsehen). Am meisten
zählt das bei den beiden Löschwerkzeugen: ein falsches „konnte nicht gelöscht
werden" ist genau das, was jemanden davon abhält nachzuschauen, ob sein Material
noch da ist.

**Versionen.** Standardmäßig ändert eine Bearbeitung den Datensatz an Ort und
Stelle (`PUT`). Mit `commit: true` und einem `versionComment` wird eine
Arbeitsrunde als neue Version abgeschlossen (`POST`) — sonst hinterließe ein
Gespräch, das einen Titel dreimal korrigiert, drei Versionen.

| Werkzeug | Was es tut |
|---|---|
| `wlo_update_content` | Ändert einen vorhandenen Datensatz: seine Metadaten und/oder **den Inhalt selbst** — `content`/`fileBase64` ERSETZT die hinterlegte Datei (überarbeitetes Arbeitsblatt, neues Bild); die bisherige Fassung bleibt in der Versionshistorie. Metadaten: Titel, Beschreibung, Schlagwörter (werden ergänzt, nicht ersetzt), Quell-URL, Sprache, Autor, Herausgeber, Lizenz, Inhaltstyp, Fach, Bildungsstufe, Zielgruppe. |
| `wlo_create_content` | Legt einen neuen Datensatz an, auf **zwei Wegen**. `url` — das Material liegt woanders und wird verlinkt; gibt es zu dieser URL schon einen Datensatz, wird dieser genannt statt einen zweiten anzulegen. `content` / `fileBase64` — der Datensatz **traegt** das Material als Datei (im Chat geschriebenes Markdown, ein erzeugtes PNG/JPEG/GIF/WebP, als reines Base64 oder als `data:`-URL), fuer Inhalte ohne eigene URL. Genau eine Quelle. Der Upload steht mit Name, Typ, Groesse und Pruefsumme in der Bestaetigungs-Vorschau und wird danach zurueckgelesen. Der Datensatz ist ein Entwurf und geht NICHT in die redaktionelle Warteschlange. |
| `wlo_submit_content` | Reicht einen vorhandenen Datensatz zur redaktionellen Pruefung ein. Ein eigener Schritt, nie automatisch — damit kein Entwurf bei der Redaktion landet, weil jemand noch am Schreiben war. |
| `wlo_create_collection` | Legt eine Sammlung an (eine kuratierte Themenseite), auf oberster Ebene oder als Untersammlung. |
| `wlo_rename_collection` | Ändert Titel und Beschreibung einer Sammlung. |
| `wlo_add_to_collection` | Nimmt vorhandenes Material in eine Sammlung auf. Nichts wird verschoben oder kopiert — eine Sammlung enthält Verweise. |
| `wlo_remove_from_collection` | Nimmt Material aus einer Sammlung heraus. Das Material bleibt bestehen und in allen anderen Sammlungen. |
| `wlo_update_compendium` | Schreibt, ersetzt oder entfernt den redaktionellen Kompendialtext einer Sammlung (Markdown). |
| `wlo_set_topic_page` | Legt fest, **welche Variante** eine Themenseite öffentlich rendert. Legt nichts an, löscht und sortiert nichts. Das einzige Kurationswerkzeug, dessen Ergebnis sofort öffentlich sichtbar ist — deshalb liegen alle Prüfungen hier: Das gespeicherte `ccm:page_config`-Dokument wird bearbeitet statt neu gebaut (unbekannte Schlüssel und die Variantenliste bleiben erhalten), eine fremde Variante wird abgelehnt, ein unlesbares Dokument nicht überschrieben, und danach wird zurückgelesen und neu geparst. Das Repository prüft davon nichts — gemessen am 09.08.2026 speichert es auch die Zeichenkette `"not json at all"` und antwortet mit 200. |
| `wlo_suggest_metadata` | Schlägt Werte mit Begründung vor, statt sie zu schreiben. Der Datensatz bleibt unverändert. |
| `wlo_list_suggestions` | Zeigt die hinterlegten Vorschläge mit Begründung, Status und der ID zum Entscheiden. |
| `wlo_decide_suggestion` | Nimmt an (schreiben, zurücklesen, dann vermerken) oder lehnt ab. |
| `wlo_delete_content` | Löscht einen Datensatz. Über diesen Server nicht rückgängig zu machen — siehe unten. |
| `wlo_delete_collection` | Löscht eine Sammlung samt Untersammlungen. Das darin verlinkte Material bleibt bestehen. |

**Löschen ist hier endgültig.** `recycle=true` wird immer mitgeschickt, das Repository behält also möglicherweise eine Archivkopie — eine personenbezogene Archivabfrage fand einen gelöschten Knoten aber nur einmal und Minuten später für denselben Knoten nichts mehr. Wiederherstellbarkeit ließ sich damit nicht zeigen. Die Werkzeuge sagen deshalb, dass sich die Löschung über diesen Server nicht rückgängig machen lässt, und versprechen keine Wiederherstellung. Material aus einer Sammlung herauszunehmen (`wlo_remove_from_collection`) ist etwas anderes und lässt das Material unangetastet. Die vier Start-Skripte (`dev`, `dev:http`, `start`, `start:http`) laden eine vorhandene `.env` über Nodes `--env-file-if-exists`; `docker compose` liest sie ohnehin. `npm test` bewusst nicht — die Testsuite darf nicht von einer lokalen Datei abhängen.

Lizenzschlüssel werden gegen eine feste Liste geprüft; eine erfundene Lizenz —
etwa der Name einer Universität — wird mit Nennung des Werts abgelehnt statt
geschrieben. Den aggregierten Inhaltstyp (`ccm:oeh_lrt_aggregated`) schreibt
dieser Server nie: das Repository leitet ihn selbst ab.

## Ausgabeformate

Die meisten Tools akzeptieren `outputFormat: "markdown"` (Standard, für Menschen
lesbar) oder `"json"` (strukturiert, leichter zu parsen). Tools der Suchfamilie
hängen zusätzlich einen `_queryMeta`-Textteil an, der die ausgeführte Query, die
Filter, die Paginierung und einen `searchUrl`-Rücklink trägt — für Konsumenten,
die die Suche rekonstruieren wollen.

`_queryMeta` kann zwei weitere optionale Blöcke tragen:

- **`unresolvedFilters`** — `{ field, value }[]` der übergebenen Vokabular-Filter,
  die nicht zu einer URI aufgelöst werden konnten und daher aus der Suche
  entfernt wurden. Wird gemeldet, damit der Aufrufer selbst korrigieren kann
  (z.B. via `lookup_wlo_vocabulary`). Entfällt, wenn alles aufgelöst wurde.
- **`facets`** — nur mit `includeFacets: true`: Facetten-Zähler nach Filtername,
  z.B. `{ learningResourceType: [{ label: "Video", count: 1203 }], … }` — wie
  viele Treffer je Typ/Fach/Stufe, damit ein Client gezieltes Eingrenzen ohne
  Probe-Suchen anbieten kann.

Die gemeinsame `FormattedNode`-Struktur (Ausgabe aller inhaltszurückgebenden Tools):

```ts
{
  nodeId: string;
  title: string;
  description: string;
  keywords: string[];
  disciplines: string[];            // labels, e.g. ["Mathematik"]
  educationalContexts: string[];    // labels, e.g. ["Sekundarstufe I"]
  userRoles: string[];              // labels, e.g. ["Lehrer/in"]
  learningResourceTypes: string[];  // labels, e.g. ["Arbeitsblatt"]
  url: string;                      // primary "open this" link (ccm:wwwurl or viewer)
  downloadUrl: string;              // direct binary download (files only), else ""
  contentUrl: string;              // in-repo viewer URL, else ""
  previewUrl: string;               // thumbnail (may be a generic icon)
  previewIsIcon: boolean;           // true = generic mediatype icon, not a real thumbnail
  mimeType: string;                 // e.g. "application/pdf", else ""
  fileSize: number;                 // bytes (0 for nodes without binary content)
  license: string;                  // label, e.g. "CC BY-SA 4.0"
  publisher: string;
  nodeType: 'collection' | 'content';
  topicPageUrl: string;             // set when ccm:page_config_ref is present
  textContent?: string;             // stored full text — only with includeTextContent
  compendiumText?: string;          // editorial collection summary — full on detail tools (`-all-`); also in collection search/list, capped to 500 chars in markdown
}
```

## Filter & Vokabular

Filter akzeptieren deutsche Labels oder vollständige URIs. Die Auflösung ist
bewusst asymmetrisch:

- **Eingabe (Label → URI)** ist beim Schulfach-Vokabular konservativ, um
  mehrdeutige, zu breite Treffer zu vermeiden.
- **Anzeige (URI → Label)** nutzt die serverseitigen
  `<property>_DISPLAYNAME`-Felder aus dem edu-sharing-Index, die sowohl das
  Schul- als auch das Hochschul-Vokabular ohne lokales Mapping abdecken.

Verwenden Sie `lookup_wlo_vocabulary`, um gültige Werte zu ermitteln. Maßgebliche
Quellen sind die offiziellen SKOS-Vokabulare unter
`https://vocabs.openeduhub.de`.

**Hochschulfächer (Hochschulfächersystematik).** Schul- und Hochschulfächer teilen
viele Labels („Mathematik“, „Physik“, …), daher bleibt das Hochschul-Vokabular
bewusst aus der *Eingabe*-Auflösung heraus — `discipline="Mathematik"` meint immer
das Schulfach, nie einen mehrdeutigen Treffer. Um nach einem *Hochschulfach* zu
filtern, gibt es zwei modellfreie, konfliktfreie Wege:
1. **Facetten-gestützt (korpus-basiert):** eine Facetten-Suche ausführen
   (`includeFacets: true`) und die `discipline`-Facette lesen — jeder Bucket trägt
   ein lesbares `label` (aufgelöst über das gebündelte `src/vocabs-hochschule.ts`)
   **und** seine Konzept-`uri`; diese `uri` als `discipline` zurückgeben (rohe URIs
   werden akzeptiert).
2. **Fuzzy-Nachschlag:** `lookup_wlo_vocabulary` mit `vocabulary="universitySubject"`
   und `query` liefert eine kurze `{label, uri}`-Auswahlliste (Levenshtein, kein ML);
   das Modell wählt eins und filtert mit dessen `uri`.

Beide halten das Hochschul-Vokabular aus der *Eingabe*-Label-Auflösung heraus —
kein lokaler Schule↔Hochschule-Konflikt.

**API-Basis-URLs:** Die REST-API liegt unter `<WLO_REPOSITORY_URL>/rest/...`, das
Frontend (Render- und Themenseiten-Links) unter
`<WLO_REPOSITORY_URL>/components/...`. Die Pfade sind über alle
edu-sharing-Instanzen hinweg identisch.

## Deployment

Produktiv läuft der Server **selbst gehostet und persistent** (Docker, siehe
unten). Ein Serverless-Deployment-Ziel gibt es nicht.

### Docker (Produktionsweg)

```bash
docker compose up -d --build          # Build + Start im Hintergrund (empfohlen)
# oder ohne Compose:
docker build -t wlomcp .
docker run -p 3000:3000 wlomcp        # prod default
# → http://localhost:3000/mcp  ·  /health  ·  /api/*  ·  /launcher.html
```

Das Image bündelt die gebauten Widgets (`dist-widgets/`) und den öffentlichen
Launcher + die Skills (`public/`), läuft als Nicht-Root-Benutzer `node`, fixiert
das Basis-Image per Digest und hat einen `HEALTHCHECK` auf `/health`.

**SSE und der Reverse-Proxy.** Das Image nutzt standardmäßig echtes
Server-Sent-Events-Streaming (`MCP_SSE=1`), das der ChatGPT-Entwicklermodus
benötigt. Ein vorgelagerter Reverse-Proxy (nginx/Traefik/Caddy) **darf die
`/mcp`-Antwort nicht puffern**, sonst erreicht der Stream den Client nie — für
nginx `proxy_buffering off;` und ein langes `proxy_read_timeout` auf dieser
Location setzen. Mit `-e MCP_SSE=0` fällt der Server auf Einzel-JSON-Antworten
zurück (curl / einfache Clients). Hinter einem TLS-terminierenden Proxy zusätzlich
`TRUST_PROXY=1` setzen.

**Vollständige vServer-Anleitung** — `.env`-Konfiguration, die komplette
nginx-SSE-Konfiguration, TLS, Verifikation und das ChatGPT-Entwicklermodus-Gate —
steht in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Jede Compose-Einstellung ist
über eine `.env`-Datei (automatisch geladen) überschreibbar, ohne die getrackte
Compose-Datei zu editieren.

### Lokal

```bash
npm install && npm run build
node dist/http.js                                                        # prod default
WLO_REPOSITORY_URL=https://repository.staging.openeduhub.net/edu-sharing node dist/http.js
```

### Apps-SDK-Einreichung & Datenschutz

- [`docs/apps-sdk-submission-checklist.md`](docs/apps-sdk-submission-checklist.md)
  — jede OpenAI-Apps-SDK-Anforderung auf ihr umsetzendes Artefakt gemappt, plus
  Golden-Demo-Prompts und die verbleibenden Betreiber-Schritte.
- [`docs/apps-sdk-golden-prompts.md`](docs/apps-sdk-golden-prompts.md) — das
  vollständige Developer-Mode-Evaluationsset (direkte / indirekte / negative
  Prompts + Precision-Recall-Protokoll), um die Tool-Auswahl zu testen und das
  Rendern der Widgets zu bestätigen.
- [`docs/PRIVACY.md`](docs/PRIVACY.md) — die Basis-Datenschutzerklärung
  (zustandslos, nur lesend, keine Speicherung personenbezogener Daten), die
  Betreiber anpassen und veröffentlichen.
- [`docs/AUTH.md`](docs/AUTH.md) — wie die Anmeldung funktioniert und warum:
  Zugangsblock, Positivliste, OAuth-Ablauf, Missbrauchsschranken und die neun
  Regeln, die eine spätere Änderung nicht aufheben darf (englisch).
- [`docs/AUTH-CONCEPT.md`](docs/AUTH-CONCEPT.md) — **das Anmelde-Konzept erklärt**:
  die drei geforderten Zugangsarten (anonym, festes Konto, eigenes WLO-Login), die
  Messung an edu-sharing, aus der alles folgt, was wir für die Sicherheit tun —
  und ein Abgleich mit den Alternativen (Token weiterreichen, Passwort-Tresor,
  Sitzungsspeicher, App-Signatur, nur OAuth), samt dem, was das Konzept
  **nicht** schützt.
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — **die Übergabe für das Team und
  für Chatbot-Entwicklung**: alle 42 Werkzeuge gruppiert, jede von außen
  aufrufbare Adresse (MCP, REST, Seiten, OAuth) und das Verhalten, das eine
  Integration kennen muss — Lizenzfilter, Offenlegungs-Felder, zweistufiges
  Schreiben, Grenzen, und was es bewusst nicht gibt.
- [`docs/TOOLS.md`](docs/TOOLS.md) — jedes Tool und Widget mit der
  Chat-Formulierung, die es auslöst.
- [`docs/SKILLS.md`](docs/SKILLS.md) — wie die Skills-Sammlung aufgebaut wird:
  die Inhaltsart, die einen Datensatz zum Skill macht, die zweistufige Struktur,
  die Schranken des Sammlungs-Laufs und der gemessene Weg zu Begleitdateien
  (englisch).

## Sicherheit & Betrieb

### Als unsicher deklarierte Werkzeuge

Ein Werkzeug kann sich selbst als **unsicher** deklarieren. Das heißt nicht, dass
es kaputt ist — es heißt, dass es ein Risiko trägt, das dieser Server von seiner
Position aus nicht schließen kann. So ein Werkzeug wird standardmäßig
registriert, protokolliert beim Start eine Warnung mit Name und Begründung und
lässt sich mit `WLO_DISABLE_UNSAFE_TOOLS` entfernen. Ausgeliefertes
`.env.example` und `docker-compose.yml` setzen das auf `all`, ein echtes
Deployment startet also ohne sie.

Betroffen ist derzeit ein Werkzeug:

**`get_url_text` — für den Produktivbetrieb nicht empfohlen.** Es liest den Text
hinter einer Adresse, die der *Aufrufer* wählt. Bevor irgendetwas angefragt wird,
lehnt der Server einen wörtlich privaten Host ab (einschließlich IPv4-in-IPv6 wie
`[::ffff:127.0.0.1]`, das `new URL()` zu `[::ffff:7f00:1]` umschreibt), lehnt
einen öffentlichen NAMEN ab, dessen DNS-Eintrag in einen privaten Bereich zeigt,
und lehnt einen Namen ab, den er gar nicht auflösen kann, statt zu raten.

Was es **nicht** prüfen kann, ist der wichtigste Teil: wir rufen das Ziel nie
selbst ab. Das tut der Extraktionsdienst, mit Playwright, in seinem eigenen
Prozess. Eine Adresse, die alle obigen Prüfungen besteht und dann auf eine
interne Adresse **weiterleitet** — oder deren DNS-Antwort sich zwischen unserer
Abfrage und der des Dienstes ändert — ist auf dieser Ebene unsichtbar. Das zu
schließen erfordert eine Prüfung zum Auflösungszeitpunkt *im abrufenden Dienst*.
Solange es die nicht gibt, ist dies ein Werkzeug für Entwicklung und Erprobung.

`get_wlo_content_text` ist bewusst **nicht** betroffen, obwohl seine
Rückfallebene denselben Extraktionsdienst nutzt. Dessen Adresse stammt aus dem
kuratierten `ccm:wwwurl` des Datensatzes, der Aufrufer kann das Ziel also nicht
wählen — genau dieser Unterschied ist der Grund, warum nur eines von beiden als
unsicher gilt. Unsichere Werkzeuge abzuschalten darf das andere nicht seine
Rückfallebene kosten.

- **HTTP-Modus-Härtung:** Jede Upstream-Anfrage hat ein Timeout
  (`WLO_FETCH_TIMEOUT_MS`); Request-Bodies sind begrenzt (`MAX_BODY_BYTES`, `413`
  über dem Limit); der MCP-Endpunkt ist pro IP rate-limitiert (`RATE_LIMIT_RPM`,
  `429` über dem Limit); Node-IDs werden URL-kodiert, bevor sie in Upstream-URLs
  interpoliert werden. Hinter einem Reverse-Proxy setzen Sie `TRUST_PROXY=1`,
  damit das Rate-Limiting auf die echte Client-IP schlüsselt.
- **Öffentliche REST-Oberfläche:** `GET /api/*` ist nur lesend, hat einen eigenen
  strengeren Limiter pro IP (`API_RATE_LIMIT_RPM`, Standard 30/min), weist
  Nicht-`GET`-Methoden ab (`405`), validiert jede Eingabe serverseitig
  (Query-/nodeId-/ID-Anzahl-Grenzen) und gibt keine internen Fehlerdetails preis
  (generischer `500`). CORS ist `*` nur für `GET`.
- **`npm audit`:** Der Produktions-Abhängigkeitsbaum ist frei von High-/
  Critical-Advisories (`npm audit --omit=dev --audit-level=high`, als CI-Gate
  verdrahtet). Der Gesamtbaum trägt nur noch eine einzige **niedrige, reine
  Dev**-Advisory (`esbuild`, via `tsx` — ein Windows-Dev-Server-Dateilesefehler),
  die weder ausgeliefert noch in CI/Produktion ausgeführt wird: eine Produktions-
  Installation (`npm ci --omit=dev`, wie im Dockerfile) enthält keine davon.
  Der Server nutzt Nodes
  eingebautes `fetch`.
- **Monitoring & Logging:** `GET /health` (HTTP-Modus) gibt `200` mit einem kleinen
  JSON-Status zurück — nutzen Sie es für Uptime-Monitoring; der Docker-`HEALTHCHECK`
  zielt darauf. Für „ist WLO erreichbar“ (Upstream, nicht Proxy) verwenden Sie das
  `wlo_health_check`-Tool. Logs sind strukturierte JSON-Zeilen auf **stderr**
  (`ts`, `level`, `name`, `msg` + Felder); stdout ist für das MCP-stdio-Framing
  reserviert.

## Architektur

```
wlo-mcp-server/
├── src/
│   ├── server.ts             # factory: registers all 42 tools (transport-agnostic)
│   ├── tools/                # tool definitions, grouped by responsibility
│   │   ├── shared.ts         #   _queryMeta, toolError, title fallbacks
│   │   ├── collections.ts    #   search_wlo_collections, get_collection_contents, search_wlo_within_collection
│   │   ├── content-search.ts #   search_wlo_content, search_wlo_all
│   │   ├── node-details.ts   #   get_node_details, get_nodes_details
│   │   ├── node-relations.ts #   get_related_content, get_node_breadcrumb
│   │   ├── collection-stats.ts #  get_collection_stats
│   │   ├── skills.ts         #   search_skill, get_skill (bzw. get_skill_for_task)
│   │   ├── vocabulary.ts     #   lookup_wlo_vocabulary, lookup_wlo_publishers
│   │   ├── topic-pages.ts    #   search_wlo_topic_pages
│   │   ├── topic-page-content.ts # get_topic_page_content
│   │   ├── browse.ts         #   get_subject_portals, browse_collection_tree
│   │   ├── compendium.ts     #   get_compendium_text
│   │   ├── wikipedia.ts      #   get_wikipedia_summary
│   │   ├── knowledge.ts      #   search, fetch (ChatGPT knowledge tools)
│   │   └── health.ts         #   wlo_health_check
│   ├── services/             # business logic reused by tools + REST + widgets
│   │   ├── search.ts         #   searchAll (combined search + opt-in enrichments)
│   │   ├── compendium.ts     #   getCompendiumTexts
│   │   ├── publishers.ts     #   lookupPublishers (facet-based counts)
│   │   ├── related.ts        #   getRelatedContent
│   │   ├── stats.ts          #   getCollectionStats
│   │   ├── skills.ts         #   findSkills (list + rank + fetch raw Markdown)
│   │   └── topic-page.ts     #   resolveTopicPageSwimlanes
│   ├── apps/                 # OpenAI Apps-SDK seam + widgets
│   │   ├── register.ts       #   registerWloTool (outputSchema/annotations/_meta.ui)
│   │   ├── tool-defaults.ts  #   applyReadOnlyToolDefaults: noauth _meta + required hints + status, on every tool
│   │   ├── tool-status.ts    #   per-tool openai/toolInvocation status strings (DE)
│   │   ├── outputSchemas.ts  #   zod structuredContent schemas
│   │   ├── resources.ts      #   ui:// widget resources (loads dist-widgets/)
│   │   ├── instructions.ts   #   server instructions block
│   │   └── widgets/          #   vanilla-TS widgets (esbuild → dist-widgets/*.html)
│   ├── vocabs.ts             # label ↔ URI mappings (6 vocabularies)
│   ├── vocabs-hochschule.ts  # university-subject URI→label (display-only; NOT in resolveVocab)
│   ├── vocab-suggest.ts      # fuzzy vocab suggestions (levenshtein, ≤2 edits)
│   ├── wlo-api.ts            # barrel re-export of the edu-sharing REST client
│   ├── wlo-config.ts         #   env config + shared types + wloFetch + DISPLAY_PROPS
│   ├── wlo-search.ts         #   search endpoints (ngsearch, collection keyword search)
│   ├── wlo-node.ts           #   node endpoints (children/metadata/text/download/breadcrumb) + URL builders
│   ├── topic-page-api.ts     # topic-page discovery (page_variant search, variant→collection)
│   ├── topic-page-structure.ts # one page's content: variant → swimlanes
│   ├── wikipedia-api.ts      # Wikipedia REST summary client (search title fallback)
│   ├── wikipedia-relevance.ts # picks which fuzzy candidate the query is about
│   ├── reranker.ts           # RRF-Merge + Quality-Scoring (pure)
│   ├── query-expand.ts       # Query → gewichtete Backend-Varianten (Synonyme, Stoppwörter)
│   ├── node-match.ts         # lokales Node-Matching (Text + Kriterien) für /children-Fallbacks
│   ├── formatter.ts          # WloNode → FormattedNode → markdown / json
│   ├── logger.ts             # minimal structured JSON logger (stderr only)
│   ├── rate-limit.ts         # in-memory per-IP rate limiter + client-IP resolution
│   ├── read-body.ts          # bounded request-body reader (413 support)
│   ├── mcp-transport.ts      # Streamable-HTTP-Transport-Optionen (MCP_SSE → JSON vs SSE)
│   ├── rest/                 # public read-only REST layer (GET /api/*) over the services
│   │   ├── validate.ts       #   input validation (query/nodeId/id-count caps, int clamp, fields)
│   │   ├── project.ts        #   field projection for /api/{search,collection} (?fields=)
│   │   ├── result.ts         #   RestResult shape + badRequest helper
│   │   ├── handlers.ts       #   the per-endpoint handlers (handleSearch, handleCollection, …)
│   │   ├── routes.ts         #   routeRestRequest (pure router) + handleRestRequest (http.ts adapter)
│   │   ├── skills.ts         #   skill registry + raw loader (GET /api/skills[/<id>])
│   │   └── static.ts         #   resolveStaticRoute (pure) + handleStaticRequest (serves /launcher.html)
│   ├── stdio.ts              # entry: stdio transport
│   └── http.ts               # entry: Streamable HTTP (CORS, rate/body limits, routing)
├── public/                   # static assets served by http.ts
│   ├── launcher.html         #   bilingual prompt launcher (self-contained; GET /launcher.html, GET /)
│   ├── bookmarklet.md        #   selection → launcher bookmarklet (install docs, DE/EN)
│   └── skills/               #   AI-app skills served raw via GET /api/skills/<id>
├── tests/                    # offline unit/smoke tests (node:test): npm test
│   ├── fetchMock.ts          #   the in-memory MCP client + upstream fetch stub every tool test uses
│   └── netguard.mjs          #   fails any unmocked non-loopback fetch — enforces "no network required"
├── scripts/                  # tooling (not shipped): run-tests.mjs (npm test), vocab generation, measurements
├── docs/                     # DEPLOYMENT.md, PRIVACY.md, TOOLS.md, apps-sdk-submission-checklist.md, apps-sdk-golden-prompts.md, plans/
├── Dockerfile · docker-compose.yml · .dockerignore · .env.example
```

**Datenfluss:** Transport-Einstieg (`stdio.ts` / `http.ts`) →
`createMcpServer()` (`server.ts`) → ein Tool-Handler (`tools/*`) →
`wlo-api.ts`/`topic-page-api.ts` (alle Upstream-Aufrufe über `wloFetch`) →
`reranker.ts` + `formatter.ts` → Tool-Ergebnis. Abhängigkeiten zeigen nach innen;
es gibt keine zirkulären Importe.

### Bibliotheks-Funktionen

Die internen Bausteine hinter den Tools (nützlich beim Lesen oder Erweitern des
Codes), gruppiert nach Modul.

**`wlo-api.ts` — edu-sharing-REST-Client**

| Funktion | Was sie tut |
|---|---|
| `ngsearch` | Volltextsuche nach **Datei**-Knoten (FILES) |
| `searchCollectionsByKeyword` | **Sammlungssuche** — liefert echte `ccm:map`-Sammlungen |
| `getCollectionContents` | Kinder (Inhalte / Sub-Sammlungen) eines Knotens |
| `getChildCollections` | Direkte Sub-Sammlungen (`filter=folders`) |
| `getNodeMetadata` / `getNodesMetadata` | Metadaten für einen / mehrere Knoten |
| `getNodeTextContent` | Gespeicherter Volltext eines Knotens |
| `getNodeParents` | Eltern-Knoten eines Knotens |
| `wloFetch` | `fetch`-Wrapper, der den Upstream-Timeout erzwingt |
| `sanitizeRepositoryUrl` | Eine Repository-URL-Eingabe normalisieren |
| `buildTopicPageUrl` / `buildRenderUrl` | Frontend-Links bauen |
| `appendPropertyFilter` | Die wiederholten `propertyFilter`-Params anhängen |

**`topic-page-api.ts` — Themenseiten finden**

| Funktion | Was sie tut |
|---|---|
| `searchPageVariants` | `page_variant`-Knoten suchen |
| `searchTopicPageCollections` | Sammlungen mit Themenseite, gegen eine Query gematcht |
| `resolveVariantCollection` | Eine Variante zur besitzenden Sammlung auflösen |
| `getCollectionThemePages` | Themenseiten-Varianten einer Sammlung |

**`topic-page-structure.ts` — was eine Themenseite zeigt**

| Funktion | Was sie tut |
|---|---|
| `getTopicPageContent` | Eine Variante auflösen und ihre Swimlane-Struktur parsen |

**Ranking, Formatierung, Vokabular**

| Funktion | Modul | Was sie tut |
|---|---|---|
| `enhancedSearch` | `reranker.ts` | Multi-Query-Expansion + RRF + Quality-Score |
| `rerankNodes` | `reranker.ts` | Bereits geladene Knoten nach Relevanz umsortieren |
| `sortByTitle` | `reranker.ts` | Deterministische alphabetische Sortierung |
| `formatNode` / `formatNodes` | `formatter.ts` | `WloNode` → `FormattedNode` |
| `renderToText` / `renderToJson` | `formatter.ts` | `FormattedNode` → Markdown / JSON |
| `resolveFacetCounts` | `formatter.ts` | Facetten-Gruppen → gelabelte Zähler nach Filtername |
| `resolveVocab` | `vocabs.ts` | Label → URI |
| `labelFromUri` | `vocabs.ts` | URI → Label |
| `listVocab` | `vocabs.ts` | Einträge eines Vokabulars auflisten |

**HTTP-Infrastruktur & Tool-Helfer**

| Funktion | Modul | Was sie tut |
|---|---|---|
| `createRateLimiter` | `rate-limit.ts` | In-Memory-Rate-Limiter pro IP (festes Fenster) |
| `clientKey` | `rate-limit.ts` | Client-IP auflösen (nutzt `X-Forwarded-For` bei `TRUST_PROXY`) |
| `readBodyWithLimit` | `read-body.ts` | Request-Body begrenzt durch `MAX_BODY_BYTES` lesen |
| `parseRequestUrl` | `request-url.ts` | Request-Target einmal parsen; `null`, wenn node:http annimmt, was `new URL()` ablehnt |
| `log` | `logger.ts` | Strukturierter JSON-Logger (stderr) |
| `buildFilterCriteria` | `filter-criteria.ts` | Deutsche Labels/Filter → Such-Kriterien |
| `queryMetaContent` | `tools/shared.ts` | Den `_queryMeta`-Block bauen |
| `toolError` | `tools/shared.ts` | Loggen + einheitliches Tool-Fehlerergebnis bauen |
| `mapPool` | `concurrency.ts` | Async-Map mit begrenzter Nebenläufigkeit (fehlertolerant) |
| `pickThemePageTitle` | `tools/shared.ts` | Bester lesbarer Themenseiten-Titel |
| `matchSubjectPortal` | `tools/browse.ts` | Fach-Name → zugehöriges Fachportal auflösen (getiert) |

## Entwicklung

- `npm run build` — TypeScript-Kompilierung (strict).
- `npm test` — Offline-Test-Suite (`node:test`), kein Netzwerk erforderlich.
- CI (`.github/workflows/ci.yml`) führt Build + Test auf Node 20 mit einem
  Produktions-`npm audit`-Gate aus.
- Siehe **[CONTRIBUTING.md](CONTRIBUTING.md)** für Konventionen (Kommentarsprache,
  Test-Disziplin, Commit-Stil, Sicherheitsregeln).

## Weitere Dokumente

- **[CHANGELOG.md](CHANGELOG.md)** — nennenswerte Änderungen.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Beitragsleitfaden.
- **[PERFORMANCE.md](PERFORMANCE.md)** — Anmerkungen zum Performance-Design.
- **[docs/apps-sdk-submission-checklist.md](docs/apps-sdk-submission-checklist.md)** — Anforderungen der ChatGPT-App-Einreichung, jeweils mit Nachweis (auf Englisch).
- **[docs/apps-sdk-golden-prompts.md](docs/apps-sdk-golden-prompts.md)** — Evaluations-Prompts für den Entwicklermodus (Discovery-Precision/Recall).
- **[README.md](README.md)** — englische Fassung dieses Dokuments.
