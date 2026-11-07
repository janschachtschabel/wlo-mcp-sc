# BOERDi-Wunschliste — Machbarkeit, Blocker, Phasen (Entwurf + Aufgaben)

Quelle: „MCP-Werkzeuge: Wunschliste" des BOERDi-Teams (Stand 2026-11-06), vom
Nutzer am 2026-11-06 zur Umsetzung übergeben mit dem Auftrag „prüfe, ob das geht
oder ob es Blocker gibt". Jede Aussage unten ist am Code geprüft (Datei genannt)
oder gemessen; wo nicht, steht es dabei.

## Ergebnis in einem Satz

Alles ist baubar bis auf zwei Stellen, an denen das Repository die Wunschform
nicht hergibt (5: exakte Zählung *in einem Teilbaum*; 9: Ablagen wiederfinden,
solange MA-0 ungemessen ist), und sechs Stellen, die eine Entscheidung brauchen,
weil sie gegen eine verbindliche Regel dieses Projekts oder gegen andere Clients
laufen (E1–E6).

## Je Punkt

| # | Werkzeug | Machbar | Befund am Code |
|---|---|---|---|
| 12a | Bestätigung strukturiert | ja | Ein Ort: `previewReply` (`tools/curation-shared.ts`) prägt jeden Schlüssel außer der Stapel-Ablage; `ChangeSet.changes` trägt `old`/`new` je Feld. Kein `outputSchema` an Kuratierwerkzeugen, also kein Schemabruch. |
| 12f | Stapel-Ablage einhängen | ja | `registerCurationBatchTools` existiert, prüft `WLO_BATCH_UPLOAD_ENABLED` selbst (aus = nichts registriert). Werkzeugliste bleibt ohne Schalter unverändert. |
| 4 | `wlo_create_content` + `addToCollectionId` | ja | Der Schlüssel bindet an den Fingerabdruck des ChangeSets — die Aufnahme MUSS in den ChangeSet (wie `action`), sonst wäre sie ungesehen freigegeben. Dubletten-Weg: `findByUrl` blockiert heute; „vorhandenen aufnehmen" ist ein zweiter Vorschau-Zweig. |
| 2 | `find_content_by_url` | ja, mit E6 | `findByUrl` (`services/write/duplicates.ts`) vergleicht nur ohne Groß-/Kleinschreibung und begründet, warum NICHT weiter normalisiert wird (Schrägstrich kann zwei Seiten trennen; ein falsches „existiert schon" blockiert). Für ein LESE-Werkzeug unkritisch, wenn der Treffer sagt, wie er zustande kam (`match: exact\|normalized`) — der Anlege-Pfad bleibt streng. `published` ist nicht definiert (E6). `inCollections` kostet je Treffer einen `/usage`-Abruf. |
| 3 | `resolve_wlo_filters` | ja | `resolveVocab` löst „Klasse 7", „Oberstufe", „Lehrkraft" schon auf (gemessen). Aber: es meldet nicht, WIE es traf — „Arbeitsblat" wird still zu „Arbeitsblatt". `status: exact\|alias\|fuzzy` braucht eine Erweiterung der Auflösung, nicht eine zweite Kopie. |
| 12c | Lizenz nur exakt | ja — **echter Fehler** | gemessen: `resolveLicenseSelection("CC BY NC")` → `CC_BY`, `"cc by nc sa"` → `CC_BY`. Der Überschuss geht in die freiere Richtung — genau die, die `filter-criteria.ts` als schädlich führt. |
| 12d | alle Aliasse | ja | `tools/vocabulary.ts:175` kappt mit `slice(0, 4)`. |
| 1 | `get_collection_overview` | ja | Alle Teile existieren als Dienste (Pfad, Kompendium + `compendium-view`, `services/stats.ts`, Registry-Cache, Kinder, Inhalte); parallel abrufbar. |
| 8 | `get_node_details` eins/viele | ja, E3 | Vertragsänderung an einem bestehenden Werkzeug. |
| 5 | `count_wlo_content_matches` | ja — **ohne exakten Teilbaum** | `pagination.total` von `ngsearch` ist die Repository-Zahl. `withinCollectionId` dagegen: `ngsearch` kann keinen Teilbaum eingrenzen (`virtual:parent_recursive` → 400, gemessen 2026-08-08), und `search_wlo_within_collection` prüft eine Stichprobe von 100 direkten Inhalten. Eine exakte Teilbaum-Zahl gibt das Repository nicht her (E5). |
| 11 | Baum Tiefe 3 | ja | heute `depth` max 2 (`tools/browse.ts:204`); Deckel 300 Knoten ist mit `truncated` vereinbar. Gemessen: Ebene 3 des ganzen Baums ≈ 1 335 — der Deckel ist nötig. |
| 7 | `wlo_add_to_collections` | ja | `wlo_add_to_collection` existiert; ein ChangeSet über alle Paare, Rücklesen je Paar. |
| 6 | `wlo_create_collection_tree` | ja, E4 | `wlo_create_collection` funktioniert live (2026-08-02). 200 Knoten von oben nach unten mit Rücklesen dauern Minuten — das Warten begrenzt der CLIENT, unsichtbar für uns, und ein Abbruch ist laut Regel ein offener Ausgang, kein Fehler. |
| 9 | `wlo_list_my_batches` | **ja, A** (entschieden 06.11.; Manifest zusätzlich in `cm:description`, siehe „P6 — Umsetzung“) | Gemessen mit Testkonto: kein Ordnerrecht → Ablagen liegen FLACH in `-userhome-`; die Suche zeigt sie dem Besitzer sofort. Offen nur die Dateiarten/-größen: Staging lehnt jeden Upload ab (500 `InvalidTypeException … content`, auch ohne unseren Code). |
| 10 | `get_skill_for_task` mit Sammlung | ja, E2 | heute nur unter `WLO_SKILL_TOOL_MODE=one-tool`, als 1:1-Tausch gegen `search_skill`. |
| 12b | `excludeNodeIds` überall | ja | `search_wlo_within_collection` hat keinen (`tools/collections.ts:288`); `get_collection_contents` hat ihn. |
| 12e | `outputFormat` entfernen | **nicht empfohlen**, E1 | |

## Nummern

Dieser Plan nutzt die Nummern des Entwurfs, den der Nutzer übergeben hat; das
BOERDi-Team führt sie für den Austausch weiter. Auf der veröffentlichten Seite
heißen sie anders:

| hier | veröffentlicht | Werkzeug |
|---|---|---|
| 4 | 8 | `wlo_create_content` + `addToCollectionId` |
| 5 | 4 | `count_wlo_content_matches` |
| 6 | 9 | `wlo_create_collection_tree` |
| 7 | 10 | `wlo_add_to_collections` |
| 8 | 5 | `get_node_details` eins/viele |
| 9 | 11 | `wlo_list_my_batches` |
| 10 | 6 | `get_skill_for_task` / Skill zur Aufgabe |
| 11 | 7 | Baum Tiefe 3 |

## Entscheidungen (Stand 2026-11-06, Rückmeldung des BOERDi-Teams)

- **E1 — entschieden:** `outputFormat` bleibt; der Chatbot ignoriert ihn.
- **E2 — entschieden:** kein `get_skill_for_task` in jedem Modus, sondern
  `get_skill_registry` + `task`. Bedingungen: die Antwort trägt die ANLEITUNG des
  gewählten Skills mit (sonst bleibt es bei zwei Aufrufen) und sagt ausdrücklich
  „keiner passt", wenn keiner passt.
- **E3 — entschieden:** `get_node_details` nimmt `nodeIds`; dann ist die Antwort
  IMMER `{results, missing}`. Mit `nodeId` bleibt die alte Form.
  `get_nodes_details` bleibt vorerst mit Verweis.
- **E4 — ENTSCHIEDEN 2026-11-06: B** (Antwort des BOERDi-Teams, vom Nutzer weitergegeben; Entwurf siehe „P5 — Entwurf“ unten). Ursprüngliche Einordnung: (Schreibvorgang auf
  Staging, deshalb sein Wort). Bedingungen des Teams für den Fortsetzungsschlüssel:
  gebunden an den Fingerabdruck des GANZEN bestätigten Plans (Elternsammlung, Baum,
  `onExisting`); jeder Schlüssel gilt einmal, die nächste Antwort bringt bei Bedarf
  einen neuen; Gesamtfrist ~30 min ab der ursprünglichen Bestätigung, die Kette
  verlängert sich nicht von selbst; vor jeder Fortsetzung prüft der Server, dass nur
  noch Teile des Plans fehlen — ist die Elternsammlung weg oder das Ziel geändert,
  kommt eine neue Vorschau statt einer Fortsetzung; nach jeder Anlage Rücklesen, die
  letzte Antwort listet angelegt / schon vorhanden / gescheitert; nach Ablauf bleibt
  „derselbe Aufruf mit `merge` und neuer Vorschau"; dieselbe Mechanik für 7.
  Messung (ebenfalls erst mit Freigabe des Nutzers): nur Staging, unter einer
  eigenen Test-Elternsammlung „BOERDi-Messung 2026-11-…", danach löschen; berichten
  Median und Maximum für Anlegen + Rücklesen, nacheinander und mit 4 parallel.
  Ursprüngliche Einordnung: 50 Knoten lösen es nicht: der Chatbot bricht jeden
  MCP-Aufruf nach 60 s ab (`MCP_CALL_TIMEOUT_S`); bei 4–8 s je Anlage
  (gemessen für DATENSÄTZE, nicht für Sammlungen) schafft ein Aufruf
  nacheinander 8–12 Knoten. Vorschlag des Teams: Zeitbudget (~40 s) statt
  Knotenzahl; Geschwister begrenzt parallel (z. B. 4); EINE Bestätigung für den
  ganzen Plan; ist das Budget aufgebraucht, `complete: false` mit `remaining` und
  einem `continuationToken` — an denselben Plan gebunden, einmalig, 10 min,
  setzt ohne neue Vorschau fort. Dieselbe Mechanik für 7. Vor dem Bau: die
  Anlagedauer einer SAMMLUNG messen (Live-Schreibvorgang auf Staging, mit
  Freigabe). Mit der Zwei-Schritt-Regel verträglich, solange der
  Fortsetzungsschlüssel an den Fingerabdruck des bestätigten Plans gebunden ist
  und nichts tun kann, was der Plan nicht enthält — er verlängert eine
  Bestätigung, er erteilt keine neue.
- **E5 — entschieden:** `withinCollectionId` entfällt. Teilbaum-Mengen zeigt
  `browse_collection_tree` mit `includeContentCounts`; eine Näherung würde in
  einer Lückenanzeige als echte Zahl gelesen.
- **E6 — entschieden:** englische Bezeichner — `missing: [{part, code}]`, Codes
  `not_found`, `not_a_collection`, `forbidden`, `timeout`. `published` entfällt.
  `match: exact | normalized` (der Chatbot wertet `exact` als Dublette und fragt
  bei `normalized` nach). `inCollections` nur auf Wunsch (`includeCollections`,
  Vorgabe aus) — je Treffer ein `/usage`-Abruf.

## Ergänzungen zu P2 aus derselben Rückmeldung

- 3: `status` je Wert (`exact`/`alias`/`fuzzy`/`unknown`), und der Hinweis auf
  eine UNSCHARFE Auflösung auch in den Suchwerkzeugen in `_queryMeta` — dort wird
  „Arbeitsblat" heute ebenso still übernommen.
- 4: Scheitert die Aufnahme nach dem Anlegen, `collection.status: failed` mit
  Code statt Gesamtfehler; der Datensatz bleibt.

## Ursprüngliche Entscheidungsfragen (Entwurf)


- **E1 — `outputFormat` bleibt (Empfehlung).** Die Wunschliste will den Parameter
  entfernen. Andere Clients (ChatGPT, Claude) lesen Markdown, und mindestens einer
  reicht nur Block 0 an das Modell weiter (2026-08-19). `structuredContent` ist in
  beiden Formen schon gleich — der Chatbot kann den Parameter einfach ignorieren.
- **E2 — `get_skill_for_task` in jedem Modus?** Kehrt die Regel um, dass der
  Modus-Tausch 1:1 ist und die Werkzeugzahl nicht ändert (+1 im Standardmodus).
  Alternative ohne Regelbruch: `get_skill_registry` bekommt `task` und liefert den
  passenden freigegebenen Skill gleich mit.
- **E3 — `get_nodes_details` entfernen?** Empfehlung: `get_node_details` nimmt
  `nodeIds` an, `get_nodes_details` bleibt mit Verweis; Entfernen später.
- **E4 — Größe eines Baums je Aufruf.** Empfehlung 50 statt 200 Knoten; mit
  `onExisting: merge` ist ein zweiter Aufruf der Fortsetzung, nicht eine Dublette.
- **E5 — Zählen im Teilbaum.** Weglassen, oder begrenzter Durchlauf mit
  `approximate: true` und genannter Grenze. Eine exakte Zahl gibt es nicht.
- **E6 — Sprache der Schnittstelle und `published`.** Die Wunschliste nennt
  Felder und Codes deutsch (`fehlend`, `teil`, `nicht_gefunden`); die
  Projektregel hält Bezeichner englisch. Empfehlung: `missing: [{part, code}]`,
  Codes `not_found`, `not_a_collection`, `forbidden`, `timeout` — Text für
  Menschen bleibt deutsch. `published` braucht eine Definition (Workflow-Status?
  anonym lesbar?) oder fällt weg.

## Phasen

Jede Phase beginnt mit `/better-coding-workflow`, endet mit Review, STATUS-Eintrag
und Halt (Paket-Protokoll).

- **P1 — 12a, 12f** (entscheidungsfrei; schaltet den Upload frei, macht jede
  Bestätigung maschinenlesbar). **Umgesetzt 2026-11-06**, siehe STATUS.
  Nachgereicht am selben Tag (Rückmeldung): `preview.tool`, `oldLabels`/`newLabels`,
  `{confirm: null, unchanged: true}`.
- **P2 — 12c, 12d, 3, 2, 4** (Erschließen-Weg). E6 entschieden, nichts wartet. **Umgesetzt 2026-11-06**, siehe STATUS.
- **P3 — 1, 8** (häufigste Lese-Ketten). **Umgesetzt 2026-11-06**, siehe STATUS.
- **P4 — 5, 11.** 5 ohne `withinCollectionId` (E5). **Umgesetzt 2026-11-06**, siehe STATUS.
- **P5 — 7, 6.** Beide warten auf E4 und die Messung der Sammlungs-Anlage.
- **P6 — 12b, 10, 9.** 10 als `get_skill_registry` + `task` (E2); 9 wartet auf die MA-0-Messung mit Testkonto. **Umgesetzt 2026-11-06: 12b und 10; 9 blockiert** (siehe unten).

## P6 — Umsetzung (2026-11-06)

**12b:** `search_wlo_within_collection` nimmt `excludeNodeIds` (≤ 200), verglichen
mit der gelisteten id UND dem Original einer Verknüpfung, entfernt VOR dem
Blättern — `total` ist, was noch kommt.

**10 (E2):** `get_skill_registry` nimmt `task`. Kandidaten sind NUR die
freigegebenen Einträge der (ggf. verengten) Registry, samt der nicht lesbaren
(`unresolved`, nach Titel). Gerangiert mit `rankBm25` (Titel, Beschreibung,
Keywords, Kontext). Gemessen an der echten Optik-Registry: die reine Rangfolge
wählte bei natürlichen Formulierungen 2 von 4 Mal den FALSCHEN Skill mit voller
Überzeugung („Wie vollständig ist diese Sammlung?“ traf nur „Sammlung“, das alle
vier tragen: 0,51/0,48/0,46). Deshalb kommt eine Anleitung nur bei EINDEUTIGER
Wahl mit: der beste Treffer trägt ein Wort, das höchstens die Hälfte der
Kandidaten trägt, und führt mit ≥ 1,5 × vor dem zweiten. Sonst
`match: ambiguous` mit den Kandidaten (das Modell wählt), `none` ohne
Wortübereinstimmung, `unreadable` für eine eindeutige, nicht lesbare Wahl — nie
ein Ausweichen auf den nächsten (der war nicht eindeutig). Restfehler, gemessen:
„Soll dieses Material in die Sammlung aufgenommen werden?“ wählt „Sprachliche
Qualität“ (das Wort „Material“ steht nur dort) — die Grenze jedes Wortabgleichs;
die Antwort nennt den Gatekeeper daneben, und die Beschreibung sagt dem Modell,
die Wahl gegen die Kandidaten zu prüfen. Live 1,1–2,0 s.

**9 — blockiert, gemessen.** Der Wunsch verlangt `vorgang.json` als Grundlage.
Dieser Server kann die Bytes einer PRIVATEN Datei mit Basic-Anmeldung nicht lesen
(Testkonto, eigene Datei mit 3 639 Bytes): `eduservlet/download?nodeId=` → 403
(das ist auf Staging auch die gemeldete `downloadUrl` — nicht signiert),
`GET …/content` → 405, `…/textContent` → 200 leer (Markdown/JSON wird nicht
indiziert). Anonym ist die Datei korrekt gesperrt. Optionen (Entscheidung beim
Nutzer bzw. BOERDi-Team): **A** die Kennzahlen der Ablage zusätzlich als
Metadaten am `vorgang.json`-Knoten speichern (über REST lesbar) — ändert MA-4;
**B** Ablagen über Metadaten der abgelegten Datensätze wiederfinden (eine Marke
je Stapel) statt über das Manifest; **C** einen authentifizierten Download-Weg
messen (z. B. mit Ticket) — nur mit Ticket-Anmeldung denkbar, für Basic nicht.
Zusätzlich gilt: Staging speichert derzeit gar keine Datei-Inhalte (Regression).

**9 — entschieden: A (Nutzer, 2026-11-06), Vor-Messung und Entwurf.** Gemessen mit
dem Testkonto an eigenen Datensätzen (alle gelöscht): eine Eigenschaft, die das
Modell NICHT kennt (`ccm:wlo_batch_manifest`), behält das Repository nicht —
`PUT …/metadata` → 400, `POST …/property` → **200 und still verworfen** (ein
weiterer „200, aber nichts gespeichert“-Fall). Modell-Eigenschaften behalten den
Wert unverändert, auch 53 950 Zeichen (200 Einträge): `cclom:general_description`,
`cm:description`, `ccm:oeh_collection_compendium_text`. Gewählt: **`cm:description`**
— `cclom:general_description` ist die sichtbare Beschreibung jedes Treffers, und
`ccm:oeh_collection_compendium_text` liest unser eigener Code als Kompendium;
`cm:description` liest der Formatter bei Datensätzen nicht. Anonym nicht lesbar (403).

Entwurf:
- **MA-4:** beim Ablegen von `vorgang.json` steht dasselbe Manifest-Objekt
  zusätzlich in `cm:description` des Datensatzes, zurückgelesen (nicht
  übernommen → Manifest `unverified`). Die Vorschau sagt es. Unabhängig vom
  Datei-Inhalt — funktioniert also auch, solange Staging Inhalte verwirft.
- **`wlo_list_my_batches {limit 1–20 = 10, nodeId?}`**, nur mit
  `WLO_BATCH_UPLOAD_ENABLED`, nur eigene Anmeldung (`registerCurationTool` +
  dieselbe Personen-Prüfung wie die Stapel-Werkzeuge; sonst `login_required`).
  Finden über die KNOTEN-Ablage des eigenen Bereichs (`-userhome-`: Dateien
  direkt, dazu je Unterordner eine Ebene tief, gedeckelt und offengelegt) — nie
  über den Suchindex, denn ein „keine Ablagen“ darf nicht auf dem Index beruhen.
  Erkennen am Namen `vorgang*.json`; `cm:description` nur für die gezeigten
  lesen. Antwort `{batches: [{manifestNodeId, folderNodeId, title, createdAt,
  status: ok|unreadable, counts: {stored, dropped, unverified, failed, open}}]}`,
  neueste zuerst; mit `nodeId` `{batch: {…, entries: [{index, title, nodeId,
  status}]}}`. Englische Bezeichner (E6): `unreadable` statt „unlesbar“,
  `login_required` statt „nur_angemeldet“, `open` für „offen“.


## P1 — Aufgaben

1. Test zuerst: eine Vorschau trägt `structuredContent.confirm = {token,
   expiresAt, preview: {action, target, fields: [{name, old, new}]}}`, und der
   Schlüssel darin ist derselbe wie im Text. Rot.
2. `previewReply` liefert ihn; `mintToken` gibt die Ablaufzeit mit heraus, damit
   sie nicht ein zweites Mal ausgerechnet wird. Grün.
3. Test zuerst: mit `WLO_BATCH_UPLOAD_ENABLED=1` listet der Server die drei
   Stapel-Werkzeuge, ohne ihn nicht. Rot.
4. `registerCurationBatchTools(server, challenge)` in `server.ts`. Grün.
5. Doku (MCP-REFERENZ + HTML-Artefakt, README) und STATUS.

## P3 — Entwurf (2026-11-06)

**1 `get_collection_overview`** — `services/collection-overview.ts` (Ablauf),
`tools/collection-overview.ts` (Schema, Darstellung). Bausteine, alle vorhanden:
`readNodeMetadata` (Kopf; liest `-all-`, also auch den Kompendiumstext — das
Inhaltsverzeichnis kostet KEINEN Abruf), `readNodeBreadcrumb`, `getCollectionStats`,
`ensureRegistryFor` + `describeEntries` (erste 3 Beschreibungen, wie jede
Sammlungsantwort), `buildCollectionTree({depth:1, includeContentCounts:true})`,
`getCollectionContents(files)`. Ablauf: Kopf lesen (404 → `not_found`, 401/403 →
`forbidden`, kein `ccm:map` → `not_a_collection` — alles als
`{error:{code,message}}` mit `isError`); eine Verknüpfungs-id wird über
`originalId` aufs Original aufgelöst; dann alle Teile PARALLEL
(`Promise.allSettled`), ein gescheiterter Teil steht in
`missing: [{part, code}]` (`timeout`/`forbidden`/`upstream_error`), der Rest kommt.
Kompendium nur als `{hasText, chars, toc: [{title, depth}], headings, tocDepthLimited?}` —
`depth` statt reiner Strings, weil die Gliederung sonst flach wird; nur Tiefe 0–1,
weil das volle Verzeichnis gemessen zu groß ist (Optik 2026-11-06: 242 Überschriften,
19 KB JSON gegen 1,3 KB für zwei Ebenen); der Text weiter über `get_compendium_text`. Nicht gebaut: `contentFields` (das Werkzeug liefert je
Inhalt nodeId, Titel, URL, Typ, Lizenz — schmal genug; nachrüstbar).

**8 `get_node_details` eins/viele** (E3): `nodeIds` (1–50) neben `nodeId`, genau
eines von beiden. Mit `nodeIds` IMMER eine Liste: `structuredContent
{total, count, results, missing}`, die Anreicherungen (`textContent`, `parents`,
`accessInfo`, `qualityInfo`) je Ergebnis im Schema deklariert. Der Ladekern zieht
aus dem Werkzeug in `services/node-details.ts` um und wird von
`get_nodes_details` (bleibt, mit Verweis) und `get_node_details` geteilt — eine
Regel für Deckel (`TEXT_ENRICH_MAX`) und Fehlschläge. `includeRaw` und
`skillContext` gelten nur mit `nodeId`.


## P5 — Entwurf (E4 = B, entschieden 2026-11-06)

**Warum B (Antwort des BOERDi-Teams):** Der Chatbot bestätigt NIE selbst — die
Freigabe der Person löst genau einen gemerkten Aufruf aus. A (viele
Selbstbestätigungen) und C (Folgevorschau selbst bestätigen) bräuchten genau den
Selbstbestätigungsweg, den sie nicht wollen; für andere Clients ist B ohnehin der
einzige saubere Weg. C bleibt nur Rückfall — und dann bestätigt wieder die PERSON.

**Rahmen des Chatbots:** Bäume typisch 30–120 Knoten, höchstens 250, Tiefe 4,
höchstens 15 Kinder je Knoten; `MCP_CALL_TIMEOUT_S` = 60 (einstellbar, Ingress
120 s) — Zeitbudget je Aufruf bleibt **40 s**. ~~Gemessen (06.11.): 0,35 s je
Sammlung bei 4 parallel~~ — **widerlegt am selben Tag:** das Messskript lief über
`mapPool`, das Fehlschläge als `null` verschluckt, und zählte nur, was durchkam.
Nachgemessen: Geschwister GLEICHZEITIG unter derselben Elternsammlung → HTTP 500
`ConcurrencyFailureException: Acl…` in 17 von 24 Fällen, und JEDE davon existiert
danach; unter verschiedenen Eltern 12 von 12 gelungen; nacheinander Median 579 ms,
Maximum 822 ms je Anlage samt Rücklesen. Live mit der Korrektur (Anlagen je
Elternsammlung nacheinander): 40 Knoten in **einem** Aufruf, 15,8 s — 250 Knoten
also rund drei Aufrufe. Fortschritt nur zwischen Aufrufen, nicht Knoten für Knoten.

**Ein Baustein für 6 und 7:** `services/write/plan-runner.ts` — Planspeicher im
Arbeitsspeicher (eine Instanz, wie die Bestätigungsschlüssel), budgetierter
Ausführer (Zeitbudget 40 s, Geschwister 4 parallel, von oben nach unten),
Schlüssel-Logik. 6 (`wlo_create_collection_tree`) und 7 (`wlo_add_to_collections`)
liefern nur ihren Plan und ihren Einzelschritt.

**Ablauf (6):**
1. Ohne Schlüssel: Vorschau. Liest vorhandene Kinder entlang des Baums (für
   `merge`: gleicher Titel, Groß/Klein und Rand-Leerzeichen egal → `exists`),
   liefert JEDEN Knoten mit Aktion (`create`/`exists`) — der Schlüssel bindet an
   den Fingerabdruck des ganzen Plans (Elternsammlung, normalisierter Baum,
   `onExisting`, Identität), Regel „alles Gesendete steht in der Vorschau“.
   `structuredContent.confirm` wie bei jedem Schreibwerkzeug (12a).
2. Mit `confirmToken`: Plan wird gespeichert (`planId`, Identität, Knotenzustand,
   Gesamtfrist **30 min** ab Bestätigung, verlängert sich nicht). Ausführung bis
   zum Budget; jede Anlage wird zurückgelesen (zählt erst dann als `created`); ein
   gescheiterter Knoten überspringt seinen Teilbaum (`parent_failed`).
3. Antwort (englische Bezeichner, E6 — die Wünsche „angelegt/gesamt" werden zu):
   `complete`, `progress: {done, total}`, `nodes: [{path, nodeId?, status:
   created|existing|failed|pending, code?}]` (Zuordnung Plan-Knoten → Knoten-ID),
   `continuationToken` solange `complete: false`.
4. **Wiederholbarkeit (Anforderung 5 + letzter Punkt):** Ein Schlüssel — der
   Bestätigungs- wie der Fortsetzungsschlüssel — darf von DERSELBEN Identität
   erneut vorgelegt werden: läuft der Plan noch nicht, macht der Aufruf weiter;
   ist er fertig, kommt dasselbe Ergebnis noch einmal. Nie doppelt angelegt, weil
   jeder Knoten seinen Zustand im Plan trägt und vor dem Anlegen gegen die
   Kinderliste geprüft wird. Damit kostet eine verlorene Antwort (Client-Abbruch)
   nichts: der zweite Aufruf mit demselben Schlüssel setzt fort. Ein zweiter
   Aufruf, während der erste noch läuft, wartet nicht parallel, sondern bekommt
   den aktuellen Stand mit `inProgress: true`.
5. Eigene Fehlercodes: `plan_expired` (unbekannt — nach Neustart — oder nach 30 min)
   und `plan_mismatch` (Schlüssel einer anderen Identität oder anderer Argumente).
   „Schon eingelöst" ist KEIN Fehler (siehe 4). Bei `plan_expired` ist der Weg C:
   derselbe Aufruf mit `merge`, neue Vorschau, die PERSON bestätigt.

**Ablauf (7):** derselbe Läufer über Paare `{nodeId, collectionId}` (≤ 200);
Verknüpfungs-ids aufs Original; schon enthalten → `already`; Einzelfehler halten
den Rest nicht auf. **Live derzeit nicht prüfbar** (Staging-Regression: jede
Aufnahme → 500, siehe STATUS) — Offline-Tests ja, Live-Nachweis nach Behebung.

**Grenzen im Schema:** 6: ≤ 250 Knoten, Tiefe ≤ 4, ≤ 15 Kinder je Knoten, Titel
1–200 Zeichen. 7: ≤ 200 Paare.

**Umsetzung (06.11.) — Abweichungen vom Entwurf, und warum:**
- `onExisting` kennt nur `merge` und `fail`; `skip` entfällt — es wäre `merge`
  ohne Zuordnung der Kennung, und genau die will der Chatbot.
- 7 antwortet mit `pairs [{nodeId, collectionId, filedId?, status, code?}]` statt
  `nodes`: ein Paar ist kein Knoten. `filedId` statt `originalId`, weil
  `tests/shared-rule-discipline.test.ts` den Bezeichner `originalId` im Schreibpfad
  verbietet (die Auflösung läuft über `resolveWriteTarget`).
- Weitere Codes: `exists` (Baum mit `fail`, Knoten aufgetaucht), `not_checked`
  (Unterordner nicht lesbar — bleibt offen, nächster Aufruf versucht erneut),
  `timeout` bleibt bei BEIDEN offen (`pending`) und wird vor dem nächsten Senden
  nachgeprüft.
- Höchstens 5 Pläne je Anmeldung (wie `confirm.ts`: Platz nur aus den EIGENEN).
- Anlagen unter derselben Elternsammlung laufen nacheinander (Messung oben); ein
  abgelehntes Anlegen wird nachgeschlagen, bevor es `failed` heißt — gefunden
  ist es `unverified` mit Kennung.

**Live-Test (Freigabe des Nutzers 06.11.: nur eigene Daten, danach aufräumen):**
Baum mit ~40 Knoten unter einer eigenen Test-Elternsammlung `BOERDi-Messung …`;
ein zweiter Lauf mit `merge` legt nichts doppelt an; Abbruch simulieren (kleines
Budget), Fortsetzung mit demselben Schlüssel; danach alles löschen (nur ids dieses
Laufs, Titelpräfix geprüft).
