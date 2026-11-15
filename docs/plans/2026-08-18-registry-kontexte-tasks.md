# Aufgaben: Kontexte in der Skill-Registry

Entwurf: [`2026-08-18-registry-kontexte-design.md`](./2026-08-18-registry-kontexte-design.md)

17 Aufgaben in 6 Phasen. Jede Phase beginnt mit Schritt 0. Jede Aufgabe ist TDD:
erst der rote Test, dann der Code.

**Abweichung vom Entwurf, während P2 entschieden und hier eingetragen — ein Plan
ist ein Vertrag.** `RegistryContext`, `RegistryGeneral`, `REGISTRY_CONTEXT_MAX`,
`layoutContexts` und `resolveContext` liegen in einem **neuen Modul**
`src/services/registry-contexts.ts`, nicht in `skill-registry.ts`. Grund: jenes
Modul besitzt bereits Finden, Lesen, Auflösen und Kappen einer Registry; „was
bedeutet die Gliederung des Dokuments" ist ein eigener Grund zur Änderung, und
die 480 Zeilen wären auf über 600 gewachsen. `skill-registry.ts` re-exportiert
alles, bleibt also die eine Anlaufstelle. **Der Wächter in T16 nennt deshalb
`services/registry-contexts.ts` als Eigentümer.**

**Die Entscheidung, die das Paket klein hält:** der Abschnitts-Parser ist rein
und kennt weder Skills noch Registries. Er sagt nur, welche Überschriften an
welchem Offset stehen. Die Zuordnung Block → Abschnitt passiert an genau einer
Stelle (`buildRegistryFrom`), über den Offset, den beide Parser liefern. Es
entsteht **keine zweite** Blockerkennung.

| Phase | Aufgaben | Ergebnis |
|---|---|---|
| P1 Parser | T1–T2 ✅ | Überschriften mit Offsets; `offset` am `SkillReference` |
| P2 Dienst | T3–T7 ✅ | `contexts`, `entry.context`, `resolveContext`, Knotenfeld + zod |
| P3 Werkzeug | T8–T10 ✅ | `context` an `get_skill_registry` |
| P4 Trefferliste | T11–T13 ✅ | `REGISTRY_INLINE_MAX`, drei Formen |
| P5 Sammlungs-Werkzeuge | T14–T16 ✅ | `skillContext` an fünf Werkzeugen + Wächter |
| P6 Doku | T17 ✅ | Redaktionsanleitung, READMEs, CHANGELOG, CLAUDE.md, STATUS.md |

**Nach jedem Paket:** `STATUS.md` fortschreiben, dann anhalten für einen
Kontext-Reset (Projektprotokoll in `CLAUDE.md`).

---

## Phase 1 — Parser (rein, kein I/O)

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T1: Abschnitte aus Markdown

**Dateien**
- Neu: `src/services/markdown-sections.ts`
- Neu: `tests/markdown-sections.test.ts`

**Was.** `parseSections(markdown): MarkdownSection[]` — ATX-Überschriften
(`^#{1,6} `) mit `level`, `title`, `headingStart`, `bodyStart`, `end`. `end` ist
der Offset der nächsten Überschrift **gleicher oder höherer** Ebene, sonst das
Dokumentende; ein H2-Abschnitt umfasst damit seine H3.

**Schritte**
- [x] Roter Test: drei H2 hintereinander → drei Abschnitte, Offsets stimmen.
- [x] Roter Test: H2 mit zwei H3 → der H2-Abschnitt reicht bis zur nächsten H2,
      die H3 liegen darin.
- [x] Roter Test: **eine Überschrift in einem eingezäunten Codeblock zählt
      nicht.** Der Registry-Text ist redaktionell und enthält Beispiele; ein
      ` ``` `-Block mit `## Beispiel` darf keinen Kontext erzeugen.
- [x] Roter Test: Setext-Überschriften (`Titel` + `-----`) werden ignoriert —
      bewusst, das Format ist im Editor nicht in Gebrauch und die Regel bliebe
      mehrdeutig gegenüber einer Trennlinie.
