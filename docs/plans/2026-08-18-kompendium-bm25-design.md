# Kompendiumstext: Inhaltsverzeichnis + gezielte Passagen (BM25)

Entwurf und Aufgaben in einer Datei (wie `2026-08-09-usecase-gap-tools.md`).

## Ziel

`get_compendium_text` nimmt neben `nodeId`/`nodeIds` einen **Suchtext**. Mit
Suchtext antwortet es mit **Inhaltsverzeichnis + den dazu passenden Passagen**
(BM25), ohne Suchtext mit **Inhaltsverzeichnis + dem ganzen Text**, dessen
Hauptabschnitte gedeckelt sind.

Das Inhaltsverzeichnis geht IMMER mit: ein Modell, das nur Ausschnitte sieht,
weiß sonst nicht, was es nicht gesehen hat — und kann die zweite, genauere Frage
nicht stellen.

## Messung (Staging, 2026-08-18)

158 Sammlungen über acht Suchwörter, davon **11 mit Kompendiumstext**.

| | |
|---|---|
| Länge | min 12 · p50 9 473 · p90 16 411 · **max 65 250** (Optik) |
| Überschriften | 10 von 11 Texten tragen ATX-Überschriften |
| Ebenen über alle Texte | H1 **10×**, H2 161×, H3 144×, H4 9× |
| je Dokument | **genau eine H1**, 11–18 H2 |
| Absätze (Leerzeile) | 972, p50 **66** Zeichen, 329 davon unter 40 |
| Abschnitts-Eigentext | 340, p50 276, p90 926, **max 16 317** |

Drei Dinge folgen daraus, und jedes widerlegt eine naheliegende Bauart:

**1. „je H1 kappen" würde den ganzen Text kappen.** Die H1 ist in 10 von 10
Fällen der Dokumenttitel; die inhaltlichen Hauptabschnitte sind H2. Wörtlich
umgesetzt lieferte der Deckel 2 000 Zeichen für das gesamte Dokument — das
Gegenteil von „alle Abschnitte sollen drin sein". Der Deckel gilt deshalb je
**Hauptabschnitt**, und Hauptabschnitt ist die **flachste Überschriftenebene,
die mindestens zweimal vorkommt** (sonst die flachste überhaupt; ohne
Überschrift ist der ganze Text ein Abschnitt). Auf allen zehn gemessenen
Dokumenten ist das H2. Wirkung bei 2 000: nur **Optik** ändert sich
(65 250 → 18 744 Zeichen Körper), die neun anderen bleiben unverändert — der
Deckel trifft den Ausreißer und nicht den Normalfall. (Die Sondierung vor der
Umsetzung schätzte 18 725; sie summierte rohe Bereiche, während der Code trimmt
und mit Leerzeile fügt. 18 744 ist der am fertigen Code gemessene Wert.)

**2. Ein roher Absatz ist die falsche BM25-Einheit.** 329 der 972 Absätze sind
kürzer als 40 Zeichen: Tabellenzeilen, Listenpunkte, fette Zwischenlabels. BM25
normalisiert auf die Dokumentlänge (`b = 0.75`), eine 4-Zeichen-Zeile mit dem
Suchwort schlägt also den 400-Zeichen-Absatz, der es erklärt. Eine Passage ist
deshalb ein **Absatzlauf innerhalb EINES Abschnitts, aufgesammelt bis mindestens
200 Zeichen**. Sie überschreitet nie eine Überschrift, trägt also immer genau
einen Überschriftenpfad.

**3. Der Abschnitt als Einheit wäre zu grob.** p50 276 Zeichen klingt passend,
aber der größte Eigentext hat 16 317 — ein Treffer hätte das ganze Budget
gefressen.

## Was gebaut wird

### `src/text-bm25.ts` (neu, rein)

Okapi BM25 (`k1 = 1.2`, `b = 0.75`) über eine Liste von Texten. Kein I/O, keine
Projektabhängigkeit außer dem Tokenizer.

