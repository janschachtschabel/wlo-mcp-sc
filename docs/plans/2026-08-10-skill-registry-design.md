# Design: Skill-Registry pro Inhaltssammlung

## Goal

Eine Inhaltssammlung nennt selbst, welche Skills für sie erlaubt sind — über ein
Registry-Dokument in der Sammlung. Ein Werkzeug liefert diesen Katalog (Kopf je
Skill: Titel, Beschreibung, Schlagwörter) plus die Prosa der Registry; das Modell
wählt daraus und holt den Volltext weiterhin mit `get_skill`.

## Context

Heute findet `search_skill` Skills über die Inhaltsart `ai_prompt` — im ganzen
Repository oder in einer genannten Sammlung. Der neue Redaktionsprozess dreht die
Richtung um: nicht mehr „welche Skills gibt es", sondern **„welche Skills sind für
diese Sammlung freigegeben"**. Die Freigabe steht als Dokument in der Sammlung.

Der alte Weg bleibt im Code und wird per Env abschaltbar, damit die Umstellung
rückholbar ist.

## Scope

**In scope**

- Neues Werkzeug `get_skill_registry` — Registry einer Sammlung finden, lesen,
  Katalog + Prosa liefern.
- Auflösen der referenzierten Skills auf ihren **Kopf** (Titel, Beschreibung,
  Schlagwörter, nodeId) — das ist die Entscheidungsgrundlage des Modells.
- Registry-Katalog automatisch bei der Sammlungssuche (`search_wlo_collections`,
  `searchAll`) — in der günstigen Stufe (Titel + nodeId, keine Kopf-Abrufe).
- Env-Schalter `WLO_DISABLE_SKILL_SEARCH` für `search_skill` und
  `WLO_REGISTRY_IN_SEARCH` für die Anreicherung der Suche (Standard: aus).
- Doku: `docs/SKILLS.md` (Redaktion), `docs/TOOLS.md`, `INTEGRATION.md`, READMEs.

**Out of scope**

- Volltext aller gelisteten Skills in einem Aufruf. Bewusst nicht: bei zehn
  Skills sprengt das das Kontextfenster. Das Modell holt gezielt mit `get_skill`.
- Schreiben/Pflegen von Registries (kein Kurationswerkzeug).
- Änderung an `get_skill` selbst.
- Ein neues Vokabular oder MDS-Feld im Repository.

## Approach

### Die tragende Beobachtung

**Eine Registry ist ein Skill-Datensatz.** Gleiche Inhaltsart (`ai_prompt`),
gleiche angehängte Markdown-Datei, gleiche `:::`-Verweisblöcke. Damit ist der
Neubau klein — drei vorhandene Bausteine tragen ihn:

