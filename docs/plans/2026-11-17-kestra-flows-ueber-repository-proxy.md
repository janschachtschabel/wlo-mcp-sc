# Kestra-Flows über den Repository-Proxy (2026-11-17)

Auftrag: „Wünsche an den MCP: Kestra-Flows über den Repository-Proxy“ des Chatbot-Teams (17.11.,
Paket M ihres Plans `2026-11-17-b-api-delegation-und-upload.md`). Stand: **gebaut, zwei Reviews; Paket E (Vorgabe-Flow, Erkennung) gebaut, zwei Reviews** (Werkzeuge W1–W4 und W6;
W5 und W7 bewusst nicht, siehe 4); abgeglichen mit der Fassung des Teams vom 18.11.

## 1. Gemessen (W0), Staging, 17.11.2026

`scripts/bapi-proxy-probe.mjs`, nur lesend, Testkonto (`WLO_TEST_USER`, kein Admin), eigene Sitzung danach beendet.

| Anfrage an `{repo}/rest/bapi…` | mit Sitzung (Cookie + `DisableGuest`) | mit `Basic` + `DisableGuest` | ohne Anmeldung |
|---|---|---|---|
| `GET /api/v1/llm/openai/models` | 200 (98 Modelle) | 200 | **403** `Forbidden` |
| `GET /api/v1/jobs/flows` | 200, **ein** Flow: `edusharing.chatbot/node-metadata-write` | 200, derselbe | **200 mit leerer Liste** |
| `GET /api/v1/jobs/<unbekannte id>` | **404** `Job not found` | 404 | 404 |
| `GET /api/v1/jobs/flows` mit selbst gesetzter `X-Edu-User-Id` | 200, derselbe Flow — die Kopfzeile wird entfernt | — | — |

Der Flow (aus der Liste): `inputSchema` `{node_ids: string[] (Pflicht), language: "de"|"en" (Vorgabe de)}`,
`additionalProperties: false`; Ausgabe `report` (JSON); `privilege` `JOB_RUN_EDUSHARING_CHATBOT_NODE_METADATA_WRITE`;
je Knoten: Text lesen → Metadaten-Agent → Eigenschaften **ersetzen** (jede Änderung eine neue Version); Status je
Knoten `OK, NO_TEXT, TEXT_FAILED, METADATA_FAILED, NOTHING_TO_WRITE, WRITE_FAILED`.

Folgen: (1) Beide Anmeldearten, die unsere Zugangsblöcke tragen, gehen. (2) **Eine leere Flow-Liste ist keine
Aussage**, wenn die Person nicht ankam — darum geht jeder Aufruf mit `DisableGuest: true` und nur mit persönlicher
Anmeldung. (3) ~~404 ist die einzige Antwort für eine fremde oder unbekannte Job-ID.~~ Überholt durch die Messung
vom 18.11. (unten): Über den Proxy liest jede Person jeden Job; die Bindung an die Person hält der Server.

### Gemessen am 18.11.2026: Start, Schreiben, Sichtbarkeit (`tests/live/bapi-flows.test.ts`)

Eigener Wegwerf-Datensatz mit kurzem Text im Bereich des Testkontos, danach gelöscht.

| Frage | Ergebnis |
|---|---|
| Start mit der Anmeldung der Person (`Basic`) über `/rest/bapi` | 202 mit `jobId` |
| Schreibt der Flow mit der eingefrorenen Person? | **ja**: `SUCCEEDED` nach rund 30 s, acht Felder ersetzt (Titel, Beschreibung, Schlagworte, Sprache, Stufe, Zielgruppe, Ressourcentyp, Fach) |
| Bericht | `outputs.report[]` je Knoten: `{nodeId, status, written: {changedKeys, ignoredKeys}, httpCode, characters}` |
| Sieht eine **andere** Person den Job (zweite Anmeldung, nur lesend)? | **ja**, samt Bericht. Über den Repository-Proxy tragen alle Personen den einen Schlüssel des Repositorys, und Jobs hängen am Schlüssel. |
| Derselbe Job **ohne Anmeldung** bzw. mit **falschem Passwort**, je mit `DisableGuest` | **401** und **401** — ein geliehener Name ohne das Passwort liest nichts |
| Derselbe Job ohne Anmeldung, **ohne** `DisableGuest` | **200**, samt Bericht: der Gast des Proxys liest jeden Job, dessen id er kennt (Lücke des Proxys; wir senden `DisableGuest` immer; ans b-api-Team) |
| Derselbe (fertige) Job **abbrechen** mit falschem Passwort, mit `DisableGuest` | **401** — der Abbruch braucht die bestätigte Person ebenso |
| Ticket-Anmeldung (`EDU-TICKET`) am Proxy | **nicht messbar** von unserer Seite: `validateSession` gibt dem Testkonto kein Ticket; Tickets entstehen auf edu-sharing-Seiten. Zugelassen; scheitert sie, kommt `rejected`/`edu_user_required`. |

