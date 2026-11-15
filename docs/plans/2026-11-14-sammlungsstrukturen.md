# Sammlungsstrukturen anlegen und pflegen (Wünsche S1–S10 des Chatbot-Teams)

Stand 2026-11-14. Quelle: „Werkzeug-Wünsche an den MCP: Sammlungsstrukturen anlegen und
pflegen" des Chatbot-Teams vom selben Tag. Entwurf und Aufgaben in einer Datei.

## Ziel

Der Weg „Lehrplan → Sammlungsbaum → Inhalte einsortieren → einreichen" soll ohne Lücke über
den MCP gehen. Alles ist additiv: kein bestehendes Werkzeug ändert seine Vorgabe, neue
Werkzeuge und Parameter kommen dazu. Der Chatbot bindet jede Neuerung an `tools/list`.

## Regeln, die für jedes Paket gelten

- Jede Schreibänderung bleibt zweistufig (Vorschau + Einmal-Schlüssel), alles Gesendete steht
  in der Änderungsmenge, jedes Schreiben wird zurückgelesen. Stapel laufen über
  `runPlannedCall`; ein neues Werkzeug geht durch `registerCurationTool`.
- Zurückgelesen wird über Listen, nie über `childReferencesCount`/`childCollectionsCount`:
  die Zähler hinken (Team: 2 bis 8 s) und zählen an der Wurzel den Teilbaum mit.
- Ein Test gegen `fetchMock` beweist nur, was wir senden. Jeder neue Schreibweg bekommt eine
  Live-Messung gegen Staging mit eigenen Wegwerf-Knoten (`tests/live/` oder `scripts/measure-*`).

## Gemessen (eigene Messung, 2026-11-14, Staging, Dienstkonto, Wegwerf-Sammlungen)

`npm run measure:order` (`scripts/measure-collection-order.ts`). Gefragt wurden BEIDE
Listen, weil dieser Server Untersammlungen über den Knoten-Endpunkt liest
(`/node/v1/…/children?filter=folders`) und das Team den Sammlungs-Endpunkt gemessen hat.

| Lage | ohne Sortierung | mit `sortProperties=ccm:collection_ordered_position&sortAscending=true` |
|---|---|---|
| C, A, B angelegt, keine Reihenfolge gesetzt | C, A, B | C, A, B |
| `POST …/order` [B, C, A] → 200 | C, A, B (unverändert) | B, C, A |
| danach D angelegt (ohne Position) | C, A, B, D | B, C, A, D |
| `POST …/order` [D, A, B, C] | C, A, B, D | D, A, B, C |

Beide Endpunkte antworten gleich. Daraus folgt die Leseregel: **immer mit dem
Sortierparameter fragen** ergibt „Position, wenn gesetzt, sonst Anlege-Reihenfolge", und ein
Kind ohne Position steht hinter denen mit Position. `orderMode` der Elternsammlung bleibt
`null`.

### Zweite Messung für P3 und P4 (2026-11-14, `npm run measure:moves`, zwei Konten)

`scripts/measure-collection-moves.ts`: Dienstkonto und Testkonto (`WLO_TEST_USER`, kein Admin),
nur eigene Wegwerf-Knoten, danach gelöscht und das Löschen nachgeprüft.

**Reihenfolge der Inhalte**

| Aufruf | Ergebnis |
|---|---|
| `POST …/order` mit Original-Kennungen | 400 `Node id … is not a children of the collection` |
| `POST …/order` mit den Kennungen der Verweise | 200; Positionen 0, 1, 2, lesbar mit dem Sortierparameter an `children?filter=files` |
| `POST …/order` mit Untersammlung UND Verweisen in einer Liste | 200; EINE Zählung über beide Arten (Verweis 0, Untersammlung 1, Verweis 2, Verweis 3) |

Folge: Untersammlungen und Inhalte teilen sich einen Positionsraum, werden aber getrennt gelistet
(`filter=folders` / `filter=files`). Eine Liste nur einer Art ist deshalb in Ordnung; die Lücken
und Doppelungen zur anderen Art stören keine der beiden Listen.

**Sammlung umhängen** (`POST /node/v1/nodes/-home-/{Ziel}/children/_move?source={Sammlung}`)

