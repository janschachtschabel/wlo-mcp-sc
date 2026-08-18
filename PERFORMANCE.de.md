# WLO-MCP — Performance & Optimierungen

> 🇩🇪 Deutsch · 🇬🇧 [English version](PERFORMANCE.md)

Stand: 2026-06-01. Dieses Dokument hält die latenzrelevanten Designentscheidungen
des MCP-Servers fest — was umgesetzt ist, welche Werte aktiv sind und wo noch
Potenzial liegt.

## Kontext
Ein Such-Turn im Chatbot dauerte gemessen **9–18 s** (Faktenfrage ohne Suche ~4 s).
Hauptkosten: die edu-sharing-Suchen (mehrere edu-sharing-REST-Calls je Tool) und
mehrere sequenzielle LLM-Calls im Backend. Die folgenden MCP-Änderungen senken
Anzahl + Größe der edu-sharing-Calls.

> **Betriebsart:** Betrieben wird der **selbst gehostete, persistente**
> HTTP-Modus (Docker auf dem vServer). Ein Serverless-Ziel gibt es nicht; was
> unten zu Cold-Starts steht, beschreibt eine Einschränkung, die dieser Server
> nicht hat.

## Umgesetzte Optimierungen (2026-06-01)

### O1 — Kombiniertes Tool `search_wlo_all`
Liefert **Einzel-Inhalte + Sammlungen + Themenseiten in EINEM Aufruf**, intern
`Promise.all`-parallel. Spart dem Backend die separaten Aufrufe von
`search_wlo_content` + `search_wlo_collections` (= weniger MCP-Round-Trips /
Cold-Starts). Rückgabe ist ein strukturiertes Envelope:
```json
{ "query": "...",
  "content":     { "total": N, "count": M, "results": [...] },
  "collections": { "total": N, "count": M, "results": [...] },
  "topicPages":  { "total": N, "count": M, "results": [...] } }
```
Themenseiten = Sammlungen mit `ccm:page_config_ref` → eine Sammlungssuche bedient
beide Töpfe (kein separater Durchlauf). Nutzt bewusst den schnellen Keyword-Pfad
(nicht den Baumlauf) → niedrige Concurrency.
*Status: im MCP implementiert UND im Backend verdrahtet (2026-06-01).* Der
Chatbot ruft `search_wlo_all` im spekulativen Prefetch für generische Inhalts-/
Sammlungs-Such-Turns (1 MCP-Call statt 3 separater) und splittet das Envelope in
drei Per-Tool-Payloads, die der bestehende `parse_wlo_cards`/Box-Pfad unverändert
verarbeitet. Explizite Themenseiten-Anfragen (Nutzer tippt „Themenseite“/
„Fachportal“ oder LLM-Tool-Hint = `search_wlo_topic_pages`) nutzen weiter das
dedizierte, session-stateful `search_wlo_topic_pages`. Live verifiziert: gleiche
Query „Photosynthese“ 12,2 s (3 Calls) → 9,1 s (1 Call); Karten-Töpfe korrekt
getrennt (content/collections/topicPages).

### O2 — Kuratierter `propertyFilter`
edu-sharing akzeptiert Feldauswahl NUR als **wiederholten** `propertyFilter=`-Param
(Kommaliste → 0 Properties). Statt `-all-` (~59 Properties/Node) werden nur die
real genutzten ~24 Felder angefordert (`DISPLAY_PROPS` / für Themenseiten
`TOPIC_PAGE_PROPS` in `topic-page-api.ts`). Die `_DISPLAYNAME`-Label-Felder müssen
explizit mitgelistet werden — kommen dann korrekt zurück (verifiziert).
Behaltene „Extras“: `ccm:oeh_lrt(_DISPLAYNAME)`, `ccm:replicationsource(_DISPLAYNAME)`
(= Bezugsquelle, z.B. Klexikon), `ccm:author_freetext`.
Top-Level-Felder (`preview`, `content.url`, `mimetype`, `size`, `downloadUrl`)
sind NICHT von propertyFilter betroffen.
`get_node_details` bleibt bewusst auf `-all-` (Einzelknoten, Detail-Tool).

