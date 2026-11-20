# Steckbrief zur Dienste-Übergabe: wlo-mcp

Stand der Angaben: 2026-11-19, gegen den Code geprüft. Die Kurzform nach der Übergabe-Vorlage; die
Begründungen und Messungen stehen im ausführlichen [STECKBRIEF.md](STECKBRIEF.md), der Betrieb in
[DEPLOYMENT.md](DEPLOYMENT.md).

Legende: **vorhanden** · **nicht vorhanden** · **geprüft** (Antwort in Klammern) · **In Klärung** ·
**In Nacharbeit**.

## Stammdaten

| Punkt | Stand |
|---|---|
| **Service** | `wlo-mcp` (WLO MCP Server). Derselbe Name für Paket, Image, Compose-Dienst, Chart und Log-Feld `service`. |
| **Funktionalität** | Macht die Inhalte von WirLernenOnline für KI-Assistenten über das Model Context Protocol nutzbar: 34 Lese-Werkzeuge (Suche, Sammlungen, Themenseiten, Details, Volltexte, Skills) und 27 Kuratier-Werkzeuge für angemeldete Personen (anlegen, bearbeiten, einsortieren, einreichen), dazu vier Stapel-Werkzeuge mit `WLO_BATCH_UPLOAD_ENABLED`; wo das Repository den B-API-Proxy hat, dazu vier Werkzeuge für Aufträge der B-API (Kestra-Flows) als die angemeldete Person. Dazu eine kleine REST-Fläche und vier Widgets. |
| **Stabile Version** | **vorhanden** (1.5.1, Git-Tag `v1.5.1`; dieselbe Nummer tragen `package.json`, Image, Chart, `docs/openapi.yaml` und `/health`.) |
| **Technischer Owner** | **vorhanden** — T4 (festgelegt 2026-11-15). Eine Vertretung ist nicht benannt. Repository-Eigentümer auf GitHub ist `janschachtschabel`. |
| **Jira** | **nicht vorhanden** |
| **Repository** | **vorhanden** ([github.com/janschachtschabel/wlo-mcp-sc](https://github.com/janschachtschabel/wlo-mcp-sc) — dorthin wird der aktuelle Stand veröffentlicht, dort läuft die Pipeline). Ein Umzug in die GitLab-Gruppe der Metadienste ist nicht erfolgt. |
| **OpenAPI Spec** | **vorhanden** als Datei ([`docs/openapi.yaml`](openapi.yaml), OpenAPI 3.1, von einem Test gegen den Code geprüft). Der Dienst liefert sie als `GET /openapi.yaml` aus (seit 1.2.0; YAML, nicht JSON). Sie beschreibt die HTTP-Fläche außerhalb von MCP; die Werkzeuge beschreibt `tools/list`. |
| **Pipeline und Git-Tags** | **vorhanden** (`.gitlab-ci.yml` und `.github/workflows/ci.yml` im Repository: Typprüfung, Lint, Tests, Abhängigkeits-Audit; der Image-Bau mit Smoke-Test und das Rendern des Charts laufen nur in der GitHub-Pipeline). Git-Tags werden seit 1.2.0 benutzt: ein Tag `vX.Y.Z` baut über `.github/workflows/release.yml` Image (`ghcr.io/janschachtschabel/wlo-mcp:X.Y.Z`, `:X.Y`) und Chart (`oci://ghcr.io/janschachtschabel/charts/wlo-mcp`) in derselben Version. Die GitLab-Pipeline hat keinen solchen Lauf. |
| **Endpunkte** | **vorhanden** (öffentlich: `POST /mcp` (auch `POST /`); `GET /api/search` (auch `/api/search/{Begriff}`), `/api/collection`, `/api/compendium`, `/api/topic-page`, `/api/wikipedia`, `/api/skills` (auch `/api/skills/{id}`), `POST /api/uploads` (nur mit eingeschaltetem Stapel-Upload); `/auth`, `/auth/*` — darunter `GET /auth/status`, `POST /auth/ticket` und `POST /auth/session` (nur mit `WLO_SESSION_EXCHANGE`, auch unter `WLO_SESSION_MOUNT_PATH`) —, `/oauth/*`, `/.well-known/oauth-*`; `/launcher.html` und weitere statische Seiten, `/openapi.yaml` (vollständig dort). Infrastruktur: `/health`, `/ready`, `/metrics`.) |
| **Endpunkte auf zwei Ports** | **vorhanden** (öffentlich `PORT`, Vorgabe 3000; intern `INTERNAL_PORT`, im Chart 9090, nur `/health`, `/ready`, `/metrics`. Ohne `INTERNAL_PORT` gibt es nur den öffentlichen Port; die drei Pfade liegen dann dort, `/metrics` nur mit `METRICS_TOKEN`.) |
| **Header / Content-Types** | **geprüft** (Anfrage: `Authorization` optional — `Bearer <Zugangsblock>` oder `Basic`; `X-WLO-Client-Key` für vertraute Clients, dazu von ihnen `X-WLO-Client-Address` (seit 1.4.0, nur hinter gültigem Schlüssel, an `/auth/session`); `Cookie` (`JSESSIONID`, dazu `INGRESSCOOKIE`) und ein passendes `Origin` an `POST /auth/session`, `Origin` an `POST /auth/ticket` (`TICKET_ALLOWED_ORIGINS`); alle POST-Endpunkte unter `/auth/*` verlangen `Content-Type: application/json` (sonst 415) — auch `POST /auth/session` ohne Körper; ausgenommen `/auth/revoke` mit `Bearer`; `/auth*` antwortet mit `Cache-Control: no-store`; jede 429 trägt `Retry-After`; `X-Request-Id`, `x-client-trace-id` und B3 werden übernommen. `/mcp`: `application/json`, Antwort als `text/event-stream` (mit `MCP_SSE`) oder JSON. `/api/*`: JSON, `/api/search?format=html` HTML. `/api/uploads`: `multipart/form-data`. Jede Antwort trägt `X-Content-Type-Options: nosniff` und `Referrer-Policy: no-referrer`; auf dem öffentlichen Port dazu `X-Request-Id`.) |
| **Asynchrone Job-Endpunkte** | **geprüft** (keine eigenen. Alles antwortet synchron. Stapel-Werkzeuge arbeiten als Plan über mehrere Aufrufe: jeder Aufruf leistet ein Stück und gibt ein `continuationToken` zurück; im Hintergrund läuft dafür nichts. Asynchron sind nur die B-API-Aufträge, die `wlo_start_flow` **in der B-API** startet: Der Start antwortet mit einer `jobId`, den Stand fragt der Client mit `wlo_flow_status` ab.) |
| **Readiness Status** | **In Nacharbeit** — Code, Tests, Chart-Entwurf und Dokumentation liegen vor; offen sind die Punkte unter „Offen“ am Ende. |

## Architektur

| Punkt | Stand |
|---|---|
| **Überblick** | Node.js-22-Anwendung in TypeScript, ein langlebiger Prozess ohne Web-Framework; zwei Laufzeit-Abhängigkeiten (`@modelcontextprotocol/sdk`, `zod`). Einstieg `src/http.ts` (Streamable HTTP) bzw. `src/stdio.ts` (lokal). Spricht die REST-Schnittstelle eines edu-sharing-Repositorys direkt an. Einzelheiten: [ARCHITECTURE.md](ARCHITECTURE.md). |
| **Horizontale Skalierbarkeit** | **geprüft** (nein — genau **eine** Instanz, im Chart `replicas: 1` mit `Recreate`. Bestätigungsschlüssel, Pläne, hochgeladene Dateien, die Zuordnung der B-API-Aufträge, Begrenzungen und Caches liegen im Arbeitsspeicher des Prozesses; das Zugangsregister ist eine Datei. Eine zweite Instanz würde Bestätigungen und Pläne nicht kennen und sähe Widerrufe und Eintragungen im Zugangsregister der anderen nicht. Begründung: STECKBRIEF.md §4.) |
| **Integriert in B-API** | **geprüft** (nein. Der Dienst steht nicht hinter der B-API; STECKBRIEF.md §1 und §2 begründen die Abweichung. Er **ruft** sie für die vier Auftrags-Werkzeuge auf — über den B-API-Proxy des Repositorys, mit der Anmeldung der Person, dafür ohne eigenen Schlüssel; eingeschaltet, wenn der Dienst den Proxy beim Start erkennt, oder mit `WLO_BAPI_VIA_REPOSITORY=1`. Getrennt davon optional: der Extraktionsdienst über den B-API-Proxy, mit `WLO_TEXT_EXTRACTION_API_KEY`.) |
| **Schreibt Suggestions** | **geprüft** (ja — auf Anforderung einer angemeldeten Person: `wlo_suggest_metadata` legt Metadaten-Vorschläge an, `wlo_decide_suggestion` entscheidet sie, `wlo_update_contents` leitet redaktionelle Felder als Vorschlag weiter; dazu Vorschläge für eine Sammlung. Nie ohne zweistufige Bestätigung; anonym nur, wenn der Betreiber das Schreiben mit dem Dienstkonto eingeschaltet hat. Kein Vorschlag, sondern ein direkter Schreibvorgang: Der vorgegebene B-API-Auftrag `node-metadata-write` überschreibt acht Felder mit vom Modell erzeugten Werten, als die Person — nach Vorschau und Bestätigung.) |
| **Nutzt Routing** | **geprüft** (nein. Kein LLM-Aufruf und kein Modell-Routing; der Dienst wird von KI-Clients aufgerufen, ruft selbst aber kein Modell. Indirekt: Der vorgegebene B-API-Auftrag erzeugt Metadaten mit einem Modell — in der B-API, auf deren Kosten.) |
| **Nutzt API Keys** | **geprüft** (einen B-API-Schlüssel nur optional: `WLO_TEXT_EXTRACTION_API_KEY`, wenn der Extraktionsdienst über den B-API-Proxy erreicht wird. Für die B-API-Aufträge keinen — dort setzt der Repository-Proxy seinen Schlüssel. Eigene, optionale Schlüssel: `TRUSTED_CLIENT_KEYS` für vertraute Clients mit eigenem Budget, `METRICS_TOKEN` für `/metrics`.) |
| **Repo über B-API** | **geprüft** (nein — direkt über `WLO_REPOSITORY_URL` gegen die edu-sharing-REST-Schnittstelle. Umgekehrt erreicht der Dienst die B-API für die Aufträge über das Repository (`/rest/bapi`). Persönliche Anmeldungen werden an genau diesen Host weitergereicht und an keinen anderen.) |
| **Benötigte Dienste** | **geprüft** (Pflicht: ein edu-sharing-Repository. Optional: der Text-Extraktionsdienst (`WLO_TEXT_EXTRACTION_URL`) für Volltexte verlinkter Seiten und `get_url_text`; Wikipedia für `get_wikipedia_summary`; der B-API-Proxy des Repositorys für die Auftrags-Werkzeuge (ohne ihn gibt es die vier nicht); für den Sitzungs-Tausch ein Pfad auf dem Host des Repositorys (eigener Ingress dort oder ein vertrautes Backend, das weiterreicht). Fällt ein optionaler Dienst aus, melden die betroffenen Werkzeuge das; der Rest arbeitet weiter.) |

## Deployment und Infrastruktur

| Punkt | Stand |
|---|---|
| **HELM** | **In Nacharbeit** — Entwurf unter [`deploy/helm/wlo-mcp/`](../deploy/helm/wlo-mcp/README.md) (Deployment, Service, Ingress, mit `sessionIngress` einen zweiten Ingress `wlo-mcp-session` auf dem Host des Repositorys, PVC, ConfigMap, NetworkPolicy, ServiceMonitor, PrometheusRule), von einem Test auf seine Kernregeln geprüft, aber **auf keinem Cluster installiert**. Chart-Version = Dienst-Version; die GitHub-Pipeline rendert ihn (`helm lint --strict`, `helm template`) und veröffentlicht ihn je Tag. |
| **Docker-Files** | **vorhanden** (`Dockerfile`, mehrstufig, Node 22 Alpine, läuft als Nicht-Root. Das schreibgeschützte Dateisystem setzen Compose-Datei und Chart, nicht das Image; `docker-compose.yml` für den Betrieb auf einem einzelnen Server hinter einem Reverse Proxy, Beispiele in DEPLOYMENT.md §4.) |
| **Abschaltbare Komponenten** | **geprüft** (ja, alles über Umgebungsvariablen: persönliche Anmeldung (aus ohne `WLO_AUTH_PRIVATE_KEY`), Schreiben mit dem Dienstkonto (`WLO_ALLOW_SERVICE_WRITES`), Stapel-Upload (`WLO_BATCH_UPLOAD_ENABLED`), Sitzungs-Tausch (`WLO_SESSION_EXCHANGE`, ohne Vorgabe aus; im Chart `sessionIngress`), Herkünfte für den Ticket-Tausch (`TICKET_ALLOWED_ORIGINS`), unsichere Werkzeuge (`WLO_DISABLE_UNSAFE_TOOLS`, im Chart `all`), Skill-Suche und Skill-Cache, die B-API-Aufträge (`WLO_BAPI_VIA_REPOSITORY`, leer = erkennen; `WLO_BAPI_FLOWS`), Metriken, interner Port. Übersicht: MCP-REFERENZ.md §3.) |
| **Datenbank** | **geprüft** (nein. Im Arbeitsspeicher liegt zudem die Zuordnung, welches Konto welchen B-API-Auftrag gestartet hat (30 Tage, nach einem Neustart weg). Einziger Zustand auf Platte ist das Zugangsregister: eine JSON-Datei mit Kennungen, ohne Zugangsdaten (`WLO_AUTH_REGISTRY_PATH`); an seiner Eintragung hängt auch, ob ein Ticket- oder Sitzungs-Block gilt. Sie braucht ein kleines, dauerhaftes Volume und gehört in die Sicherung — nur wenn die persönliche Anmeldung eingeschaltet ist.) |
| **Große Daten** | **geprüft** (nein. Hochgeladene Dateien liegen nur vorübergehend im Arbeitsspeicher — höchstens 128 MB insgesamt, 50 MB je Datei — und gehen ans Repository.) |

## Security und Konfiguration

| Punkt | Stand |
|---|---|
| **Authentifizierung** | **geprüft** (Lesen ist ohne Anmeldung möglich. Schreiben verlangt eine persönliche WLO-Anmeldung: OAuth 2.1 mit PKCE, ein verschlüsselter Zugangsblock als `Bearer`, ein Ticket-Tausch für eingebettete Widgets, ein Sitzungs-Tausch an `POST /auth/session` für Widgets in Seiten des Repositorys (optional, `WLO_SESSION_EXCHANGE`) oder `Basic`. Einzige Ausnahme, ohne Vorgabe aus: Mit `WLO_ALLOW_SERVICE_WRITES` schreibt das Dienstkonto für jeden Aufrufer — nur für geschlossene Umgebungen gedacht. Die Anmeldung wird gegen das Repository geprüft; der Dienst führt keine eigenen Konten. `/metrics` öffentlich nur mit Token. Einzelheiten: [AUTH.md](AUTH.md).) |
| **Network Policy** | **vorhanden** im Chart-Entwurf (`templates/networkpolicy.yaml`), ohne Vorgabe **aus**: sie braucht die Namespaces von Ingress-Controller und Monitoring (eingehend; mit `sessionIngress` dazu der Controller des Repository-Hosts, `controllerNamespace`), und der Chart rät keine Namen. Ausgehend braucht der Dienst HTTPS zum Repository (die B-API-Aufträge laufen über denselben Host), optional zum Extraktionsdienst (über den B-API-Proxy: zum Host der B-API) und zu Wikipedia, dazu DNS. |
| **ENV Variablen** | **geprüft** (Konfiguration ausschließlich über Umgebungsvariablen. Pflicht im Chart: `WLO_REPOSITORY_URL`. Üblich hinter einem Proxy: `TRUST_PROXY`, `WLO_PUBLIC_BASE_URL`, `MCP_SSE`, `INTERNAL_PORT`. Für Chatbot und eingebettete Widgets: `TRUSTED_CLIENT_KEYS`, `TICKET_ALLOWED_ORIGINS`, `WLO_SESSION_EXCHANGE`, `WLO_SESSION_ALLOWED_ORIGINS`, `WLO_SESSION_MOUNT_PATH`, `WIDGET_OAUTH_ORIGINS`. Vollständig mit Vorgaben: `.env.example` und MCP-REFERENZ.md §7; DEPLOYMENT.md §3 nennt die für den Betrieb wichtigen.) |
| **Benötigte Secrets** | **geprüft** (je nach Einschaltung, alle aus einem vorhandenen Secret: `WLO_AUTH_PRIVATE_KEY` (und `…_PREVIOUS` beim Schlüsselwechsel) für die persönliche Anmeldung; `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` für das Dienstkonto; `METRICS_TOKEN`; `TRUSTED_CLIENT_KEYS`; `WLO_TEXT_EXTRACTION_API_KEY`. Ohne jede dieser Angaben läuft der Dienst anonym und nur lesend.) |

## Monitoring und Betrieb

| Punkt | Stand |
|---|---|
| **Prometheus** | **vorhanden** (`GET /metrics` im Prometheus-Textformat: Anfragen, Werkzeugaufrufe und ihre Fehlercodes, Aufrufe am Repository, Wartezeit an der eigenen Schranke, eigene 429, Füllstände der begrenzten Speicher, Prozesswerte. Liste: STECKBRIEF.md §9.) |
| **Alarmregeln** | **vorhanden** als Vorschlag im Chart-Entwurf (`templates/prometheusrule.yaml`). Die Schwellen sind ohne Betriebserfahrung gewählt und nach den ersten Wochen festzulegen. |
| **B3-Tracing** | **vorhanden** (eingehende B3-Köpfe — `b3` oder `X-B3-*` — und `x-client-trace-id` werden gelesen, in jede Logzeile der Anfrage geschrieben und als Kind-Span an das Repository weitergegeben. Sendet der Aufrufer keinen B3-Trace, beginnt der Dienst einen eigenen (seit 1.2.0), sodass jede Logzeile einer Anfrage `trace_id` und `span_id` trägt. Spans werden nicht an einen Collector exportiert. Jede Anfrage trägt zusätzlich `X-Request-Id`.) |
| **Logging** | **vorhanden** (eine JSON-Zeile je Ereignis auf stdout, Felder `timestamp`, `level`, `service`, `message`, je Anfrage `req`, `trace_id`, `span_id`; Adresse, Kontoname und Suchbegriff nur pseudonymisiert, Klartext per `LOG_PERSONAL_DATA=plain`.) |
| **Proben** | **vorhanden** (`/health` für beide Proben des Pods — im Chart die Liveness-Probe auf dem internen, die Readiness-Probe auf dem öffentlichen Port; `/ready` prüft zusätzlich das Repository und ist für einen Circuit-Breaker gedacht, **nicht** als Kubernetes-Probe. Stoppsignal: bis 70 s Auslaufzeit, `terminationGracePeriodSeconds` muss darüber liegen.) |

## Ressourcen und Kosten

| Punkt | Stand |
|---|---|
| **CPU, RAM und Storage** | **vorhanden**, gemessen am 2026-11-13 mit 1.1.0 (`npm run measure:resources`; spätere Funktionen nicht neu gemessen — STECKBRIEF.md §6): Leerlauf 72 MB, Suchlast 172 MB, ungünstigster Fall mit Stapel-Upload rund 480 MB; 0,3 Kern unter Suchlast. Vorschlag: Anforderung 100m / 256Mi, Grenze 1 Kern / 768Mi (Compose: 512 MB, mit Stapel-Upload `MEM_LIMIT=768m`). Storage: ein Volume von wenigen Megabyte für das Zugangsregister. |
| **Kostenschätzung** | **nicht vorhanden** — der Dienst ruft kein Modell und keinen kostenpflichtigen Drittdienst auf; Kosten entstehen nur für die eine Instanz und das Volume. Was ein gestarteter B-API-Auftrag kostet — der Vorgabe-Flow nutzt ein Modell —, fällt in der B-API an, nicht hier. Eine bezifferte Schätzung gibt es nicht. |

## Abgleich mit dem Leitfaden „Dienste übergeben“

Gelesen gegen den Stand des Leitfadens vom November 2026 (dort als ungeprüft und in Arbeit
gekennzeichnet). **erfüllt** · **abweichend** (mit Begründung) · **offen**.

| Kapitel | Stand |
|---|---|
| 1. API und Eingaben | **erfüllt:** OpenAPI unter `GET /openapi.yaml`, Header und Content-Types benannt, Fehler als JSON, 4xx/5xx getrennt, kein dauerhafter Fehler als 503. **abweichend:** die Datei ist von Hand geschrieben und von einem Test auf ihre Pfade geprüft, nicht aus dem Code erzeugt; sie nennt auch `/health`, `/ready`, `/metrics` (mit dem internen Port liegen sie nicht auf dem öffentlichen); Fehlerantworten tragen `X-Request-Id` statt einer `trace_id` im Körper; einen maschinenlesbaren `code` tragen die Werkzeugantworten und ein Teil der HTTP-Fehler (etwa 429), die übrigen nur `error`. **abweichend:** „unabhängig vom Repository“ trifft nicht zu — der Dienst IST der Zugang zu einem edu-sharing-Repository; WLO-eigene Felder sind über Umgebungsvariablen einstellbar, nicht entfernt. **offen:** Antwortzeiten je Endpunkt stehen als Messwerte in PERFORMANCE.md, nicht je Pfad in der Spezifikation. |
| 2.1 LLM und Routing | **entfällt** — der Dienst ruft kein Modell. Indirekt nutzt der vorgegebene B-API-Auftrag eines, in der B-API. |
| 2.2 Dienst hinter der b-api | **abweichend** (Ausnahme „Betrieb ohne b-api“): eigene Anmeldung mit OAuth 2.1, Zugangsblock, Ticket- und Sitzungs-Tausch, weil MCP-Clients sich so anmelden und der Dienst die Anmeldung einer Person an das Repository weiterreicht. Die B-API ruft er für die Auftrags-Werkzeuge über den Repository-Proxy auf (STECKBRIEF.md §1). Zwei Ports sind vorhanden; Variablen und Schlüsselwechsel stehen in AUTH.md und DEPLOYMENT.md. Mit T6 abzustimmen. |
| 2.3 Logging und Tracing | **erfüllt:** JSON nach stdout mit `timestamp`, `level`, `service`, `trace_id`, `span_id`, `message`; B3 gelesen, weitergegeben, sonst angelegt; `x-client-trace-id` durchgereicht; keine Schlüssel im Log, Personen nur pseudonymisiert (Klartext nur mit `LOG_PERSONAL_DATA=plain`); `LOG_LEVEL`. **abweichend:** kein OpenTelemetry und kein Span-Export; eine Zeile je Anfrage nur für `POST /mcp`. |
| 3. Betrieb | **erfüllt:** zwei Ports, Metriken, Alarmregeln und NetworkPolicy im Chart, Ressourcen gemessen, keine Datenbank, keine großen Daten, Architekturübersicht. **abweichend:** nicht zustandslos — genau eine Instanz (STECKBRIEF.md §4). **offen:** Tests der Alarmregeln (`promtool`). |
| 4. Build und Helm | **erfüllt:** die GitHub-Pipeline baut und prüft Image und Chart, getaggte Versionen, Image und Chart in derselben Version, Image ohne Daten, Nicht-Root, mehrstufig, Dateisystem nur lesend, Compose als Referenz, Secrets nur als Name, Pod Security „restricted“ im Chart. **offen:** `kubeconform`; Repository in einer Gruppe, auf die T6 Zugriff hat; Spiegelung in die Registry der Plattform. |
| 5. Kestra | **abweichend** (als Aufrufer, nicht als Anbieter): Der Dienst stellt keinen Flow bereit, er startet Flows der B-API für eine angemeldete Person (`wlo_start_flow`, Stand, Abbruch, Liste), mit Vorschau und Bestätigung; startbar ist nur, was `WLO_BAPI_FLOWS` nennt (Vorgabe `edusharing.chatbot/node-metadata-write`). **offen** beim B-API-Team: Jobs an die Person binden; die Grenze von 20 unfertigen Jobs teilen sich alle Personen eines Repositorys (STECKBRIEF.md §14). |
| 6. Übergabe und Wartung | **erfüllt:** dieser Steckbrief, Kompatibilität in STECKBRIEF.md §13, Owner. **offen:** Vertretung, Jira, Zeile in der gemeinsamen Kompatibilitätsmatrix, Kosten je Funktion (kein eigenes Modell, daher nur Betriebskosten; die Modellkosten eines B-API-Auftrags fallen in der B-API an). |

## Offen

Aus STECKBRIEF.md §14, soweit für die Übergabe nötig:

- Vertretung für den technischen Owner (T4); Jira-Projekt.
- Ziel-Repository in GitLab und die Registry der Plattform (heute: GitHub und `ghcr.io/janschachtschabel`, privat).
- Abstimmung der zwei Abweichungen vom Service-Leitfaden (nicht hinter der B-API; eine Instanz).
- Plattform-Angaben für den Chart: Namespaces für die NetworkPolicy, Ingress-Controller und ob er die
  echte Client-Adresse sieht, Storage-Klasse, Sicherung des Volumes.
- Erste Installation des Charts auf einem Cluster und danach die Alarmschwellen.
- B-API: Jobs an die Person binden (beim B-API-Team gemeldet); bis dahin teilen sich alle Personen eines Repositorys die Grenze von 20 unfertigen Jobs (STECKBRIEF.md §14).
- Schlüssel (vorgeschlagen `boerdi:500:<Schlüssel>`) und erlaubte Ursprünge (`TICKET_ALLOWED_ORIGINS`, `WLO_SESSION_ALLOWED_ORIGINS`, `WIDGET_OAUTH_ORIGINS`) für das Chatbot-Team in der Zielumgebung.
- Form des Sitzungs-Tauschs: `sessionIngress` im Cluster des Repositorys oder ein vertrautes Backend, das weiterreicht (hängt daran, ob der Dienst dort läuft; offen beim Nutzer und T6).
- Termin für das Deployment in der Zielumgebung.
- Betrieb hinter der B-API: entworfen, nicht gebaut (Proxy-Eintrag und Kopfzeile offen).