| Lage | Ergebnis |
|---|---|
| A (mit Untersammlung A1 und einem Verweis darin) unter B | 200; Kennung bleibt, A1 und der Verweis ziehen mit, `/parents` von A1 zeigt die neue Kette |
| lokal gesetztes Recht an A (Testkonto: Consumer) | bleibt nach dem Umhängen erhalten, `inherited` bleibt `true` — geerbt wird ab dann vom neuen Elternknoten |
| eine zweite Sammlung gleichen Titels unter dasselbe Ziel | **200 — danach stehen zwei gleichnamige Sammlungen nebeneinander.** Das Repository prüft das nicht; das Werkzeug muss es tun |
| Ziel im eigenen Teilbaum | 500 `CyclicChildRelationshipException`, nichts verändert. Das Werkzeug lehnt vorher ab |
| Ziel `-root-` | 404 — der Platzhalter gilt an diesem Endpunkt nicht |

**Vorschlag an eine Sammlung** — die Frage, die zwei Konten braucht

| Lage | Ergebnis |
|---|---|
| Testkonto OHNE jedes Recht an der Sammlung schlägt vor | 403 `No Read permissions for collection` |
| Testkonto mit LESERECHT (Consumer): gewöhnliches Einsortieren | 403 |
| Testkonto mit Leserecht: `?asProposal=true` | **200** — wer lesen, aber nicht schreiben darf, darf vorschlagen |
| derselbe Vorschlag noch einmal | 409 `already proposed for this collection` |
| Vorschläge auflisten als Vorschlagender | 403 `No Write on collection` — die Liste sieht nur, wer an der Sammlung schreiben darf |
| Vorschläge auflisten mit Schreibrecht | 200; je Eintrag das Material, `proposal` (Knoten `ccm:collection_proposal`), `status`, `accessible` |
| Rückwärtssuche (`/usage/…/collections`) als Vorschlagender | leer — der eigene offene Vorschlag ist dort NICHT sichtbar (das Team sah `PROPOSAL_PENDING` mit einem Konto, das auch die Sammlung besitzt) |
| Annehmen: gewöhnliches `PUT …/references/{Material}` | 200, der Verweis entsteht; der Vorschlag bleibt `PENDING` |
| Status am Vorschlags-Knoten auf `ACCEPTED` bzw. `DECLINED` setzen | 200; die Listen nach Status stimmen danach |
| nach `DECLINED` erneut vorschlagen | 409 — ein abgelehnter Vorschlag sperrt das Paar |

### Dritte Messung für P4 (2026-11-14, zwei Konten, Wegwerf-Knoten)

| Frage | Ergebnis |
|---|---|
| Woran sieht man, ob die angemeldete Person an einer Sammlung schreiben darf? | Am Datensatz selbst: das Feld `access` der Metadaten-Antwort. Mit Leserecht (Consumer) `["Read","ReadAll","Comment","Embed","Feedback","DownloadContent"]`, mit Schreibrecht (Collaborator) zusätzlich `"AddChildren","Write"`. Ohne jedes Recht antwortet schon das Lesen 403 |
| Darf jemand mit Schreibrecht, der KEIN Admin ist, Vorschläge sehen und entscheiden? | Ja: Liste 200, Status am Vorschlags-Knoten setzen 200 (Testkonto als Collaborator) |
| Was sagt `isPublic`? | `false` am eigenen, nie geteilten Material — verlässlich „nur für mich". `true` ist KEIN Versprechen des Gegenteils: eine mit EINEM Konto geteilte Sammlung meldet diesem Konto `true`. Gesagt wird deshalb nur das Negative |
| Ein Verweis, der schon besteht, noch einmal einsortieren | 409, kein zweiter Verweis |
| Rückwärtssuche nach dem Entfernen eines Verweises | 2 bis 5 s lang 500 für dieses Material, dann wieder richtig |

Nicht gemessen: ob die WLO-Oberfläche die Vorschläge zeigt.

Vom Team gemessen und übernommen: unvollständige Liste an `/order` → doppelte Positionen;
`…/copy`; die Zähler hinken nach.

### Vierte Messung für S11–S13 (2026-11-15, `npm run measure:tree`, anonym, nur lesend)

`scripts/measure-tree-reading.ts`: ohne Anmeldung (schlichtes `fetch`, kein `.env`), nichts
geschrieben. Stichprobe: die Wurzel, die erste Ebene aller 37 Fachportale und der ganze
Physik-Teilbaum (144 Sammlungen, tatsächlich drei Ebenen tief) — 67 Elternknoten mit Kindern.

**Positionen (S11)**