- [x] Roter Test: CRLF-Zeilenenden, führende Leerzeichen bis 3, `#` ohne
      folgendes Leerzeichen (keine Überschrift).
- [x] Roter Test: leeres Dokument und Dokument ohne Überschrift → `[]`.
- [x] Implementieren, alle grün.

**Verifikation.** `node --import tsx --test tests/markdown-sections.test.ts`

### T2: `offset` am `SkillReference`

**Dateien**
- Ändern: `src/services/skill-references.ts`
- Ändern: `tests/skill-references.test.ts`

**Was.** Additives Feld `offset: number` — der Offset des öffnenden Zauns.
`m.index` liegt in der Schleife bereits vor.

**Schritte**
- [x] Roter Test: drei Blöcke → aufsteigende Offsets, und `markdown.slice(offset)`
      beginnt mit `:::`.
- [x] Implementieren.
- [x] Zusichern, dass `get_skill`s Aufrufer unberührt bleibt: die bestehenden
      neun Tests grün, keine Änderung an `services/skills.ts`.

**Verifikation.** `node --import tsx --test tests/skill-references.test.ts`

---

## Phase 2 — Dienst und Datenmodell

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T3: Kontexte aus dem Dokument

**Dateien**
- Ändern: `src/services/skill-registry.ts`
- Ändern: `tests/skill-registry.test.ts`

**Was.** `RegistryContext`, `RegistryGeneral`, `SkillRegistry.contexts`,
`SkillRegistry.general`, `RegistryEntry.context`. Zuordnung in `buildRegistryFrom`
über den Offset; gefüllt in **beiden** Tarifen. `REGISTRY_CONTEXT_MAX = 50`,
offengelegt.

Ein Kontext ist ein Abschnitt der Ebene 2 oder 3 **mit nicht-leerem Titel**.
Alles andere ist **durchlässig**: der Block gehört dem nächsten benannten
Kontext, der ihn umschließt, sonst dem allgemeinen Teil.

**Schritte**
- [x] Roter Test: Dokument mit zwei H2 à zwei Skills → zwei Kontexte, jeder
      Eintrag trägt seinen `path`.
- [x] Roter Test: H3 unter H2 → `path` ist `"H2/H3"`, `level: 3`.
- [x] Roter Test: Skill vor der ersten H2 → Eintrag **ohne** `context`, und der
      Skill steht in `general.skills`.
- [x] Roter Test: **flaches Dokument ⇒ `contexts: []`** (Regressionsschutz — das
      ist der heutige Bestand), alle Skills in `general.skills`.
- [x] ~~Roter Test: ein Abschnitt ohne Skill-Block erscheint **nicht** als
      Kontext.~~ **Umgekehrt (2026-08-18, Live-Lauf).** Ein benannter Abschnitt
      IST ein Kontext, auch ohne Skill — die Redaktion legt Gruppen an, bevor sie
      sie füllt (`## Browserplugin` im echten Dokument). Sonst fehlt die
      Überschrift im Katalog und `resolveContext` meldet „unbekannt" für einen
      Namen, der im Dokument steht.
- [x] Roter Test: **namenloses `##` auf oberster Ebene** → kein Kontext, seine
      Skills landen in `general.skills`. Nicht verwerfen: der Abschnitt ist per
      Namen nicht aufrufbar, sein Inhalt aber vorhanden.
- [x] Roter Test: **namenloses `###` innerhalb einer benannten H2** → kein
      eigener Kontext, seine Skills gehören der **H2**. Dieselbe Regel, anderes
      richtiges Ergebnis: entscheidend ist der nächste benannte Kontext darüber.
- [x] Roter Test: namenloses `##`, danach ein benanntes `##` → die Skills des
      namenlosen bleiben allgemein und wandern **nicht** in den folgenden
      Kontext.
- [x] Roter Test: mehr als `REGISTRY_CONTEXT_MAX` Abschnitte → gekappt und
      offengelegt, nicht still gekürzt.
- [x] Implementieren.

### T4: Die Anweisung

