# Steckbrief: wlo-mcp

Stand: 2026-11-19 · Server-Version 1.5.0 · **Entwurf zur Übergabe an das Plattform-Team**

Dieser Steckbrief fasst zusammen, was jemand wissen muss, der den Dienst betreibt, ohne ihn gebaut zu
haben. Er wiederholt die Einzelheiten nicht, sondern verweist: Betrieb in
[`DEPLOYMENT.md`](DEPLOYMENT.md), Einstellungen in [`.env.example`](../.env.example) und
[`MCP-REFERENZ.md`](MCP-REFERENZ.md), Anmeldung in [`AUTH.md`](AUTH.md), der Helm-Chart-Entwurf in
[`deploy/helm/wlo-mcp/`](../deploy/helm/wlo-mcp/README.md). Die Kurzform nach der Übergabe-Vorlage
(eine Zeile je Punkt) ist [`STECKBRIEF-UEBERGABE.md`](STECKBRIEF-UEBERGABE.md).

Heute läuft der Dienst mit Docker Compose auf einem Host. Der Helm-Chart ist ein Entwurf: geprüft mit
`helm lint` und `helm template`, **auf keinem Cluster installiert**.

## 1. Was der Dienst ist — und was nicht

| | |
|---|---|
| **Service-ID** | `wlo-mcp` (so auch das Feld `service` in jeder Logzeile) |
| **Ist** | Der Zugang zu **einem** edu-sharing-Repository für MCP-Clients (KI-Programme, Chatbots): Suche, Sammlungen, Themenseiten, Detaildaten, Volltext, Skills — 34 Lesewerkzeuge — und 26 Kuratier-Werkzeuge, die schreiben. Wo das Repository den B-API-Proxy hat, dazu vier Werkzeuge, die **Aufträge der B-API** (Kestra-Flows) als die angemeldete Person starten und verfolgen. Dazu eine kleine öffentliche REST-Fläche (`/api/*`) und die Anmeldeseiten. |
| **Ist nicht** | Kein LLM und kein LLM-Gateway: der Dienst ruft kein Sprachmodell auf. Einen B-API-Auftrag startet er nur; was der Auftrag tut, läuft in der B-API — der Vorgabe-Flow erzeugt Metadaten mit einem Modell, dort und auf deren Kosten. Kein eigener Datenbestand: alle Inhalte liegen im Repository. Kein Ersatz für das Repository-Rechtesystem — was jemand sieht und ändern darf, entscheidet edu-sharing. |
| **Technik** | TypeScript, Node 22, ein langlebiger Prozess. Laufzeit-Abhängigkeiten: `@modelcontextprotocol/sdk`, `zod`. Kein Web-Framework, keine Datenbank. |
| **Abhängig von** | dem Repository (zwingend); Wikipedia (`*.wikipedia.org`, nur für das Wikipedia-Werkzeug); einem Textextraktionsdienst (optional, `WLO_TEXT_EXTRACTION_URL`); der B-API, für die vier Auftrags-Werkzeuge erreicht **über den Proxy des Repositorys** (`{Repository}/rest/bapi` — dafür kein weiterer Host und kein eigener Schlüssel); getrennt davon optional der Extraktionsdienst über den B-API-Proxy, mit dem B-API-Schlüssel `WLO_TEXT_EXTRACTION_API_KEY` (§7). |

### Anmeldung: der Dienst steht nicht hinter der B-API

Der Dienst hat eine eigene Anmeldung. Der Kopf `Authorization` trägt den **WLO-Zugang**, keinen
B-API-Schlüssel:

| Wer | Wie | Voraussetzung am Server |
|---|---|---|
| anonym | kein `Authorization`-Kopf — Antwort 200, öffentliche Inhalte | keine |
| Dienstkonto | ein gemeinsames Konto für alle Aufrufe auf `/mcp` | `WLO_SERVICE_USER` + `WLO_SERVICE_PASSWORD` |
| Person, OAuth 2.1 | der Client meldet sich selbst an (`/oauth/*`), die Person loggt sich mit ihrem WLO-Konto ein | `WLO_AUTH_PRIVATE_KEY` **und** eine bekannte öffentliche Adresse — siehe unten |
| Person, Zugangsblock | verschlüsselter Block von `/auth`, einmal als `Bearer wlo2.…` eingetragen, widerrufbar | `WLO_AUTH_PRIVATE_KEY` |
| Person, Ticket | ein eingebettetes Widget tauscht ein edu-sharing-Ticket an `POST /auth/ticket` gegen einen Block (12 h gültig) | `WLO_AUTH_PRIVATE_KEY` |
| Person, Basic | `Authorization: Basic …` wird ans Repository durchgereicht | keine (nicht empfohlen: der Wert ist das Passwort) |