Folgen: „404 für fremde Jobs“ (Auftrag §3) gilt über diesen Weg nicht, und die 20 unfertigen Jobs je Schlüssel
teilen sich alle Personen des Repositorys. Beides geht als Hinweis an das b-api-Team.

## 2. Entscheidungen

- **Ein Schalter:** `WLO_BAPI_VIA_REPOSITORY`. ~~aus ohne Wert~~ — seit Paket E (18.11., Wunsch des Nutzers): ohne
  Wert oder `auto` fragt der HTTP-Server beim Start anonym die Flow-Liste des Proxys ab (ohne Urteil erneut) und registriert die
  Werkzeuge nur bei `200` mit einer Liste (Staging: `200 []`; ein Repository ohne den Pfad: `404` mit JSON-Objekt, beides gemessen
  18.11.); jede andere Antwort ist kein Urteil (auch 3xx, 401/403, eine 404-Seite) = aus und später erneut fragen.
  `1` an ohne Frage, `0` aus, ein anderer Wert aus mit Warnung. stdio fragt nie (keine eigene Anmeldung), dort nur `1`. **Freigabeliste:** `WLO_BAPI_FLOWS` (kommagetrennt `namespace/id`; ~~leer = keiner~~
  leer = `edusharing.chatbot/node-metadata-write`, `none` = keiner).
- **Nur persönliche Anmeldung** (`source: 'user'`), nie Dienstkonto, nie anonym: sonst `login_required` vor jedem
  Aufruf. Die Anmeldung geht nur an den Repository-Host (`wloFetch`, unverändert); dazu immer `DisableGuest: true`.
- **Feste Pfade:** nur `/api/v1/jobs/flows`, `/api/v1/jobs/flows/{ns}/{id}`, `/api/v1/jobs/{jobId}` (GET, DELETE),
  geprüft vor dem Aufruf; `namespace`, `id` und `jobId` nur aus `[A-Za-z0-9_.-]`. Keine `x-edu-*`, kein `x-api-key`.
  Frist 30 s.
- **Start ist ein Schreibvorgang** mit Vorschau und Bestätigung (`registerCurationTool`, Schlüssel an Flow und
  Eingaben gebunden). Kommt nach dem Senden keine Antwort, ist der Ausgang **offen** (ein Job kann laufen) — kein
  „gescheitert“; der Hinweis nennt `GET /api/v1/jobs` nicht, weil wir die Liste nicht anbieten, sondern „vor einem
  neuen Start in WLO nachsehen“. Eine wiederholte Einlösung liefert die erste Antwort (vorhandene Wiederholung, S3).
- **`node-metadata-write` prüfen wir vor der Vorschau:** 1–50 IDs, ohne Doppelte; jede ein Datensatz (`ccm:io`),
  keine Sammlung, keine Verknüpfung in einer Sammlung (der Flow schriebe sonst auf die Kopie), für die Person
  schreibbar (`access` enthält `Write`). Sonst `bad_inputs` mit den IDs und dem Grund; sind alle Probleme
  `unchecked` (keine Antwort), `upstream_error`. Die Vorschau nennt Anzahl,
  Titel und den Satz, dass Titel, Beschreibung, Schlagworte, Fach, Bildungsstufe, Zielgruppe, Ressourcentyp und
  Sprache überschrieben werden. `language` nur `de`/`en`.
- **Andere freigegebene Flows:** Vorschau mit Flow-Name und Eingaben (gekürzt); Eingaben als JSON ≤ 64 KB.
- **Status-Abbildung** wie §3 des Auftrags; `outputs` nur bei Erfolg, ≤ 1 MB, sonst weggelassen mit `truncated`.
- **Keine Werte der Anmeldung und keine Job-Ausgaben im Log; nichts davon in geteilten Speichern.**
- **Jobs gehören bei uns der Person, die sie gestartet hat** (Ergänzung 18.11., nach der Messung): Der Server merkt
  sich je gestartetem Job das Konto (im Arbeitsspeicher, 30 Tage wie die b-api, begrenzt). `wlo_flow_status` und
  `wlo_cancel_flow` fragen die b-api nur für eigene Jobs; jeder andere ist `unknown_job`. Grenze, offen gesagt: Nach
  einem Neustart des Servers sind auch eigene laufende Jobs unbekannt — die Ergebnisse stehen dann am Datensatz.