**Dateien**
- Ändern: `src/services/skill-registry.ts`
- Ändern: `tests/skill-registry.test.ts`

**Was.** Die Anweisung eines Abschnitts = Prosa von `bodyStart` bis zum
**früheren** von: erstem Skill-Block, nächster Überschrift (beliebiger Ebene),
`end`. Dieselbe Regel für einen Kontext (`RegistryContext.instruction`) und für
den allgemeinen Teil (`general.instruction`), der zusätzlich die Prosa
namenloser Abschnitte oberster Ebene aufnimmt, in Dokumentreihenfolge verbunden.

**Schritte**
- [x] Roter Test: Vorspann wird Anweisung, der Absatz **nach** dem Block nicht.
- [x] Roter Test: Abschnitt ohne Block → ganze Prosa ist Anweisung.
- [x] Roter Test: Abschnitt ohne Prosa → `instruction` fehlt (kein Leerstring).
- [x] Roter Test: die Prosa einer H2 endet an ihrer ersten H3 — sonst zöge eine
      H2 ohne eigenen Block die Überschrift und Prosa ihres Unterkontexts in die
      eigene Anweisung.
- [x] Roter Test: die Prosa **vor** der ersten H2 wird `general.instruction`
      (im echten Dokument: Einleitung, Bezugsquelle, Lizenz).
- [x] Roter Test: die Prosa eines **namenlosen** Abschnitts oberster Ebene wird
      an `general.instruction` angehängt, statt verlorenzugehen.
- [x] Implementieren.

### T5: `resolveContext`

**Dateien**
- Ändern: `src/services/skill-registry.ts`
- Ändern: `tests/skill-registry.test.ts`

**Was.** Die eine Auflösungsregel. Normalisiert (trimmen, Leerraum
zusammenfassen, `toLocaleLowerCase('de')`), vergleicht gegen `title` **und**
`path`, liefert `ContextResolution`.

**Schritte**
- [x] Roter Test: `"material"` trifft `"Material"` (Groß-/Kleinschreibung,
      Leerraum).
- [x] Roter Test: `"Vorgabe & Planung/Wochenplanung"` trifft die H3; der bloße
      Titel `"Wochenplanung"` ebenfalls, solange er eindeutig ist.
- [x] Roter Test: derselbe H3-Titel unter zwei H2 → `kind: 'ambiguous'` mit
      beiden Pfaden. **Nicht raten.**
- [x] Roter Test: unbekannter Name → `kind: 'unknown'` samt **allen** vorhandenen
      Namen (die Liste ist das, woraus der Aufrufer den richtigen lernt).
- [x] Roter Test: `""`, `"all"`, `"ALL"` → `kind: 'all'`.
- [x] Roter Test: ein Treffer liefert `parent` (bei H3) und `children` (bei H2).
- [x] Roter Test: eine Registry **ohne** Kontexte → `kind: 'all'` für jeden
      Eingabewert; es gibt nichts zu verfehlen.
- [x] Implementieren.

### T6: Knotenfeld und zod

**Dateien**
- Ändern: `src/formatter.ts` (Feld), `src/services/skill-registry.ts`
  (`toRegistrySummary`), `src/apps/outputSchemas.ts`
- Ändern: `tests/skill-registry.test.ts`, `tests/formatter.test.ts`

**Was.** `contexts?: { path: string; skills: number }[]` am Knotenfeld, gefüllt
ausschließlich in `toRegistrySummary`. **Keine** Anweisungstexte.

**Schritte**
- [x] Roter Test: `toRegistrySummary` überträgt Pfad und Anzahl, **nicht** die
      Anweisung.
- [x] Roter Test: Registry ohne Kontexte → Feld fehlt (nicht `[]`), damit sich
      keine bestehende Antwort ändert.
- [x] Roter Test (**getrennt**, weil zod Unbekanntes verwirft): das Feld
      überlebt `formattedNodeSchema.parse`.
- [x] Implementieren.

### T7: Der billige Tarif kostet weiterhin nichts

**Dateien**
- Ändern: `tests/skill-registry.test.ts`