### O4 — `enhancedSearch` gezähmt
Query-Expansion erzeugte 6–9 parallele `ngsearch`-Calls. Jetzt: Einzelterm-
Varianten entfernt + Hard-Cap `MAX_VARIANTS = 5` (nach Gewicht sortiert,
`full:` bleibt immer dabei).

### O5 — Themenseiten-Loops parallelisiert
`getCollectionThemePages` holt die page_config-Kinder jetzt `Promise.all`-parallel
statt sequenziell (`for … await`). `getTopicPageContent` braucht den per-Kind-
Fan-out gar nicht mehr (siehe Stage-3-Befund unten: die Variante IST das
page_config-Kind) → noch weniger Calls.

### O6 — Collections-Baumlauf gedeckelt
Fallback-Traversal begrenzt: level2 ≤ 25 Parents, level3 ≤ 15 (mit Warn-Log).
Verhindert die frühere 100+-Parallel-Call-Lawine. Direkte level1-Treffer bleiben
vollständig.

### O8 — Reranking vereinheitlicht (Sammlungen + Themenseiten)
Bisher wurden NUR Einzel-Inhalte gerankt (`enhancedSearch`); Sammlungen kamen in
roher edu-sharing-API-Reihenfolge → off-topic Treffer oben (z.B. „Musik der
Klassik“ bei „Französische Revolution“). Jetzt wird `rerankNodes(query)`
einheitlich angewandt:
- `search_wlo_collections` (im `renderOut`, vor dem Slice),
- `search_wlo_all` (Sammlungen → daraus erben die Themenseiten die Reihenfolge),
- `search_wlo_topic_pages` Mode B (Eingangs-Sammlungen + Default-Sortierung bei
  Query = „relevance“ statt „alpha“).

`rerankNodes` **sortiert nur um + entfernt gelöschte Knoten** (kein `minScore`-
Drop) → kann nichts Relevantes verlieren. Verlust-Check über 6 Queries:
**0 relevante Treffer aus Top-3 verloren**, durchweg
Gewinn (Exakt-Treffer von #3 → #1; z.B. „Klimawandel“/„Mittelalter“ rückten von
3 off-topic-Sammlungen auf 3 exakte). Browse ohne Query bleibt unverändert.

## Aktuell aktive Einstellungen
| Knopf | Wert | Bedeutung |
|---|---|---|
| `POOL_SIZE` (`WLO_POOL_SIZE`) | **25** (von 40) | Kandidaten-Pool **je Variante** fürs Ranking — NICHT die ausgelieferte Trefferzahl |
| `MAX_VARIANTS` | 5 | max. parallele Such-Varianten |
| `search_wlo_content` maxResults | Default 8 | ausgelieferte Inhalte (Backend setzt real 10 spekulativ / 4 im Loop) |
| `search_wlo_collections` maxResults | Default 5 | |
| `search_wlo_all` maxContent / maxCollections | 8 / 5 | |
| Collections-Baumlauf | level1 ≤100 · level2 ≤25 · level3 ≤15 | |
| `minScore` | max(5, Terme×3) | Quality-Floor im Reranking |
| Properties/Node | ~24 (statt ~59) | O2 |
| `WLO_COMPENDIUM_SECTION_MAX` | **2000** | Zeichen je Hauptabschnitt eines Kompendiumstextes, der ohne `query` ausgeliefert wird — O11 |

## Was nach dem Ranking ausgeliefert wird
`enhancedSearch`: ≤5 Varianten × `POOL_SIZE` Kandidaten → RRF-Merge +
Quality-Score (`computeRelevanceScore`) → `minScore`-Filter (Graceful-Fallback
auf den Pool) → gelöschte Knoten raus → **auf `maxResults` gekürzt** → diese
Top-N als formatierte Knoten + der **echte edu-sharing-Treffer-Total**. Der
Kandidaten-Pool verlässt den MCP nie.

## Themenseiten-Inhalte (`get_topic_page_content`) — Stand 2026-06-01