**Was „anonym“ mit einem Dienstkonto bedeutet — eine Entscheidung des Betreibers.** Ist ein
Dienstkonto eingerichtet, liest eine `/mcp`-Anfrage OHNE `Authorization`-Kopf mit diesem Konto, nicht
als Gast. Alles, was das Konto über die öffentlichen Inhalte hinaus lesen darf, ist damit für jeden
lesbar, der `/mcp` erreicht. Immer anonym bleibt nur die REST-Oberfläche `/api/*` (und der Launcher).
Das Dienstkonto also so berechtigen, wie man es jedem Besucher zugestehen würde — oder `/mcp` nur
einem bekannten Kreis zugänglich machen. Ein Kopf, der sich nicht verwenden lässt, fällt dagegen auf
Gast zurück, nie auf das Dienstkonto.

**Woher OAuth die öffentliche Adresse nimmt** (`resolveIssuer`, `src/auth/oauth-metadata.ts`): Ist
`WLO_PUBLIC_BASE_URL` gesetzt, gilt allein dieser Wert — auch dann, wenn er sich nicht als Adresse
lesen lässt; dann ist OAuth aus, es wird **nicht** auf den Kopf ausgewichen. Ist die Variable leer,
entscheidet `TRUST_PROXY`: eingeschaltet wird die Adresse je Anfrage aus dem `Host`-Kopf gebildet
(Schema aus `X-Forwarded-Proto`, sonst https) — das stimmt nur hinter einem Proxy, der den Kopf
selbst setzt, und der Server warnt beim Start davor; ausgeschaltet antworten alle OAuth-Pfade mit 404.
Empfohlen ist deshalb, `WLO_PUBLIC_BASE_URL` immer zu setzen.

Schreibende Werkzeuge sind für alle sichtbar und verweigern beim Aufruf, wenn niemand angemeldet ist.

### Die B-API als Ziel, nicht als Vorbau: Aufträge über den Repository-Proxy

Der Dienst steht nicht hinter der B-API, er **ruft** sie für die vier Auftrags-Werkzeuge auf — und zwar
nicht direkt, sondern über den B-API-Proxy des Repositorys (`{Repository}/rest/bapi/**`). Dort bürgt
das Repository für die Person, mit deren eigener Anmeldung der Aufruf kommt, und setzt seinen eigenen
Schlüssel; für die Aufträge hält der Dienst keinen B-API-Schlüssel. Nur persönliche Anmeldungen, nie
das Dienstkonto. (Getrennt davon kann der Extraktionsdienst über den B-API-Proxy erreicht werden, mit
dem B-API-Schlüssel `WLO_TEXT_EXTRACTION_API_KEY` — eine andere Route, §7.)

- **Eingeschaltet:** Ohne Einstellung fragt der Dienst beim Start anonym, ob das Repository den Proxy
  hat (`200` mit Liste = ja, `404` mit JSON-Objekt = nein; ohne klares Urteil erneut, auch über
  Minuten — ein Proxy, der den Gast abweist, gibt nie eines), und hat die vier Werkzeuge nur dann.
  `WLO_BAPI_VIA_REPOSITORY=1`/`0` legt es fest. Startbar ist `edusharing.chatbot/node-metadata-write`,
  solange `WLO_BAPI_FLOWS` nichts anderes nennt.
- **Netz:** für die Aufträge kein neuer Host — der Proxy liegt auf dem Repository-Host.
- **Zustand:** Über den Proxy tragen alle Personen den einen Schlüssel des Repositorys, und die B-API
  würde jeden Job jedem zeigen, der seine ID kennt (gemessen 2026-11-18). Der Dienst merkt sich deshalb,
  welches Konto welchen Job gestartet hat, und beantwortet Stand und Abbruch nur diesem — im
  Arbeitsspeicher (§4).
- **Kapazität:** Die Grenze der B-API von 20 unfertigen Jobs je Schlüssel teilen sich damit alle
  Personen eines Repositorys.
- **Asynchron:** Ein Auftrag läuft in der B-API weiter, nachdem der Start geantwortet hat; der Client
  fragt den Stand mit `wlo_flow_status` ab. Der Dienst selbst hat dafür keinen Hintergrundlauf.

Einzelheiten: [`docs/rules/write-support.md`](rules/write-support.md) (b-api-Block), Plan
[`2026-11-17-kestra-flows-ueber-repository-proxy.md`](plans/2026-11-17-kestra-flows-ueber-repository-proxy.md).

## 2. Zwei Abweichungen vom Service-Leitfaden — mit Begründung

**Abweichung 1: Betrieb ohne B-API.**
Der Dienst wird direkt von MCP-Clients angesprochen, nicht über die B-API, und prüft keinen
B-API-Schlüssel. (Dass er für die Auftrags-Werkzeuge die B-API über den Repository-Proxy *aufruft*,
ändert daran nichts — siehe §1.) Gründe:

- MCP-Clients sind fremde Programme (ChatGPT, Claude, andere), die nur das können, was das Protokoll
  vorsieht: OAuth 2.1 oder gar keine Anmeldung. Gemessen am 2026-08-05: der ChatGPT-Connector bietet
  kein Feld für einen Kopf oder API-Schlüssel.
- Die Rechte sollen die der **Person** sein, und Änderungen sollen unter ihrem Namen in der
  Repository-Historie stehen. edu-sharing bietet dafür kein weiterreichbares Token (kein
  OIDC-Discovery, nur Basic und Cookie) — deshalb der verschlüsselte Zugangsblock, den nur dieser
  Server öffnen kann.
- Anonymes Lesen und Anmeldung liegen bewusst auf derselben Adresse.

Was der Dienst an Stelle des Gateways selbst mitbringt: Ratenbegrenzung je Adresse bzw. je
vertrautem Client, Schutz gegen das Durchprobieren von Logins, Größenbegrenzung der Anfragen, eine
prozessweite Schranke für offene Repository-Aufrufe.

**Abweichung 2: an ein Repository gebunden.**
Ein MCP pro Repository; die Adresse steht fest in der Umgebung (`WLO_REPOSITORY_URL`) und ist kein
Parameter eines Aufrufs. Gründe:

- Die **Vokabulare** (Fach, Bildungsstufe, Inhaltsart, Lizenz …) sind im Code hinterlegt und werden
  per Skript gegen die Instanz abgeglichen, nicht zur Laufzeit geladen.
- Der Dienst liest und schreibt WLO-eigene Eigenschaften (`ccm:oeh_*`) und setzt den
  WLO-Metadatensatz voraus.
- Knoten-IDs gelten nur in einem Repository: die **Wurzel-Sammlung** ist je bekanntem Host fest
  hinterlegt (`WLO_ROOT_COLLECTION_ID` für andere Instanzen), ebenso Posteingang und
  Skill-Sammlung, sofern gesetzt.
- Die Zugangsdaten des Betreibers werden **nur** an genau diesen Host angehängt — eine
  Sicherheitsgrenze, die eine frei wählbare Adresse aufheben würde.

## 3. Ports und Pfade

| Port | Zweck | Pfade | Erreichbar für |
|---|---|---|---|
| `3000` (öffentlich, `PORT`) | Clients | `POST /mcp` (MCP, SSE-Antwort) · `GET /api/*`, `POST /api/uploads` · `/auth`, `/auth/*`, `/auth-revoke.html` · `/oauth/*`, `/.well-known/oauth-*` · `/launcher.html` · `/openapi.yaml` | Ingress / Reverse Proxy |
| intern (`INTERNAL_PORT`, **ohne Vorgabe aus**; im Chart `9090`) | Proben, Metriken | **nur** `GET /health`, `GET /ready`, `GET /metrics` | Cluster (kubelet, Prometheus) — nie über den Ingress |

- **Den internen Port gibt es nur, wenn er eingeschaltet wird.** `INTERNAL_PORT` ist ohne Vorgabe
  leer (bzw. `0`), dann öffnet der Server keinen zweiten Port — so läuft die heutige
  Compose-Installation. `9090` ist der Wert, den der Chart setzt, keine Vorgabe des Dienstes.
- `/health`, `/ready` und `/metrics` gibt es weiterhin auch auf dem öffentlichen Port (`/metrics`
  dort nur mit `METRICS_TOKEN`).
- Auf dem internen Port verlangt `/metrics` kein Token, solange `METRICS_TOKEN` nicht gesetzt ist;
  ist es gesetzt, gilt es auf beiden Ports. `INTERNAL_BIND_ADDR` legt fest, auf welcher
  Schnittstelle der interne Port lauscht (leer = alle; `127.0.0.1` = nur die Maschine selbst — im
  Cluster nicht setzen, Proben und Scraper kommen von außerhalb des Pods). Ohne Loopback-Adresse
  und ohne `METRICS_TOKEN` warnt der Start.
- **Der Proxy muss die echte Client-Adresse sehen** (aus dem Code abgeleitet — `clientKey`,
  `src/rate-limit.ts` —, **nicht auf einem Cluster gemessen**). Mit `TRUST_PROXY=1` (Vorgabe in
  Compose und Chart) zählt der Server jede Grenze nach dem **letzten** Eintrag von
  `X-Forwarded-For`, also nach der Adresse, die der direkt vorgeschaltete Proxy gesehen und
  angehängt hat (ohne den Kopf: die Adresse der Verbindung; IPv6 je /64; vorausgesetzt ist genau ein
  vertrauter Proxy). Sieht der Ingress-Controller selbst nur eine Knoten- oder
  Load-Balancer-Adresse (SNAT), teilen sich **alle Nutzer einen Zähler**: das Werkzeugbudget
  `RATE_LIMIT_RPM` (Vorgabe 120 `tools/call` je Minute und Adresse) und den Schutz gegen das
  Durchprobieren von Logins `AUTH_CREDENTIAL_LIMIT` (Vorgabe 10 verschiedene Logins je Adresse in
  10 Minuten — die elfte Person, die sich mit `Basic` oder an den Anmeldeseiten anmeldet, wird
  abgewiesen). Ebenso `API_RATE_LIMIT_RPM` (30/min) und `TICKET_CREDENTIAL_LIMIT` (200). Der
  Controller braucht deshalb `externalTrafficPolicy: Local` oder das PROXY-Protokoll. Nicht
  betroffen: Zugangsblöcke auf `/mcp` (gezählt je Block) und vertraute Clients (je Schlüssel).