**Was.** Die Zusicherung, um die es im ganzen Paket geht. Kein Produktivcode.

**Schritte**
- [x] Die bestehende Zählung (`resolveHeads: false` → 1 children, 1 download,
      0 metadata) läuft gegen ein Dokument **mit** Kontexten und bleibt bei
      1/1/0.
- [x] Zusichern, dass die Einträge dabei ihren `context` tragen — Kontexte sind
      im billigen Tarif vollständig, nicht nur im Werkzeug-Tarif.

**Ende P2:** `STATUS.md` fortschreiben, anhalten.

---

## Phase 3 — `get_skill_registry` mit `context`

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T8: Parameter und gefilterter Katalog

**Dateien**
- Ändern: `src/tools/skill-registry.ts`
- Ändern: `tests/tools-skill-registry.test.ts`

**Schritte**
- [x] Roter Test: `context: "Material"` → nur dessen Skills, plus die
      kontextfreien, als „gilt immer" ausgewiesen.
- [x] Roter Test: eine H3 → die Anweisung ihrer H2 wird als geltend benannt.
- [x] Roter Test: ohne `context` → wie heute, **plus** Kontext-Index.
- [x] Roter Test: die Reihenfolge-Zusicherung (`:64`, Katalog vor Dokument)
      bleibt grün.
- [x] Implementieren.

### T9: Abschnitt statt Dokument, Fehlgriffe als Text

**Dateien**
- Ändern: `src/tools/skill-registry.ts`
- Ändern: `tests/tools-skill-registry.test.ts`

**Schritte**
- [x] Roter Test: mit **passendem** `context` steht unterhalb des `---` **nur
      dieser Abschnitt**, nicht das ganze Dokument.
- [x] Roter Test: **unbekannter Name → das GANZE Dokument**, identisch zum
      Aufruf ohne `context` — plus eine Zeile, die den Fehlgriff benennt und
      alle vorhandenen Kontexte aufzählt. **Kein** `isError`.
- [x] Roter Test: **mehrdeutiger Name → ebenfalls das ganze Dokument**, plus die
      qualifizierten Pfade. Kein besserer Fall als „unbekannt": es steht kein
      eindeutiger Kontext fest, und geraten wird nicht.
- [x] Roter Test: der Katalog ist bei beiden Fehlgriffen **vollständig** — alle
      Skills, nicht nur die kontextfreien.
- [x] Roter Test: `context` auf einer Registry **ohne** Kontexte → sagt das und
      liefert den vollen Katalog, statt leer auszugehen.
- [x] Implementieren.

### T10: JSON-Zweig und Beschreibungsgrenze

**Dateien**
- Ändern: `src/tools/skill-registry.ts`
- Ändern: `tests/tools-skill-registry.test.ts`

**Schritte**
- [x] Roter Test: JSON trägt `contexts` und — bei gesetztem `context` — die
      `instruction` als benanntes Feld.
- [x] Roter Test: `hint` bleibt an die Bedingung „Einträge vorhanden" gebunden.
- [x] `tests/tool-descriptions.test.ts` grün: Beschreibung unter 1024 Zeichen,
      Querverweis auf `get_skill` erhalten. Vorher messen, nicht schätzen.

**Ende P3:** `STATUS.md` fortschreiben, anhalten.

---

## Phase 4 — Das Zeilenbudget

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T11: Die drei Formen

**Dateien**
- Ändern: `src/formatter.ts`
- Ändern: `tests/formatter.test.ts`

**Was.** `REGISTRY_INLINE_MAX = 12` **ersetzt** `REGISTRY_LINES_MAX`.
Kontextnamen werden **gepackt** (mehrere je Zeile, `·`-getrennt, Umbruch bei
~100 Zeichen) — sieben Kontexte sind zwei Zeilen, nicht sieben. Ohne Namen kann
niemand gezielt nachfragen, deshalb ist Form 2 der Normalfall und Form 3 die
Ausnahme.

**Schritte**
- [x] Roter Test: die Packung — sieben Kontexte ergeben zwei Zeilen, keine
      Zeile über ~100 Zeichen, kein Name zerschnitten.
