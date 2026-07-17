# WLO MCP Server

> 🇩🇪 Deutsch · 🇬🇧 [English version](README.md)

Ein [Model-Context-Protocol](https://modelcontextprotocol.io)-(MCP-)Server, der
KI-Agenten das **Suchen und Abrufen offener Bildungsressourcen (OER)** aus
[WirLernenOnline (WLO)](https://wirlernenonline.de) über die öffentliche
edu-sharing-REST-API ermöglicht.

Er stellt **22 Tools** für Volltextsuche, Sammlungs-/Themenseiten-Navigation,
Metadaten-Abfrage und Vokabular-Auflösung bereit — allesamt gegen die anonyme,
nur lesende öffentliche API. Keine Authentifizierung, keine Schreibzugriffe.

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
- [Ausgabeformate](#ausgabeformate)
- [Filter & Vokabular](#filter--vokabular)
- [Deployment](#deployment)
- [Sicherheit & Betrieb](#sicherheit--betrieb)
- [Architektur](#architektur)
- [Entwicklung](#entwicklung)
- [Weitere Dokumente](#weitere-dokumente)

---

## Konzept

In WLO sind eine **Sammlung** (collection) und eine **Themenseite** (topic page)
dasselbe: eine kuratierte thematische Seite, die Bildungsinhalte in
**Swimlanes** (Schwimmlinien / Karussells) bündelt, gruppiert nach Thema, Fach
oder Bildungsstufe. Untersammlungen sind Unter-Themenseiten. Eine Sammlung mit
einer `ccm:page_config_ref`-Eigenschaft besitzt eine kuratierte **Themenseite**
mit zielgruppenspezifischen Varianten (Lehrende / Lernende / allgemein).

Alles, was der Server zurückgibt, sind öffentliche OER-Metadaten; der Server ist
ein schlanker, zustandsloser Proxy vor edu-sharing.

## Funktionen

- **22 MCP-Tools** — Inhaltssuche, Sammlungssuche, kombinierte Suche,
  Themenseiten und deren Swimlane-Inhalte, Fachportale, Baum-Navigation,
  Node-Details (einzeln & im Bulk), Vokabular-Abfrage, Anbieter-Abfrage,
  Health-Check, Wikipedia-Zusammenfassung, voller Kompendiumstext, Suche
  innerhalb einer Sammlung, verwandte Inhalte, Sammlungsstatistik,
  Node-Breadcrumb, **WLO-Skill-Suche** sowie die
  ChatGPT-`search`/`fetch`-Knowledge-Tools.
- **OpenAI-Apps-SDK-Unterstützung** — Anzeige-Tools liefern `structuredContent`
  (Tool-`outputSchema`) mit read-only-`annotations`, der Server annonciert
  werkzeugübergreifende `instructions`, und vier Tools bringen ein inline-
  gebündeltes `ui://`-Widget mit (Kombi-Suchergebnisse, Themenseiten-Swimlanes
  und ein interaktiver Sammlungs-Browser) — theme-fähig, WCAG 2.2 AA, DE/EN.
  Nicht-Apps-Clients bleiben unberührt.
- **Qualitäts-Reranking** — Multi-Query-Expansion (Synonyme, Keyword, Titel,
  Stoppwort-Varianten), fusioniert mit Reciprocal Rank Fusion (RRF) und einem
  Metadaten-Qualitätsscore. Deterministische Sortierung.
- **Drei Transporte** — stdio, eigenständiges Streamable HTTP und eine
  Vercel-Serverless-Funktion — alle aus einer transport-agnostischen
  Server-Factory.
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

## Konfiguration

Die gesamte Konfiguration erfolgt über Umgebungsvariablen. Kopieren Sie
`.env.example` nach `.env` und passen Sie sie nach Bedarf an. Üblicherweise wird
nur `WLO_REPOSITORY_URL` geändert; alles andere hat sinnvolle Standardwerte.

| Variable | Standard | Geltungsbereich | Beschreibung |
|---|---|---|---|
| `WLO_REPOSITORY_URL` | `https://redaktion.openeduhub.net/edu-sharing` | alle | edu-sharing-Instanz, mit der der Server kommuniziert. Die Pfade sind über alle Instanzen hinweg identisch, daher ist diese Basis-URL der einzige Umschalter zwischen Prod / Staging / einem eigenen Repository. Die Eingabe ist fehlertolerant: Leerzeichen, abschließende Slashes und ein abschließendes `/rest` werden entfernt; ein fehlendes Protokoll wird zu `https://`; ein reiner Host bekommt `/edu-sharing` angehängt. Verdächtige Werte (tiefe `/components/...`-Links, doppeltes `/edu-sharing`) erzeugen beim Start eine Warnung. |
| `WLO_ROOT_COLLECTION_ID` | `5e40e372-735c-4b17-bbf7-e827a5702b57` | alle | Wurzelknoten der Sammlungshierarchie. Auf WLO-Prod und -Staging identisch. Nur für ein eigenes Repository mit abweichender Wurzel überschreiben. |
| `WLO_SKILLS_COLLECTION_ID` | _(nicht gesetzt)_ | alle | nodeId der WLO-Sammlung mit den Launcher-**Skills** (hochgeladene Markdown-Dateien). Wenn gesetzt, nutzt `GET /api/collection` ohne `nodeId` diese als Default. Nicht gesetzt → Aufrufer geben `?nodeId=` explizit an. |
| `WLO_POOL_SIZE` | `25` | alle | Größe des Kandidaten-Pools **pro Suchvariante** für das Reranking (`enhancedSearch`) — **nicht** die Anzahl der zurückgegebenen Treffer (das ist `maxResults`). Kleiner = schneller/kleinere Abrufe bei minimal geringerer Recall-Quote. |
| `WLO_FETCH_TIMEOUT_MS` | `10000` | alle | Timeout pro Anfrage (ms) für jeden Upstream-edu-sharing-Aufruf. Verhindert, dass ein hängender Backend-Socket einen Tool-Aufruf blockiert. |
| `PORT` | `3000` | HTTP-Modus | Port für den eigenständigen HTTP-Server. |
| `MCP_SSE` | `false` | HTTP-Modus | Bei wahrem Wert (`1`/`true`/`yes`) wird `POST /mcp` als echter Server-Sent-Events-Stream ausgeliefert (vom ChatGPT-Entwicklermodus benötigt). Standard sind Einzel-JSON-Antworten (maximale Client-Kompatibilität). Hinter einem Reverse-Proxy **muss** das Buffering für die `/mcp`-Location deaktiviert sein — siehe [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Das Docker-Image setzt dies standardmäßig auf `1`. |
| `WLO_WIDGET_MIME` | `text/html;profile=mcp-app` | alle | MIME-Type der inline-Apps-SDK-Widget-Ressourcen. Standard ist der MCP-Apps-Standard (portabel). Auf `text/html+skybridge` setzen, falls eine Legacy-ChatGPT-Runtime die Widgets mit dem Standardwert nicht rendert. |
| `WLO_WIDGET_DOMAIN` | nicht gesetzt | alle | App-Identitäts-Domain für die ChatGPT-Plugin-Submission (dort Pflicht + pro App eindeutig; Widgets rendern unter `<domain>.web-sandbox.oaiusercontent.com`). Wenn gesetzt, wird sie als Standard-`_meta.ui.domain` **und** als `openai/widgetDomain`-Alias ausgewiesen; wenn nicht gesetzt, nur der Alias (edu-sharing-Origin) — Claudes MCP-Apps-Host validiert `ui.domain` gegen sein eigenes Sandbox-Format und lehnt Widgets mit fremden Werten ab. Für Claude nicht setzen; nur für eine ChatGPT-Submission. Die Widget-CSP bleibt unabhängig davon auf der edu-sharing-Origin. |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | HTTP-Modus | Maximale Request-Body-Größe; größere POSTs erhalten `413`. Begrenzt einen Speichererschöpfungs-Vektor. |
| `RATE_LIMIT_RPM` | `120` | HTTP-Modus | Anfragen/Minute **pro Client-IP** am MCP-Endpunkt; über dem Limit wird `429` zurückgegeben. `/health` ist ausgenommen. `0` zum Deaktivieren (z. B. hinter einem WAF-/Plattform-Limiter). |
| `API_RATE_LIMIT_RPM` | `30` | HTTP-Modus | Anfragen/Minute **pro Client-IP** an den öffentlichen REST-Endpunkten (`GET /api/*`); über dem Limit `429`. Strenger als `RATE_LIMIT_RPM`, da es eine anonyme öffentliche Oberfläche ist. `0` zum Deaktivieren. |
| `TRUST_PROXY` | `false` | HTTP-Modus | Bei wahrem Wert (`1`/`true`/`yes`) wird die Client-IP aus dem letzten (Proxy-angehängten) `X-Forwarded-For`-Hop statt aus der Socket-Adresse genommen — nötig für korrektes Rate-Limiting pro Client **hinter einem Reverse-Proxy**. Standardmäßig aus, da `X-Forwarded-For` auf einem direkt exponierten Server fälschbar ist. |

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
```

## REST-API (öffentlich, nur lesend)

Im HTTP-Modus stellt der Server zusätzlich eine kleine **öffentliche REST-Schicht**
bereit — dünne `GET`-Wrapper über dieselben Services wie die MCP-Tools, für
Nicht-MCP-KI-Werkzeuge und den Prompt-Launcher. Nur lesend, `CORS *` für `GET`,
pro IP rate-limitiert (`API_RATE_LIMIT_RPM`, Standard 30/min), Eingaben
serverseitig validiert (Query ≤ 200 Zeichen, nodeId ≤ 50, ≤ 25 IDs). Antworten
sind JSON; Fehler sind `{ "error": "…" }` mit `4xx`/`5xx`-Status.

| Endpunkt | Query-Parameter | Liefert |
|---|---|---|
| `GET /api/search` | `q` (Pflicht), `educationalContext`, `discipline`, `learningResourceType`, `userRole`, `publisher`, `maxContent`, `maxCollections`, `skipCount`, `include` (`content,collections,topicPages`), `includeCompendium`, `includeTextContent`, `includeWikipedia`, `includeTopicPageContent`, `maxPerSwimlane`, `includeFacets`, `fields` | Das kombinierte `search_wlo_all`-Envelope (`content` / `collections` / `topicPages`, optional `wikipedia`). Ergänzt `unresolvedFilters` (nicht auflösbare Vokabel-Filter + „Meintest du?"-Vorschläge), und — mit `includeFacets=1` — `facets` (`{label, count, uri}` je Bucket; die `discipline`-Facette löst Hochschulfächer auf, siehe unten). Optionales `fields=title,url,…` kürzt jeden Treffer auf diese Schlüssel (`nodeId` bleibt immer) — Token-Ersparnis für LLM-Clients, die das rohe JSON lesen. |
| `GET /api/collection` | `nodeId` (Default `WLO_SKILLS_COLLECTION_ID`), `q` (optional, Suche innerhalb), `max`, `fields`, Vokabular-Filter | Die Inhalte einer Sammlung: `{ collectionId, query, total, results: [{ nodeId, title, description, learningResourceTypes, publisher, url, downloadUrl }] }`. Ohne `q` werden die direkten Datei-Kinder gelistet (zuverlässig auch für Referenz-Sammlungen); mit `q` wird darin gesucht. Optionales `fields=…` kürzt jeden Treffer (`nodeId` bleibt immer). Die **Skills**-Quelle des Launchers — je Treffer liefert `downloadUrl` das rohe Markdown. |
| `GET /api/compendium` | `ids` (kommagetrennt) oder `nodeId`, ≤ 25 | `{ entries: [{ nodeId, title, compendiumText }] }` — der VOLLE redaktionelle Kompendiumstext. |
| `GET /api/topic-page` | `collectionId` oder `variantId` (≥ 1 Pflicht), `targetGroup` (`teacher`/`learner`/`general`), `maxPerSwimlane` | Das render-fertige Swimlane-Payload (`variantTitle`, `topicPageUrl`, `swimlanes[]`). |
| `GET /api/wikipedia` | `q` (Pflicht), `lang` (Standard `de`), `sections` (1–3) | Eine Wikipedia-Einleitungszusammenfassung `{ title, extract, thumbnail?, url, lang }`, oder `404`, wenn kein Artikel passt. |
| `GET /api/skills` | — | Der Skill-Katalog `{ skills: [{ id, name, description, path }] }` für KI-Apps (siehe [Prompt-Launcher](#prompt-launcher)). |
| `GET /api/skills/<id>` | — | Der **rohe Markdown-Text** eines Skills (`text/markdown`), oder `404` bei unbekannter id. `<id>` ist heute ein stabiler Slug (später vsl. eine WLO-nodeId). |

```bash
curl "http://localhost:3000/api/search?q=Photosynthese&includeWikipedia=1"
```

Die REST-Schicht wird nur von `http.ts` bedient — **nicht** vom Vercel-Handler
(`api/mcp.ts`).

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
Zwischenablage. Nativ eingetragene MCP-Clients erhalten dieselben Skills über das
Tool `find_wlo_skills`. Ein [Bookmarklet](public/bookmarklet.md) öffnet den Launcher
vorausgefüllt mit dem markierten Text (`/launcher.html?q=<Auswahl>`).

## Tools

| # | Tool | Zweck | Ausgabe |
|---|---|---|---|
| 1 | `search_wlo_collections` | Sammlungen/Themenseiten suchen (Keyword + Baum-Fallback) | markdown / json |
| 2 | `search_wlo_content` | Volltextsuche für einzelne Inhaltselemente | markdown / json |
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
| 13 | `get_wikipedia_summary` | Kurze Wikipedia-Zusammenfassung (+ Link) zu einem Begriff — enzyklopädischer Kontext | markdown / json |
| 14 | `get_compendium_text` | VOLLER redaktioneller Kompendiumstext einer/mehrerer Sammlungen (Bulk, ≤25) | markdown / json |
| 15 | `search_wlo_within_collection` | Gefilterte Volltextsuche, auf einen Sammlungs-Teilbaum begrenzt | markdown / json |
| 16 | `search` | ChatGPT-Knowledge-Konvention: leichte Treffer `{id,title,url}` über WLO | json (+ Text) |
| 17 | `fetch` | ChatGPT-Knowledge-Konvention: volles Dokument eines Knotens `{id,title,text,url,metadata}` | json (+ Text) |
| 18 | `lookup_wlo_publishers` | Anbieter/Quellen mit Materialzahl je Anbieter auflisten (Facette) | markdown / json |
| 19 | `get_related_content` | „Mehr davon": Inhalte mit gleichem Fach/gleicher Stufe wie ein Seed-Node (+ optional Geschwister) | markdown / json |
| 20 | `get_node_breadcrumb` | Ahnenpfad einer Sammlung (Wurzel → Node) im Inhaltsbaum | markdown / json |
| 21 | `get_collection_stats` | Zusammensetzung einer Sammlung: Datei-/Untersammlungs-Zahlen + Typ/Fach/Stufe-Aufschlüsselung | markdown / json |
| 22 | `find_wlo_skills` | WLO-„Skills" (wiederverwendbare Instruktions-Markdown in einer WLO-Sammlung) zu einer Aufgabe finden und ihre Instruktionen zum Anwenden liefern | markdown / json |

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
`discipline?`, `userRole?`, `maxResults?` (1–50, Standard 5), `excludeNodeIds?`
(≤200), `outputFormat?`. Versucht zuerst eine Keyword-Sammlungssuche, dann eine
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

**5. `search_wlo_all`** — `query` (erforderlich), die fünf Filter, `maxContent?`
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
| `general`), `educationalContext?`, `collectionId?`, `mergeVariants?` (Standard
true), `sort?` (`relevance` | `alpha`), `maxResults?` (1–20, Standard 5),
`includeContent?` (Standard false; JSON-Modus — hängt je Seite die aufgelösten
Swimlane-Inhalte `content` an, ≤5 parallel) + `maxPerSwimlane?` (1–10, Standard
3), `outputFormat?`. Drei Modi: per `collectionId` (direkt), per `query` (Suche →
auf Themenseite prüfen) oder nur mit Filtern (alle auflisten).

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
`outputFormat?`. Liefert einen Wikipedia-Einleitungsauszug mit Link (und optional
Thumbnail); löst einen unscharfen/falsch geschriebenen Begriff via opensearch auf,
wenn der direkte Titel nicht trifft. Für enzyklopädischen Kontext neben
WLO-Material — nicht für die OER-Materialsuche. `readOnlyHint` + `openWorldHint`.

**14. `get_compendium_text`** — `nodeId?` **oder** `nodeIds?` (Array, ≤25),
`outputFormat?`. Gibt den VOLLEN, ungekürzten redaktionellen Kompendiumstext der
angegebenen Sammlung(en) zurück — die maßgebliche Prosa-Übersicht — für den Fall,
dass ein Sammlungstreffer nur die 500-Zeichen-Vorschau zeigt. `compendiumText`
ist `null` für Knoten ohne die Eigenschaft.

**15. `search_wlo_within_collection`** — `nodeId` (erforderlich, die Sammlung),
`query?`, die fünf Vokabular-Filter, `maxResults?` (1–50, Standard 10),
`skipCount?`, `outputFormat?`. Eine Volltextsuche, begrenzt auf einen
Sammlungs-Teilbaum (via `virtual:primaryparent_nodeid`) — „welche Videos zu X
sind in dieser Sammlung?". Für eine unbegrenzte Suche `search_wlo_content`, zum
ungefilterten Auflisten `get_collection_contents` nutzen.

**18. `lookup_wlo_publishers`** — `query?`, `discipline?`, `educationalContext?`,
`maxResults?` (1–100, Standard 20), `outputFormat?`. Listet die Anbieter/Quellen
(`ccm:oeh_publisher_combined`) mit Materialzahl je Anbieter, per Facetten-Aggregation
über den Live-Index (größte zuerst). Optional auf Thema/Fach/Stufe begrenzt. Nützlich,
um gültige Werte für den `publisher`-Filter zu finden.

**19. `get_related_content`** — `nodeId` (erforderlich, der Seed), `maxResults?`
(1–30, Standard 8), `includeSiblings?` (Standard `false`), `outputFormat?`. Liest
Fächer + Bildungsstufen des Seed-Nodes und findet anderes Material mit gleichem
Profil (der Seed wird ausgeschlossen); `includeSiblings` liefert zusätzlich die
übrigen Inhalte der primären Eltern-Sammlung. „Was passt noch dazu?"

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

**22. `find_wlo_skills`** — `query?`, `maxResults?` (1–20, Standard 5),
`includeContent?` (Standard true), `nodeId?`, `outputFormat?`. Findet WLO-**Skills**
— wiederverwendbare Instruktions-Dokumente (Markdown), die als hochgeladene
Dateien in einer WLO-Sammlung kuratiert sind — passend zu einer Aufgabe und gibt
ihre rohen Instruktionen zum Anwenden zurück. `nodeId` defaultet auf
`WLO_SKILLS_COLLECTION_ID`; ohne `query` werden alle verfügbaren Skills gelistet.
Titel/Beschreibung sagen, was der Skill tut und wann. Teilt die Listing-/Abruf-Logik
mit `GET /api/collection`, sodass native MCP-Clients dieselbe Skill-Funktion wie
der Launcher/REST-Pfad erhalten.

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
viele Labels („Mathematik", „Physik", …), daher bleibt das Hochschul-Vokabular
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

### Vercel (serverless)

`api/mcp.ts` ist ein Streamable-HTTP-Handler; `vercel.json` leitet `/mcp` und `/`
darauf um. Setzen Sie `WLO_REPOSITORY_URL` als Projekt-Umgebungsvariable. Rate-/
Body-Limits werden hier nicht angewendet — die Plattform stellt sie bereit.

### Docker

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

## Sicherheit & Betrieb

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
- **Härtungs-Asymmetrie:** Body-/Rate-Limits gelten im eigenständigen HTTP-Server,
  **nicht** im Vercel-Handler (`api/mcp.ts`), der sich auf die Plattform verlässt.
- **`npm audit`:** Der Produktions-Abhängigkeitsbaum ist frei von High-/
  Critical-Advisories (`npm audit --omit=dev --audit-level=high`, als CI-Gate
  verdrahtet). Der Gesamtbaum trägt nur noch eine einzige **niedrige, reine
  Dev**-Advisory (`esbuild`, via `tsx` — ein Windows-Dev-Server-Dateilesefehler),
  die weder ausgeliefert noch in CI/Produktion ausgeführt wird: eine Produktions-
  Installation (`npm ci --omit=dev`, wie im Dockerfile) enthält keine davon. Der
  frühere `@vercel/node`-Dev-Baum (undici u. a.) wurde entfernt — `api/mcp.ts`
  nutzt jetzt lokale `node:http`-Request/Response-Typen. Der Server nutzt Nodes
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
│   ├── server.ts             # factory: registers all 22 tools (transport-agnostic)
│   ├── tools/                # tool definitions, grouped by responsibility
│   │   ├── shared.ts         #   _queryMeta, filter builder, mapPool, toolError, title fallbacks
│   │   ├── collections.ts    #   search_wlo_collections, get_collection_contents, search_wlo_within_collection
│   │   ├── content-search.ts #   search_wlo_content, search_wlo_all
│   │   ├── node-details.ts   #   get_node_details, get_nodes_details
│   │   ├── node-relations.ts #   get_related_content, get_node_breadcrumb
│   │   ├── collection-stats.ts #  get_collection_stats
│   │   ├── skills.ts         #   find_wlo_skills
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
│   ├── topic-page-api.ts     # topic-page API (page_variant, swimlane parsing, variant→collection)
│   ├── wikipedia-api.ts      # Wikipedia REST summary client (opensearch title fallback)
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
├── api/mcp.ts                # Vercel serverless wrapper
├── docs/                     # DEPLOYMENT.md, PRIVACY.md, apps-sdk-submission-checklist.md, apps-sdk-golden-prompts.md, plans/
├── Dockerfile · docker-compose.yml · .dockerignore · vercel.json · .env.example
```

**Datenfluss:** Transport-Einstieg (`stdio.ts` / `http.ts` / `api/mcp.ts`) →
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

**`topic-page-api.ts` — Themenseiten**

| Funktion | Was sie tut |
|---|---|
| `searchPageVariants` | `page_variant`-Knoten suchen |
| `resolveVariantCollection` | Eine Variante zur besitzenden Sammlung auflösen |
| `getCollectionThemePages` | Themenseiten-Varianten einer Sammlung |
| `getTopicPageContent` | Swimlane-Struktur einer Themenseite parsen |

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
| `log` | `logger.ts` | Strukturierter JSON-Logger (stderr) |
| `buildFilterCriteria` | `tools/shared.ts` | Deutsche Labels/Filter → Such-Kriterien |
| `queryMetaContent` | `tools/shared.ts` | Den `_queryMeta`-Block bauen |
| `toolError` | `tools/shared.ts` | Loggen + einheitliches Tool-Fehlerergebnis bauen |
| `mapPool` | `tools/shared.ts` | Async-Map mit begrenzter Nebenläufigkeit (fehlertolerant) |
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
