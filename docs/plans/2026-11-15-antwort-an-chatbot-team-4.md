# Antwort an das Chatbot-Team: euer Abschnitt 9

Stand 15.11.2026. Danke für die Nachmessung und für die Liste der Formen, an denen ihr
hängt. Der bereitgestellte Server läuft weiter auf dem alten Stand.

## Euer neuer Befund: `search_wlo_content_many` meldet „weitere Treffer" bei null Treffern

Behoben. Eine Anfrage ohne Treffer liefert jetzt `count: 0` ohne `more`.

Die Ursache liegt etwas anders, als ihr vermutet habt. Die Rangsuche stellt mehrere
Varianten einer Anfrage und verträgt, dass eine davon fehlschlägt; das Ende erklärt sie
dann nicht. Die Einzelsuche las deshalb zusätzlich ein leeres Fenster als Ende, die
Mehrfachsuche nicht.

Daraus sind zwei Änderungen geworden:

- **Ein leeres Fenster ist das Ende**, in beiden Suchen nach derselben Regel.
- **Eine nicht beantwortete Variante wird gesagt.** Unser Review hat gezeigt, dass „keine
  Treffer" in diesem Fall genauso falsch wäre wie „es gibt weitere": Die Treffer können
  gerade in der Variante liegen, die niemand gelesen hat. Die Antwort trägt dann
  `incomplete: true` und den Satz „Die Inhaltssuche hat nicht (vollständig) geantwortet …"
  mit eurer Erkennungswendung. Das gilt für `search_wlo_content`, den Inhalts-Teil von
  `search_wlo_all` (`content.incomplete`) und je Anfrage in `search_wlo_content_many`.
  Ihr könnt es wie jeden anderen Ausfall behandeln: kurze Cache-Frist, erneuter Aufruf.

Bei einer Mehrfachsuche ohne Treffer steht jetzt entweder nur `count: 0` (echtes Ende)
oder `count: 0, incomplete: true` (kein Befund).

## Die Formen, an denen ihr hängt

Alle Formen aus eurer Tabelle bleiben, wie sie sind. Sie sind jetzt bei uns per Test
festgeschrieben; eine Änderung daran fällt bei uns auf, bevor sie euch erreicht, und kommt
nur mit Vorlauf.

Eine Zeile eurer Tabelle trifft bei uns nichts: **Suchantworten in Markdown.** Die
Wendungen „Gesamt:", „Treffer:" und „Gefunden:" gibt es bei uns nicht. Die Zeile lautet:

```
Gefundene Treffer gesamt: <N>, zeige <M>
```

Euer Rückfall ohne JSON findet die Trefferzahl also bisher nicht. Diese Form ist jetzt
ebenfalls festgeschrieben.

## Umgestellt, wie von euch angeregt: Kennung vorn, Titel zuletzt

Die Zeilen, die ihr nicht wörtlich auswertet, haben jetzt alle dieselbe Form. Was der
Server weiß, steht vorn; der Titel steht zuletzt in Anführungszeichen, und Anführungszeichen
im Titel werden in der Zeile durch `'` ersetzt. Die Datenfelder behalten den Titel
unverändert.

| Wo | vorher | jetzt |
|---|---|---|
| Katalog an einer Sammlung, Kopf | `Skill-Registry: <Titel> (nodeId: <id>) — …` | `Skill-Registry (nodeId: <id>) — … — „<Titel>“` |
| Katalog, Einträge | `Skill: <Titel> (nodeId: <id>) — laden mit get_skill` | `Skill (nodeId: <id>), laden mit get_skill — „<Titel>“` |
| `browse_collection_tree` | `- **<Titel>** (<id>) [n Inhalte]` | `- nodeId: <id> [n Inhalte] — „<Titel>“` |
| `find_content_by_url` | `- [match] <Titel> — nodeId: <id> — <Adresse>` | `- [match] nodeId: <id> — „<Titel>“ — <Adresse>` |
| `get_collection_overview`, Untersammlungen | `<Titel> (<n>) — <id>` | `<id> (<n>) „<Titel>“` |
| `get_collection_overview`, Skills | `<Titel> (<id>)` | `<id> „<Titel>“` |
| `get_node_details`, Eltern-Sammlungen | `- <Titel> (nodeId: <id>)` | `- nodeId: <id> — „<Titel>“` |

**Nicht umgestellt:** die Vorschauzeile der Schreibwerkzeuge, `Datensatz: „Titel“ (id)`.
An ihr erkennt euer Client, dass wir das Ziel schon nennen; sie bleibt. Sollte sie sich
je ändern, sagen wir es vorher.

Eine Frage dazu: Die Marker der Übersicht, die ihr nennt (`Nicht geladen:`,
`Inhalte (n von m):`), sind unverändert. `<Teil>: nicht gezählt (` steht bei uns in
`count_wlo_content_matches`, nicht in der Übersicht. Falls ihr die Wendung in der
Übersicht erwartet, sagt Bescheid; dort gibt es sie nicht.

## Zu eurer Liste „Offen bei dir"

| Punkt | Stand |
|---|---|
| Einheitliche Antwortformen, Ausgabeschemata für alle Werkzeuge | entschieden: wird nicht gebaut. Fehlercodes und Wartezeiten sind einheitlich; meldet euch, wenn euch eine konkrete Uneinheitlichkeit behindert |
| Staging-Vorgabe im Code | bleibt, mit Warnung beim Start, wenn die Variable fehlt. Ohne B-API gibt es keine andere Quelle für die Adresse |
| `WLO_PUBLIC_BASE_URL` erzwingen | bleibt eine Startwarnung |
| Dienst-ID | `wlo-mcp` (Paket und Image) |
| Version | noch nicht geschnitten; Entscheidung steht aus |
| Image-Registry | Entscheidung steht aus |
| Deploy auf Staging | Termin steht aus; wir melden uns |

## Gut zu wissen

- Eure Messung der Mehrfachsuche (0,6 bis 1,1 s gegen 4 bis 5 s nacheinander) deckt sich
  mit unserer.
- Für die Prüfung der Schreibwege mit Anmeldung braucht ihr den bereitgestellten Server;
  das hängt am Deploy.

Nachlesen: `CHANGELOG.md` („Unreleased", oberste zwei Abschnitte).
