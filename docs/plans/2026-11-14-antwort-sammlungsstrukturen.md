# Antwort an das Chatbot-Team: Sammlungsstrukturen anlegen und pflegen

Stand 14.11.2026, zu euren Wünschen S1 bis S10 vom selben Tag. Der bereitgestellte Server
läuft weiter auf dem alten Stand; alles hier ist im Repository (`main`) und kommt mit dem
nächsten Deploy.

## Kurzfassung

Neun der zehn Wünsche sind gebaut, S10 (Teilbaum kopieren) nicht. Alles ist additiv: kein
bestehendes Werkzeug hat eine andere Vorgabe bekommen. Dazu gekommen sind ein Lesewerkzeug
und sieben Kuratier-Werkzeuge; der Server führt jetzt 34 lesende und 26 schreibende (60, mit
Stapel-Ablage 64).

| Nr. | Wunsch | Umgesetzt als |
|---|---|---|
| S1 | Reihenfolge lesen | `order: "stored"` an `browse_collection_tree` und `get_collection_overview`; `list_collection_tree` liefert immer die gespeicherte Reihenfolge |
| S1 | Reihenfolge setzen | `wlo_order_collection`; `wlo_create_collection_tree` setzt die Reihenfolge, die es anlegt |
| S2 | Baum in voller Tiefe lesen | neues Lesewerkzeug `list_collection_tree` (flache Liste mit Pfad, Tiefe 4, in Seiten) |
| S3 | Fach, Stufe, Schlagworte im Baum | `discipline`, `educationalContext`, `keywords` je Knoten und `shared` für den Baum |
| S4 | Einreichen im Stapel | `wlo_submit_contents` |
| S5 | Sammlung umhängen | `wlo_move_collection` |
| S6 | Stapel entfernen, umsortieren | `wlo_remove_from_collections`; `removeFrom` je Paar in `wlo_add_to_collections` |
| S7 | Leere Sammlungen löschen | `wlo_delete_collections` |
| S8 | Vorschlag an eine Sammlung | `wlo_add_to_collection(s)` schlagen vor, wo nur Leserecht besteht; `wlo_list_collection_proposals`, `wlo_decide_collection_proposal` |
| S9 | „noch nicht öffentlich" | Satz und Feld in der Vorschau beider Einsortier-Werkzeuge |
| S10 | Teilbaum kopieren | nicht gebaut (von euch als nachrangig eingestuft) |

## Eure offene Frage zu S8 ist gemessen

Mit zwei Konten gegen Staging, an eigenen Wegwerf-Knoten:

- **Wer an einer Sammlung lesen, aber nicht schreiben darf, darf vorschlagen.** Das gewöhnliche
  Einsortieren antwortet dann 403, `?asProposal=true` antwortet 200. Ohne Leserecht wird
  beides abgelehnt.
- Ob die angemeldete Person schreiben darf, steht am Datensatz der Sammlung: Das Feld
  `access` enthält dann `Write`. Daran entscheiden die Einsortier-Werkzeuge, und die Vorschau
  sagt, welches von beiden der Schlüssel freigibt.
- Wer schreiben darf, kann Vorschläge auflisten und entscheiden, auch ohne Admin zu sein.
- Der Vorschlagende selbst sieht seine Vorschläge nicht: Die Liste antwortet ihm 403, und die
  Rückwärtssuche zeigt für ihn nichts. Ihr habt `PROPOSAL_PENDING` gesehen, weil euer Konto
  auch die Sammlung besitzt.
- Derselbe Vorschlag noch einmal antwortet 409, auch nach einer Ablehnung. Ein abgelehntes
  Paar lässt sich also nicht erneut vorschlagen.

Nicht gemessen: ob die WLO-Oberfläche die Vorschläge zeigt.

## Die Werkzeuge im Einzelnen

### `list_collection_tree` (S2, S1)

```
{ nodeId | collection (+ discipline), depth: 1–4 (Vorgabe 4), maxItems ≤ 250, skipCount, includeContentCounts }
→ { root: {nodeId, title}, depth, count, skipCount,
    items: [{ nodeId, title, path: ["Physik", "Optik", "Linsen"], depth, parentId, contentCount? }],
    more?: { nextSkipCount }, incomplete?, restricted?, walkCapped? }
```