- **Fortschritt (Fassung des Teams vom 18.11.):** `progress` (`started, running, succeeded, warning, failed`) wie die
  b-api ihn liefert; aus `iterations` nur Zahlen je Stand (`iterations: {running, succeeded, warning, failed,
  cancelled}`), keine Werte und keine Codes; ist die Liste eine Stichprobe (über 200), steht `iterationsSampled: true`.

## 3. Werkzeuge (nur mit b-api-Proxy, `WLO_BAPI_VIA_REPOSITORY`)

| Name | Art | Ein | Aus (`structuredContent`) |
|---|---|---|---|
| `wlo_start_flow` | schreibend, Vorschau + Bestätigung | `flow`, `inputs`, `confirmToken` | `status: preview` + `confirm` · `started` + `jobId`, `flow` · `failed` + `reason` (`not_allowed`, `login_required`, `edu_user_required`, `rejected`, `bad_inputs`, `rate_limited`, `upstream_error`), `retryAfter?`, `code?`, `problems?: [{nodeId, problem}]` |
| `wlo_flow_status` | lesend | `jobId` | `status: running\|succeeded\|failed\|cancelled\|unknown`, `rawStatus`, `errorCode?`, `warnings?`, `progress?`, `iterations?`, `iterationsSampled?`, `outputs?`, `truncated?`, `files?` · `failed` + `reason: unknown_job` … |
| `wlo_cancel_flow` | schreibend, ohne Bestätigung (nur eigener Job) | `jobId` | `status: cancelled\|already_finished\|unknown_job` |
| `wlo_list_flows` | lesend | — | `flows: [{flow, description, inputSchema}]` geschnitten mit `WLO_BAPI_FLOWS` |

Der Auftrag nennt `confirm` als Parameter; bei uns heißt er wie bei allen Schreibwerkzeugen `confirmToken`
(die Vorschau gibt ihn unter `confirm.token` zurück, wie die übrigen). Das ist im Antwortschreiben gesagt.

## 4. Nicht gebaut

- **W5 `wlo_flow_file`:** Der einzige freigegebene Flow liefert keine Dateien (`fileInputs: []`, nur `report`).
  Erst bauen, wenn ein Flow Dateien erzeugt.
- **W7 Textextraktion über den Proxy:** ändert den Weg eines bestehenden Werkzeugs; eigenes Paket mit eigener Messung.

## 5. Aufgaben

1. `src/services/bapi/jobs.ts`: ~~Schalter~~ (seit Paket E in `proxy-switch.ts`), Freigabeliste, Pfadprüfung, `bapiFetch` (persönlich, `DisableGuest`,
   30 s), Start, Stand, Abbruch, Liste, Status-Abbildung — mit Tests gegen die Drahtform (202/jobId, Mapping,
   404/409/429 + `Retry-After`, leere Liste ohne Person, Dienstkonto abgewiesen, Pfad außerhalb abgewiesen).
2. `src/services/bapi/node-metadata-write.ts`: Prüfung der Knoten (Art, Verknüpfung, Schreibrecht, Anzahl).
3. `src/tools/bapi-flows.ts`: die vier Werkzeuge, Registrierung nur mit Schalter; Ausgabeschemata.
4. Wächter: Pfade nur aus der festen Liste; kein Aufruf ohne persönliche Anmeldung.
5. Live-Test (`tests/live/bapi-flows.test.ts`, Staging): eigener Wegwerf-Datensatz (Präfix `boerdi-durchtest-`)
   mit Volltext → Start mit `Basic` UND mit einer Sitzung über den echten Anmeldepfad (`applyUpstreamAuth`) →
   Stand bis fertig → Bericht → Datensatz löschen. Dazu die W0-Aufrufe mit der Sitzung.
6. Doku: `.env.example`, Compose, MCP-REFERENZ, DEPLOYMENT, README(s), TOOLS/WERKZEUGE, `docs/rules/write-support.md`,
   CHANGELOG, STATUS; Antwort an das Team.
7. **Paket E (18.11., Wunsch des Nutzers):** `WLO_BAPI_FLOWS` leer = `node-metadata-write`, `none` = keiner;
   `src/services/bapi/proxy-switch.ts` (Schalter `auto`/`1`/`0`, Zustand, Wiederholung), `probeBapiProxy` in
   `jobs.ts` (die eine anonyme Abfrage, nur 200+Liste und 404+JSON entscheiden), Start nur aus `http.ts` (stdio
   fragt nie); Wächter für Start und Probe; `tests/bapi-proxy-switch.test.ts`; live gemessen (Staging: `present`).
   Zwei Reviews: 1 schwer, 5 mittel, 4 klein; dann 4 mittel, 7 klein — alle behoben.