**Bugfix (umgesetzt):** Die Variantenauflösung war kaputt — sie durchsuchte die
*Inhalte* der `page_config_ref`-Kinder (das sind `WIDGET_*`-Knoten OHNE
`ccm:page_variant_config`) und lieferte daher **immer 0 Swimlanes**. Tatsächlich
tragen die page_config-**Kind-Collections selbst** den `ccm:page_variant_config`
(Titel z.B. „Variante_Ideal“ / „PAGE_VARIANT_…“). Fix in `getTopicPageContent`:
direkt unter den Kindern die echte (Nicht-Template-)Variante wählen. Verifiziert
gegen Staging: „Nachhaltigkeit“ liefert jetzt **8 Swimlanes** mit echten
Überschriften („Test Tina 2“, „Akkordeonelement“, „Ankermenü“, …).

**`outputFormat:'json'` = RENDER-READY (umgesetzt):** Die Swimlane-Items sind
**WIDGET-Knoten** (`ccm:map` mit `ccm:widget_config`). Der json-Branch löst je
Swimlane das **erste inhaltstragende Widget** zu echten Karten auf — drei in WLO
vorkommende Formen:
| Widget-Typ | config-Feld | Auflösung |
|---|---|---|
| `content-teaser` | `propertyFilters` (gespeicherte Query) | → `ngsearch(FILES)` |
| `wlo-collection-chips` | `sortedNodeIds` (feste Liste) | → `getNodesMetadata` |
| `wlo-media-rendering` | `selectedNodeId` (Einzelknoten) | → `getNodesMetadata` |

Andere Widgets (Text / AI-Text / `wlo-topics-column-browser` / `editorial-members`
/ iframe) tragen keine Inhalte → leere Swimlane (Frontend überspringt sie).
Output je Swimlane: `{heading, type, items:[Karte…≤maxPerSwimlane], hasMore}` +
`variantTitle` + `topicPageUrl`. Gedeckelt: ≤ `MAX_LANES=12` Swimlanes, 1 Widget/
Swimlane, `maxPerSwimlane` (Default 3) Karten — hält die Call-Zahl beschränkt.
**Live verifiziert (Staging):** „Nachhaltigkeit“ füllt 5/8 Swimlanes —
content-teaser → echte Inhalte („Wie funktioniert das Internet?“), collection-chips
→ Sammlungen („Klimawandel“, „Nachhaltige Ernährung“), media-rendering → 1 Knoten.
*Backend-/Frontend-Verdrahtung (Intent/Pattern + Swimlane-Boxen mit „(Auszug)“ +
Absprung-Button) steht noch aus — Backend ruft das Tool noch nicht.*

## O8 — Themenseiten-Listung (Mode C)  *(umgesetzt 2026-07-27)*
Ein Client meldete **17–19 s** für `search_wlo_topic_pages` ohne `query`
(Analyse: `docs/plans/2026-07-27-topic-pages-latency.md`). Drei Ursachen, alle
behoben:
- **Toter Upstream-Call:** je Variante wurden die Metadaten der besitzenden
  Sammlung geholt, nur um `ccm:page_config_ref` zu lesen — ein Wert, den der
  Eltern-Walk schon kennt (er wählt die Sammlung genau deswegen aus) und den
  `buildTopicPageUrl` ohnehin nur auf Wahrheitswert prüft. Ersatzlos entfernt
  → halbe Rundreisenzahl.
- **Cache-Stampede:** der Eltern-Cache speicherte den *Wert* statt der
  *laufenden Anfrage*, also verfehlten gleichzeitig verarbeitete
  Geschwister-Varianten ihn und starteten denselben Abruf erneut. Jetzt wird
  die Promise gecacht (Muster wie beim früheren `ownerMetaCache`).
- **Kandidaten-Untergrenze:** `max(50, maxResults * 5)` ließ eine Anfrage über
  5 Ergebnisse 50 Varianten bezahlen. Jetzt `max(10, maxResults * 3)` (drei =
  die maximale Variantenzahl je Themenseite) mit einmaligem Nachladen auf den
  alten Pool, falls die Zusammenführung zu wenig übrig lässt.

Zusätzlich fragt der Eltern-Walk statt `-all-` (~59 Felder je Knoten der
gesamten Ahnenkette) nur noch die drei tatsächlich gelesenen Felder ab, und
`WLO_TOPIC_POOL` macht die Nebenläufigkeit dieses Fan-outs einstellbar.