- Die Liste läuft Ebene für Ebene, in der Reihenfolge des Repositorys (gesetzte Position,
  sonst Anlege-Reihenfolge). `path` beginnt mit dem Titel der Start-Sammlung.
- Nichts wird je Elternknoten gekürzt. Eine Seite fasst 250 Einträge, also einen ganzen von
  `wlo_create_collection_tree` angelegten Baum.
- Vollständig ist die Liste nur ohne `incomplete` (ein Zweig antwortete nicht), `restricted`
  (ein Zweig ist für diese Anmeldung nicht lesbar) und `walkCapped` (der Lauf hat seine Grenze
  von 400 Abfragen erreicht). Bei `walkCapped` hilft eine Untersammlung als Start.
- `contentCount` wird aus der Liste gelesen, nicht aus dem Zähler des Repositorys.
- Gemessen am Fachportal Physik auf Staging: 144 Sammlungen über vier Ebenen in 6,4 s.

### Reihenfolge (S1)

Gemessen, auch am Knoten-Endpunkt, über den wir lesen: Ohne Sortierparameter listet das
Repository in Anlege-Reihenfolge und ignoriert eine gesetzte Reihenfolge. Mit dem Parameter
stehen Kinder mit Position vorn und Kinder ohne Position dahinter.

- **Lesen:** `order: "stored"` an `browse_collection_tree` und `get_collection_overview`. Die
  Vorgabe bleibt `"title"` (alphabetisch), damit sich für niemanden etwas ändert.
- **Setzen:** `wlo_order_collection {collectionId, order: [nodeId …]}`.
  - Die Liste muss alle Einträge einer Art nennen. Eine unvollständige wird vor dem Schlüssel
    abgelehnt (`invalid_input`, `error.missing` nennt die fehlenden).
  - Je Aufruf entweder Untersammlungen oder Inhalte.
  - Bei Inhalten nehmen wir die Kennung des Materials oder die des Verweises und senden die
    des Verweises. Liegt ein Material mehrfach in der Sammlung, müsst ihr die Verweise nennen.
  - Ab 501 Einträgen einer Art: `too_many`.
- **Im Baum:** `wlo_create_collection_tree` stellt neue Untersammlungen in der Reihenfolge
  der Eingabe hinter die vorhandenen und setzt das ausdrücklich. Ließ es sich für eine Ebene
  nicht setzen, trägt ein Knoten dieser Ebene den Code `order_not_set`; angelegt ist trotzdem
  alles.

### Fach, Stufe, Schlagworte im Baum (S3)

```
wlo_create_collection_tree {
  parentCollectionId, onExisting,
  shared: { discipline, educationalContext, keywords },
  tree: [{ title, description?, discipline?, educationalContext?, keywords?, children? }]
}
```

- Ein Knoten, der ein Feld selbst nennt, ersetzt dort den gemeinsamen Wert. Eine leere Liste
  schaltet ihn für diesen Knoten ab.
- Vokabular streng wie bei jedem Schreiben: Name, Alias oder URI. Eine Ablehnung trägt
  `error.candidates`.
- Die Vorschau nennt je Knoten jeden Wert als Beschriftung.
- Eine mit `merge` übernommene Sammlung bleibt unverändert; die Vorschauzeile nennt, was dort
  nicht gesetzt wird. Den Schalter „vorhandene ergänzen" gibt es noch nicht.
- Kam ein Wert nicht an: `unverified` mit Code `not_visible`, die `nodeId` bleibt.

### `wlo_submit_contents` (S4)

`{items: [{nodeId}], comment?}`, bis 200, Plan wie `wlo_add_to_collections`. Antwort:
`items [{nodeId, status, code?}]`.

- `submitted`, `already` (lag schon vor, wird nicht erneut eingereicht), `not_stored` (mit
  Erfolg beantwortet, aber kein Workflow-Status am Datensatz), `unverified`, `failed`.
