# Design: Kontexte in der Skill-Registry

## Goal

Ein Registry-Dokument gliedert seine Skills über Markdown-Überschriften in
**Arbeitskontexte** und stellt jedem eine **Nutzungsanleitung** der Redaktion
voran. Werkzeuge liefern wahlweise alles oder gezielt einen Kontext — und was an
jedem Sammlungstreffer mitreist, wird dabei **kürzer**, nicht länger.

## Context

Aus dem Registry-Dokument liest der Server heute **ausschließlich** den
`::: ki-skill`-Block. Überschriften, Prosa und Anwendungshinweise werden beim
Parsen übersprungen; sichtbar werden sie nur, weil `get_skill_registry` das
Dokument unverändert mit ausgibt.

Damit fehlen zwei Dinge, die die Redaktion braucht: eine Gliederung („welche
Skills gelten für welche Arbeit") und die Anleitung dazu („zuerst /lehrprofil,
sonst fragt jeder Skill erneut nach dem Bundesland"). Beides steht bereits im
Dokument — es wird nur nicht gelesen.

Gleichzeitig ist die Ausgabemenge aus dem Ruder gelaufen: `REGISTRY_LINES_MAX`
steht auf 100, also schreibt eine Registry mit 60 Skills 60 Zeilen in **jeden**
Sammlungstreffer. Beide Themen treffen dieselbe Funktion und werden deshalb
zusammen behandelt.

### Messungen, auf denen dieser Entwurf ruht

Staging, 2026-08-18, `get_skill_registry` auf `9e7ae956-e9df-430f-bace-f3db4b910013`
(Sammlung „Optik"). Vor einem Widerspruch neu messen.

| Frage | Ergebnis |
|---|---|
| Registry vorhanden? | Ja — „Skillkatalog Physik Optik", `d84d54c4-f473-4e4b-8d54-c4f4738e4b87` |
| Umfang | 16 717 Zeichen, **28** `::: ki-skill`-Blöcke, 28 Einträge, 0 unresolved |
| Nutzt das Dokument schon Überschriften? | **Ja — aber eine `##` je Skill.** 28 H2, jede mit genau einem Block |
| Steht Prosa im Dokument? | Ja: je Skill ein Beschreibungsabsatz plus eine Liste `Aufruf:` / `Node-ID:` / `Arbeitsbereich:` |
| Gibt es bereits eine fachliche Gruppierung? | Ja — in den **Keywords**: sieben Gruppen („Kommunikation & Organisation", „Diagnostik und Bewertung", „Vorgabe & Planung", „Material", „Kontext & Zugang", „Erschließen & Beschreiben", „Fragen & Qualität") |
| Was kostet diese Gruppierung heute? | 28 Metadaten-Abrufe (nur der Werkzeug-Tarif kennt Keywords) |
| Was kostet sie als `##` im Dokument? | **nichts** — der Text ist im billigen Tarif ohnehin gelesen |

Drei Folgerungen, die den ganzen Entwurf tragen:

1. **Die gewünschte Struktur existiert schon, nur am falschen Ort.** Sie aus den
   Keywords in die Überschriften zu heben macht sie kostenlos und redaktionell
   pflegbar.
2. **Das vorhandene Dokument passt noch nicht.** Eine H2 je Skill ergibt unter
   der neuen Regel 28 Kontexte mit je einem Skill — korrekt geparst, nutzlos. Der
   Umbau ist Redaktionsarbeit, keine Codeaufgabe; der Code muss den
   Übergangszustand aber **anständig** überstehen (siehe Zeilenbudget).
3. **Kontexte kosten null zusätzliche Abrufe.** Sie stehen im Dokumenttext, den
   `resolveHeads: false` bereits liest (1 × `/children`, 1 × Download). Das gilt
   auch für den Cache, der den Katalog im bestehenden Feld mitführt.

**Korrektur einer bestehenden Angabe:** `CLAUDE.md` nennt „56 `:::` blocks". Es
sind **28 Blöcke** mit 56 Zaunzeilen (je öffnend und schließend). Wird im
Doku-Paket richtiggestellt.

## Scope

**In scope**

- Ein Abschnitts-Parser für Markdown-Überschriften (rein, kein I/O).
- `contexts` am `SkillRegistry`, `context` am Eintrag, beides in **beiden**
  Tarifen gefüllt.
- `resolveContext` — eine Auflösungsregel für Kontextnamen, geteilt von allen
  Werkzeugen.
- `context` an `get_skill_registry`: gefilterter Katalog, Anleitung, und der
  **Abschnitt** statt des ganzen Dokuments.
- `skillContext` an den fünf Werkzeugen, die über **eine** Sammlung antworten.
- Ein Zeilenbudget für den Katalog, der an Sammlungstreffern mitreist
  (`REGISTRY_INLINE_MAX` ersetzt `REGISTRY_LINES_MAX`).
- Redaktionsdokumentation der neuen Struktur.

**Out of scope**

- **Skill-Prosa als Beschreibung.** Der Absatz nach einem Block ließe sich als
  Beschreibung im billigen Tarif ausgeben und würde 28 Metadaten-Abrufe sparen. Nicht
  gefragt, spekulativ, und über den wortgetreuen Abschnitt ohnehin sichtbar.
- **Kontext an `search_skill` / `get_skill_for_task`.** Die suchen im ganzen
  Repository, nicht in der Registry einer Sammlung.
- **`skillContext` an `search_wlo_all` / `search_wlo_collections`.** Begründung
  unten — die Namen sind je Registry vergeben.
- **Eine Heuristik gegen „eine H2 je Skill".** Redaktionsarbeit an genau einem
  Dokument, keine Rateregel im Parser.

## Approach

### Das Format, das die Redaktion schreibt

    # Skillkatalog Physik Optik          ← Dokumententitel, vom Parser ignoriert

    Einleitung, Bezugsquelle, Lizenz.    ← kontextfreie Prosa

    ::: ki-skill
    [Lehrkontext erfassen](…/render/3e92f908-…)
    :::                                  ← kontextfreier Skill: gilt IMMER

    ## Vorgabe & Planung                 ← Kontext

    Zuerst /lehrprofil aufrufen, sonst   ← ANWEISUNG (bis zum ersten Block)
    fragt jeder Skill erneut nach.

    ::: ki-skill
    [Stunde planen](…/render/5b29f470-…)
    :::

    Plant eine Einzel- oder Doppelstunde …  ← Skill-Prosa, NICHT Anweisung

    ### Wochenplanung                    ← Unterkontext, erbt die Anweisung oben

    ###                                  ← ohne Titel: kein Kontext, durchlässig
                                            → sein Inhalt gehört „Vorgabe & Planung"

    ##                                   ← ohne Titel, oberste Ebene: durchlässig
                                            → sein Inhalt gehört dem allgemeinen Teil

### Die drei Regeln, die daraus folgen

1. **Anweisung = Prosa von der Überschrift bis zum ersten Skill-Block.** Text
   nach einem Block gehört dem Skill davor. Hat ein Abschnitt gar keine Blöcke,
   ist seine ganze Prosa Anweisung. Nutzerentscheidung 2026-08-18: „der Text, der
   nicht zu den Skills gehört".
2. **Der allgemeine Teil gilt immer.** Was zu keinem benannten Kontext gehört —
   die Skills und die Prosa vor der ersten H2 — kommt bei **jedem**
   Kontext-Aufruf mit, als solches gekennzeichnet.
2b. **Ein Abschnitt OHNE Titel ist durchlässig.** Er erzeugt keinen Kontext (per
   Namen wäre er nicht aufrufbar), aber sein Inhalt geht nicht verloren: er
   gehört dem nächsten **benannten** Kontext darüber, und gibt es keinen, dem
   allgemeinen Teil. Ein namenloses `##` auf oberster Ebene landet damit im
   Allgemeinen, ein namenloses `###` innerhalb seiner H2 dagegen bei dieser H2 —
   was in beiden Fällen der Stelle entspricht, an der die Redaktion es
   hingeschrieben hat. Eine Regel, zwei richtige Ergebnisse; die Alternative
   („verwerfen") hätte Skills verschluckt.
3. **Eine H3 erbt die Anweisung ihrer H2.** Ein Unterkontext sitzt im Kontext;
   ihn ohne dessen Anweisung auszuliefern wäre eine unvollständige Antwort.
   Dieselbe Logik wie (2), eine Ebene höher.

## Global constraints

Aus `CLAUDE.md`, gelten unverändert:

- ESM, `.js`-Endung an projektinternen Importen.
- Ein Werkzeugmodul hält Schema und Rendering, nie einen Algorithmus.
- Ein neues `FormattedNode`-Feld **muss** in `formattedNodeSchema` deklariert
  sein; Text- und JSON-Zusicherung sind getrennte Aufgaben.
- Jeder repository-gelieferte Wert in einer zeilenorientierten Ausgabe geht durch
  `oneLine`.
- Deutsch für Nutzertexte, Englisch für Bezeichner, Kommentare, Doku.

## Architecture

### Files

| Datei | Verantwortung |
|---|---|
| **neu** `src/services/markdown-sections.ts` | Was für Abschnitte hat dieses Markdown? Rein, kein I/O. |
| `src/services/skill-references.ts` | + `offset` am `SkillReference` — **ein** Block-Parser bleibt einer. |
| `src/services/skill-registry.ts` | `RegistryContext`, `contexts`, `entry.context`, `resolveContext`, `REGISTRY_CONTEXT_MAX` |
| `src/formatter.ts` | `contexts` am Knotenfeld · `REGISTRY_INLINE_MAX` · drei Ausgabeformen |
| `src/apps/outputSchemas.ts` | zod-Spiegel des neuen Feldes |
| `src/tools/skill-registry.ts` | `context`-Parameter, gefilterte Ausgabe, Abschnitt statt Dokument |
| `src/tools/shared.ts` | `subjectRegistryText` nimmt den Kontext entgegen |
| `src/tools/collections.ts`, `node-details.ts`, `topic-page-content.ts`, `node-relations.ts` | `skillContext`-Parameter |
| `src/rest/search-page.ts` | Kontextnamen statt der ersten vier Titel |

### Data flow

    Dokument (Text, bereits gelesen)
       ├─ parseSections()          → Überschriften mit Offsets      [markdown-sections.ts]
       └─ parseSkillReferences()   → Blöcke mit Offsets             [skill-references.ts]
                    ↓ zusammengeführt über den Offset
          buildRegistryFrom()      → contexts[] + entries[].context [skill-registry.ts]
                    ↓
       ┌────────────┴─────────────┐
       ↓                          ↓
    toRegistrySummary()      get_skill_registry
       ↓ (Cache, Treffer)         ↓ (mit/ohne context)
    registrySummaryLines()   Katalog + Abschnitt

### Interfaces

```ts
// markdown-sections.ts
export interface MarkdownSection {
  level: number;        // 1–6
  title: string;
  headingStart: number; // Offset der '#'-Zeile
  bodyStart: number;    // Offset hinter der Überschriftenzeile
  end: number;          // Offset der nächsten Überschrift gleicher/höherer Ebene
}
export function parseSections(markdown: string): MarkdownSection[];

// skill-references.ts — additiv
export interface SkillReference { /* … */ offset: number }

// skill-registry.ts
export interface RegistryContext {
  title: string;          // nie leer — ein namenloser Abschnitt wird kein Kontext
  level: 2 | 3;
  path: string;           // "H2" bzw. "H2/H3"
  instruction?: string;
  skills: string[];       // nodeIds, Dokumentreihenfolge
  range: { start: number; end: number };  // Abschnitt im Dokument, fuer den Ausschnitt
}

/** Was zu keinem benannten Kontext gehört und deshalb immer gilt. */
export interface RegistryGeneral {
  /** Prosa vor der ersten H2, plus die namenloser Abschnitte auf oberster Ebene. */
  instruction?: string;
  /** nodeIds außerhalb jedes benannten Kontexts. */
  skills: string[];
}
export type ContextResolution =
  | { kind: 'all' }
  | { kind: 'found'; context: RegistryContext; parent?: RegistryContext; children: RegistryContext[] }
  // Alle Nicht-Treffer werden vom Aufrufer GLEICH behandelt: wie 'all', plus
  // eine Zeile, die den Fehlgriff benennt. Sie bleiben getrennte Fälle, weil
  // sich nur der erklärende Satz unterscheidet — siehe "Ein Fehlgriff liefert
  // alles, nie nichts".
  | { kind: 'unknown'; available: string[] }
  | { kind: 'ambiguous'; paths: string[] }
  | { kind: 'no_contexts'; asked: string };   // ← Review 2026-08-18, siehe unten
export function resolveContext(
  contexts: readonly RegistryContext[], wanted: string | undefined): ContextResolution;

**Zwei Korrekturen am obigen Entwurfsstand, beide aus dem Review vom
2026-08-18.**

1. **`no_contexts` ist ein eigener Ausgang.** Hier standen ZWEI Nicht-Treffer,
   und ein Name über einem Dokument ohne Gliederung fiel unter `all`. Damit
   mussten beide Aufrufer den Unterschied selbst herleiten, und sie schrieben
   verschiedene Bedingungen: `get_skill_registry` nahm das reservierte `all`
   aus, `subjectRegistryText` nicht — also meldete `skillContext: "all"` auf
   einer flachen Registry, „all" habe nicht gegriffen. Die Regel „`resolveContext`
   lebt an genau einer Stelle" war formal eingehalten und in der Sache verletzt:
   der Wächter prüft die FUNKTION, nicht die ENTSCHEIDUNG. Wer hier einen
   Ausgang ergänzt, gibt ihm einen eigenen `kind`.
2. **Die Signatur nimmt die Kontexte, nicht die Registry.** Folge der
   Modul-Aufteilung (in der Aufgabenliste festgehalten): `registry-contexts.ts`
   kennt `SkillRegistry` nicht und soll es nicht kennen.
```

Am Knotenfeld (`formatter.ts`, gespiegelt in `apps/outputSchemas.ts`):

```ts
contexts?: { path: string; skills: number }[];
```

### Dependencies

Keine neuen. Der Abschnitts-Parser sind zwei reguläre Ausdrücke und eine
Schleife; eine Markdown-Bibliothek dafür wäre ein Paket für einen Einzeiler.

## Non-functional

**Performance — die tragende Zusage.** Kontexte kosten **null** zusätzliche
Abrufe. Der billige Tarif bleibt bei exakt 1 × `/children` + 1 × Download +
0 × Metadaten; die bestehende Zählung in `tests/skill-registry.test.ts:362` ist
die Zusicherung und muss unverändert grün bleiben.

Die Ausgabemenge **sinkt**. An Optik gemessen (28 Skills, Zeichen):

| | heute | mit Budget |
|---|---|---|
| Kopfzeile | ~110 | ~120 |
| Skill- bzw. Kontextzeilen | ~3020 (28 × ~108) | ~280 (7 × ~40) |
| `DESCRIPTIONS_ONLY_NOTE` | ~200 | — (keine nodeId gedruckt) |
| Zeigerzeile | — | ~90 |
| **je Sammlung** | **~3330** | **~490** |
| bei 5 Sammlungen | ~16 600 | ~2450 |

Davon sind heute 1008 Zeichen nackte UUIDs (28 × 36). Sie kaufen genau eine
Fähigkeit — `get_skill` direkt aufzurufen, also den Schritt zu überspringen, von
dem die drei Zeilen darunter sagen, dass man ihn nicht überspringen soll.

Der gezielte Aufruf kostet **weniger** als heute: `get_skill_registry` mit
`context` liest nur die Metadaten der Skills dieses Kontexts — bei Optik 5 statt
28.

**Sicherheit.** Der Anweisungstext ist Repository-Inhalt, also ungeprüft. Zwei
Regeln:

- Im Markdown-Zweig von `get_skill_registry` steht er **unterhalb des `---`**, im
  wortgetreuen Abschnitt. Serverseitig hergeleitete Abschnitte stehen davor,
  weil sie danach von gefälschten nicht mehr zu unterscheiden sind
  (`tests/tools-skill-registry.test.ts:64`). Als benanntes JSON-Feld ist er
  eindeutig und dort richtig aufgehoben.
- Im Treffer erscheint er **nur**, wenn ein Aufrufer ihn über `skillContext`
  ausdrücklich angefordert hat — gekappt über `capText`, geflacht über
  `flattenText`, als kuratierter Inhalt ausgewiesen.

**Observability.** Eine gekappte Kontextliste wird offengelegt, nicht still
gekürzt — dieselbe Haltung wie `truncated` und `scanTruncated`.

## Das Zeilenbudget

    REGISTRY_INLINE_MAX = 12                     // Zeilen für den Katalog im Treffer

    Kontextzeilen + Skillzeilen ≤ 12           →  beides, gruppiert, mit nodeIds
    sonst: Kontexte da UND Kontextzeilen ≤ 12  →  Kontext-Index (Namen), keine UUIDs
    sonst                                      →  Kopfzeile mit Anzahl, ohne Namen

Eine Zahl, drei Formen.

**Korrigiert am 2026-08-18 (P6, Live-Lauf).** Hier stand „monotoner Abbau: je
größer die Registry, desto kürzer wird sie im Treffer — nie länger". Das ist
falsch und war es von Anfang an: gedeckelt ist die OBERGRENZE. Innerhalb des
Budgets kostet die Gruppierung eine Zeile je Kontext, eine kleine Registry wird
dadurch etwas länger als ihre flache Liste — am echten Optik-Dokument (3 Skills
in 2 Kontexten) 818 gegen 659 Zeichen. Die Ersparnis entsteht ausschließlich
oberhalb des Budgets, dort dann sehr deutlich (28 Skills in 7 Kontexten: 407
gegen 3436 Zeichen). Gefunden hat es der Live-Lauf; kein Test prüft die
Ausgabelänge gegen die einer Form, die es nicht mehr gibt.

**Kontextnamen werden GEPACKT, nicht eine je Zeile:** mehrere je Zeile, mit `·`
getrennt, umbrochen bei ~100 Zeichen. Sieben Kontexte sind damit zwei Zeilen, nicht
sieben. Das ist der Grund, warum Form 2 fast immer greift und Form 3 der seltene
Ausnahmefall bleibt — was gewollt ist: **ohne Namen kann niemand gezielt
nachfragen.**

    Skill-Registry: Skillkatalog Physik Optik (nodeId: d84d…) — 28 freigegebene Skills in 7 Kontexten
      Kontexte: Vorgabe & Planung (5) · Diagnostik & Bewertung (4) · Material (3) · Kontext & Zugang (3)
      Kontexte: Kommunikation & Organisation (5) · Erschließen & Beschreiben (3) · Fragen & Qualität (2)
      Skills und Anleitung je Kontext: get_skill_registry mit nodeId d84d… und context:"…"

| Fall | heute | neu |
|---|---|---|
| 3 Skills, 2 Kontexte | 5 Zeilen | **unverändert**, mit nodeIds |
| Optik nach dem Umbau: 7 Kontexte, 28 Skills | 30 Zeilen | Form 2 — 3 Zeilen, ~490 Zeichen |
| Optik **vor** dem Umbau: 28 Ein-Skill-Kontexte | 30 Zeilen | Form 2 oder 3, je nach Namenslänge (s. u.) |
| flach, 50 Skills, keine Kontexte | **50 Zeilen** | Form 3 — Kopfzeile allein |
| flach, 8 Skills | 8 Zeilen | **unverändert** |

Drei Eigenschaften, die die Regel tragfähig machen:

- **Der Übergangszustand bleibt besser als heute, aber knapp.** Die 28
  Kontextnamen des heutigen Optik-Dokuments sind die Skilltitel selbst (~35
  Zeichen), gepackt also rund 12 Zeilen — genau an der Grenze. Ob Form 2 oder 3
  greift, entscheidet die Namenslänge; beides liegt bei ~1200 bzw. ~150 Zeichen
  gegen heute ~3330. Eine krisp klingende Zusage wäre hier falsch: es sind
  zwischen Faktor 2,8 und Faktor 22, und welcher, hängt am Dokument.
- **Auch flache Dokumente gewinnen, und zwar am meisten.** Die 100er-Grenze
  verschwindet aus dem Treffer; was heute 50 Zeilen schreibt, schreibt eine. Das
  braucht gar keine Kontexte.
- **Form 3 nennt trotzdem die Anzahl und den Weg.** Sie ist der einzige Fall ohne
  Namen — dann ist `get_skill_registry` die ehrliche Antwort, und die Kopfzeile
  sagt das.

## `skillContext` an den Sammlungs-Werkzeugen

Fünf Werkzeuge antworten über **eine** Sammlung und bekommen den Parameter:
`get_collection_contents`, `search_wlo_within_collection`, `get_node_details`,
`get_topic_page_content`, `get_related_content` — also genau die Aufrufer von
`subjectRegistryText` plus `get_node_details`.

Wirkung: statt der Kontextübersicht rendert der Katalog **diesen einen Kontext**
— seine Skills mit nodeIds (weiter im Budget) und die Anweisung dazu. Damit
entfällt der zweite Aufruf: Sammlung, Kontext, Anleitung und Skill-nodeIds in
einer Antwort.

**Kostenzusage korrigiert am 2026-08-18 (P5), gemessen statt angenommen.** Hier
stand „zu null zusätzlichen Abrufen". Das gilt für den Kontext-INDEX, nicht für
eine ANLEITUNG: der Cache hält die Zusammenfassung — Titel, nodeId,
Kontextnamen, Anzahlen — und **nicht** die Prosa der Redaktion, die je Sammlung
Kilobytes wäre und dann in jedem Treffer läge. Ein benannter Kontext kostet
deshalb **einen Live-Abruf: 2 Anfragen, rund 1,0–1,4 s**. Opt-in, eine Sammlung,
und immer noch billiger als der Rundlauf, den er ersetzt —
`get_skill_registry` zahlt dieselben zwei plus einen Metadaten-Abruf je Skill.
Dieselbe Größenordnung und dieselbe Formulierung wie beim vorhandenen
`includeSkillRegistry`.

Der Name ist `skillContext`, nicht `context`: in einem Sammlungs-Werkzeug klänge
`context` nach Suchkontext.

Passt der Name nicht, fällt die Antwort auf die volle Budgetform zurück und nennt
alle vorhandenen Kontexte — nie eine leere oder verkürzte Antwort, nie ein
Fehler. Der Kontext-Index reist ohnehin mit, also lernt ein Modell die richtigen
Namen aus genau der Antwort, in der es danebengegriffen hat.

**Nicht an `search_wlo_all` / `search_wlo_collections`** — dort hat die Regel
ihre Grenze. Die Kontextnamen sind **je Registry** vergeben; ein Parameter über
fünf Sammlungen träfe in der einen und ginge in der anderen ins Leere, hieße also
je Zeile etwas anderes. Was diese Werkzeuge stattdessen liefern, ist die
Übersicht, aus der ein Modell die Namen überhaupt erst lernt.

**Nicht an die drei Kopfzeilen-Werkzeuge** (`browse_collection_tree`,
`get_subject_portals`, `search_wlo_topic_pages`): sie rendern einen Block je
Knoten und haben nie einen Katalog getragen.

## Ein benannter Abschnitt IST ein Kontext, auch ohne Skill

Der erste Entwurf verlangte mindestens einen Skill — mit der Begründung, ein
leerer Kontext verspreche einen Abruf, der nichts liefert. **Ein Lauf gegen das
echte Optik-Dokument am 2026-08-18 hat das widerlegt.** Die Redaktion hatte
`## Browserplugin` mit Anweisung und noch ohne Skills angelegt: eine Gruppe wird
erst erzeugt und dann gefüllt. Unter der alten Regel fehlte diese Überschrift im
Katalog **und** `resolveContext` antwortete „unbekannt" auf einen Namen, den
jeder im Dokument lesen kann — eine falsche Aussage über ein sichtbares Dokument.

Ein zweites Argument entscheidet es unabhängig davon: ein rein gruppierender
Kontext (seine Skills liegen in seinen Unterkontexten) wird ohnehin mit **0**
gelistet. Diese Null zu zeigen und die eines Blattes zu verbergen, wäre dieselbe
Zahl in zwei Behandlungen.

Der Preis ist gering und sichtbar: ein Abschnitt wie „Über diesen Katalog" wird
als Kontext mit 0 Skills geführt. Er trägt dann seine Prosa als Anweisung, was
für einen Aufrufer eher nützlich als störend ist.

## Regeln, die jede Änderung hieran binden

- **Der Kopfzeilen-Tarif (`entries: false`) bleibt einzeilig.** Er darf höchstens
  die Kontext-ANZAHL nennen, nie die Namen — dreißig Portale mit je sieben
  Kontextzeilen zerstören die Form, für die es diesen Tarif gibt.
- **`DESCRIPTIONS_ONLY_NOTE` nur, wenn eine Skill-nodeId gedruckt wurde.** In
  Form 2 und 3 also nicht; sonst verspricht sie einen Schritt, den die Antwort
  nicht trägt. Die bestehende Bedingung greift von selbst — sie wird zugesichert,
  nicht angenommen.
- **`REGISTRY_LINES_MAX` wird ersetzt, nicht ergänzt.** Zwei Deckel auf derselben
  Liste sind die Doppelung, an der die `truncated`-Offenlegung in diesem Projekt
  schon einmal auseinandergelaufen ist. Die dienstseitige Kappung bei
  `REGISTRY_SEARCH_MAX` bleibt unberührt: sie betrifft, was die Registry
  *enthält*, nicht was der Treffer *zeigt*.
- **Das Budget gilt je Registry, nicht je Antwort** — vorhersagbar und je Knoten
  prüfbar. `skillContext` durchbricht es nicht.
- **`resolveContext` lebt an genau einer Stelle.** Sechs Werkzeuge nehmen einen
  Kontextnamen entgegen; sechs Kopien der Normalisierungs- und
  Mehrdeutigkeitsregel wären genau die Doppelung, gegen die dieser Bereich schon
  fünf Wächter hält. Ein sechster kommt dazu.
- **Ein Fehlgriff liefert alles, nie nichts** — eigener Abschnitt unten.

## Ein Fehlgriff liefert alles, nie nichts

Ein Modell rät einen Kontextnamen, bevor es die Namen kennt — das ist der
Normalfall, nicht die Ausnahme. Also darf ein Fehlgriff **niemals** eine leere
oder verkürzte Antwort erzeugen; er fällt auf die vollständige zurück und sagt,
was schiefging.

Das gilt für **beide** Nicht-Treffer gleichermaßen. Ein mehrdeutiger Name ist
kein besserer Fall als ein unbekannter: in beiden steht kein eindeutiger Kontext
fest, und raten ist die eine Antwort, die dieses Projekt nirgends gibt.

| Ergebnis | `get_skill_registry` | die fünf Sammlungs-Werkzeuge |
|---|---|---|
| Treffer | dieser Kontext + Anweisung + Abschnitt wortgetreu | dieser Kontext + Anweisung, im Budget |
| unbekannt | **das ganze Dokument**, wie ohne `context` | volle Budgetform + Kontext-Index |
| mehrdeutig | **das ganze Dokument**, wie ohne `context` | volle Budgetform + Kontext-Index |
| keine Kontexte im Dokument | das ganze Dokument | volle Budgetform |

In allen vier Zeilen steht **zusätzlich** eine Zeile, die den Fehlgriff benennt
und die vorhandenen Namen aufzählt — bei Mehrdeutigkeit die qualifizierten Pfade.
Nie ein `isError`; dieselbe Haltung wie `missText` und `ambiguous` bei der
Registry-Auswahl.

### Warum die Sammlungs-Werkzeuge NICHT die Anweisungstexte mitschicken

Wörtlich gefordert war „immer alle Skills **und Anweisungen** aus dem Dokument".
Für `get_skill_registry` ist das genau so umgesetzt: das ganze Dokument, alle
Anweisungen enthalten.

Bei den Sammlungs-Werkzeugen wäre es der Widerspruch zum Budget, das dasselbe
Paket einbaut: sieben Anweisungen à bis zu 1200 Zeichen sind ~8 kB — in **jedem**
Sammlungstreffer, ausgelöst durch einen Tippfehler im Kontextnamen. Ein
Modellfehler darf nicht die teuerste Antwort des Systems auslösen.

Was diese Werkzeuge stattdessen liefern, erfüllt den Zweck der Forderung: die
vollständige Skill-Liste (soweit das Budget sie trägt), **alle** Kontextnamen,
und den Zeiger auf `get_skill_registry` — womit die Anweisungen einen Aufruf
entfernt sind, mit dann korrektem Namen. Kein Aufrufer bleibt hängen.

Diese Abweichung ist bewusst und wird hier festgehalten, nicht stillschweigend
umgesetzt.

## Risks

| Risiko | Gegenmaßnahme |
|---|---|
| Das echte Dokument passt noch nicht (28 Ein-Skill-Kontexte) | Das Budget fängt es ab: Form 3, eine Zeile. Auslieferung ist von der Redaktionsarbeit entkoppelt. |
| Der `reach`-Satz der Kopfzeile wird falsch | Heikelste Stelle des Pakets. `tests/formatter.test.ts:368-506` führt ein halbes Dutzend verbotener Formulierungen; jede neue Form braucht ihre eigene Zusicherung. |
| Ein `#` in einem Codeblock täuscht eine Überschrift vor | Der Parser überspringt eingezäunte Codeblöcke. Test dafür. |
| Ein `\n` in einer Überschrift fälscht eine Zeile | `oneLine` auf jedem Kontextnamen, zugesichert. |
| Flache Registries ändern ihr Verhalten unbemerkt | Regressionstest: kleine flache Registry rendert **zeichengleich** wie heute. |
| Werkzeugbeschreibungen reißen die 1024-Zeichen-Grenze | `tests/tool-descriptions.test.ts:116` prüft es; vor dem Ergänzen messen. |
| Ein geratener Kontextname liefert eine leere Antwort | Rückfall auf alles, plus Kontext-Index — eigener Abschnitt, je Werkzeug zugesichert. |
| Ein Modellfehler löst die teuerste Antwort aus | Die Sammlungs-Werkzeuge schicken bei einem Fehlgriff **keine** Anweisungstexte mit, nur Namen und den Zeiger. Bewusste Abweichung, begründet im Fehlgriff-Abschnitt. |

## Open questions

Keine. Die drei offenen Punkte (Trefferinhalt, Umfang der Anweisung, Umgang mit
kontextfreien Skills) sind am 2026-08-18 vom Nutzer entschieden und oben als
Regeln festgehalten.