> **Nachtrag 2026-08-12 — die Inhaltsart ist NICHT mehr dieselbe.** Das
> Vokabular bekam einen eigenen Eintrag `ai_skill` („KI-Skill"), und WLO hat die
> Skill-Datensätze darauf umgezogen. Ein Skill trägt seither `ai_skill`
> (`SKILL_CONTENT_TYPE_URI`), ein Registry-Dokument behält `ai_prompt`
> (`REGISTRY_CONTENT_TYPE_URI`) — genau das, was der Begriff jetzt noch meint:
> ein Prompt-Dokument ÜBER Skills. Alles Übrige dieses Abschnitts gilt
> unverändert: Dateiform und `:::`-Blöcke sind gleich, die drei Bausteine tragen
> den Neubau weiterhin. Gemessen als Dienstnutzer: 31 Datensätze unter
> `ai_skill`, 2 unter `ai_prompt` (beide Registries).

| Vorhanden | Leistet |
|---|---|
| `services/skills.ts` → `getSkill()` | liest die Datei, parst die `:::`-Blöcke zu `references` |
| `services/skill-references.ts` | kennt `ki-skill` vs. `wlo-material` **und** die Regel, welche ID zu welchem Block gehört |
| `SkillSummary` | trägt bereits `nodeId`, `originalId`, `title`, `description`, `keywords` |

Neu ist nur: **die Registry finden** und **die referenzierten IDs auf ihre Köpfe
auflösen**.

### T1 — was gegen Staging gemessen wurde (2026-08-10)

Diese Zahlen binden die Umsetzung. Wer ihnen widersprechen will, misst neu.

| Frage | Antwort |
|---|---|
| Trägt `/children` das Feld `mimetype`? | **Ja**, in jeder Projektion — `mimetype`/`mediatype` sind Knotenfelder, kein `propertyFilter` berührt sie. |
| Trägt `/children` `ccm:oeh_extendedType`? | **Nur mit ausdrücklicher Projektion.** Derselbe Knoten, derselbe Aufruf: mit `DISPLAY_PROPS` leer, mit `SKILL_PROPS` die volle URI. |
| Welchen Medientyp hat eine SKILL.md? | **`text/x-web-markdown`** (25/25), `mediatype: file-markdown`. Weder `text/markdown` noch `text/plain`. |
| Gibt es schon eine Registry? | **Nein.** `SKILL_REGISTRY` → 0 Treffer. |

Drei weitere Befunde derselben Messung, die den Plan berühren:

- **28 von 28** Skill-Datensätzen heißen `cm:name = SKILL.md`. Die Namensregel
  unterscheidet heute also **nichts** — sie ist eine künftige Konvention, und die
  Titelregel ist die, die sofort greifen kann.
- **0 von 28** sind Sammlungsverweise (`ccm:original` ≠ eigene id). Skills liegen
  heute in Arbeitsbereich-Ordnern, nicht in Sammlungen. Das ist genau der Prozess,
  den das Team gerade einführt — es heißt aber, dass T12 auf Redaktionsarbeit
  wartet, nicht auf Code.
- **0 von 28** Dokumenten enthalten `:::` überhaupt (roh geprüft, nicht nur über
  den Parser). Der Blockaufbau stammt aus dem WLO-Editor und ist in
  `docs/SKILLS.md` belegt, aber **kein Live-Dokument auf Staging übt ihn aus**.
  Der Parser ist durch Unit-Tests gedeckt, nicht durch einen echten Fund.

### Erkennung der Registry (Entscheidung des Teams)

In der Sammlung liegt ein Inhalt mit Inhaltsart `ai_prompt` **und** Markdown als
Medientyp. Bei mehreren Kandidaten gewinnt, wessen Datei `SKILL_REGISTRY.md`
heißt **oder** wer `SKILL REGISTRY` im Titel trägt (Groß-/Kleinschreibung egal).

Bleiben danach mehrere übrig, gewinnt der erste in stabiler Reihenfolge (nach
`nodeId`) — **und die Antwort sagt das**. Eine stillschweigend gewählte Registry
wäre genau die Sorte Fehler, die niemand bemerkt. Nach der Messung oben ist das
kein Randfall: solange jede Datei `SKILL.md` heißt, entscheidet allein der Titel,
und eine Sammlung mit zwei Skills darin fällt sofort in diesen Zweig.

Der Markdown-Test nimmt den gemessenen Wert `text/x-web-markdown`, dazu die
IANA-Schreibweise `text/markdown` und die historische `text/x-markdown`; ersatzweise
greift `mediatype === 'file-markdown'`. Eine einzige herstellerspezifische
Zeichenkette als alleinige Bedingung wäre der spröderer Weg, und die Tabelle
kostet nichts.

### Abgewogene Alternativen

**A — Registry über die Suche finden** (`ngsearch` mit `ai_prompt`, auf die
Sammlung eingegrenzt). Verworfen: Der Sammlungs-Scope ist upstream nicht
ausdrückbar (`virtual:primaryparent_nodeid` → 400, gemessen 2026-07-17) — und der
Optik-Fall dieser Woche zeigt, dass ein Datensatz aus dem Index fallen kann,
während er im Knotenspeicher liegt. Eine Freigabeliste darf nicht davon abhängen.

**B — Kinderliste der Sammlung lesen** (`getCollectionContents(id, 'files')`).
**Gewählt.** Ein Aufruf, unabhängig vom Suchindex, dieselbe Quelle, aus der die
Oberfläche die Sammlung zeigt.

**C — Neues Property/Vokabular für „ist Registry"**. Verworfen für jetzt:
verlangt eine MDS-Änderung im Repository und blockiert damit den Start. Die
Namenskonvention aus B ist die Brücke; C bleibt der saubere Endzustand.

### Prosa der Registry

Das Markdown wird **unverändert** mitgeliefert — dort stehen laut Team
Verwendungshinweise. Reihenfolge in der Antwort: **erst der servergebildete
Katalog, dann das Dokument.** Das ist die bestehende Projektregel: nach dem
Dokument sind servergebildete Abschnitte nicht mehr von gefälschten zu
unterscheiden.

## Architecture

### Files

| Datei | Verantwortung |
|---|---|
| **`src/services/skill-registry.ts`** (neu) | Registry finden + Katalog bauen. Kein MCP-Import. |
| `src/tools/skills.ts` (ändern) | `get_skill_registry` registrieren; `search_skill` hinter dem Env-Schalter. |
| `src/services/search.ts` (ändern) | Registry-Marker an die Sammlungs-Ergebnisse. |
| `src/tools/collections.ts` (ändern) | Marker rendern. |
| `src/apps/outputSchemas.ts` (ändern) | Marker im Schema. |
| `tests/skill-registry.test.ts` (neu) | Auswahlregel, Parser-Anbindung, Auflösung. |
| `tests/tools-skill-registry.test.ts` (neu) | Werkzeug-Ebene inkl. Reihenfolge und Offenlegung. |

`skill-registry.ts` bleibt deutlich unter 300 Zeilen; `skills.ts` (Werkzeuge)
wächst um eine Registrierung.

### Interfaces

```ts
// services/skill-registry.ts

/**
 * Ein Katalogeintrag. Titel und nodeId stammen aus dem `:::`-Block und kosten
 * nichts; Beschreibung und Schlagwörter nur in der Stufe `resolveHeads: true`.
 */
export interface RegistryEntry {
  nodeId: string;
  title: string;
  description?: string;
  keywords?: string[];
  /** Gesetzt, wenn der Kopf-Abruf lief und der Datensatz lesbar war. */
  resolved?: boolean;
}

export interface SkillRegistry {
  collectionId: string;
  /** Der Registry-Datensatz selbst. */
  registryNodeId: string;
  registryTitle: string;
  /** Das Dokument, unverändert. Null, wenn keine Datei lesbar war. */
  markdown: string | null;
  /** Aufgelöste `ki-skill`-Verweise, in Dokumentreihenfolge. */
  entries: RegistryEntry[];
  /** Verweise, deren Datensatz nicht lesbar war — genannt, nicht verschwiegen. */
  unresolved: { title: string; nodeId: string }[];
  /** Gesetzt, wenn mehrere Kandidaten in Frage kamen. */
  ambiguous?: { candidates: number; chosen: string };
}

export type RegistryMiss =
  | 'collection_not_found'
  | 'no_registry'          // Sammlung existiert, trägt aber kein ai_prompt-Markdown
  | 'unreadable';          // Registry gefunden, Datei nicht lesbar

export async function loadSkillRegistry(
  collectionId: string,
  opts?: { resolveHeads?: boolean },   // Standard: true
): Promise<{ registry: SkillRegistry | null; reason?: RegistryMiss }>;

```

> **Korrektur nach der Umsetzung (2026-08-10):** ein zusätzliches
> `findRegistryMarker` — „hat diese Sammlung eine Registry, ohne sie zu lesen" —
> war hier geplant und wurde gebaut, hatte am Ende aber **null Aufrufer**: die
> Suche ging über die günstige Stufe von `loadSkillRegistry`, und die Messung
> zeigte dann, dass ein reiner Marker ohnehin nichts spart (die Kosten stecken im
> `/children`-Aufruf, den beide brauchen). Wieder entfernt; seine Zusicherungen —
> vor allem die Projektionsregel — liegen jetzt auf `loadSkillRegistry`.

Eine Funktion mit einem Schalter, nicht zwei Funktionen: die Erkennung, der
Tie-Break, die Kappung und jede Offenlegung sind in beiden Stufen dieselben, und
zwei Kopien davon wären zwei Stellen, an denen die Regel auseinanderläuft.

### Data flow

```
get_skill_registry(collectionId)
  └─ getCollectionContents(collectionId, 'files')        1 Aufruf
     └─ Kandidaten: ccm:oeh_extendedType = ai_prompt  ∧  mimetype ~ markdown
        └─ Tie-Break: SKILL_REGISTRY.md | "SKILL REGISTRY" im Titel
           └─ getSkill(registryNodeId)                   1 Aufruf  → markdown + references
              └─ references.filter(kind === 'ki-skill')
                 └─ mapPool(ids, 5, getNodeMetadata)     ≤ REGISTRY_MAX parallel
                    └─ { entries, unresolved, markdown }
```

Obergrenze: **`REGISTRY_MAX = 30`** aufgelöste Einträge. Darüber wird gekappt und
die Kappung genannt (Projektregel: keine stillen Obergrenzen).

### Registry-Katalog bei der Sammlungssuche (Entscheidung 2026-08-10)

Ursprünglich war hier nur ein **Marker** vorgesehen (hat eine, ja/nein). Der
Nutzer hat den Katalog selbst verlangt, damit die Suche ohne Zwischenschritt
weiterläuft — bei ausdrücklich begrenzten Kosten und mit der Möglichkeit, es
später wieder herauszunehmen. Daraus folgen zwei Stufen **einer** Funktion:

| Stufe | Wer | Einträge tragen | Aufrufe je Sammlung |
|---|---|---|---|
| `resolveHeads: false` | die Suche | Titel + nodeId, direkt aus den `:::`-Blöcken | **2** (`/children`, Textabruf) |
| `resolveHeads: true` | `get_skill_registry` | zusätzlich Beschreibung + Schlagwörter | 2 + ≤ `REGISTRY_MAX` parallele Kopf-Abrufe |

Der Trick, der die Suche billig macht: **die `:::`-Blöcke tragen den Titel schon
selbst.** Titel und nodeId kosten damit keinen einzigen zusätzlichen Abruf — nur
Beschreibung und Schlagwörter verlangen je einen Metadatenabruf, und die bleiben
dem gezielten Werkzeug vorbehalten. Der Textabruf geht direkt über
`getNodeDownloadText`, nicht über `getSkill`: der Marker stammt aus der
Kinderliste und trägt den Knoten bereits, ein zweiter Metadatenabruf wäre eine
Wiederholung.

Bei `maxCollections = 5` also höchstens 10 Abrufe in zwei parallelen Runden. Nur
die **Sammlungen** werden angereichert, nicht die Themenseiten. Schlägt ein
Aufruf fehl, fehlt das Feld; die Suche scheitert nie daran.

**Gemessen gegen Staging (2026-08-10), und die Schätzung war zu optimistisch.**
Der Aufschlag liegt bei **~1,0–1,4 s**, nicht bei einer halben Sekunde:

| Messung | Wert |
|---|---|
| Anreicherung allein, 2 Sammlungen parallel | 1390 / 1409 / 1500 ms |
| `searchAll` aus → ein | 2767→4111 · 3300→4263 · **7034→3769** |
| `/children` einer Sammlung mit 3 Dateien | ~0,53 s |
| `/children` einer Sammlung mit 28 Dateien | ~1,34 s |

Zwei Dinge, die diese Messung geklärt hat und die jede Änderung hier binden:

1. **Die Projektion kostet nichts.** 27 Felder gegen 3 Felder: 531 ms vs. 523 ms
   und 1345 ms vs. 1604 ms. Die Dauer hängt an der **Kindzahl**, nicht an der
   Feldzahl — eine kleinere Projektion ist also keine Optimierung, und `SKILL_PROPS`
   bleibt (es trägt `ccm:oeh_extendedType`, ohne das nichts erkannt wird).
2. **Staging streut stark.** Die dritte Zeile oben zeigt einen Lauf OHNE
   Anreicherung, der langsamer war als jeder Lauf mit ihr. Ein einzelnes
   Messpaar trägt hier keine Aussage; erst drei Runden ergaben ein Bild.

Da die Aufrufe parallel laufen, bestimmt die **größte** Sammlung die Dauer, nicht
ihre Anzahl. Der Aufschlag lässt sich nicht wegoptimieren — er ist die Latenz von
`/children`.

**Entscheidung nach dieser Messung (2026-08-10): die Anreicherung ist standardmäßig
AUS.** ~1,4 s auf jede Suche, für fünf Sammlungen, unabhängig davon, ob eine
Registry existiert, war dem Nutzer zu teuer — und zu Recht. An ihre Stelle tritt
ein **kostenloser** Auslöser: jedes Sammlungs-Ergebnis trägt eine Hinweiszeile auf
`get_skill_registry` mit seiner nodeId, die Server-Instructions nennen den Anlass,
und die Beschreibungen der Sammlungs-Werkzeuge verweisen darauf (festgehalten in
`tests/tool-descriptions.test.ts`). Der Abruf erfolgt dann einmal, für die EINE
Sammlung, um die es geht, statt für alle fünf. `WLO_REGISTRY_IN_SEARCH=1` schaltet
die Anreicherung ein, wo Registries verbreitet genug sind.

Feld am Sammlungsergebnis:

```ts
skillRegistry?: {
  nodeId: string;
  title: string;
  entries: { title: string; nodeId: string }[];
  truncated?: boolean;
}
```

Nur gesetzt, wenn eine Registry existiert. Kein Feld = keine Registry.

Das weicht bewusst von der Nachbarregel in `services/search.ts` ab, wo jede
Anreicherung opt-in und standardmäßig aus ist. Grund ist die Nutzerentscheidung
„automatisch mitliefern"; der Ausschalter ist deshalb **betrieblich**
(`WLO_REGISTRY_IN_SEARCH`) statt ein Parameter je Aufruf — „später wieder
rausnehmen" soll eine Konfigurationsänderung sein, kein Deploy.

### Dependencies

Keine neuen. Alles aus `wlo-api`, `concurrency`, `services/skills*`.

## Non-functional

- **Performance:** `get_skill_registry` = 2 Aufrufe + ≤30 parallele Kopf-Abrufe.
  Sammlungssuche: +1 Rundreise.
- **Sicherheit:** Das Registry-Markdown ist **fremder Text**. Es wird nach dem
  servergebildeten Katalog gerendert, und jeder daraus übernommene Wert
  (Titel) läuft durch `oneLine`/`sanitizeText` — ein Zeilenumbruch in einem Titel
  fälscht sonst eine Katalogzeile mitsamt nodeId.
- **Fehlerfälle:** Jeder Miss hat einen benannten `reason`. Keine leere Antwort
  ohne Grund — dieselbe Regel wie bei `get_topic_page_content`.
- **Observability:** Mehrdeutige Auswahl und gekappte Listen werden geloggt.
- **i18n:** Werkzeugbeschreibungen deutsch wie die übrigen; Bezeichner englisch.

## Risks

| Risiko | Gegenmittel |
|---|---|
| Mehrere ai_prompt-Dokumente in einer Sammlung | Tie-Break-Regel + `ambiguous` in der Antwort. **Der Regelfall**, solange jede Datei `SKILL.md` heißt (T1) |
| Registry verweist auf gelöschte/unlesbare Skills | `unresolved` nennt sie, statt sie zu verschlucken |
| ~~`mimetype` fehlt in der Projektion~~ | **Erledigt durch T1**: `mimetype` kommt immer, `ccm:oeh_extendedType` nur mit `SKILL_PROPS` |
| Anreicherung verlangsamt jede Sammlungssuche | **Gemessen: +1,0–1,4 s — zu teuer.** Standardmäßig aus; der Auslöser ist eine kostenlose Hinweiszeile, `WLO_REGISTRY_IN_SEARCH=1` schaltet sie ein |
| Registry-Markdown fälscht Katalogzeilen | Katalog VOR Dokument, Titel durch `oneLine` |
| **Kein Live-Dokument übt das `:::`-Format aus** (0/28, T1) | T12 ist die einzige echte Probe — und sie hängt an der Redaktion, nicht am Code. Bis dahin gilt der Pfad als ungemessen, nicht als grün |

## Open questions

Keine. Die vier Entwurfsfragen sind vom Team entschieden (Erkennung per Position
+ Namens-Tie-Break, `:::`-Format, Katalog mit Köpfen + Auto-Marker, eigene
Env-Variable).
