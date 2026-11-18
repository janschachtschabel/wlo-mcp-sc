# Antwort an das Chatbot-Team: Kestra-Flows über den Repository-Proxy (2026-11-18)

Zu eurem Plan „Kestra-Flows über den Repository-Proxy“ (Fassung vom 18.11.). Gebaut sind W1–W4 und W6, gemessen W0
und Schritt 4. W5 und W7 sind zurückgestellt (unten). Ein Messergebnis ändert eine Annahme eures Plans: Über den
Proxy kann jede Person jeden Job lesen. Wir gleichen das im MCP aus; euer Vertrag bleibt, wie ihr ihn beschrieben habt.

## 1. Gemessen auf Staging

Mit dem Testkonto, eigene Wegwerf-Datensätze (`boerdi-durchtest-…`), danach gelöscht; die Person kam wie bei euch:
eine Repository-Sitzung, gegen einen Zugangsblock getauscht, und jeder Aufruf über unseren normalen Anmeldepfad
(Cookie + `DisableGuest: true`, kein Schlüssel, kein `x-api-key`, keine `x-edu-*`).

| Aufruf über `{repo}/rest/bapi` | Sitzung aus dem Zugangsblock | Passwort (`Basic`) | ohne Anmeldung |
|---|---|---|---|
| `GET /api/v1/llm/openai/models` | 200 | 200 | 403 |
| `GET /api/v1/jobs/flows` | 200, mit `edusharing.chatbot/node-metadata-write` | 200, derselbe | **200, leere Liste** |
| `GET /api/v1/jobs/<unbekannt>` | 404 | 404 | 404 |
| `POST /api/v1/jobs/flows/edusharing.chatbot/node-metadata-write` | **202** mit `jobId` | 202 | — |

- **Der Flow schreibt mit der eingefrorenen Person.** `SUCCEEDED` nach rund 30 s; ersetzt wurden acht Felder: Titel,
  Beschreibung, Schlagworte, Sprache, Bildungsstufe, Zielgruppe, Ressourcentyp, Fach. Der Bericht je Knoten:
  `{nodeId, status, written: {changedKeys, ignoredKeys}, httpCode, characters}`. Damit ist die offene Frage aus eurem
  §6 und aus dem b-api-Update beantwortet.
- **Eine andere Person sieht den Job.** Mit einer zweiten Anmeldung ließ sich derselbe Job samt Bericht lesen, nur
  mit der `jobId`. Über den Repository-Proxy tragen alle Personen den einen Schlüssel des Repositorys, und die b-api
  hält Jobs je Schlüssel. „404 für fremde Jobs“ (euer §3) gilt auf diesem Weg also nicht — siehe 2.
- **Ohne bestätigte Person liest niemand einen Job — solange `DisableGuest` mitkommt.** Derselbe Job ohne Anmeldung
  und mit falschem Passwort, je mit `DisableGuest: true`: beide 401. Ohne `DisableGuest` und ohne Anmeldung dagegen
  **200 samt Bericht** — der Gast des Repository-Proxys liest jeden Job, dessen `jobId` er kennt. Der MCP schickt
  `DisableGuest` bei jedem Aufruf; die Lücke selbst gehört dem Proxy (siehe 4).
- **Ticket-Anmeldungen** (`EDU-TICKET`) konnten wir nicht messen: Das Testkonto bekommt kein Ticket, Tickets entstehen
  auf edu-sharing-Seiten. Sie sind zugelassen; scheitern sie am Proxy, kommt `rejected` oder `edu_user_required`.
  Wenn ihr mit einem Ticket-Block testet, sagt uns das Ergebnis.

## 2. Was ihr bekommt

Jede Ablehnung trägt `error.code` (bei diesen Werkzeugen gleich `reason`). Wer schon vor dem Werkzeug abgewiesen wird (ohne Anmeldung, oder das Dienstkonto), bekommt nur `error.code: login_required` mit der Anmelde-Aufforderung, ohne `status` und `reason`.

Nur mit `WLO_BAPI_VIA_REPOSITORY`; startbar sind die Flows aus `WLO_BAPI_FLOWS`. Alle vier nur mit der eigenen
Anmeldung der Person, nie mit dem Dienstkonto.

- **`wlo_start_flow`** — `flow`, `inputs`, `confirmToken` (der Parameter heißt bei uns wie bei allen
  Schreibwerkzeugen `confirmToken`; die Vorschau gibt ihn unter `confirm.token` zurück). Ausgabe `status: preview`
  mit `confirm`, `started` mit `jobId` und `flow`, oder `failed` mit `reason` (`not_allowed`, `login_required`,
  `edu_user_required`, `rejected`, `bad_inputs`, `rate_limited`, `upstream_error`), `retryAfter?`, `code?` und bei
  `node-metadata-write` `problems: [{nodeId, problem}]`.
  - `node-metadata-write`: 1–50 nodeIds, keine doppelt, `language` `de`/`en` (Vorgabe `de`, wird ausdrücklich
    mitgeschickt). Vor der Vorschau liest der MCP jeden Datensatz als die Person: ein Material (`ccm:io`), keine
    Sammlung, **keine Verknüpfung in einer Sammlung** (der Flow schriebe auf die Kopie), schreibbar. Probleme:
    `not_found`, `not_readable`, `not_a_record`, `is_reference`, `not_writable`, `unchecked` (keine Antwort; dann
    `upstream_error`, erneut versuchen — nur wenn alle Probleme `unchecked` sind; sonst `bad_inputs`). Die Vorschau nennt jedes Material (`nodeId „Titel“`) und den Satz, was
    überschrieben wird; gesendet werden genau diese nodeIds.
  - Kommt nach der Bestätigung keine verwertbare Antwort (5xx, 202 ohne `jobId`, Abbruch), ist der Ausgang **offen**:
    `reason: upstream_error`, `error.outcomeOpen: true`. Ein Job kann laufen — vor einem neuen Start nachsehen.
    Ein 4xx der b-api nach der Bestätigung (`bad_inputs`, `edu_user_required`, `rejected`, `not_allowed`, ein
    anderer 4xx als `upstream_error`) hat nichts gestartet: `error.outcomeOpen: false`; der Schlüssel ist verbraucht,
    also neue Vorschau. **Ein 429 ist kein Urteil:** `reason: rate_limited` mit `retryAfter`, aber
    `error.outcomeOpen: true` — vor einem neuen Start nachsehen. **Entscheidet nach `error.outcomeOpen`, nicht nach
    `reason`:** `upstream_error` kann beides sein.
  - Derselbe Schlüssel ein zweites Mal liefert die erste Antwort (`replayed: true`), es startet kein zweiter Job.