- Liegen alle schon vor, kommt eine Antwort ohne Schlüssel, kein Fehler.
- Ein unbrauchbarer Eintrag (nicht gefunden, Sammlung, Ordner) lehnt den ganzen Aufruf vor
  dem Schlüssel ab; `error.refused` nennt ihn mit Code.
- Die Notiz gilt für alle Datensätze und ist Teil der Bestätigung.

### `wlo_move_collection` (S5)

`{nodeId, newParentId}`. Antwort: `{nodeId, newParentId, previousParentId, path}`.

- Die Kennung bleibt, Untersammlungen und Inhalte ziehen mit.
- **Rechte, gemessen:** Lokal an der Sammlung gesetzte Rechte bleiben erhalten. Geerbte Rechte
  kommen danach von der neuen Elternsammlung. Eure ältere Notiz stimmt also für das Geerbte.
- Vor dem Schlüssel abgelehnt: Ziel im eigenen Teilbaum (`invalid_input`), schon dort
  (`no_change`), gleichnamige Sammlung am Ziel (`exists` mit `existingId`), kein Schreibrecht
  an der Sammlung oder am Ziel (`forbidden`). Das Repository selbst prüft den Namensvetter
  nicht und würde beide nebeneinander stellen.
- Die Vorschau nennt, wie viele Untersammlungen mitziehen; gezählt wird bis zur vierten Ebene,
  darüber hinaus steht „mindestens".
- Auf die oberste Ebene lässt sich nicht umhängen.
- Eine Liste von Umhängungen gibt es noch nicht.

### Entfernen und Umsortieren (S6)

- `wlo_remove_from_collections {pairs: [{nodeId, collectionId}]}`, bis 200. Status `removed`,
  `absent` (lag nicht in der Sammlung), `unverified`, `failed`.
- Umsortieren: `removeFrom` je Paar in `wlo_add_to_collections`. Erst aufnehmen und
  zurücklesen, dann aus der Quelle nehmen; Status `moved`.
  - Scheitert das Entfernen: `added`/`already` mit Code `not_removed`. Das Material liegt dann
    in beiden Sammlungen.
  - Lag es nicht in der Quelle: Code `not_in_source`.
  - Ein aufgenommenes Material endet nie als `failed`.

### `wlo_delete_collections` (S7)

`{nodeIds}`, bis 200. Gelöscht wird nur, was leer ist: keine Untersammlung, kein Verweis, kein
eigenes Material. Status `deleted`, `not_empty`, `unverified`, `failed`.

- „Leer" wird aus den Listen gelesen, für die Vorschau und noch einmal unmittelbar vor jedem
  Löschen. Die Zähler nutzen wir dafür nicht.
- Eine Sammlung, deren einziger Inhalt mitgenannte leere Untersammlungen sind, zählt als leer.
  Kinder werden zuerst gelöscht. Einen falschen Baum nehmt ihr so in einem Aufruf zurück,
  indem ihr alle seine Kennungen nennt.
- Die Plan-Kennung des Baum-Werkzeugs als Eingabe gibt es noch nicht.

### Vorschläge (S8)

- **Vorschlagen** ist kein eigenes Werkzeug. `wlo_add_to_collection` und
  `wlo_add_to_collections` schlagen vor, wo die Anmeldung an der Sammlung nur lesen darf.
  - Einzeln: Antwort `status: "proposed"`; war es schon vorgeschlagen: Fehlercode
    `already_proposed`.
  - Im Stapel: je Paar `proposed`, oder `already` mit Code `already_proposed`.
  - Ein vorgeschlagenes Material liegt nicht in der Sammlung.
  - Ein Umsortieren (`removeFrom`) in eine solche Sammlung wird abgelehnt.
- `wlo_list_collection_proposals {collectionId, status}` →
  `proposals [{nodeId, title, proposalId, status, accessible?}]`. Braucht Schreibrecht an der
  Sammlung.
