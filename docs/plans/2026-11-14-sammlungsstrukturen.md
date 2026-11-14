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

Nicht gemessen: ob jemand mit Schreibrecht an der Sammlung, der KEIN Admin ist, den Status am
Vorschlags-Knoten setzen darf (das Dienstkonto ist Admin), und ob die WLO-Oberfläche die
Vorschläge zeigt.

Vom Team gemessen und übernommen: unvollständige Liste an `/order` → doppelte Positionen;
`…/copy`; die Zähler hinken nach.

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

### Nicht gebaut

- **S10** Teilbaum kopieren: vom Team selbst als nachrangig eingestuft; mit S2 und dem
  Baum-Werkzeug geht es bereits.
- Icon, Farbe, Anheften, Kommentare, Bewertungen, Rechte setzen (B3 des Teams).

## Fortschritt

| Paket | Stand |
|---|---|
| P1 | umgesetzt 2026-11-14 (Live-Probe gegen Staging: Physik, 144 Sammlungen über vier Ebenen in 6,4 s) |
| P2 | umgesetzt 2026-11-14 (S3 live gegen Staging bestätigt) |
| P3 | offen |
| P4 | offen |