| Frage | Ergebnis |
|---|---|
| Liefert die Kinderliste die Position je Kind? | Ja, sobald `ccm:collection_ordered_position` in der Projektion steht (`propertyFilter`). Form: EIN String mit einer ganzen Zahl (`["0"]`, `["1"]`, … `["13"]`) |
| Wie sieht ein Kind ohne Position aus? | Die Eigenschaft FEHLT (kein leerer Wert, keine `"0"`) |
| Gibt es gleiche Positionen? | Ja, und sie sind der Normalfall: von 57 Elternknoten, deren Kinder eine Position tragen, haben **46 einen Gleichstand** und nur **9 zwei verschiedene Werte**. Alle 30 Fachportale der Wurzel tragen `"1"`, ebenso fast jede Physik-Untersammlung |
| Verteilung | 10 Elternknoten ganz ohne Position, 43 mit Position an jedem Kind, 14 gemischt |
| Wurzel: sortierte gegen unsortierte Liste | dieselbe Reihenfolge — bei Gleichstand ordnet die Position nichts |

Folge: „eine Position ist gesetzt" heißt auf diesem Bestand fast nie „jemand hat geordnet".
Deshalb fällt Gleichstand auf den Titel zurück, und das Kennzeichen `childrenPositioned` fragt
nach ZWEI VERSCHIEDENEN Positionen. Über den Physik-Teilbaum: bei 1 von 145 gelisteten
Elternknoten (dem Portal selbst, 16 von 17 Kindern mit Position, zwei Werte).

**Inhaltszahlen (S12)** — 144 Zählabrufe auf Physik, je drei Läufe, Median

| Abruf je Sammlung | gleichzeitig | Läufe (s) | Median | Median je Abruf |
|---|---|---|---|---|
| bisher: `filter=files&maxItems=1`, drei Titel-Eigenschaften | 8 | 6,00 / 5,68 / 5,88 | 5,88 s | 307 ms (3,5 kB) |
| `maxItems=1`, eine Eigenschaft | 8 | 5,73 / 5,86 / 5,75 | 5,75 s | 311 ms |
| **`maxItems=0`**, eine Eigenschaft | 8 | 2,89 / 2,60 / 2,75 | 2,75 s | 139 ms (57 Byte) |
| `maxItems=0` | 4 | 5,50 / 5,17 / 5,05 | 5,17 s | 139 ms |
| **`maxItems=0`** | **12** | 1,74 / 1,76 / 1,79 | **1,76 s** | 136 ms |
| `maxItems=0` | 16 | 1,38 / 1,48 / 1,44 | 1,44 s | 145 ms |
| `maxItems=0` | 24 | 1,06 / 1,07 / 1,01 | 1,06 s | 155 ms |
| bisher (`maxItems=1`) | 16 | 3,33 / 3,17 / 2,94 | 3,17 s | 334 ms |

`pagination.total` ist in jeder Variante auf allen 144 Sammlungen gleich (Summe 2 299, fünf
Sammlungen mit 0). Die Projektion spart nichts; das Weglassen des EINEN Eintrags halbiert den
Abruf. Das Repository skaliert bis 24 gleichzeitige Abrufe fast linear.

Eine Suchanfrage, die für viele Sammlungen auf einmal zählt, gibt es nicht: `ngsearch` nimmt als
Facette nur Felder, die der Metadatensatz als Widget kennt. `virtual:primaryparent_nodeid`,
`ccm:collection_io_reference`, `collections.ref.id`, `virtual:parent_recursive` und
`ccm:original` → 400 `Widget … was not found in the mds`; `virtual:collection_id_primary` → 200
mit null Buckets (Kontrolle `ccm:taxonid` → 200 mit Buckets).

**Das Werkzeug selbst** (`listCollectionTree`, Physik, Tiefe 4, eine Seite, frischer Prozess)

| Aufruf | vorher (drei Läufe, Median) | nachher |
|---|---|---|
| ohne `includeContentCounts` | 5,15 / 6,07 / 5,40 → 5,40 s | 4,96 / 5,05 / 4,96 → 4,96 s (unverändert gebaut; Streuung) |
| mit `includeContentCounts` | 13,48 / 11,37 / 11,30 → **11,37 s** | 6,95 / 7,02 / 7,16 → **7,02 s** |
| `order: "position"`, ohne Zahlen | — | 5,00 / 5,28 / 5,08 → 5,08 s |