- `wlo_decide_collection_proposal {collectionId, nodeId, decision: "accept" | "decline"}`.
  Annehmen nimmt das Material auf, liest zurück und markiert erst dann den Vorschlag. Code
  `proposal_not_marked` heißt: aufgenommen, die Markierung steht aber nicht fest; nicht noch
  einmal annehmen. `error.mark` sagt, was man weiß: `failed` (der Vorschlag ist weiter offen)
  oder `unverified` (gesendet, nicht bestätigt).
- Ein Vorschlagender kann seinen Vorschlag nicht zurücklesen. Bestätigt wird er bei uns
  dadurch, dass dieselbe Anfrage danach als Dublette abgelehnt wird.

### „Noch nicht öffentlich" (S9)

Die Vorschau beider Einsortier-Werkzeuge nennt Materialien mit `isPublic: false`:

- als Satz in `confirm.preview.notes`,
- als Daten in `confirm.preview.notPublic: [{nodeId, public: false}]`,
- im Stapel zusätzlich am Ende der Zeile („— noch nicht öffentlich").

Gemessen: `isPublic: false` heißt verlässlich „nur für die Eigentümerin". `true` ist kein
Versprechen des Gegenteils (eine mit einem einzigen Konto geteilte Sammlung meldet diesem
Konto `true`). Deshalb sagen wir nur das Negative.

## Ein Fund, der euch betrifft: Herausnehmen konnte Material löschen

Beim Nachmessen für S6 gefunden, und es betraf auch das bestehende
`wlo_remove_from_collection`: Liegt ein Material nicht als Verweis, sondern als Original
direkt in einer Sammlung, dann löscht das Herausnehmen das Material selbst. Das Repository
antwortet 200, der Datensatz danach 404. Unsere Vorschau sagte dabei, das Material bleibe
bestehen.

Alle drei Wege lehnen das jetzt vor dem Senden ab, mit Code `is_original` (im Umsortieren:
`source_is_original`, das Material bleibt dann in beiden). Falls euer Client aus einer
Sammlungsliste entfernt: Ein Eintrag ohne `originalId` ist so ein Original.

## Zu euren Beobachtungen

- **Kein Schreibrecht ist jetzt vor dem Schlüssel bekannt:** `wlo_create_content` mit
  `addToCollectionId` und `wlo_create_collection_tree` lehnen eine Sammlung, an der die
  Anmeldung nicht schreiben darf, sofort ab (`forbidden`), statt erst nach der Bestätigung.
- **B1 (Einsortieren geht wieder):** bestätigt. `wlo_add_to_collections` und `addToCollectionId`
  laufen bei uns live gegen Staging.
- **B2 (Zähler hinken, zählen den Teilbaum):** Nach keinem Schreiben lesen wir über die Zähler
  zurück. An einer Stelle geben wir einen aus: `contentsCount` an einem Sammlungs-Treffer der
  Suche und in den Kandidaten der Titel-Auflösung ist `childReferencesCount`. Das steht jetzt
  in der Referenz. Direkt gelesene Zahlen liefern `list_collection_tree` und
  `browse_collection_tree` mit `includeContentCounts`.
- **Dazu gemessen:** Nach dem Entfernen eines Verweises antwortet die Rückwärtssuche für
  dieses Material zwei bis fünf Sekunden lang mit 500 und erholt sich dann. Ein Einsortieren
  desselben Materials in diesem Fenster kann als `unverified` zurückkommen, obwohl es
  angekommen ist.
- **Ein zweites Einsortieren** desselben Paars antwortet im Repository 409 und legt keinen
  zweiten Verweis an. Bei uns ist das `already`.

## Was es noch nicht gibt

- S10, Teilbaum kopieren.
- „Vorhandene ergänzen" bei `merge` (S3, euer zweiter Schritt).
- Umhängen als Liste (S5).
- Die Plan-Kennung des Baum-Werkzeugs als Eingabe für das Löschen (S7).
- Ein Deploy-Termin für Staging; daran hängt eure Prüfung der Schreibwege mit Anmeldung.

Nachlesen: `CHANGELOG.md` („Unreleased", oberste Abschnitte), `docs/MCP-REFERENZ.md`
(Abschnitt der Kuratier-Werkzeuge), `docs/plans/2026-11-14-sammlungsstrukturen.md` (alle
Messungen).