- [x] Roter Test an den Grenzen: 11 / 12 / 13 Zeilen → Form 1 / Form 1 / Form 2.
- [x] Roter Test: sehr viele Kontexte (gepackt > 12 Zeilen) → Form 3.
- [x] Roter Test: **flach mit 50 Skills → Form 3**, nicht Form 2 — ohne Kontexte
      hätte der Index nichts zu zeigen, und eine leere Zwischenform wäre die
      schlechteste von dreien.
- [x] Roter Test: flach mit 8 Skills → **zeichengleich** wie heute.
- [x] Roter Test: Form 2 druckt **keine** Skill-nodeId.
- [x] Implementieren.

### T12: Was die Kopfzeile verspricht

**Dateien**
- Ändern: `src/formatter.ts`
- Ändern: `tests/formatter.test.ts`

**Was.** Der `reach`-Satz bekommt zwei Fälle. Heikelste Stelle des Pakets.

**Schritte**
- [x] Roter Test: Form 2 → nennt `get_skill_registry` **mit** `context`, und
      **keine** `DESCRIPTIONS_ONLY_NOTE` (keine nodeId gedruckt).
- [x] Roter Test: Form 3 → nennt die **Kontextanzahl** und `get_skill_registry`
      als den Weg zu den Namen. Sie ist die einzige Form ohne Namen; ohne diesen
      Satz wäre ein gezielter Zweitaufruf unmöglich.
- [x] Roter Test: Form 3 verspricht keinen Kontextnamen, den sie nicht zeigt.
- [x] Roter Test: die bestehenden Verbotslisten (`:368-506`) bleiben grün.
- [x] Roter Test: `\n` in einem Kontextnamen fälscht keine Zeile (`oneLine`).
- [x] Roter Test: Kopfzeilen-Tarif (`entries: false`) bleibt **eine** Zeile und
      nennt höchstens die Anzahl, nie die Namen.
- [x] Implementieren.

### T13: Cache, `structuredContent`, REST

**Dateien**
- Ändern: `src/rest/search-page.ts`
- Ändern: `tests/tools-registry-cache.test.ts`

**Schritte**
- [x] Roter Test: das Feld überlebt Cache **und** `structuredContent`.
- [x] Roter Test: die HTML-Seite zeigt Kontextnamen statt der ersten vier Titel.
- [x] Die vier Tier-A-Aufrufer gegenprüfen (`node-details.ts:217`,
      `shared.ts:64`, `formatter.ts:580`) — keiner hängt an der alten Zeilenzahl.

**Ende P4:** `STATUS.md` fortschreiben, anhalten.

---

## Phase 5 — `skillContext` an den Sammlungs-Werkzeugen

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T14: Durchreichen bis `subjectRegistryText`

**Dateien**
- Ändern: `src/tools/shared.ts`, `src/formatter.ts`
- Ändern: `tests/tools-registry-cache.test.ts`

**Was.** `subjectRegistryText` nimmt einen optionalen Kontextnamen entgegen und
rendert dann diesen einen Kontext samt Anweisung — gekappt über `capText`,
geflacht über `flattenText`, als kuratierter Inhalt ausgewiesen.

**Schritte**
- [x] Roter Test: Treffer → Skills des Kontexts mit nodeIds, plus die
      kontextfreien, plus die Anweisung.
- [x] Roter Test: die Anweisung ist gekappt und als Repository-Inhalt
      gekennzeichnet, nicht als System-Anweisung.
- [x] Roter Test: das Budget gilt weiterhin — ein Kontext mit 40 Skills fällt in
      Form 3.
- [x] Roter Test: Sammlung ohne Registry schweigt wie heute.
- [x] Implementieren.

### T15: Der Parameter an fünf Werkzeugen

**Dateien**
- Ändern: `src/tools/collections.ts` (2×), `src/tools/node-details.ts`,
  `src/tools/topic-page-content.ts`, `src/tools/node-relations.ts`