**Erster Aufruf eines frischen Prozesses (19 s und 38 s beim Team)** — nicht nachstellbar. Die
erste Anfrage des Prozesses kostet 528 ms gegen 439 ms für dieselbe danach (DNS und TLS zusammen
rund 0,1 s). Der erste Werkzeug-Aufruf im frischen Prozess lag bei 5,15 s (ohne Zahlen) und, NEBEN
dem Aufwärmen des Skill-Caches gestartet, bei 6,83 s mit Zahlen (Aufwärmen fertig nach 0,62 s,
kein Zählabruf am Tor abgewiesen). Dieser Server tut beim ersten Aufruf nichts, was 19 bis 38 s
erklärt; das Werkzeug liest keinen Cache und baut keinen Index. Was bleibt, liegt außerhalb der
Messung: der Zustand des Repositorys nach einer Pause (die 22 s aus dem Chatbot-Paket vom
2026-11-07 waren ebenfalls nicht der Transport) oder ein Aufruf über `collection` (Titel), der vor
dem Baum die Sammlungssuche beider Indizes bezahlt. Zum Eingrenzen: `X-Request-Id` des langsamen
Aufrufs und die Log-Zeile über langsame Repository-Aufrufe.

## Pakete

Reihenfolge wie vom Team vorgeschlagen. Jedes Paket: Workflow-Skill laden → Tests zuerst →
umsetzen → Review → Befunde beheben → STATUS, CHANGELOG, Doku → Commit und Push.

### P1 — lesen (S1 Lesen, S2)

- **S1** `browse_collection_tree` und `get_collection_overview` bekommen `order: "title" | "stored"`.
  Vorgabe bleibt `title` (heutiges Verhalten, heutige Abfrage unverändert). `stored` fragt mit
  dem Sortierparameter und sortiert nicht mehr nach Titel. `getChildCollectionsResult` bekommt
  dafür eine Option; die Regel steht einmal dort.
- **S2** neues Lesewerkzeug `list_collection_tree`: der Teilbaum als flache Liste
  `[{nodeId, path: [Titel …], depth}]` in gespeicherter Reihenfolge, Tiefe 1 bis 4, in Seiten
  (`maxItems` ≤ 250, `skipCount`). Ebene für Ebene gelesen, mit Abbruch, sobald die Seite
  gefüllt ist; entdoppelt nach Kennung (Sammlungen bilden einen DAG, der erste Elternknoten
  gewinnt). Je Knoten: `childrenUnread`, `childrenRefused` (gekürzt wird je Elternknoten nichts, also gibt es kein `hasMoreChildren`);
  auf Antwortebene `incomplete`/`restricted` mit den bestehenden Hinweissätzen und
  `more {nextSkipCount}`. Optional `includeContentCounts` (ein direkter Lesezugriff je Knoten
  der Seite, nicht der Zähler). Der Startknoten wird gelesen (Titel als erstes Pfadglied); ist
  er nicht lesbar, ist das ein Fehler.

### P2 — vom Upload bis zum Einreichen (S4, S3)

- **S4** `wlo_submit_contents {items: [{nodeId}], comment?}`, bis 200, als Plan wie
  `wlo_add_to_collections`. `already_submitted` zählt als erledigt; ein gescheiterter Eintrag
  hält die anderen nicht auf; Sammlungen und Ordner werden wie beim Einzelwerkzeug abgelehnt.
- **S3** `wlo_create_collection_tree`: je Knoten `discipline`, `educationalContext`, `keywords`,
  dazu gemeinsame Werte für den Baum, die ein Knoten überschreibt. Vokabular streng
  (`vocabularyUris`, kein Teilwort). Die Werte stehen je Knoten in der Vorschau und damit im
  Fingerabdruck. Bei `merge` bleibt ein vorhandener Knoten unverändert, und die Vorschau sagt
  es. Der Schalter „vorhandene ergänzen" ist NICHT Teil dieses Pakets.

### P3 — Reihenfolge setzen, Stapel entfernen, leere löschen (S1 Setzen, S6, S7)

- **S1** `wlo_create_collection_tree` setzt nach dem Anlegen einer Ebene die Reihenfolge
  (`POST …/order` mit ALLEN Kindern). Bei `merge`: vorhandene behalten ihren Platz, neue
  dahinter. Eigenes Werkzeug `wlo_order_collection {collectionId, order}` für Untersammlungen
  und Inhalte; die Liste muss alle Kinder nennen (sonst Ablehnung vor dem Schlüssel), bei
  Inhalten werden Original-Kennungen auf die Verweise aufgelöst. Zurückgelesen wird die
  sortierte Liste.