- **Proxy-Anforderung:** die Antwort auf `/mcp` ist ein SSE-Strom. Der Proxy darf sie nicht puffern
  und braucht eine lange Lesefrist (3600 s); Anfragegröße mindestens 4 MiB, mit Stapel-Upload
  mindestens `UPLOAD_MAX_BYTES` (DEPLOYMENT.md §4).

## 4. Zustand — und warum genau eine Instanz

Im **Arbeitsspeicher** des Prozesses (nach einem Neustart weg, zwischen Prozessen nicht geteilt):

| Was | Lebensdauer |
|---|---|
| Bestätigungsschlüssel der Vorschauen | 10 min |
| Merker abgelaufener Schlüssel und beendeter Pläne | 60 min |
| Ergebnisse eingelöster Schlüssel (Wiederholung) | 30 min |
| Laufende Pläne (Sammlungsbäume, Ablage, Metadaten, Volltexte) | 30 min |
| Stapel und ihre Upload-Plätze | 30 min / bis abgelegt |
| OAuth-Autorisierungscodes | 60 s |
| Raten- und Login-Zähler, Status-Cache | Fenster von 1–10 min |
| Geprüfte Upload-Logins (bestätigt 10 min, abgelehnt 60 s), Antwort von `/ready` (30 s) | Sekunden bis 10 min |
| Metrik-Zähler | bis zum Neustart |
| Wer welchen B-API-Auftrag gestartet hat (Kontoname und Job-ID; höchstens 500 je Konto, 20 000 insgesamt) | 30 Tage — nach einem Neustart sind auch eigene Aufträge `unknown_job` |
| Ob das Repository den B-API-Proxy hat | bis zum Neustart (ohne Urteil: erneut gefragt) |
| Skill-Registry-Cache, Kurzzeit-Caches | Minuten |

Auf der **Platte** genau eine Datei: das Zugangsregister `/data/access-registry.json`.

**Deshalb eine Instanz.** Mit zwei Prozessen kennt der eine die Vorschau des anderen nicht, ein Plan
läuft auf der Instanz weiter, die ihn nicht hält, ein Upload landet dort, wo das Stapel-Werkzeug
nicht nachsieht, ein gestarteter B-API-Auftrag ist auf der anderen Instanz „fremd“, und jede Instanz
vergibt das volle Ratenbudget. Für einen Deployment-Entwurf heißt
das: `replicas: 1`, Strategie `Recreate`, kein Autoscaler. Verfügbarkeit kommt aus dem schnellen
Neustart (72 MB, in Sekunden bereit), nicht aus Replikaten. Eine zweite Instanz würde auch nichts
beschleunigen — die Zeit vergeht im Repository.

## 5. Was zu sichern ist

- **Das Volume unter `/data`** (Compose: `wlo-access-registry`, Chart: PVC `wlo-mcp-data`,
  ReadWriteOnce, Kilobytes). Es enthält Zugangs-IDs, Benutzernamen und Ausstellungszeiten — nie ein
  Passwort. Es ist eine **Positivliste**: geht sie verloren, ist jeder ausgestellte Zugangsblock
  ungültig und alle holen sich einen neuen. Unbequem, aber sicher.
- **Der private Schlüssel** (`WLO_AUTH_PRIVATE_KEY`) — im Secret-Speicher der Plattform. Er
  entschlüsselt jeden ausgestellten Block zu einem lebenden WLO-Passwort.
- Sonst nichts: kein Schema, keine Migration. Was die Kuratier-Werkzeuge geschrieben haben, liegt im
  Repository und folgt dessen Versionierung.

## 6. Ressourcen

Gemessen am 2026-11-13 mit `npm run measure:resources` (DEPLOYMENT.md §5.0.2); auf anderer Hardware
neu messen.

| Zustand | Arbeitsspeicher (RSS) |
|---|---|
| Leerlauf, 10 s nach dem Start | 72 MB |
| Nach einer Runde Lesewerkzeuge | 100 MB |
| Spitze bei 3 × 10 gleichzeitigen `search_wlo_all` | 172 MB |
| Upload-Plätze an ihrer Grenze (128 MB Dateien) | + 156 MB gemessen, **bis + 178 MB** (siehe unten) |
| Volltexte offener Pläne an ihrer Grenze (64 MiB), Latin-1 | + 67 MB |
| dasselbe mit Zeichen außerhalb von Latin-1 (`„`, `–`, `€`) | + 131 MB |
| **Ungünstigster Fall zusammen** | **rund 480 MB** (vor den Anfragekörpern in Übertragung) |