- **`wlo_flow_status`** — `jobId`. Ausgabe `status: running|succeeded|failed|cancelled|unknown` (`unknown` für ein
  Statuswort, das die b-api nicht dokumentiert — nie „running“), `rawStatus`, `errorCode?`, `warnings?`,
  `progress?` (`started, running, succeeded, warning, failed`, wie die b-api ihn liefert), `iterations?` (nur Zahlen
  je Stand: `running, succeeded, warning, failed, cancelled`), `iterationsSampled?` (die b-api listet höchstens 200),
  `outputs?` (nur bei Erfolg, ≤ 1 MB, sonst `truncated: true`; im Text höchstens die ersten 20 000 Zeichen, vollständig
  im strukturierten Ergebnis), `files?` ohne Download-Link.
  Scheitert die Abfrage: `status: failed`, `isError`, `reason` — `unknown_job` für einen fremden oder unbekannten
  Job, `edu_user_required` (die Person kam bei der b-api nicht an), `rejected`, `rate_limited` mit `retryAfter`,
  `login_required`, `upstream_error` (dann ist offen, ob der Job noch läuft). Die Liste ist nicht abschließend.
- **`wlo_cancel_flow`** — `jobId`. Ausgabe `status: cancelled|already_finished|unknown_job` (ein fremder oder
  unbekannter Job ist hier `status: unknown_job`, kein Fehler). Scheitert der Abbruch: `status: failed`, `isError`,
  `reason`; kommt keine Antwort, `reason: upstream_error` mit `error.outcomeOpen: true` — ob abgebrochen wurde, ist
  offen, `wlo_flow_status` zeigt den Stand.
- **`wlo_list_flows`** — die Flows dieser Anmeldung, geschnitten mit `WLO_BAPI_FLOWS`, mit Beschreibung und
  Eingabeschema.

**Eigene Jobs, bei uns gebunden:** Weil über den Proxy jede Person jeden Job lesen könnte, merkt sich der MCP, welches
Konto welchen Job über ihn gestartet hat. `wlo_flow_status` und `wlo_cancel_flow` fragen die b-api nur für eigene
Jobs; jeder andere ist `unknown_job` — bei `wlo_flow_status` als `status: failed` + `reason: unknown_job`, bei
`wlo_cancel_flow` als `status: unknown_job`, also genau die Antworten, die ihr für einen fremden Job erwartet. Grenze: Die Zuordnung
liegt im Arbeitsspeicher. **Nach einem Neustart des MCP sind auch eigene laufende Jobs `unknown_job`**; ihre
Ergebnisse stehen dann an den Datensätzen.

## 3. Nicht gebaut

- **W5 `wlo_flow_file`:** Der einzige freigegebene Flow liefert keine Dateien (`fileInputs: []`, nur `report`).
  Bauen wir, sobald ein Flow Dateien erzeugt.
- **W7 Textextraktion über den Proxy:** ändert den Weg eines bestehenden Werkzeugs; ein eigenes Paket mit eigener Messung.

## 4. Für das b-api-Team (bitte weitergeben)

- Jobs, die über `/bapi/**` gestartet werden, hängen am Schlüssel des Repositorys, nicht an der bestätigten Person:
  Jede bestätigte Person liest jeden Job, dessen `jobId` sie kennt (Abbrechen haben wir nicht ausprobiert, es
  hängt am selben Schlüssel). Ohne bestätigte Person, je mit `DisableGuest`: beim Lesen ergeben falsches Passwort und
  keine Anmeldung 401; beim Abbrechen haben wir das falsche Passwort gemessen: ebenfalls 401. Vorschlag: den Job an die Person
  der Assertion binden.
- Die Grenze von 20 unfertigen Jobs je Schlüssel teilen sich damit alle Personen eines Repositorys.
- **Ohne Anmeldung liest der Gast des Repository-Proxys jeden Job samt Bericht**, wenn die Anfrage kein
  `DisableGuest: true` trägt (gemessen 18.11.: 200; mit `DisableGuest` 401). Ein Browser schickt den Header nicht.
  Vorschlag: Job-Pfade über `/bapi/**` nie als Gast beantworten.

## 5. Bereitstellung auf Staging

Der Betrieb setzt `WLO_BAPI_VIA_REPOSITORY=1` und `WLO_BAPI_FLOWS=edusharing.chatbot/node-metadata-write` und
stellt den aktuellen Stand bereit. Wir melden uns mit Commit und Werkzeugschemas, sobald es läuft; danach baut ihr
Paket K.