- **S6** `wlo_remove_from_collections {pairs}` als Plan; `removeFrom` je Paar in
  `wlo_add_to_collections` (erst hinzufügen, zurücklesen, dann entfernen; scheitert das
  Entfernen, sagt die Antwort, dass das Material in beiden liegt).
- **S7** `wlo_delete_collections {nodeIds}` löscht nur LEERE Sammlungen (keine Untersammlung,
  kein Verweis, kein Original; direkt gelesen, unmittelbar vor dem Löschen noch einmal). Alles
  andere kommt als `not_empty` zurück. Die Plan-Kennung des Baum-Werkzeugs als Eingabe ist
  ein möglicher zweiter Schritt, nicht Teil dieses Pakets.

### P4 — Umbau und Einsortieren ohne Schreibrecht (S5, S8, S9)

- **S5** `wlo_move_collection {nodeId, newParentId}`. Vorschau: alte und neue Elternsammlung
  mit Pfad, Zahl der mitziehenden Untersammlungen, Satz zu den Rechten. Ablehnung, wenn das
  Ziel im eigenen Teilbaum liegt oder dort eine gleichnamige Sammlung steht. Vorher messen:
  was `_move` mit lokal gesetzten Rechten macht.
- **S8** Vorschlag an eine Sammlung. **Vorher mit zwei Konten messen** (Dienstkonto legt eine
  Sammlung an und gibt dem Testkonto Leserecht): darf eine Person ohne Schreibrecht
  vorschlagen? Erst danach: `proposed` je Paar in `wlo_add_to_collection(s)`,
  `wlo_list_collection_proposals`, `wlo_decide_collection_proposal` (Annehmen schreibt den
  Verweis, liest zurück und setzt DANN den Status — dieselbe Regel wie bei Metadaten-Vorschlägen).
- **S9** Vorschau von `wlo_add_to_collection(s)`: je Material `public: false` und ein Satz.
  Kein Werkzeug zum Setzen von Rechten.

### S11–S13 — Nachtrag des Teams (2026-11-15): Reihenfolge, die immer passt; schnellere Zahlen; WO nicht gelesen wurde

Alles additiv. Ohne die neuen Angaben sendet und antwortet jedes Werkzeug wie zuvor — mit zwei
benannten Ausnahmen: der Zählabruf von `list_collection_tree` ist ein anderer (gleiche Zahl), und
eine Antwort dieses Werkzeugs, die schon `incomplete`/`restricted` trug, nennt jetzt zusätzlich
die betroffenen Elternknoten.

- **S11 (a) `order: "position"`** an `browse_collection_tree`, `get_collection_overview` und
  `list_collection_tree`. Je Elternknoten: Kinder MIT gesetzter Position in dieser Reihenfolge
  (als Zahl verglichen), danach die ohne Position nach Titel; gleiche Positionen ebenfalls nach
  Titel — dieselbe Sortierung wie `order: "title"` (`sortByTitle`). Die Regel steht einmal, in
  `src/collection-position.ts`. `title` und `stored` bedeuten, was sie bedeuteten; `title` fragt
  die Position nicht ab, `stored` seit dem Nachtrag unten schon
  (`getChildCollectionsResult(…, { withPosition })` ist die eine Stelle, die die Eigenschaft in
  die Projektion nimmt).
- **`list_collection_tree` bekommt `order`** mit Vorgabe `stored` (bisheriges Verhalten,
  bisherige Abfrage) und zusätzlich `title` und `position`. Sortiert wird je Elternknoten, BEVOR
  dessen Kinder an die Ebene angehängt werden; die Ebenenfolge bleibt. Damit die Seiten eine
  Liste bleiben, liest ein sortierender Lauf jeden Elternknoten bis zum Ende (bei `stored` endet
  das Lesen wie bisher, sobald die Seite gefüllt ist) — sonst begänne eine kleine Seite über
  einem Elternknoten mit 130 Kindern mit anderen Einträgen als dieselbe Position einer großen.
  Die Obergrenze von 400 Abfragen gilt unverändert.