Die 480 MB setzen sich zusammen aus 172 MB Suchspitze + 178 MB Upload-Speicher + 131 MB Volltexte.
Der Upload-Speicher kostet seinen Inhalt **plus eine weitere Datei**: gemessen war der externe
Speicher gleich den gehaltenen Bytes plus der Größe der zuletzt abgelegten Datei (50 + 50 + 28 MB
gehalten → + 156 MB). Wo diese Kopie liegt, wurde nicht nachverfolgt; sie ist durch eine Datei
begrenzt (`UPLOAD_MAX_BYTES`, 50 MB), also 128 + 50 = 178 MB.

CPU: 0,3 Kern während der Suchlast. Vorschlag für den Chart: Speicher Anforderung 256Mi, Grenze
768Mi; CPU Anforderung 100m, Grenze 1. Die Compose-Datei begrenzt auf 512 MB — ohne Stapel-Upload
reichlich, mit ihm nur knapp.

## 7. Konfiguration im Überblick

Alles über Umgebungsvariablen; keine Konfigurationsdatei. Grundsatz: **leer lassen**, was man nicht
bewusst entscheidet — die Vorgaben stehen im Code neben ihrer Messung. Die Gruppen folgen
`.env.example`, dort steht jede Variable mit Bedeutung und Vorgabe:

| Gruppe | Inhalt | Beispiele |
|---|---|---|
| 1 Repository | welches Repository | `WLO_REPOSITORY_URL` (Pflicht im Chart), `WLO_ROOT_COLLECTION_ID` |
| 2 Persönliche Anmeldung | Schlüssel, Register | `WLO_AUTH_PRIVATE_KEY`, `…_PREVIOUS`, `WLO_AUTH_REGISTRY_PATH` |
| 3 Dienstkonto, Schreiben, Stapel | gemeinsames Konto und was es darf | `WLO_SERVICE_USER`, `WLO_SERVICE_PASSWORD`, `WLO_ALLOW_SERVICE_WRITES`, `WLO_BATCH_UPLOAD_ENABLED` |
| 4 Werkzeuge | welche Werkzeuge es gibt | `WLO_DISABLE_UNSAFE_TOOLS` (ausgeliefert: `all`), `WLO_SKILL_*`, `WLO_TEXT_EXTRACTION_URL`, `WLO_BAPI_VIA_REPOSITORY` (leer = erkennen), `WLO_BAPI_FLOWS` |
| 5 Netz | Betrieb hinter einem Proxy | `MCP_SSE`, `TRUST_PROXY`, `WLO_PUBLIC_BASE_URL`, `INTERNAL_PORT` |
| 6 Grenzen und Zeiten | Feinjustierung | `RATE_LIMIT_RPM`, `TRUSTED_CLIENT_KEYS`, `WLO_UPSTREAM_CONCURRENCY`, `METRICS_TOKEN`, `LOG_LEVEL` |
| 7 Widgets | ChatGPT-Einreichung | `WLO_WIDGET_*` |

Sieben davon gehören in ein Secret, nie in eine Werte-Datei: `WLO_SERVICE_USER`, `WLO_SERVICE_PASSWORD`,
`WLO_AUTH_PRIVATE_KEY`, `WLO_AUTH_PRIVATE_KEY_PREVIOUS`, `METRICS_TOKEN`, `TRUSTED_CLIENT_KEYS`, `WLO_TEXT_EXTRACTION_API_KEY` (nur wenn der Extraktionsdienst hinter dem B-API-Proxy liegt). Im Chart kommen sie aus einem
**vorhandenen** Secret (`existingSecret`); alles andere wird eine ConfigMap.

Eine unbrauchbare `WLO_REPOSITORY_URL` beendet den Start mit Exit-Code 1.

## 8. Logging

- **Format:** ein JSON-Objekt je Zeile.
- **Ströme:** über HTTP nach **stdout**; im stdio-Betrieb nach stderr (stdout ist dort der
  Protokollkanal).
- **Felder:** `timestamp`, `level` (`info` | `warn` | `error`), `service` (`wlo-mcp`), `message`,
  `req` (die Request-ID, auch als Antwortkopf `X-Request-Id`), `trace_id` / `span_id` in jeder
  Zeile einer HTTP-Anfrage (der B3-Trace des Aufrufers, sonst ein eigener, seit 1.2.0); dazu ereignisbezogene Felder.