**Der eigentliche Fund kam beim Nachprofilieren der verbliebenen Sekunden:**
`/parents` antwortet anonym mit **500 (AccessDenied)** für page_config-Ordner.
`getNodeParents` stuft eine Fehlerantwort auf `[]` herunter — die
Besitzer-Auflösung scheiterte also bei jeder Variante lautlos. Die Liste zeigte
lauter identische „Fachportalstartseite“-Titel, keine Themenseiten-URLs, und
als `collectionId` in Wahrheit die Varianten-ID. Mode C war nicht nur langsam,
sondern unbrauchbar — und bezahlte dafür ~1,1 s je Variante.

Ersetzt durch zwei `/metadata`-Abrufe entlang `virtual:primaryparent_nodeid`
(Variante → page_config-Ordner → Sammlung). Dieser Endpunkt funktioniert anonym
und kostet ~0,19 s. Zusätzlich Pool-Faktor 3 → 2, weil die Daten im Mittel nur
1,10 Varianten je Seite tragen (108 Varianten auf 98 Seiten).

Eine Eingrenzung auf eine einzelne Zielgruppen-Variante wurde geprüft und
verworfen: 98 der 108 Varianten tragen gar keine Zielgruppe, ein serverseitiger
`teacher`-Filter liefert 3 Varianten für 3 von 98 Seiten.

Gemessen (lokal gegen Produktions-Repository, `scripts/measure-topic-pages.mjs`):

| Aufruf | ursprünglich gemeldet | nach Pool/Projektion | nach `/metadata`-Fix |
|---|---|---|---|
| `{maxResults: 20}` | 17–19 s | 9,9 s | **3,2 s** |
| `{maxResults: 10}` | 8,5 s | 4,5 s | **1,4 s** |
| `{maxResults: 5}`  | 8,2 s | 2,8 s | **0,66 s** |
| `{maxResults: 20, educationalContext}` | 3,4 s | 1,5 s | **0,55 s** |

Alle Werte bei `WLO_TOPIC_POOL=10`; die Nutzlast ist dabei **gewachsen**, weil
erstmals echte Titel und Links enthalten sind. Dass 10 und 5 überhaupt
unterschiedlich viel kosten (vorher: 8,5 s vs. 8,2 s — beide auf der
Untergrenze 50), belegt zusätzlich den Wegfall der Untergrenze.

Reichweite des `/parents`-Defekts: Bei normalen Sammlungen antwortet der
Endpunkt korrekt (200, ~0,4 s), bei Inhaltsknoten (`ccm:io`) scheitert er
ebenfalls — was `getNodeBreadcrumb` bereits dokumentiert und abfängt. Nur der
page_config-Fall war unentdeckt.

## O10 — Begrenzter, sich selbst erklärender Sammlungsbaum  *(umgesetzt 2026-07-27)*
Die Messung der **optionalen Modi** — die O9 zunächst ausgelassen hatte —
brachte den eigentlichen Ausreißer zutage: `browse_collection_tree` mit Tiefe 2
und `includeContentPreview` brauchte **11,7 s und lieferte 460 kB**. Der Baum
holte bis zu 30 Unter-Sammlungen je Knoten ohne Gesamtgrenze (ein Portal mit 15
Knoten ergibt ~100), und jede Anreicherung kostete danach einen Abruf pro Knoten
— im ungünstigsten Fall 1500 Upstream-Abrufe aus einem einzigen Tool-Aufruf.

- **Der Baum ist jetzt begrenzt.** Die Scheibe je Elternknoten leitet sich aus
  einem Gesamtbudget (150) ab, gedeckelt bei 10, und wird **vor** dem Durchlauf
  berechnet — so bekommt jeder Elternknoten dieselbe Größe. Ein Zähler, den
  nebenläufige Arbeiter leeren, hätte die Ausgabe nichtdeterministisch gemacht.
  Die Tiefe bleibt bei 2.
