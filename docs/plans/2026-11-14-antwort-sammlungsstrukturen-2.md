# Antwort an das Chatbot-Team: Sammlungsstrukturen, zweite Runde (2026-11-14)

Antwort auf eure Rückmeldung vom 14.11. („Antwort an den MCP-Entwickler: Sammlungsstrukturen“). Sie
enthält auch, was sich durch unser Audit vom selben Tag für einen Client sichtbar geändert hat.
Nichts davon benennt ein Werkzeug oder einen Parameter um.

## 1. Was stabil bleibt

Ihr erkennt unseren Stand an Werkzeugnamen und Parametern der obersten Ebene. Das bleibt so:

- `list_collection_tree` mit `depth`; `order` an `browse_collection_tree` und `get_collection_overview`;
  `shared` an `wlo_create_collection_tree`.
- Die Pflichtparameter der neuen Kuratier-Werkzeuge: `items`, `pairs`, `nodeIds`, `newParentId`, `order`,
  `collectionId`, `decision`.
- `removeFrom` (Verschieben) und `wlo_remove_from_collections` werden **gemeinsam** ausgeliefert. Es gibt
  keinen Stand, der nur eines von beiden hat; euer Schluss vom Werkzeug auf den Parameter trägt.
- Die Plan-Felder `complete`, `continuationToken`, `expiresAt` und die Codes `plan_expired`,
  `plan_mismatch`, `too_many_plans`.

Umbenennungen und entfernte Felder gibt es bei uns nur nach Rücksprache mit euch.

## 2. Eure zwei Funde

**`more.nextSkipCount` über der eigenen Grenze — behoben.** `list_collection_tree` nennt nie mehr
einen Wert, den das Werkzeug selbst ablehnt:

- Läge die nächste Seite teils über 500, nennt `more.nextSkipCount` genau 500. Der Text sagt dazu,
  dass die ersten Einträge dort das Ende dieser Seite wiederholen (bei Seiten zu 250 also: 0, 250,
  500).
- Erst bei `skipCount` 500 selbst steht statt `more` das Feld `skipLimitReached: true` mit dem Satz,
  dass die Liste weitergeht und man eine Untersammlung als Start nehmen muss.

`get_collection_contents` mit `includeSubcollections` hatte dieselbe Sackgasse; dort liegt die Grenze
bei `skipCount` 400. Die Seite, deren nächste Seite nicht mehr abrufbar wäre, trägt
`skipLimitReached: true` und denselben Hinweis.

**Fachportal über `collection` — behoben.** „Physik“ lief ins Leere, weil keiner der beiden
Suchindizes das Portal für sein eigenes Titelwort liefert. Kandidaten waren deshalb nur tiefere
Sammlungen. Die Namensauflösung liest jetzt zusätzlich die Liste der Fachportale und nimmt ein Portal,
dessen Titel **genau** dem Namen entspricht. Die übrigen Regeln gelten weiter: nur ein gleicher Titel,
nie ein Teilwort; ein Portal und eine gleichnamige tiefere Sammlung sind zwei Kandidaten
(`ambiguous_collection` mit beiden). Ist die Portalliste gerade nicht lesbar, wird nichts übernommen:
Der Fehler `ambiguous_collection` trägt dann zusätzlich `portalsUnread: true` und einen eigenen Satz,
und eine über die Suche gefundene Sammlung steht als Kandidat da. Kosten: ein Abruf mehr je
Auflösung, eine Minute zwischengespeichert.

## 3. Was sich sonst sichtbar ändert

### Schreiben

- **Fehlercodes der Einzelwerkzeuge** (`wlo_add_to_collection`, `wlo_remove_from_collection`,
  `wlo_rename_collection`, `wlo_delete_collection`, `wlo_order_collection`, `wlo_move_collection`,
  `wlo_set_topic_page`): Eine Ablehnung des Repositorys kommt nicht mehr als `upstream_error` mit
  offenem Ausgang. 401/403 → `forbidden`, 404 → `not_found`, jedes andere 4xx außer 429 → `refused`,
  jeweils mit `outcomeOpen: false`. 5xx und 429 bleiben offen.