- **Schwelle:** `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; Vorgabe `info`).
- **Menge:** eine Zeile je Anfrage gibt es **nur für `POST /mcp`** (`mcp request`, mit Methode und
  Rechte-Modus). Anfragen an `/api/*`, `/auth*`, `/oauth/*`, `/health`, `/ready` und die Seiten
  schreiben **keine** Zugriffszeile — dort erscheinen nur Ereignisse (ein Widerruf, ein ausgestelltes
  Token, eine abgelehnte Autorisierung) sowie Warnungen und Fehler. Wer Zugriffe auf diese Pfade
  zählen will, nimmt `wlo_http_requests_total` oder das Log des Proxys. Compose begrenzt das Containerlog auf 5 × 10 MB; auf einer
  Plattform ist die Rotation Sache der Knoten bzw. der Log-Pipeline.
- Adresse, Benutzername und Suchbegriff stehen im Log standardmäßig nur als Pseudonym (Schlüssel-Hash, der nur im laufenden Prozess gilt); `LOG_PERSONAL_DATA=plain` schreibt sie im Klartext (Entscheidung des Betreibers).

## 9. Metriken und vorgeschlagene Alarme

`GET /metrics` im Prometheus-Textformat (interner Port; öffentlich nur mit `METRICS_TOKEN`).
Labels tragen nie einen Aufrufer, einen Pfad oder eine Suchanfrage.

| Metrik | Art | Labels |
|---|---|---|
| `wlo_http_requests_total` | Zähler | `route` (mcp, api, auth, oauth, health, ready, metrics, other), `status` (Statuscode oder `aborted`) |
| `wlo_http_request_duration_seconds` | Histogramm | `route` |
| `wlo_tool_calls_total` | Zähler | `tool`, `outcome` (`ok`, `error` = mit isError beantwortet, `thrown`) |
| `wlo_tool_duration_seconds` | Histogramm | `tool` |
| `wlo_tool_errors_total` | Zähler | `tool`, `code` (Fehlercode der Antwort; unbekannte als `other`, fehlende als `uncoded`) |
| `wlo_upstream_requests_total` | Zähler | `outcome` (`2xx`…`5xx`, `error` = keine Antwort, `cancelled`, `shed` = nicht gesendet, eigene Schranke) |
| `wlo_upstream_duration_seconds` | Histogramm | `outcome` |
| `wlo_upstream_gate_wait_seconds` | Histogramm | `outcome` (`granted`, `shed`) — nur Aufrufe, die an der eigenen Schranke warten mussten |
| `wlo_upstream_in_flight`, `wlo_upstream_waiting`, `wlo_upstream_limit` | Messwert | — |
| `wlo_rate_limited_total` | Zähler | `limiter` (eigene 429: `rate_limited`, `too_many_logins`, `upload_…`) |
| `wlo_skill_registry_cache_entries`, `wlo_fulltext_held_bytes`, `wlo_plans_held`, `wlo_confirm_tokens_held`, `wlo_confirm_replays_held`, `wlo_upload_held_bytes` | Messwert | — (begrenzte Speicher im Prozess, beim Abruf gelesen) |
| `wlo_build_info` | Messwert | `version` |
| `process_*`, `nodejs_heap_*`, `nodejs_external_memory_bytes`, `nodejs_eventloop_lag_seconds` | übliche Prozesswerte | — |

Histogramm-Grenzen: 0,05 s … 60 s. Zähler beginnen mit dem Prozess bei null, und eine Zählerreihe
gibt es erst ab ihrem ersten Ereignis — `increase()`/`rate()` allein übersehen deshalb das erste
Ereignis nach einem Neustart. Die Regeln im Chart für seltene Ereignisse fangen es eigens ab.

**Vorgeschlagene Alarme** (im Chart als optionale `PrometheusRule`; **alle Schwellen sind Vorschläge
ohne Betriebserfahrung**):

| Alarm | Bedingung (Vorschlag) |
|---|---|
| `WloMcpDown` | die eine Instanz wird 3 min nicht abgefragt |
| `WloMcpRecentlyStarted` (Hinweis) | der Prozess läuft seit weniger als 10 min. **Kein** Neustart-Zähler: ein neu angelegter Pod ist eine neue Reihe, eine Absturzschleife ist aus den eigenen Metriken nicht zu erkennen — dafür kube-state-metrics nehmen, wo vorhanden |
| `WloMcpRepositoryFailing` | > 20 % der Repository-Aufrufe enden mit 5xx oder ohne Antwort, 5 min — **der Ersatz für eine Probe auf `/ready`** |
| `WloMcpSheddingRepositoryCalls` | Aufrufe werden von der eigenen Schranke abgewiesen (`outcome="shed"`), 5 min — auch der erste nach einem Neustart |
| `WloMcpRepositoryQueue` | durchgehend wartende Repository-Aufrufe, 5 min |
| `WloMcpToolErrors` | > 25 % der Werkzeugaufrufe enden mit `error` oder `thrown`, 10 min (`error` enthält auch gewollte Absagen) |
| `WloMcpToolThrows` | ein Werkzeug hat geworfen statt zu antworten — auch beim ersten Mal nach einem Neustart |
| `WloMcpServerErrors` | anhaltend **selbst verschuldete** 5xx, 10 min. Ausgenommen sind `route="ready"`, `route="api"` und jeder 503: die entstehen, wenn das Repository (oder Wikipedia) nicht antwortet, und gehören zu `WloMcpRepositoryFailing`. Ein Fehler in einem `/api`-Handler fällt damit nur im Log auf |
| `WloMcpSlowRequests` / `WloMcpSlowTool` | p95 über 20 s (`/mcp` bzw. je Werkzeug), 10 min |
| `WloMcpMemoryNearLimit` | Arbeitsspeicher über 85 % der Grenze von 768Mi (684 510 412 Bytes), 5 min |
| `WloMcpEventLoopLag` | Verzögerung der Ereignisschleife über 0,1 s, 5 min |

Zusätzlich nötig und nicht aus dem Dienst selbst zu gewinnen: eine **Prüfung von außen** auf
`GET /health` (der Container ist weg) bzw. `GET /ready` (das Repository ist nicht erreichbar).

## 10. Proben

| Probe | Ziel | Warum |
|---|---|---|
| Liveness | `GET /health`, **interner** Port | antwortet auch, während der öffentliche Port nach einem Stoppsignal ausläuft |
| Readiness | `GET /health`, **öffentlicher** Port | sobald er nichts mehr annimmt, kommt kein Verkehr mehr |
| — | **nie** `GET /ready` | antwortet 503, solange das **Repository** nicht erreichbar ist; als Probe nähme es die einzige Instanz aus dem Dienst — für eine Störung, die nicht ihre ist. Stattdessen alarmieren. |

`/health` trägt außerdem den Fingerabdruck der gebauten Widgets („ist der neue Stand live?").

## 11. Stoppverhalten

- Auf `SIGTERM`: keine neuen Verbindungen, laufende Arbeit zu Ende bringen, Exit-Code 0. Ohne
  laufende Arbeit sofort (gemessen: `docker stop` in 1,0–1,4 s).
- Nach **70 s** (`SHUTDOWN_GRACE_MS`) wird abgeschnitten, Exit-Code 1. In die Nähe kommen nur ein
  Schreibvorgang mit Quell-URL (bis 60 s) und ein Abschnitt eines Stapel-Plans (etwa 40 s).
- Die Frist der Plattform muss **darüber** liegen: Compose `stop_grace_period: 75s`, Chart
  `terminationGracePeriodSeconds: 90`.
- Während des Auslaufens werden neue Verbindungen abgelehnt (hinter dem Proxy: 502). Ein Client, der
  das als „gleich noch einmal" behandelt, liegt richtig.
- Ein abgeschnittener bestätigter Schreibvorgang hat einen **offenen Ausgang**; der neue Prozess
  kennt die alten Schlüssel nicht (`confirm_unknown`, `outcomeOpen: true`). Erst im Repository
  nachsehen, dann neu beginnen.

## 12. Build

- **Mehrstufiges Image** (`Dockerfile`): Basis `node:22-alpine`, per Digest festgelegt; die
  Laufzeitstufe enthält nur Produktionsabhängigkeiten, `dist/`, die gebauten Widgets, `public/` und `docs/openapi.yaml`.
- **Nicht-root:** Benutzer `node` (uid 1000). Im Betrieb: Dateisystem nur lesbar, beschreibbar sind
  allein `/data` (Volume) und `/tmp`; alle Capabilities entzogen, keine Rechteausweitung.
- **CI:** Lint, Tests und Build auf Node 22; in der GitHub-Pipeline zusätzlich ein Smoke-Test des
  Images (`npm run smoke:image`: bauen, unter den Compose-Einschränkungen starten, `/health`,
  `tools/list`, `/openapi.yaml`, sauberes Stoppen, Startabbruch bei unbrauchbarer Repository-Adresse). In der
  GitLab-Pipeline läuft dieser Smoke-Test nicht (er braucht einen Docker-Daemon).
- **Versionen als Tag (seit 1.2.0):** Ein Git-Tag `vX.Y.Z` (gleich der Version in `package.json`)
  baut über `.github/workflows/release.yml` das Image `ghcr.io/janschachtschabel/wlo-mcp:X.Y.Z` und
  `:X.Y` sowie den Chart `oci://ghcr.io/janschachtschabel/charts/wlo-mcp` in derselben Version;
  `latest` wird nicht veröffentlicht. Ein neues Paket in dieser Registry ist privat, bis sein
  Eigentümer das ändert. Die Ziel-Registry der Plattform ist weiter offen (§14); der Chart hat
  deshalb keinen Vorgabewert für `image.repository`. Die CI rendert den Chart
  (`helm lint --strict`, `helm template`). Compose baut weiterhin auf dem Host
  (`docker compose up -d --build`, Name `wlo-mcp:latest`).

## 13. Kompatibilität

Eingetragen ist nur, was im Repository belegt ist; leere Felder sind nicht gemessen.

| Server | Node | MCP-SDK | edu-sharing-Instanz | Stand |
|---|---|---|---|---|
| 1.5.0 | 22 (Image: `node:22-alpine`, 22.23.5; `engines` ≥ 22.12.0) | 1.32.2 | **Staging** (`repository.staging.openeduhub.net`) — edu-sharing-Version nicht festgehalten | gemessen mit 1.1.0: Lesen, Schreibvertrag (`npm run test:live`), Ressourcen (2026-11-13); 1.2.0: Baumlesen (2026-11-15), Image-Smoke-Test; 1.3.0: Schreibvertrag und Sitzungs-Tausch (`npm run test:live`, 23 von 23, 2026-11-15); 1.5.0: B-API-Aufträge über den Repository-Proxy (Start, Lauf, Schreiben als Person, Fremdzugriff; `tests/live/bapi-flows.test.ts`, 2026-11-18) und die Erkennung des Proxys (2026-11-18) |
| 1.5.0 | 22 | 1.32.2 | Produktion (`redaktion.openeduhub.net`) | einzelne Lesemessungen (vor 1.2.0); kein Schreibtest |
| 1.5.0 | 22 | 1.32.2 | anderes edu-sharing | nicht gemessen; braucht mindestens `WLO_ROOT_COLLECTION_ID` |
| … | | | | |

Bekannter Zustand auf Staging (2026-11-06): das Repository lehnt Inhalts-Uploads und das Ablegen in
Sammlungen mit HTTP 500 ab; die davon betroffenen Schreibpfade sind dort derzeit nicht live prüfbar
(`docs/plans/archive/STATUS-2026-08-15-bis-2026-11-14.md`).

## 14. Offen / zu entscheiden

> Diese Punkte sind **nicht entschieden**. Nichts davon ist im Chart oder im Code vorweggenommen.

- [ ] **Image-Registry der Plattform und Sichtbarkeit:** Seit 1.2.0 veröffentlicht der Tag-Lauf nach
      `ghcr.io/janschachtschabel` (privat). Offen bleibt, wohin die Plattform spiegelt und ob das
      Paket öffentlich wird.
- [ ] **Vertretung** für den Dienst. Technischer Owner ist T4 (festgelegt 2026-11-15).
- [x] **Service-ID:** `wlo-mcp`, entschieden 2026-11-13 — Paket, Image, Compose-Dienst, Log-Feld `service` und Chart tragen denselben Namen.
- [x] **Vorgabe für `WLO_REPOSITORY_URL` im Code:** bleibt (entschieden 2026-11-13). Ohne B-API hat der
      Dienst keine andere Quelle für die Adresse, und Installationen ohne jede Variable würden nicht mehr
      starten. Dafür meldet der Start jetzt mit einer Warnung, welches Repository benutzt wird, wenn die
      Variable fehlt. Der Chart verlangt die Adresse weiterhin.
- [x] **Was das Log tragen darf:** entschieden 2026-11-13 — IP-Adresse, Benutzername und Suchbegriff
      nur pseudonymisiert, Klartext per `LOG_PERSONAL_DATA=plain`. Offen bleibt die Aufbewahrungsdauer
      im Log-System des Betreibers.
- [ ] **Abstimmung der beiden Abweichungen** (Abschnitt 2) mit Team 6.
- [ ] **Plattform-Angaben für den Chart:** Namespaces von Ingress-Controller und Monitoring (ohne
      sie bleibt die NetworkPolicy aus — der Chart rät keine Namen), ob der Ingress-Controller die
      echte Client-Adresse sieht (Abschnitt 3),
      Ingress-Controller (die Annotationen im Entwurf gelten für ingress-nginx), Storage-Klasse,
      Sicherung des Volumes, ob ausgehender Verkehr nach Hostnamen beschränkt werden kann.
- [ ] **Alarmschwellen** nach den ersten Betriebswochen festlegen.
- [ ] **B-API: Jobs an die Person binden** (beim B-API-Team, 2026-11-18 gemeldet): Über den
      Repository-Proxy hängen Jobs am Schlüssel des Repositorys; der Dienst gleicht das mit seiner
      Zuordnung im Arbeitsspeicher aus (§1). Damit teilen sich auch alle Personen eines Repositorys
      die Grenze von 20 unfertigen Jobs je Schlüssel. Und: ohne `DisableGuest` liest der Gast des
      Proxys jeden Job, dessen ID er kennt — der Dienst schickt den Kopf immer, die Lücke gehört dem Proxy.
- [ ] **Schlüssel für das Chatbot-Team** (`TRUSTED_CLIENT_KEYS`) und die erlaubten Ursprünge
      (`TICKET_ALLOWED_ORIGINS`, `WIDGET_OAUTH_ORIGINS`) für die Zielumgebung.