- **S11 (b) `childrenPositioned`** (boolesch) je Elternknoten: am Knoten in
  `browse_collection_tree`, an `root` und je Eintrag in `list_collection_tree`, als
  `subcollectionsPositioned` in `get_collection_overview`, im Text als Zusatz der Kopfzeile
  (Baum, flache Liste) bzw. als eigene Zeile nach der Liste (Übersicht); die Marke
  `[Unterthemen in gesetzter Reihenfolge]` je Zeile gibt es nur im Baum. Drei Zustände (Stand
  nach dem Review, siehe „Review 2026-11-15" unten): `true` = mindestens zwei
  Kinder tragen VERSCHIEDENE Positionen (die Liste steht in dieser Reihenfolge); `false` =
  die Unterliste wurde bis zum Ende gelesen und Positionen ordnen dort nichts (keine, eine, oder
  überall dieselbe); fehlt = nichts bekannt (letzte Ebene, gekürzt, volle Seite, nicht gelesen,
  verweigert) oder weniger als zwei Kinder. **Entschieden:** nicht „mindestens ein Kind hat eine Position" —
  gemessen träfe das auf 57 Elternknoten zu, von denen 48 nichts ordnen; ein Client, der danach
  selbst sortiert, bekäme genau die beliebige Reihenfolge, um die es geht.
- ~~**Entschieden: das Kennzeichen kommt nur mit `order: "position"`.**~~ **Aufgehoben am selben
  Tag (Nachtrag, 2026-11-15): das Kennzeichen kommt mit `stored` UND `position`.** Das Team hatte
  es als ALTERNATIVE zur neuen Reihenfolge erbeten („je Knoten ein Merkmal … Dann sortieren wir
  selbst") — es liest mit `stored` und sortiert selbst, also muss das Kennzeichen dort stehen.
  Bedeutung unverändert (`true` = mindestens zwei verschiedene Positionen; `false` = Positionen
  ordnen nichts; fehlt = Unterliste in diesem Aufruf nicht vollständig gelesen). Folgen:
  - `stored` nimmt die Positions-Eigenschaft in die Projektion der Kinderliste (gemessen
    kostenlos); sonst ist die Abfrage dieselbe, und die Reihenfolge der Antwort ändert sich nicht.
    `title` fragt weiter nicht ab und trägt kein Kennzeichen.
  - Nur die VORGABE jedes Werkzeugs bleibt unverändert: `browse_collection_tree` und
    `get_collection_overview` (Vorgabe `title`) senden und antworten wie zuvor.
    `list_collection_tree` hat `stored` als Vorgabe — dort erscheint das Kennzeichen jetzt ohne
    weiteres Zutun (gewollt): `root.childrenPositioned`, je Eintrag `childrenPositioned`, und im
    Text NACH den Hinweisen (deren Platz bleibt) EINE Zeile `Erste Ebene: in gesetzter
    Reihenfolge.` bzw. `Erste Ebene: keine unterscheidenden Positionen gesetzt.` — nicht über
    einer leeren Seite. ~~Marke je Eintrag, weiterer Textblock im JSON-Format~~ — beides nach
    dem Review entfernt (unten).
  - Bei `stored` sagt kein Text „nach Titel" — diese Reihenfolge sortiert nicht
    (Baum: „erste Ebene ohne unterscheidende Positionen"; Übersicht: `Reihenfolge: keine
    unterscheidenden Positionen gesetzt.`).
  - „Vollständig gelesen" ist in der flachen Liste bei `stored` eine eigene Bedingung: der Lauf
    hört an einem Elternknoten auf zu lesen, sobald die Seite gefüllt ist, OHNE dass etwas
    scheitert. Das Kennzeichen steht deshalb nur, wo die letzte Listenseite kurz zurückkam
    (`Listing.complete`) — über den ersten hundert von 130 Kindern wäre „ordnet nichts" eine
    Aussage über die dreißig nicht gesehenen. Welche Einträge es tragen, hängt bei `stored` also
    von der Seitengröße ab; behauptet wird nur Beobachtetes.
  - ~~`browse_collection_tree`/Übersicht urteilen über alles, was die gekürzte Liste zurückgab —
    `false` gilt für das Gelesene.~~ Aufgehoben durch das Review: siehe unten.
- **Grenze, benannt:** `browse_collection_tree` und die Übersicht kürzen je Elternknoten, und
  bei `position` wird auf JEDER Ebene in der Reihenfolge des Repositorys gekürzt, BEVOR sortiert
  wird. Hinter einem Schnitt (`hasMoreChildren`) stehen von den Kindern ohne Position also die
  zuerst angelegten, nicht die alphabetisch ersten. `title` bleibt, wie es war (erste Ebene:
  kürzen, dann sortieren; tiefere Ebenen: alles Geholte sortieren, dann kürzen). Die flache
  Liste kürzt je Elternknoten nichts und hat die Grenze nicht.
- **Review 2026-11-15 (neun Befunde, alle bearbeitet) — was jetzt gilt:**
  - **Kein „nein" aus einer unvollständigen Liste.** Die Liste kommt aufsteigend nach Position;
    ein gekürzter Anfang gleicher Positionen ist genau die Stelle, an der der ungesehene Rest
    abweicht (Probe: 60 Kinder, 55 auf „1", `maxResults` 50 → vorher `false` neben
    `truncated`). Eine Regel für alle drei Werkzeuge (`positionedFlag`,
    `src/collection-position.ts`): `true`, sobald zwei verschiedene Positionen GESEHEN wurden
    (auch über einer gekürzten Liste, das Zusatzkind zählt mit); `false` nur über einer bis zum
    Ende gelesenen Liste; sonst fehlt das Feld. Im Baum und in der Übersicht heißt „zu Ende
    gelesen": nicht gekürzt (`truncatedAt` ≠ Start bzw. kein `hasMoreChildren`); in der flachen
    Liste `Listing.complete`.
  - **Weniger als zwei Untersammlungen: kein Feld** — in allen drei Werkzeugen. Vorher trug
    jedes Blatt `childrenPositioned: false` (≈ 26 Zeichen × 250 Einträge je Seite, und „selbst
    sortieren" über nichts).
  - **Textformen.** Baum, Kopfzeile: `… (Tiefe n) — Reihenfolge: gesetzte Position, sonst
    Titel[; erste Ebene in gesetzter Reihenfolge | ; erste Ebene nach Titel]` (`position`) bzw.
    `… — erste Ebene in gesetzter Reihenfolge | … — erste Ebene ohne unterscheidende Positionen`
    (`stored`); ohne Kennzeichen entfällt der Teil zur ersten Ebene. Übersicht: die Zeile
    beginnt für JEDE Reihenfolge mit `Untersammlungen: ` (Zeilenform, die der Chatbot liest);
    die Reihenfolge steht in einer eigenen Zeile danach — `position`: `Reihenfolge: gesetzte
    Position, sonst Titel.` mit ` Hier: in gesetzter Reihenfolge.` bzw. ` Hier: nach Titel
    (keine unterscheidenden Positionen gesetzt).`, wo das Kennzeichen steht; `stored`:
    `Reihenfolge: in gesetzter Reihenfolge.` bzw. `Reihenfolge: keine unterscheidenden
    Positionen gesetzt.`, ohne Kennzeichen keine Zeile. Flache Liste: die Eintragszeilen sind
    wieder die von vor dem Nachtrag (keine Marke; das Kennzeichen je Eintrag steht in den
    Daten); EINE Zeile zur ersten Ebene — `stored`: `Erste Ebene: in gesetzter Reihenfolge.` /
    `Erste Ebene: keine unterscheidenden Positionen gesetzt.` nach den Hinweisen, `position`:
    `Reihenfolge: gesetzte Position, sonst Titel.[ Erste Ebene: …]` direkt nach der Kopfzeile;
    keine davon über einer leeren Liste. Im JSON-Format gibt es KEINEN Textblock zur
    Reihenfolge mehr (Block 0 trägt `root.childrenPositioned`); die Blöcke danach sind wie
    zuvor nur die Hinweise.
  - **Position ist eine ganze Zahl** (`/^-?\d+$/`, im sicheren Bereich); `"0x10"`, `"1e3"`,
    `"1.5"` und Werte jenseits 2^53 zählen als „keine Position".
  - **Zähl-Pool** als reine Funktion `countPool(Tor)`: 0 → 12, 1 → 1, 2 → 1, 8 → 4, 24 → 12;
    nie 0, nie über dem Tor.
  - **`delete-empty-plan` zählt weiter mit `maxItems=1`** — „leer" entscheidet über ein
    LÖSCHEN, und der eine Eintrag ist ein zweiter Zeuge neben `total`
    (`Math.max(total, nodes.length)`); der gemeinsame Zählabruf (`maxItems=0`) hätte den nicht.
  - **`tools/list`:** 234 912 Zeichen (gemessen 2026-11-15), Obergrenze im Test 238 000.
- **S12** Der Zählabruf von `list_collection_tree` fragt mit `maxItems=0` und einer Eigenschaft
  (139 statt 307 ms) und läuft zu 12 statt 8 gleichzeitig: die HÄLFTE des Tors
  (`WLO_UPSTREAM_CONCURRENCY`, Vorgabe 24), höchstens 12 — ein Aufruf soll das Tor, das sich alle
  teilen, nicht füllen, und die Zählabrufe laufen nach dem Baumlauf, also hält der Aufruf dann
  nur diese Hälfte. Physik: 11,37 s → 7,02 s. Gezählt wird weiter über die Liste, nie über die
  Zähler; ein nicht gelesener Abruf markiert den Eintrag wie bisher. **Nicht gebaut:** eine
  Facette (gibt es nicht, siehe Messung), ein breiterer Baumlauf (die 5 s ohne Zahlen sind 145
  Listen zu 8 in festen Gruppen; die Gruppengröße steckt in der Rechnung von `walkCapped` und in
  zwei Tests — eigenes Paket). **Nachtrag 2026-11-15: derselbe Zählabruf jetzt überall, wo nur
  die ZAHL gebraucht wird** — eine Funktion (`countCollectionContents` /
  `countNodeContents`, `services/collection-traversal.ts`) für `list_collection_tree`,
  `browse_collection_tree` (`includeContentCounts`), die Untersammlungen der Übersicht und deren
  `contents` bei `maxContents: 0`. Die Vorschau (`includeContentPreview`) und `contents` mit
  Einträgen lesen weiter die Liste selbst — dort werden die Knoten gebraucht; je Knoten bleibt es
  bei einem Zähl- und einem Vorschau-Abruf. Die Pool-Größen von Baum und Übersicht sind
  unverändert. Ein nicht gelesener Zählabruf markiert den Knoten weiter (`contentsUnread` /
  `contentsRefused`), entfernt ihn nie und liest sich nie als 0.
- **S13** `list_collection_tree` nennt im Kopf `unreadParents` und `refusedParents`: die
  Kennungen ALLER Elternknoten, deren Unterliste in diesem Aufruf nicht (oder ab einer späteren
  Seite nicht) gelesen wurde, in Laufreihenfolge, getrennt nach Ausfall und Verweigerung — die
  Start-Sammlung eingeschlossen (für sie gibt es keinen Eintrag) und Elternknoten, deren Eintrag
  auf einer anderen Seite steht. Höchstens 50 je Liste; darüber nennt `unreadParentsTotal` /
  `refusedParentsTotal` die Zahl. Im Text je ein Satz DIREKT nach dem bestehenden Hinweis, dessen
  Wortlaut bleibt. Nur Kennungen, kein Pfad: das war die Bitte, und der Pfad steht am Eintrag.
  Unverändert: scheitert die Liste der Start-Sammlung ganz, ist das ein Fehler. Ein Elternknoten,
  den der Lauf nie gefragt hat (Seite voll, `walkCapped`), steht in keiner der Listen — dafür
  gibt es kein eigenes Feld, `more` bzw. `walkCapped` sagen es; behauptet wird nur Beobachtetes.
  `browse_collection_tree` hat die Lücke nicht: alle Knoten stehen in EINER Antwort mit ihren
  Marken, und die Liste der Start-Sammlung ist dort eine einzige Abfrage — sie antwortet oder der
  Aufruf ist ein Fehler.

### Nicht gebaut

- **S10** Teilbaum kopieren: vom Team selbst als nachrangig eingestuft; mit S2 und dem
  Baum-Werkzeug geht es bereits.
- Icon, Farbe, Anheften, Kommentare, Bewertungen, Rechte setzen (B3 des Teams).

## Fortschritt

| Paket | Stand |
|---|---|
| P1 | umgesetzt 2026-11-14 (Live-Probe gegen Staging: Physik, 144 Sammlungen über vier Ebenen in 6,4 s) |
| P2 | umgesetzt 2026-11-14 (S3 live gegen Staging bestätigt) |
| P3 | umgesetzt 2026-11-14 (live gegen Staging: Reihenfolge der Inhalte, Umsortieren, Entfernen, nur Leere löschen) |
| P4 | umgesetzt 2026-11-14 (live gegen Staging mit zwei Konten: Umhängen; vorschlagen als Lesender, annehmen durch den Schreibenden) |
| S11–S13 | umgesetzt 2026-11-15 (anonym gegen Staging gemessen: Physik mit Inhaltszahlen 11,37 s → 7,02 s; `order: "position"` am echten Portal gelaufen) |