- Ändern: `tests/tools-registry-cache.test.ts`, `tests/tool-descriptions.test.ts`

**Schritte**
- [x] Roter Test je Werkzeug: `skillContext` wirkt.
- [x] Roter Test: **unbekannter Name → volle Budgetform** (alle Skills, soweit
      das Budget sie trägt) **plus alle Kontextnamen** plus die Zeile, die den
      Fehlgriff benennt. **Kein** `isError`, nie eine leere Antwort.
- [x] Roter Test: mehrdeutiger Name verhält sich genauso, mit den qualifizierten
      Pfaden.
- [x] Roter Test: bei einem Fehlgriff kommt **kein** Anweisungstext mit — nur
      Namen und der Zeiger. Ein Modellfehler darf nicht die teuerste Antwort des
      Systems auslösen (bewusste Abweichung, im Entwurf begründet).
- [x] Roter Test: `search_wlo_collections` und `search_wlo_all` haben den
      Parameter **nicht** — Zusicherung, nicht Auslassung.
- [x] Beschreibungen unter 1024 Zeichen für alle fünf.
- [x] Implementieren.

### T16: Wächter

**Dateien**
- Ändern: `tests/shared-rule-discipline.test.ts`

**Was.** `resolveContext` wird nur in `services/registry-contexts.ts` definiert und
nirgends nachgebaut — sechs Werkzeuge nehmen einen Kontextnamen an, und sechs
Kopien der Normalisierungs- und Mehrdeutigkeitsregel wären die Doppelung, gegen
die dieser Bereich schon fünf Wächter hält.

**Schritte**
- [x] Wächter schreiben.
- [x] **Verletzung einspielen und rot sehen** — ein Wächter, der nie rot war,
      ist nicht bewiesen.
- [x] Verletzung zurücknehmen, grün.

**Ende P5:** `STATUS.md` fortschreiben, anhalten.

---

## Phase 6 — Doku und Redaktion

**Schritt 0: `/better-coding-workflow` aufrufen.**

### T17: Alles synchronisieren

**Dateien**
- Ändern: `docs/SKILLS.md`, `docs/SKILL-TRIGGER.md`, `docs/TOOLS.md`,
  `docs/TOOLS-KOMPAKT.md`, `README.md`, `README.de.md`, `CHANGELOG.md`,
  `CLAUDE.md`, `docs/plans/STATUS.md`

**Schritte**
- [x] `docs/SKILLS.md`: die Struktur für Kuratoren, mit Beispiel und der Regel
      **„Anweisung vor die Blöcke"**.
- [x] `docs/SKILL-TRIGGER.md`: die Kurzfassung.
- [x] `docs/TOOLS.md`, `TOOLS-KOMPAKT.md`, beide READMEs: `context` und
      `skillContext` benannt (`tests/docs-claims.test.ts:279`).
- [x] `CLAUDE.md`: neuer Block; **Korrektur „56 `:::` blocks" → 28 Blöcke /
      56 Zaunzeilen**. Zusätzlich eine Überholt-Marke am `REGISTRY_LINES_MAX`-Absatz
      von 2026-08-11 — die Konstante gibt es seit P4 nicht mehr.
- [x] `CHANGELOG.md`, `STATUS.md`.
- [x] `npm test` (2027 pass, 0 fail) · `npm run lint` (0) ·
      `npx tsc -p tsconfig.typecheck.json` (0).

### Danach (nicht Code)

- [x] Live-Lauf gegen Staging: `loadSkillRegistry` auf Optik (1,9 s, 3 Einträge,
      2 Kontexte, 0 unresolved); Ausgabelänge gerendert gemessen. **Er hat die
      Zusage „nie länger" widerlegt** — bei dieser kleinen Registry 818 gegen 659
      Zeichen, weil die Gruppierung innerhalb des Budgets eine Zeile je Kontext
      kostet. Entwurf, STATUS und alle Nutzerdokumente korrigiert.
- [ ] Redaktion: das Optik-Dokument auf sieben H2 umbauen (die Gruppen stehen
      schon in den Keywords), dann erneut messen.