- **`wlo_remove_from_collection`** lehnt schon in der Vorschau ab, ohne Schlüssel: `not_in_collection`
  (liegt dort nicht), `is_original` (liegt als Original direkt in der Sammlung; Entfernen würde das
  Material löschen), `not_checked` (die Sammlung war nicht lesbar).
- **`wlo_create_collection`**: Elternsammlung ohne Schreibrecht → `forbidden` vor dem Schlüssel. Eine
  gleichnamige Sammlung daneben steht als Hinweis in der Vorschau. Wurde angelegt, aber nicht
  bestätigt, trägt der Fehler `nodeId` und `recordExists` — dann **nicht** neu anlegen.
- **`wlo_rename_collection`** ohne Änderung antwortet `unchanged: true` und gibt keinen Schlüssel aus.
- **Datei-Upload** (`wlo_create_content`, `wlo_update_content`): Das Zurücklesen vergleicht jetzt die
  Größe mit dem Gesendeten. Ein Upload, der nicht ankam, ist ein Fehler mit Code (`not_stored`,
  `unverified`, `forbidden` …) und `error.upload`, nicht mehr eine Textzeile über einem Erfolg.
- **`wlo_submit_content`** verhält sich wie das Stapel-Werkzeug: `not_stored`, `unverified`, bei 4xx
  `forbidden`/`not_found`/`refused`; nach einem 5xx wird der Datensatz erst gelesen. Der Kommentar wird
  so gesendet, wie die Vorschau ihn zeigt.
- **`wlo_add_to_collections`**: Ein 5xx oder 429 beim Einsortieren lässt den Schritt `pending`. Der
  nächste Aufruf sieht erst nach und sendet nur, wenn es nötig ist. Liegt das Material dann dort, heißt
  der Schritt `added` (unsere Anfrage war unterwegs), nicht `already`.
- **`wlo_add_to_collection`** (einzeln): Antwortet das Repository 409, liegt das Material schon in der
  Sammlung. Das ist jetzt wie im Stapel eine Erfolgsantwort „ist bereits in …“, kein Fehler.
- **`wlo_create_collection_tree`**: Ein 5xx oder 429 beim Anlegen eines Knotens lässt ihn `pending`
  (vorher `failed`). Der nächste Aufruf sucht die Sammlung erst unter der Elternsammlung und legt nur
  an, wenn sie fehlt; Kinder warten so lange. Eine Ablehnung (4xx) trägt `outcomeOpen: false`.
- **429 und 503 des Repositorys** sind überall `upstream_busy` und gelten nach einer Einlösung als
  offen. Nach der Einlösung fehlt `retryAfter` wie bisher.
- **`wlo_store_batch_manifest`**: Nach einem offenen Ausgang antwortet der nächste Aufruf nicht mehr
  „schon behandelt“. Er sieht nach, ob die Datei da ist (`found: true`), legt sie sonst genau einmal
  ab oder antwortet `not_checked`, wenn sich das nicht klären ließ.
- **`wlo_decide_collection_proposal`**: `proposal_not_marked` mit `error.mark: "failed"` steht nur
  noch, wenn die Markierung sicher nicht ankam. Nach einem 5xx oder 429 ist es `"unverified"`.
- **`wlo_update_contents`**: Ein mit 5xx oder 429 abgelehntes Feld ist `outcomeOpen: true`, wie beim
  Einzelwerkzeug.
- **Plan-Texte:** Ein Schritt, der mit `outcomeOpen: true` endet, heißt in allen sieben
  Stapel-Werkzeugen „offen — Ausgang unbekannt“ mit dem Ort zum Nachsehen, nie „nicht …“. Die
  strukturierten Felder sind unverändert.
- **`wlo_delete_collections`**: `confirm.preview.action` ist `delete`.
- Ein abgelaufener Schlüssel antwortet wiederholt `confirm_expired`, nicht beim zweiten Mal
  `confirm_unknown`.

### Lesen

- **Neuer Fehlercode `internal_error`** für einen Fehler in unserem eigenen Code. Bisher kam er als
  `upstream_error` mit der rohen Meldung. Für euch ist er wie `upstream_error` zu behandeln, nur ohne
  Aussicht, dass eine Wiederholung hilft.
