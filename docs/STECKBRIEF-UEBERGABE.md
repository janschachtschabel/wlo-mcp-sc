# Steckbrief zur Dienste-Übergabe: wlo-mcp

Stand der Angaben: 2026-11-15, gegen den Code geprüft. Die Kurzform nach der Übergabe-Vorlage; die
Begründungen und Messungen stehen im ausführlichen [STECKBRIEF.md](STECKBRIEF.md), der Betrieb in
[DEPLOYMENT.md](DEPLOYMENT.md).

Legende: **vorhanden** · **nicht vorhanden** · **geprüft** (Antwort in Klammern) · **In Klärung** ·
**In Nacharbeit**.

## Stammdaten

| Punkt | Stand |
|---|---|
| **Service** | `wlo-mcp` (WLO MCP Server). Derselbe Name für Paket, Image, Compose-Dienst, Chart und Log-Feld `service`. |
| **Funktionalität** | Macht die Inhalte von WirLernenOnline für KI-Assistenten über das Model Context Protocol nutzbar: 34 Lese-Werkzeuge (Suche, Sammlungen, Themenseiten, Details, Volltexte, Skills) und 26 Kuratier-Werkzeuge für angemeldete Personen (anlegen, bearbeiten, einsortieren, einreichen). Dazu eine kleine REST-Fläche und vier Widgets. |
| **Stabile Version** | **In Klärung** — `package.json` trägt `1.1.0`; die Versionsnummer für die Übergabe und ihr Tag stehen aus. |
| **Technischer Owner** | **vorhanden** — T4 (festgelegt 2026-11-15). Eine Vertretung ist nicht benannt. Repository-Eigentümer auf GitHub ist `janschachtschabel`. |
| **Jira** | **nicht vorhanden** |
| **Repository** | **vorhanden** ([github.com/janschachtschabel/wlo-mcp-sc](https://github.com/janschachtschabel/wlo-mcp-sc) — dorthin wird der aktuelle Stand veröffentlicht, dort läuft die Pipeline). Ein Umzug in die GitLab-Gruppe der Metadienste ist nicht erfolgt. |
| **OpenAPI Spec** | **vorhanden** als Datei ([`docs/openapi.yaml`](openapi.yaml), OpenAPI 3.1, von einem Test gegen den Code geprüft). **Kein Endpunkt** — der Dienst liefert die Spezifikation nicht selbst aus. Sie beschreibt die HTTP-Fläche außerhalb von MCP; die Werkzeuge beschreibt `tools/list`. |
| **Pipeline und Git-Tags** | **vorhanden** (`.gitlab-ci.yml` und `.github/workflows/ci.yml` im Repository: Lint, Tests, Abhängigkeits-Audit; der Image-Bau mit Smoke-Test läuft nur in der GitHub-Pipeline). Git-Tags werden **noch nicht** für Versionen benutzt; eine Veröffentlichung des Images in eine Registry ist nicht eingerichtet. |
| **Endpunkte** | **vorhanden** (öffentlich: `POST /mcp`; `GET /api/search`, `/api/collection`, `/api/compendium`, `/api/topic-page`, `/api/wikipedia`, `/api/skills`, `POST /api/uploads`; `/auth`, `/auth/*`, `/oauth/*`, `/.well-known/oauth-*`; `/launcher.html`. Infrastruktur: `/health`, `/ready`, `/metrics`.) |
| **Endpunkte auf zwei Ports** | **vorhanden** (öffentlich `PORT`, Vorgabe 3000; intern `INTERNAL_PORT`, im Chart 9090, nur `/health`, `/ready`, `/metrics`. Ohne `INTERNAL_PORT` gibt es nur den öffentlichen Port; die drei Pfade liegen dann dort, `/metrics` nur mit `METRICS_TOKEN`.) |
| **Header / Content-Types** | **geprüft** (Anfrage: `Authorization` optional — `Bearer <Zugangsblock>` oder `Basic`; `X-WLO-Client-Key` für vertraute Clients; `X-Request-Id`, `x-client-trace-id` und B3 werden übernommen. `/mcp`: `application/json`, Antwort als `text/event-stream` (mit `MCP_SSE`) oder JSON. `/api/*`: JSON, `/api/search?format=html` HTML. `/api/uploads`: `multipart/form-data`. Jede Antwort trägt `X-Content-Type-Options: nosniff` und `Referrer-Policy: no-referrer`; auf dem öffentlichen Port dazu `X-Request-Id`.) |
| **Asynchrone Job-Endpunkte** | **geprüft** (keine. Alles antwortet synchron. Stapel-Werkzeuge arbeiten als Plan über mehrere Aufrufe: jeder Aufruf leistet ein Stück und gibt ein `continuationToken` zurück; im Hintergrund läuft dafür nichts.) |
| **Readiness Status** | **In Nacharbeit** — Code, Tests, Chart-Entwurf und Dokumentation liegen vor; offen sind die Punkte unter „Offen“ am Ende. |

## Architektur

| Punkt | Stand |
|---|---|
| **Überblick** | Node.js-22-Anwendung in TypeScript, ein langlebiger Prozess ohne Web-Framework; zwei Laufzeit-Abhängigkeiten (`@modelcontextprotocol/sdk`, `zod`). Einstieg `src/http.ts` (Streamable HTTP) bzw. `src/stdio.ts` (lokal). Spricht die REST-Schnittstelle eines edu-sharing-Repositorys direkt an. Einzelheiten: [ARCHITECTURE.md](ARCHITECTURE.md). |
| **Horizontale Skalierbarkeit** | **geprüft** (nein — genau **eine** Instanz, im Chart `replicas: 1` mit `Recreate`. Bestätigungsschlüssel, Pläne, hochgeladene Dateien, Begrenzungen und Caches liegen im Arbeitsspeicher des Prozesses; das Zugangsregister ist eine Datei. Eine zweite Instanz würde Bestätigungen und Pläne nicht kennen. Begründung: STECKBRIEF.md §4.) |
| **Integriert in B-API** | **geprüft** (nein. Der Dienst steht nicht hinter der B-API und nutzt sie nicht; STECKBRIEF.md §1 und §2 begründen die Abweichung.) |
| **Schreibt Suggestions** | **geprüft** (ja — auf Anforderung einer angemeldeten Person: `wlo_suggest_metadata` legt Metadaten-Vorschläge an, `wlo_decide_suggestion` entscheidet sie, `wlo_update_contents` leitet redaktionelle Felder als Vorschlag weiter; dazu Vorschläge für eine Sammlung. Nie ohne zweistufige Bestätigung; anonym nur, wenn der Betreiber das Schreiben mit dem Dienstkonto eingeschaltet hat.) |
| **Nutzt Routing** | **geprüft** (nein. Kein LLM-Aufruf und kein Modell-Routing; der Dienst wird von KI-Clients aufgerufen, ruft selbst aber kein Modell.) |
| **Nutzt API Keys** | **geprüft** (keine der B-API. Eigene, optionale Schlüssel: `TRUSTED_CLIENT_KEYS` für vertraute Clients mit eigenem Budget, `METRICS_TOKEN` für `/metrics`, `WLO_TEXT_EXTRACTION_API_KEY` nur, wenn der Extraktionsdienst hinter einem Proxy mit Schlüssel liegt.) |
| **Repo über B-API** | **geprüft** (nein — direkt über `WLO_REPOSITORY_URL` gegen die edu-sharing-REST-Schnittstelle. Persönliche Anmeldungen werden an genau diesen Host weitergereicht und an keinen anderen.) |
| **Benötigte Dienste** | **geprüft** (Pflicht: ein edu-sharing-Repository. Optional: der Text-Extraktionsdienst (`WLO_TEXT_EXTRACTION_URL`) für Volltexte verlinkter Seiten und `get_url_text`; Wikipedia für `get_wikipedia_summary`. Fällt ein optionaler Dienst aus, melden die betroffenen Werkzeuge das; der Rest arbeitet weiter.) |

## Deployment und Infrastruktur

| Punkt | Stand |
|---|---|
| **HELM** | **In Nacharbeit** — Entwurf unter [`deploy/helm/wlo-mcp/`](../deploy/helm/wlo-mcp/README.md) (Deployment, Service, Ingress, PVC, ConfigMap, NetworkPolicy, ServiceMonitor, PrometheusRule), von einem Test auf seine Kernregeln geprüft, aber **auf keinem Cluster installiert**. `helm lint` läuft nicht in der Pipeline. |
| **Docker-Files** | **vorhanden** (`Dockerfile`, mehrstufig, Node 22 Alpine, läuft als Nicht-Root. Das schreibgeschützte Dateisystem setzen Compose-Datei und Chart, nicht das Image; `docker-compose.yml` für den Betrieb auf einem einzelnen Server hinter einem Reverse Proxy, Beispiele in DEPLOYMENT.md §4.) |
| **Abschaltbare Komponenten** | **geprüft** (ja, alles über Umgebungsvariablen: persönliche Anmeldung (aus ohne `WLO_AUTH_PRIVATE_KEY`), Schreiben mit dem Dienstkonto (`WLO_ALLOW_SERVICE_WRITES`), Stapel-Upload (`WLO_BATCH_UPLOAD_ENABLED`), unsichere Werkzeuge (`WLO_DISABLE_UNSAFE_TOOLS`, im Chart `all`), Skill-Suche und Skill-Cache, Metriken, interner Port. Übersicht: MCP-REFERENZ.md §3.) |
| **Datenbank** | **geprüft** (nein. Einziger Zustand auf Platte ist das Zugangsregister: eine JSON-Datei mit Kennungen, ohne Zugangsdaten (`WLO_AUTH_REGISTRY_PATH`). Sie braucht ein kleines, dauerhaftes Volume und gehört in die Sicherung — nur wenn die persönliche Anmeldung eingeschaltet ist.) |
| **Große Daten** | **geprüft** (nein. Hochgeladene Dateien liegen nur vorübergehend im Arbeitsspeicher — höchstens 128 MB insgesamt, 50 MB je Datei — und gehen ans Repository.) |

## Security und Konfiguration

| Punkt | Stand |
|---|---|
| **Authentifizierung** | **geprüft** (Lesen ist ohne Anmeldung möglich. Schreiben verlangt eine persönliche WLO-Anmeldung: OAuth 2.1 mit PKCE, ein verschlüsselter Zugangsblock als `Bearer`, ein Ticket-Tausch für eingebettete Widgets oder `Basic`. Einzige Ausnahme, ohne Vorgabe aus: Mit `WLO_ALLOW_SERVICE_WRITES` schreibt das Dienstkonto für jeden Aufrufer — nur für geschlossene Umgebungen gedacht. Die Anmeldung wird gegen das Repository geprüft; der Dienst führt keine eigenen Konten. `/metrics` öffentlich nur mit Token. Einzelheiten: [AUTH.md](AUTH.md).) |
| **Network Policy** | **vorhanden** im Chart-Entwurf (`templates/networkpolicy.yaml`), ohne Vorgabe **aus**: sie braucht die Namespaces von Ingress-Controller und Monitoring, und der Chart rät keine Namen. Ausgehend braucht der Dienst HTTPS zum Repository, optional zum Extraktionsdienst und zu Wikipedia, dazu DNS. |
| **ENV Variablen** | **geprüft** (Konfiguration ausschließlich über Umgebungsvariablen. Pflicht im Chart: `WLO_REPOSITORY_URL`. Üblich hinter einem Proxy: `TRUST_PROXY`, `WLO_PUBLIC_BASE_URL`, `MCP_SSE`, `INTERNAL_PORT`. Vollständig mit Vorgaben: `.env.example`, MCP-REFERENZ.md §7, DEPLOYMENT.md §3.) |
| **Benötigte Secrets** | **geprüft** (je nach Einschaltung, alle aus einem vorhandenen Secret: `WLO_AUTH_PRIVATE_KEY` (und `…_PREVIOUS` beim Schlüsselwechsel) für die persönliche Anmeldung; `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` für das Dienstkonto; `METRICS_TOKEN`; `TRUSTED_CLIENT_KEYS`; `WLO_TEXT_EXTRACTION_API_KEY`. Ohne jede dieser Angaben läuft der Dienst anonym und nur lesend.) |

## Monitoring und Betrieb

| Punkt | Stand |
|---|---|
| **Prometheus** | **vorhanden** (`GET /metrics` im Prometheus-Textformat: Anfragen, Werkzeugaufrufe und ihre Fehlercodes, Aufrufe am Repository, Wartezeit an der eigenen Schranke, eigene 429, Füllstände der begrenzten Speicher, Prozesswerte. Liste: STECKBRIEF.md §9.) |
| **Alarmregeln** | **vorhanden** als Vorschlag im Chart-Entwurf (`templates/prometheusrule.yaml`). Die Schwellen sind ohne Betriebserfahrung gewählt und nach den ersten Wochen festzulegen. |
| **B3-Tracing** | **vorhanden** (eingehende B3-Köpfe — `b3` oder `X-B3-*` — und `x-client-trace-id` werden gelesen, in jede Logzeile der Anfrage geschrieben und als Kind-Span an das Repository weitergegeben. Der Dienst erfindet keine Trace-Kennung und exportiert keine Spans an einen Collector. Jede Anfrage trägt zusätzlich `X-Request-Id`.) |
| **Logging** | **vorhanden** (eine JSON-Zeile je Ereignis auf stdout, Felder `timestamp`, `level`, `service`, `message`; Adresse, Kontoname und Suchbegriff nur pseudonymisiert, Klartext per `LOG_PERSONAL_DATA=plain`.) |
| **Proben** | **vorhanden** (`/health` für beide Proben des Pods — im Chart die Liveness-Probe auf dem internen, die Readiness-Probe auf dem öffentlichen Port; `/ready` prüft zusätzlich das Repository und ist für einen Circuit-Breaker gedacht, **nicht** als Kubernetes-Probe. Stoppsignal: bis 70 s Auslaufzeit, `terminationGracePeriodSeconds` muss darüber liegen.) |

## Ressourcen und Kosten

| Punkt | Stand |
|---|---|
| **CPU, RAM und Storage** | **vorhanden**, gemessen am 2026-11-13 (`npm run measure:resources`): Leerlauf 72 MB, Suchlast 172 MB, ungünstigster Fall mit Stapel-Upload rund 480 MB; 0,3 Kern unter Suchlast. Vorschlag: Anforderung 100m / 256Mi, Grenze 1 Kern / 768Mi (Compose: 512 MB, mit Stapel-Upload `MEM_LIMIT=768m`). Storage: ein Volume von wenigen Megabyte für das Zugangsregister. |
| **Kostenschätzung** | **nicht vorhanden** — der Dienst ruft kein Modell und keinen kostenpflichtigen Drittdienst auf; Kosten entstehen nur für die eine Instanz und das Volume. Eine bezifferte Schätzung gibt es nicht. |

## Offen

Aus STECKBRIEF.md §14, soweit für die Übergabe nötig:

- Versionsnummer und Tag für die Übergabe.
- Vertretung für den technischen Owner (T4); Jira-Projekt.
- Ziel-Repository in GitLab und Image-Registry (wer baut, welche Marke, öffentlich oder intern).
- Abstimmung der zwei Abweichungen vom Service-Leitfaden (nicht hinter der B-API; eine Instanz).
- Plattform-Angaben für den Chart: Namespaces für die NetworkPolicy, Ingress-Controller und ob er die
  echte Client-Adresse sieht, Storage-Klasse, Sicherung des Volumes.
- Erste Installation des Charts auf einem Cluster und danach die Alarmschwellen.
- Schlüssel und erlaubte Ursprünge für das Chatbot-Team in der Zielumgebung.