**Die Termhäufigkeit zählt über `termMatches`, nicht über Gleichheit.** Deutsche
Komposita und Flexionen sind der gemessene Grund, aus dem `node-match.ts`
überhaupt existiert („Rechnung" in „Bruchrechnung"); exakte Token-Gleichheit
wäre hier eine zweite, schlechtere Regel. `queryTerms` liefert die Terme — damit
fallen die Stoppwörter, die in deutschen Wörtern STECKEN („Stu-die-n"), aus der
Anfrage.

### `src/services/compendium-view.ts` (neu)

Aus einem Kompendiumstext:

- `outline` — die Überschriften ab Hauptabschnittsebene, mit Tiefe.
- ohne Anfrage: `sections` — alle Hauptabschnitte, jeder auf `maxSectionChars`
  gekappt (`capText`, also mit Offenlegung).
- mit Anfrage: `passages` — die bestbewerteten Passagen mit Pfad, plus
  `unmatchedTerms`.

**Ohne Punktzahl, und das ist eine Vertragsänderung** (Review 2026-08-18; der
erste Entwurf sagte „mit Pfad und Punktzahl"): ein roher BM25-Wert ist zwischen
zwei Anfragen nicht vergleichbar und hat keine absolute Bedeutung. Ausgegeben
lädt er zu genau dem Fehlschluss ein, den er zu stützen scheint — „0,4, also
schwach" —, während die Reihenfolge dasselbe verlässlich sagt. Was der Aufrufer
über Lücken wissen muss, steht in `unmatchedTerms`.

### `src/tools/compendium.ts`

Neuer Parameter `query`. Reihenfolge der Antwort je Sammlung:

```
# <Sammlungstitel>          (wie bisher)
## Inhalt                   (serverseitig hergeleitet)
- …
<Hinweis>                   (serverseitig hergeleitet)
---                         (ab hier Dokumentinhalt)
<Passagen | gedeckelter Volltext>
```

Serverseitiges VOR dem ungeprüften Dokument — dieselbe Regel wie bei `get_skill`
und `get_skill_registry`: danach wäre es von einem Abschnitt, den das Dokument
selbst fälscht, nicht mehr zu unterscheiden. Jede Zeile, die aus dem Dokument
stammt (Überschriften im Inhaltsverzeichnis, Pfade über den Passagen), geht
durch `oneLine`.

### Konfiguration

`WLO_COMPENDIUM_SECTION_MAX`, Standard **2000**, über `resolvePositiveInt` (nie
`parseInt` — `env-parsing-discipline.test.ts`). Muss in `.env.example` UND
`docker-compose.yml` stehen, sonst erreicht die Einstellung den Container nicht
(`deploy-env-passthrough.test.ts`).

Operator-Einstellung, kein Aufrufparameter: der Deckel existiert, damit eine
Antwort nicht endlos wird, und ein Aufrufer, der ihn hochsetzen kann, hat keinen
Deckel.

## Regeln, die halten müssen

- **Nicht getroffene Suchwörter werden benannt.** Gemessen: „Lehrplan Thüringen
  Regelschule" auf Optik trifft nur über `lehrplan`, und die Antwort ist voller
  Lehrpläne aus Rheinland-Pfalz und Sachsen. Ohne den Satz „Nicht gefunden:
  Thüringen, Regelschule" liest sich das wie eine Antwort auf die gestellte
  Frage.
- **Der Hinweis sagt nur, was wahr ist.** „Gekürzt" nur, wenn gekürzt wurde; der
  Verweis auf `query` steht immer, weil er immer stimmt.
- **Kein Treffer ist kein Fehler.** Wie `missText` bei der Skill-Registry: die
  Antwort nennt das Inhaltsverzeichnis und sagt, dass die Anfrage nichts traf —
  nie `isError`, und nie stillschweigend der Volltext, denn der wäre eine
  Antwort auf eine andere Frage.
- **`getCompendiumTexts` bleibt unverändert.** `services/search.ts` und
  `/api/compendium` hängen daran; das Auswählen gehört in die neue Sicht, nicht
  in den Abruf.
- **`charCount` in `structuredContent` ist die Länge VOR dem Kürzen**, wie das
  Schema es sagt, und `truncated` sagt die Wahrheit — bisher stand dort fest
  `false`.

## Aufgaben

Jede Phase beginnt mit `/better-coding-workflow`.

**P1 — BM25.** `src/text-bm25.ts`, `tests/text-bm25.test.ts`: IDF trennt ein
häufiges von einem seltenen Wort · die Längennormalisierung bevorzugt die
kürzere von zwei gleich oft treffenden Passagen · ein Term, der in JEDEM
Dokument steht, trägt nahezu nichts bei · Komposita treffen („Brechung" in
„Lichtbrechung") · leere Anfrage liefert leere Rangliste.

**P2 — Sicht.** `src/services/compendium-view.ts`, `tests/compendium-view.test.ts`:
Hauptabschnittsebene bei einer einzelnen H1 ist H2 · bei mehreren H1 ist es H1 ·
ohne Überschriften ein Abschnitt · Deckel je Hauptabschnitt mit Offenlegung ·
Passagen überschreiten keine Überschrift · kurze Absätze werden zusammengefasst ·
`unmatchedTerms`.

**P3 — Werkzeug.** Parameter, Rendering, beide Ausgabeformate,
`structuredContent`. `tests/tools-compendium.test.ts` erweitern; die bestehenden
Zusicherungen (Volltext ohne Anfrage, JSON-Form, Sammelabruf, Lesewidget)
bleiben grün.

**P4 — Konfiguration und Doku.** `.env.example`, `docker-compose.yml`,
`docs/TOOLS.md`, `docs/TOOLS-KOMPAKT.md`, beide READMEs, `CHANGELOG.md`,
`CLAUDE.md`-Block, `STATUS.md`.

## Verifikation

`npm test` · `npm run lint` · `npx tsc -p tsconfig.typecheck.json`, und ein Lauf
gegen den echten Optik-Text (65 250 Zeichen): Ausgabelänge ohne Anfrage gemessen
statt behauptet, und `query: "Lehrplan Thüringen Regelschule"` liefert die
Lehrplan-Passagen samt Hinweis auf die zwei nicht getroffenen Wörter.