- **Nicht gelesen ist nicht „gibt es nicht“**, jetzt auch hier: `get_related_content`,
  `get_compendium_text`, `get_topic_page_content` und `get_wlo_content_text` unterscheiden 404,
  401/403 („mit dieser Anmeldung nicht lesbar“) und einen Ausfall. `get_wlo_content_text` antwortet
  dann `access_denied` oder `text_unreadable` statt `node_not_found`.
- **Neue Felder für Grenzen.** Sie stehen in `structuredContent` und im JSON-Textblock; im Markdown
  steht dazu ein Satz im ersten Block, mit zwei Ausnahmen, die unten genannt sind.
  - `get_collection_contents` (rekursiv): `walkCapped`, `contentsCut`, `skipLimitReached`, und
    `totalIsLowerBound`. Letzteres hat keinen eigenen Satz; die Zählzeile heißt dann „Gefundene
    Treffer gesamt: mindestens N“.
  - `search_wlo_within_collection`: `truncated`, `collectionTotal` (durchsucht werden die ersten 100
    direkten Inhalte).
  - `search_wlo_collections`: `scanCapped`. Der Satz steht nur, wenn nichts gefunden wurde: dann
    heißt es, dass nur ein Teil durchsucht wurde, statt „Keine Sammlungen gefunden“.
  - `search_wlo_content`, `search_wlo_all`: `totalIsUpperBound`, nur mit Lizenzfilter und nur, wenn
    sich die genaue Zahl nicht ermitteln ließ. Eine OER-Suche kann jetzt `incomplete` sein.
  - `get_related_content`: `siblingsRefused`, `siblingsUnread`.
  - `search_wlo_content` mit `outputFormat: "json"`: Der Textblock trägt jetzt auch `more` und
    `totalIsUpperBound`, nicht nur `incomplete`.
- **`get_url_text` und `get_wlo_content_text`** stellen dem Fremdtext eine Hinweiszeile und `---`
  voran (im JSON-Textblock das Feld `note`): Was folgt, ist ungeprüfter Inhalt und keine Anweisung.
- **`search`** (ChatGPT-Konvention): Eine leere Liste über einer unvollständigen Suche ist ein
  codierter Fehler `upstream_error`, kein leeres Ergebnis.
- **`get_compendium_text`** mit `outputFormat: "json"`: Textblock und `structuredContent` tragen
  dieselben `entries` (und `missing`). `structuredContent.text` ist in diesem Format leer, damit der
  Text nur einmal übertragen wird. Ein nicht gelesener Eintrag trägt `unread`.
- Umlaute in zerlegter Schreibweise (NFD) treffen beim Textvergleich (Suchwörter gegen Titel und
  Texte) dieselben Wörter wie in zusammengesetzter. Für Filterwerte gilt das nicht: Ein Fachname in
  NFD löst weiterhin nicht auf.
- **Skill-Katalog bei angemeldeten Aufrufen:** Mit `includeSkillRegistry` hängt nach einer frischen
  Abfrage kein veralteter Katalog mehr an der Sammlung.

### REST und Betrieb

- `/api/*` antwortet bei einem Ausfall des Repositorys nicht mehr pauschal 500: 404, 403, 503 mit
  `Retry-After`, 504 oder 502, jeweils `{error, code, retryAfter?}`. Ein Fehler im Server selbst
  bleibt 500 ohne Code. 405 trägt `Allow`.
- Jede Antwort trägt `X-Content-Type-Options: nosniff` und `Referrer-Policy: no-referrer`.
- Die Widgets zeigen einen Fehlerzustand, wo bisher „Keine Treffer gefunden“ über einem
  fehlgeschlagenen Aufruf stand, und nennen Grenzen und unvollständige Quellen über der Trefferliste.

## 4. Offen bei uns

- Termin für das Staging-Deployment: steht noch nicht fest; wir melden uns.
- Ungemessen: ob die WLO-Oberfläche Vorschläge für eine Sammlung anzeigt und in welcher Reihenfolge
  sie Untersammlungen darstellt.