- **Die Kürzung wird offengelegt, nicht verschwiegen.** Gekürzte Knoten tragen
  `hasMoreChildren`, die Antwort trägt `truncated`, und die Markdown-Ausgabe
  nennt den konkreten Folgeaufruf (`browse_collection_tree mit nodeId=…`). Die
  Tool-Beschreibung weist das Modell an, das der Nutzerin/dem Nutzer zu sagen
  und einen Zweig gezielt zu öffnen, statt die Auswahl als vollständig
  darzustellen. Das Erkennen von „da ist mehr“ kostet nichts extra: Der
  Durchlauf holt genau ein Kind mehr, als er zeigt.

| Modus | vorher | jetzt |
|---|---|---|
| Tiefe 2 + Inhaltsvorschau | 11,7 s / 460 kB | **6,5 s / 362 kB** |
| Tiefe 2 + Zählungen | 5,1 s / 103 kB | **4,0 s / 84 kB** |
| Tiefe 1 + Zählungen | 2,0 s | **1,5 s** |

Bleibt teuer: `includeContentPreview` kostet naturgemäß einen Abruf je Knoten.
Der Schalter ist optional und standardmäßig aus — wer ihn auf einem breiten Baum
setzt, muss mit Sekunden rechnen.

## O9 — Fächer-Durchsicht aller Werkzeuge  *(umgesetzt 2026-07-27)*
Alle 22 zu diesem Zeitpunkt registrierten Werkzeuge wurden live mit
realistischen Argumenten durchgemessen, um den Engpass zu finden statt ihn zu
vermuten. Ergebnis: Die meisten antworten unter einer Sekunde; drei
Aufrufstellen enthielten vermeidbare Wartezeit. (`get_wlo_content_text`, das
23. Werkzeug, kam danach hinzu und steckt nicht in diesen Zahlen.)

- **Kandidatenprüfung (Mode B) nutzt jetzt `WLO_TOPIC_POOL`** statt einer fest
  verdrahteten Breite von 4. `findTopicPagesByQuery` prüft bis zu 12 Kandidaten
  mit je einem Metadaten- und ggf. einem Kinder-Abruf — das waren drei bis vier
  Wellen. Isoliert gemessen: 1797 ms bei Breite 4, 788 ms in einer Welle.
- **`getTopicPageContent` hat einen Schnellpfad für „beide IDs“.** Sind
  Sammlungs- und Varianten-ID bekannt, werden beide Knoten **parallel** gelesen,
  statt die Kette Sammlung → Config-Ordner → Variante zu laufen. Die Auflösung
  liefert beide IDs ohnehin. Gemessen: 1238 ms → 774 ms.
- **`browse_collection_tree`: Breite der ersten Ebene 5 → 10.** Bei Tiefe 2
  kostet jeder Knoten der ersten Ebene genau einen `/children`-Abruf, und Ebene 2
  rekursiert nicht — die Breite war also vier Wellen. Der verschachtelte Pool ist
  jetzt eine eigene, bewusst schmale Konstante (4), weil er nur auf dem
  optionalen `includeContentCounts`-Pfad überhaupt Arbeit macht; damit bleibt der
  ungünstigste Fall bei 40 gleichzeitigen Abrufen statt der quadrierten Breite.

Gemessen (lokal gegen Produktions-Repository, bester von zwei Läufen):

| Werkzeug | vorher | jetzt |
|---|---|---|
| `get_topic_page_content` (query) | 3253 ms | **2175 ms** |
| `browse_collection_tree` Tiefe 2 | 2899 ms | **1968 ms** |
| `browse_collection_tree` Tiefe 1 | 1378 ms | **943 ms** |
| `search_wlo_topic_pages` (query) | 1621 ms | **1191 ms** |

Alle übrigen Werkzeuge lagen bereits bei ≤ 1,2 s und blieben unangetastet.

**Nebenläufigkeit wurde gemessen, nicht angenommen:** Gegen den Live-Server
kosten fünf gleichzeitige Aufrufe pro Aufruf genauso viel wie ein einzelner
(Faktor 0,96), zehn gleichzeitige 1,65× — weit entfernt vom Faktor 10, den
Serialisierung bedeuten würde. Was bei zehn bremst, ist edu-sharing, nicht
dieser Server.

## O11 — Kompendiumstext beantwortet eine Frage, statt ganz zu kommen  *(umgesetzt 2026-08-18)*

