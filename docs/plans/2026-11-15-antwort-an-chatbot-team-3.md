# Antwort an das Chatbot-Team: Sammlung per Titel, eure Messung vom 14.11.

Stand 15.11.2026. Antwort auf eure Abschnitte 7 und 8. Danke für die Messung an 24 Titeln;
beide Befunde stimmen und sind behoben. Der bereitgestellte Server läuft weiter auf dem
alten Stand.

**Was ihr anpassen müsst:** die Form der Kandidaten- und der `Sammlung:`-Zeile (siehe
unten). Da ihr eure Zeilen aus `error.candidates` baut, betrifft euch das nur, wenn ihr
unsere Zeilen irgendwo wörtlich auswertet.

## Eure zwei Befunde

**1. Eine Sammlung ohne Fach wurde genommen, obwohl ein Fach verlangt war.** Behoben.
Trägt keine gleichnamige Sammlung das verlangte Fach, wird eine ohne Fachangabe nicht
mehr genommen:

```json
{ "error": { "code": "ambiguous_collection", "reason": "unverified",
             "disciplineUnverified": true, "candidates": [ … ] } }
```

Der Satz dazu: „Eine Sammlung mit dem Titel „…“ wurde gefunden, trägt aber keine
Fachangabe — ob sie zum genannten Fach gehört, ließ sich nicht prüfen, und sie wurde nicht
übernommen. Bitte die nodeId angeben:"

Wichtig für euren Client: `unverified` hat damit zwei Ursachen. Mit `incomplete: true`
kann ein erneuter Aufruf helfen, mit `disciplineUnverified: true` nicht.

**2. Eine Sammlung ohne Fach verhinderte den eindeutigen Treffer im Fach.** Behoben, wie
von euch vorgeschlagen. Trägt genau eine gleichnamige Sammlung das Fach, wird sie
genommen. Die ohne Fachangabe stehen in der Antwort:

```json
{ "resolvedCollection": { "nodeId": "256377d9-…", "title": "Mechanik", "path": ["Physik"],
    "alsoFound": [ { "nodeId": "ad84a986-…", "title": "Mechanik",
                     "path": ["Communities", "ComeIn", "…"], "contentsCount": 0,
                     "disciplineUnknown": true } ] } }
```

Im Text steht darunter „Auch gefunden, Fach unbekannt (nicht gewählt — die Sammlung oben
trägt das genannte Fach):" mit je einer Zeile. `alsoFound` hat höchstens fünf Einträge;
sind es mehr, nennt `alsoFoundTotal` die Zahl.

Ohne Fach ändert sich nichts.

**Gegen Staging nachgemessen (anonym, lesend):**

| Aufruf | vorher | jetzt |
|---|---|---|
| „Klimawandel" + Geografie | Community-Sammlung genommen | abgelehnt, `unverified` + `disciplineUnverified` |
| „Mechanik" + Physik | abgelehnt (`several`) | „Mechanik" unter Physik genommen, Community-Sammlung in `alsoFound` |
| „Saeuren und Basen" + Chemie | „nichts Ähnliches" | „Säuren und Basen" unter Chemie, als lose Übereinstimmung gesagt |

## Eure kleineren Punkte

- **ä/ae griff nicht.** Findet die Suche zur Schreibweise ohne Umlaute nichts Gleiches,
  sucht sie einmal mit Umlauten nach. Der Treffer bleibt eine lose Übereinstimmung
  (`matched: "loose"`, mit Hinweissatz). „ue" nach q, a oder e wird nicht umgeschrieben
  (Quelle, Frauen, Feuer). Kosten: eine weitere Suche, nur in diesem Fall.
- **Kandidaten dreifach im JSON.** `error.message` ist im JSON-Modus jetzt der Satz ohne
  die Kandidatenzeilen. `candidates` und der Textblock bleiben. Gemessen an
  „Klimawandel": 1,1 kB + 0,9 kB statt vorher rund 3,4 kB. Im Markdown-Modus ist
  `message` unverändert der ganze Text.
- **Titel in den Zeilen ungeschützt.** Die Zeilen haben eine neue Form: alles, was der
  Server weiß, steht vorn, der Titel zuletzt und in Anführungszeichen.

  ```
  - nodeId: <id> · <n> Inhalte · Fach unbekannt · unter <Pfad> — „<Titel>“
  Sammlung: <id> · unter <Pfad> — „<Titel>“
  ```

  Anführungszeichen im Titel und im Pfad werden in der Zeile durch `'` ersetzt, damit
  ein Titel seine eigenen Anführungszeichen nicht schließen kann. Die Felder
  (`candidates`, `resolvedCollection`) behalten den Titel unverändert.
  `oneLine` ersetzt jetzt auch U+0085, U+2028 und U+2029, in allen zeilenweisen
  Antworten des Servers.
- **`find_content_by_url`:** Die Werkzeugbeschreibung sagt jetzt, dass ein Eintrag mit
  `error`, auch `not_found`, die Prüfung offen lässt und nur `matches: []` ohne `error`
  „kein Datensatz" heißt.
- **Satz bei mehreren Gleichnamigen:** Er empfiehlt das Eingrenzen per Fach nicht mehr,
  wenn das Fach schon genannt war.

## Was unser Review zusätzlich fand

- Die neue Umlaut-Nachsuche vergaß zunächst, dass das Fenster der ersten Suche voll war,
  und hätte so einen losen Treffer als einzigen genommen. Jetzt wird in dem Fall nicht
  übernommen (`unverified`, `incomplete`, `windowFull`).
- Antwortet die Nachsuche nicht, steht `incomplete: true` in der Ablehnung.

## Bewusst nicht geändert

- **Kein breiterer Suchlauf für „keine im Fach, Fenster voll".** Die Antwort bleibt
  ehrlich (`incomplete`, `windowFull`), kostet aber die Runde.
- **Andere Zeilen mit Titel vor der Kennung** (etwa `Skill: <Titel> (nodeId: …)` oder die
  Baumzeile `- **Titel** (id)`) haben dieselbe Schwäche. Das sind Formen, an denen ihr
  möglicherweise hängt; wir ändern sie nicht ohne Absprache. Sagt uns, welche ihr wörtlich
  auswertet.

## Eure Hinweise aus Abschnitt 7

Alles so verstanden: `restricted` kein Ausfall, `contentsUnread` Ausfall, Themenseiten
ohne eigenes Kennzeichen. Die Wendung „mit dieser Anmeldung nicht lesbar" bleibt und ist
bei uns per Test festgeschrieben.

Nachlesen: `CHANGELOG.md` („Unreleased", oberster Abschnitt), `docs/MCP-REFERENZ.md` §5.2.