**Problem.** `get_compendium_text` lieferte die redaktionelle Prosa einer Sammlung
ungekürzt. Gemessen über die 11 Sammlungen auf Staging, die einen solchen Text
führen: Median 9 473 Zeichen, p90 16 411, **max 65 250**. Wer nach einem Lehrplan
fragte, bekam alles und bezahlte alles.

**Änderung.** Jede Antwort beginnt mit dem Inhaltsverzeichnis der Überschriften.
Ohne `query` folgt der ganze Text mit je Hauptabschnitt gedeckelten Abschnitten,
mit `query` nur die passenden Passagen, gewichtet über BM25
(`src/text-bm25.ts`) und jede unter ihrem Überschriftenpfad.

| Aufruf auf dem längsten Text (65 250 Zeichen) | ausgeliefert | ms |
|---|---|---|
| ohne `query` (vor dieser Änderung) | 65 250 | — |
| ohne `query` | **20 802** | 739–1 121 |
| `query: "Lehrplan Thüringen Regelschule"` | **4 964** | 588–601 |
| `query: "Brechung an der Linse"` | 8 725 | 572–833 |
| `query` ohne Treffer (nur Inhaltsverzeichnis) | 2 083 | 466–526 |

**Kostet upstream nichts.** Die Auswahl ist lokal: derselbe eine Metadaten-Abruf
holt den Text, das Ranking ist reine Rechenzeit — der absolute Worst Case,
25 Sammlungen × längster Text × 7 Suchwörter, gemessen **91 ms**.

Drei Bauarten hat die Messung ausgeschlossen, und jede sah zuerst naheliegend
aus: „je H1 kappen" hätte jedes Dokument als Ganzes gekappt (10 von 10 Texten
tragen ihren Titel in einer einzelnen H1); ein roher Absatz ist die falsche
BM25-Einheit (329 von 972 echten Absätzen sind kürzer als 40 Zeichen, und die
Längennormalisierung hebt eine nackte Tabellenzeile über die Prosa, die sie
erklärt — deshalb werden Absätze erst auf 200 Zeichen aufgesammelt); und ein
ganzer Abschnitt ist zu grob (größter Eigentext: 16 317 Zeichen).

**Bewusst unangetastet:** `GET /api/compendium` und das `includeCompendium`-Bündeln
in `search_wlo_content` liefern weiterhin den Volltext — sie rufen
`getCompendiumTexts` direkt auf, und den hat diese Änderung nicht angefasst.

## Offenes Optimierungspotenzial

### O7 — In-Process-Cache  *(NICHT umgesetzt)*
**Größter verbliebener Hebel.** Der Server läuft im Zielbetrieb **persistent**
(Docker auf dem vServer), pro Request wird lediglich ein MCP-Server-Objekt
erzeugt und wieder geschlossen — der Prozess selbst bleibt bestehen. Ein
**In-Process-Result-Cache** (Suchergebnisse, Node-Metadaten, Vokabular mit TTL)
wäre also wirksam, anders als in einem serverless Betrieb, wo er Requests nicht
überlebt.
- Besonders lohnend für Themenseiten: Eltern-Walk und Sammlungs-Metadaten
  ändern sich selten und dominieren die Listung.
- **Vor einer Umsetzung mit dem Auth-Vorhaben abgleichen**
  (`docs/plans/2026-07-25-wlo-mcp-optional-auth.md`): sobald Antworten von den
  Rechten des angemeldeten Nutzers abhängen, muss der Cache-Schlüssel die
  Identität enthalten — sonst bekäme Nutzer B das rechte-gefilterte Ergebnis
  von Nutzer A.
- Reihenfolge-Empfehlung: erst O8 im Betrieb nachmessen, dann entscheiden, ob
  O7 überhaupt noch nötig ist.

### Kleinere, optionale Hebel
- `POOL_SIZE` weiter senken (25→15) — minimal weniger Recall.
- edu-sharing-Antwortzeit selbst (~1–4 s/ngsearch) ist Infra (Staging; Prod evtl.
  schneller) — nicht im MCP-Code lösbar; wir senken nur Anzahl + Größe der Calls.
