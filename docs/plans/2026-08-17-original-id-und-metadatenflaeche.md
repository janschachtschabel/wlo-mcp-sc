# Design: Schreibziel Original + erweiterte Metadatenfläche

Datum: 2026-08-17 · Status: **fertig geplant, nicht begonnen**

> Dieses Dokument ist so geschrieben, dass es einen Kontext-Reset überlebt. Alles,
> was in der Planungssitzung gemessen wurde, steht unten unter „Gemessene Fakten" —
> **nicht neu erheben**, aber auch nicht ohne neue Messung widersprechen. Was dort
> als ANGENOMMEN markiert ist, ist ungeprüft und muss vor der Umsetzung gemessen
> werden.

## Goal

Schreibende Werkzeuge sollen den Datensatz treffen, den die Nutzerin meint (das
Original, nicht eine Verknüpfung), und lesend wie schreibend mehr als die heutige
Feldauswahl abdecken — Qualität, Recht, Zugänglichkeit — ohne die Standardantwort
zu verlängern.

## Context

Zwei unabhängige Befunde, die dasselbe Modul berühren.

**A — Schreibziel.** Ein Metadaten-Schreibvorgang auf eine Sammlungs-**Verknüpfung**
wird dort **gespeichert**, erreicht das Original nicht, und die Verknüpfung erbt
danach **nicht mehr** vom Original. Ein stiller, dauerhafter lokaler Override.
`verifyWrite` fängt ihn nicht ab, weil es denselben Knoten zurückliest und den
geschriebenen Wert findet. Sammlungsinhalte **sind** Verknüpfungen, und `originalId`
wird nach außen nirgends ausgegeben — die Aufruferin kann die richtige id mit
unseren Werkzeugen nicht ermitteln.

**B — Feldfläche.** Schreibbar sind heute 17 Properties, lesbar 24. Die Begrenzung
war eine Kontextfenster-Entscheidung, keine fachliche.

## Scope

**In scope**

- Auflösung auf das Original vor jedem Metadaten-Schreibvorgang, an genau einer Stelle.
- Offenlegung der Umleitung in der Vorschau (der Bestätigungsschlüssel bindet daran).
- `originalId` als Feld in `FormattedNode` **und** `formattedNodeSchema`.
- Erhebung der tatsächlich vorhandenen und gepflegten Felder (mds + Korpus).
- Lesender Support für Qualitäts-, Rechts- und Zugänglichkeitsfelder, **opt-in**.
- Schreibender Support **nur** für die Teilmenge, die die Erhebung als
  vokabular-gestützt und reversibel ausweist.
- Korrektur der widerlegten Messung in `wlo-collections-references` und den Doks.

**Out of scope — jeweils mit Grund**

- **Inhalts-Uploads.** Treffen bereits das Original (gemessen, F4).
- **`wlo_add_to_collection` / `wlo_remove_from_collection`.** Behandeln Verknüpfungen
  bereits bewusst und in der Gegenrichtung (`services/write/collections.ts:318`).
- **Das 20-s-Timeout beim Anlegen eines `ccm:wwwurl`-Datensatzes.** Eigener Befund
  (F7), eigene Entscheidung.
- **Die Aktivierungsblöcke in den 28 SKILL.md.** Eigene Aufgabe, eigener Auftrag.

## Approach

**Auflösung im gemeinsamen Schreibpfad, nicht je Werkzeug.** Die Alternative wäre,
jedes Kuratier-Werkzeug auflösen zu lassen. Verworfen: fünf betroffene Werkzeuge,
und eine Regel, die fünfmal steht, gilt nach dem nächsten neuen Werkzeug viermal.
`services/write/nodes.ts` ist die Stelle, durch die jeder Metadaten-Write geht.

**Opt-in je Aufruf statt größerer Standardantwort.** Die Standardausgabe bleibt
Byte für Byte wie heute. Die Alternative „nur gesetzte Felder ausgeben" klingt
billiger, ist aber unehrlich: heute wäre die Antwort unverändert — bis ein
gepflegter Datensatz sie unangekündigt verdoppelt.

**Schreiben nur für geprüfte Felder.** Qualitätsfelder sind redaktionelle
**Prüfsiegel**. Ein Modell, das sie setzt, behauptet eine Prüfung, die niemand
vorgenommen hat. Sie werden gelesen, nicht geschrieben, solange die Erhebung nicht
zeigt, wer sie führt und wogegen.

## Global constraints

- Interaktionssprache Deutsch; Code, Bezeichner, Kommentare, Doks Englisch.
- ESM, `.js`-Endung bei projektinternen Importen.
- Jede Mutation liest zurück; jede Mutation ist zweistufig bestätigt.
- Ein neues `FormattedNode`-Feld MUSS in `formattedNodeSchema` deklariert werden —
  zod verwirft Unbekanntes, das Feld verschwände still aus `structuredContent`.
- Testziel ist Staging, niemals Produktion.
- Kein Schreibvorgang ohne ausdrücklichen Wunsch: neue schreibbare Felder werden
  nie als Nebenwirkung eines anderen Aufrufs gesetzt.

---

## Gemessene Fakten

**F1 — Metadaten auf eine Verknüpfung werden dort GESPEICHERT** (Staging,
2026-08-16). Nicht verworfen. Original bleibt unberührt.

**F2 — Danach erbt die Verknüpfung nicht mehr.** Ein späterer Schreibvorgang aufs
Original ändert die Verknüpfung nicht. Die beiden driften ab da auseinander.

**F3 — `verifyWrite` merkt es nicht.** Es liest denselben Knoten zurück, findet den
geschriebenen Wert und meldet Erfolg.

**F4 — Inhalts-Uploads treffen das Original**, auch wenn sie an die Verknüpfung
adressiert sind. Bytes sind nicht je Verknüpfung kopiert. Die Version des
**Originals** steigt.

**F5 — Ein Upload benennt den Datensatz NICHT um.** `fileNameFrom` leitet aus dem
Titel einen Dateinamen ab, das Repository übernimmt ihn nicht; `cm:name` bleibt.

> F1–F5 sind als Live-Tests festgehalten: `tests/live/reference-write.test.ts`,
> vier Tests, grün. **Sie widerlegen die Messung im Skill
> `wlo-collections-references`** („verpufft STILLSCHWEIGEND, 200 OK ohne Effekt").
> Nicht ohne neue Messung dorthin zurückdrehen.

**F6 — Woran man eine Verknüpfung erkennt** (gemessen 2026-08-17):

| | DTO `node.originalId` | Property `ccm:original` |
|---|---|---|
| Verknüpfung | id des Originals | id des Originals |
| Original | **`undefined`** | **zeigt auf sich selbst** |

→ **Das DTO-Feld ist das Signal**: vorhanden = Verknüpfung. `ccm:original` braucht
einen Selbstvergleich und ist die Falle.

**F7 — `WLO_FETCH_TIMEOUT_MS` = 20 000 ms; das Anlegen eines Datensatzes mit
`ccm:wwwurl` braucht auf Staging 16,8 s** (Rohabruf HTTP 200). Deshalb ist
`tests/live/write-contract.test.ts` Test 6 rot — ein Timeout, keine Ablehnung.
Vorbestehend, außerhalb dieses Plans, aber nicht als „kaputt" fehldeuten.

> **BEHOBEN 2026-08-17**, nachdem die Ursache je Anfrage aufgeschlüsselt wurde.
> Der Verdacht „16,8 s gegen 20 s" war richtig, aber ungenau: `createContentNode`
> sind **drei** Anfragen, und das Timeout gilt je Anfrage. Gemessen mit
> Aufrufspur: Dublettenprüfung 1,2 s · **Anlegen 18,6 s** · Metadaten 0,5 s.
> Es ist also ein einzelner Aufruf bei **93 %** des Budgets — über vier Läufe
> 12,2 / 15,7 / 16,6 / 18,6 s — und zwar NICHT, weil das Repository die Adresse
> lädt (siehe den Nachtrag unten).
>
> Damit ist es kein Test-Artefakt, sondern trifft jede Nutzerin: ein Abbruch
> meldet Fehlschlag für Arbeit, die das Repository zu Ende bringt — und ein
> Wiederholungsversuch legt einen **zweiten** Datensatz an.
>
> `CREATE_NODE_TIMEOUT_MS = 30_000` gilt nur für diesen einen Aufruf
> (`createNodeTimeoutMs()`, `services/write/nodes-lifecycle.ts`), 1,6× über dem
> langsamsten gemessenen. Eine größere Einstellung des Betreibers wird nicht
> heruntergesetzt (`Math.max`). Wächter in `tests/shared-rule-discipline.test.ts`,
> weil die Verdrahtung am Mock nicht prüfbar ist: `wloFetch` hängt selbst ein
> Signal an, wenn keins kommt.
>
> **Korrektur am selben Tag:** die Zahl war zuerst 25 000, gehalten von einer
> Decke, die es nicht gibt — „`http.ts` kappt die ganze MCP-Anfrage bei 30 s".
> Gemessen: ein node:http-Server mit `requestTimeout = 30_000` und einem Handler,
> der nach **35 s** antwortet, liefert die Antwort aus. Die Einstellung begrenzt
> das EMPFANGEN der Anfrage, nicht die Arbeit daran. Derselbe Irrtum stand schon
> in drei älteren Kommentaren und hatte dort Deckel begründet; die Deckel bleiben,
> die Begründung ist jetzt die messbare (was der Aufruf kostet), und was das
> Warten wirklich begrenzt, sitzt beim Client.

**F8 — Heutige Feldflächen.**
- Schreibbar (17, `services/write/fields.ts`): `cclom:general_description`,
  `cclom:general_keyword`, `cclom:general_language`, `cclom:title`,
  `ccm:commonlicense_cc_version`, `ccm:commonlicense_key`, `ccm:educationalcontext`,
  `ccm:educationalintendedenduserrole`, `ccm:lifecyclecontributer_author`,
  `ccm:oeh_collection_compendium_text`, `ccm:oeh_lrt`, `ccm:oeh_lrt_aggregated`,
  `ccm:oeh_publisher_combined`, `ccm:taxonid`, `ccm:wwwurl`, `cm:description`,
  `cm:title`.
- Lesbar: `DISPLAY_PROPS` in `wlo-config.ts` (24).

**F9 — Ein echter Datensatz trägt 86 Properties** (`propertyFilter=-all-`), darunter
**keine** `ccm:oeh_quality_*`.

> ~~**ANGENOMMEN, nicht gemessen:** dass es `ccm:oeh_quality_*`-Felder in `mds_oeh`
> überhaupt gibt, und wie Rechts- und Zugänglichkeitsfelder heißen.~~
> **GEMESSEN 2026-08-17 (T3.1):** es gibt sie, 14 Stück — F9 bleibt richtig, denn
> die vier Rechtsprüfungs-Felder tragen 80–86 Belegungen bei 590 186 Datensätzen,
> und ein Feld, das fast niemand pflegt, fehlt auf einem beliebigen Datensatz.
> Vollständig in `2026-08-17-metadatenfelder-erhebung.md`.

**F10 — Löschen auf eine Verknüpfung trifft NUR die Verknüpfung** (Staging,
2026-08-17, T0.1). `deleteContentNode(referenceId)` → `{status:'ok'}`; die
Verknüpfung danach **404**, das Original **200** und lesbar.

Drei Folgerungen:

1. **Kein Datenverlust.** Die Dringlichkeit von Phase 1 wird *nicht* hochgestuft.
2. **Die Auflösung darf NICHT aufs Löschen angewandt werden.** Ein umgeleitetes
   `wlo_delete_content` würde aus dem heute harmlosen Verhalten genau den
   Datenverlust machen, nach dem diese Messung gesucht hat. `resolveWriteTarget`
   gehört in den **Metadaten**-Pfad, nirgendwo sonst.
3. **Die Meldung ist wahr über den Knoten und falsch über das Material.**
   `wlo_delete_content` auf eine Sammlungs-id meldet Erfolg, während der Datensatz
   unter eigener id und in jeder anderen Sammlung weiterlebt — faktisch ein
   `remove_from_collection` mit dem Wort „gelöscht". Behoben in **T2.3**, das
   ohnehin den Satz über Verknüpfung vs. Original schreibt.

> Festgehalten als `tests/live/reference-delete.test.ts`, grün. Die Datei pinnt
> beide Hälften — dass die Verknüpfung verschwindet **und** dass das Original
> bleibt —, weil erst das Paar die Aussage trägt.

## Fallen, die in dieser Sitzung Zeit gekostet haben

1. **`getNodeMetadata(id)` liefert `WloNode | null` DIREKT**, nicht `{node, status}`.
   Das ist `readNodeMetadata`. Ein `.node?.properties` darauf ist still `undefined`.
2. **Skripte brauchen `node --env-file-if-exists=.env --import tsx …`.** Ohne das
   sind die Zugangsdaten leer, jeder Schreibvorgang endet in 403 `GuestCagePolicy`,
   Lesen funktioniert weiter (anonym) — der Fehler sieht also aus wie ein Rechteproblem.
3. **`appendPropertyFilter` ohne Argument setzt `-all-`.** Ein *roher* Abruf ohne
   `propertyFilter` liefert dagegen **null** Properties.
4. **Python-Schreibvorgänge auf Projektdateien nur mit `newline=''`** — sonst wird
   die ganze Datei auf CRLF umgestellt (hat `.env.example` zerlegt).

---

## Architecture

### Files

| Datei | Verantwortung |
|---|---|
| `src/services/write/nodes.ts` | **ändern** — `resolveWriteTarget()`, aufgerufen von `updateNodeMetadata` |
| `src/services/write/verify.ts` | **ändern** — gegen den umgeleiteten Knoten prüfen |
| `src/services/write/change-set.ts` | **ändern** — Umleitung als Teil der Änderungsmenge |
| `src/formatter.ts` | **ändern** — `originalId` im Typ und in `formatNode` |
| `src/apps/outputSchemas.ts` | **ändern** — `originalId` in `formattedNodeSchema` |
| `src/wlo-config.ts` | **ändern** — neue Property-Gruppen neben `DISPLAY_PROPS` |
| `src/vocabs-quality.ts` | **neu** — Label↔URI der neuen Felder, Muster `vocabs-lrt.ts`. *Nach T3.2: kein Qualitätsfeld überlebt die Messung, der Name passt also nicht mehr* |
| `scripts/survey-metadata.mjs` | ✅ **neu** — Erhebung; meldet, schreibt nie |
| `tests/live/reference-delete.test.ts` | **neu** — die offene Löschfrage |

### Data flow

```
Werkzeug ──nodeId──▶ resolveWriteTarget ──▶ { targetId, requestedId, redirected }
                            │                      │
                   node.originalId lesen           ├─▶ ChangeSet (nennt die Umleitung)
                                                   ├─▶ updateNodeMetadata(targetId)
                                                   └─▶ verifyWrite(targetId)
```

### Interfaces

```ts
// src/services/write/nodes.ts — wie GEBAUT (siehe Abweichung 1 in Phase 1)
export interface WriteTarget {
  /** Wohin geschrieben wird — das Original. */
  targetId: string;
  /** Was die Aufruferin genannt hat. */
  requestedId: string;
  /** true, wenn beide sich unterscheiden. */
  redirected: boolean;
}

/**
 * Nimmt den Knoten, den der Aufrufer ohnehin schon gelesen hat. Ein nicht
 * lesbarer Knoten kommt hier nie an — jedes Werkzeug bricht vorher ab, und
 * genau das ist die Zusage: lieber gar nicht schreiben als auf die angefragte
 * id ausweichen.
 */
export function resolveWriteTarget(node: WloNode, requestedId: string): WriteTarget;
```

```ts
// src/formatter.ts — FormattedNode
/** Das Original, wenn dieser Knoten eine Verknüpfung ist; sonst gleich `nodeId`. */
originalId: string;
```

### Dependencies

Keine neuen.

## Non-functional

- **Performance:** ein zusätzlicher Metadatenabruf je Schreibvorgang. Schreibvorgänge
  sind selten und ohnehin zweistufig. Lesepfade unberührt.
- **Sicherheit:** ein nicht lesbarer Knoten führt zum Abbruch, nie zum Schreiben auf
  die angefragte id.
- **Beobachtbarkeit:** jede Umleitung wird geloggt (`requestedId`, `targetId`).

## Risks

| Risiko | Gegenmaßnahme |
|---|---|
| Auflösung im Kreis, weil `ccm:original` beim Original auf sich selbst zeigt | F6: **`node.originalId`** verwenden, nicht die Property |
| Nutzerin bestätigt eine id, eine andere wird geändert | T1.5: Umleitung steht IN der Änderungsmenge, an die der Schlüssel bindet |
| `originalId` fehlt in `formattedNodeSchema` → verschwindet still aus `structuredContent` | T2.1 und T2.2 sind **getrennte** Aufgaben mit getrennten Zusicherungen |
| Löschen einer Verknüpfung löscht das Original | **T0.1** misst es, bevor irgendetwas gebaut wird |
| Support für Felder, die es nicht gibt oder die niemand pflegt | T3.1 fragt das mds **und** zählt den Korpus; T4 ist ohne T3.2 gesperrt |

## Open questions

Keine offenen Entwurfsfragen. Zwei **Messfragen** sind Phase 0 und blockieren Phase 1.

---

# Tasks

## Phase 0 — Messen, bevor gebaut wird  ✅ ERLEDIGT 2026-08-17

Step 0: `/better-coding-workflow`

- [x] **T0.1 — Was löscht `wlo_delete_content` auf eine Verknüpfung?**
  Antwort: nur die Verknüpfung (**F10**). Festgehalten in
  `tests/live/reference-delete.test.ts`. `withReference` und `markdownFile` sind
  dabei nach `tests/live/fixtures.ts` gewandert — zweiter Verbraucher, gleiche
  Begründung wie bei `guard.ts`: ein Fixture, das auf Staging aufräumt, darf
  nicht in zwei Fassungen existieren.
- [x] **T0.2 — Ergebnis festhalten** — F10 oben, `STATUS.md`.
  Die Antwort lautet **nicht** „Original weg", also bleibt die Dringlichkeit von
  Phase 1 unverändert. Neu hinzugekommen ist die Grenze in F10.2: die Auflösung
  gehört in den Metadatenpfad und **nicht** ins Löschen.

## Phase 1 — Schreibziel  ✅ ERLEDIGT 2026-08-17

Step 0: `/better-coding-workflow`

- [x] **T1.1 — `resolveWriteTarget`** — `src/services/write/nodes.ts`,
  `tests/write-target.test.ts` (3 Fälle).
- [x] **T1.2 — der Schreibpfad benutzt sie** — zwei Wächter in
  `tests/shared-rule-discipline.test.ts`, beide durch injizierte Verletzung
  rot gesehen.
- [x] **T1.3 — `verifyWrite` prüft den umgeleiteten Knoten.**
- [x] **T1.4 — Live-Beleg** in `tests/live/reference-write.test.ts`.
- [x] **T1.5 — Die Vorschau nennt die Umleitung**, und der Schlüssel bindet daran.

### Drei Abweichungen vom Entwurf, mit Grund

**(1) `resolveWriteTarget` ist synchron und nimmt den bereits gelesenen Knoten**
(`(node: WloNode, requestedId: string) => WriteTarget`) statt asynchron eine id.
Jeder Schreibpfad liest den Datensatz ohnehin, um dagegen zu diffen — ein zweiter
Abruf kostete nicht nur eine Runde, er könnte dem ersten **widersprechen**, und
die Änderungsmenge, die die Nutzerin bestätigt, stammt aus dem ersten. Die
Sicherheitszusage des Entwurfs („nicht lesbar → Abbruch, niemals Ausweichen auf
die angefragte id") bleibt: jedes Werkzeug bricht mit eigener deutscher Meldung
ab, bevor eine Änderungsmenge entsteht. Damit entfällt auch der einzige
nicht-funktionale Preis, den der Entwurf veranschlagt hatte.

**(2) Die Auflösung sitzt an den drei Werkzeug-Einstiegen, nicht in
`updateNodeMetadata`.** Der Entwurf wollte sie „im gemeinsamen Schreibpfad", weil
dort jeder Write vorbeikommt. Das trägt nicht: der Bestätigungsschlüssel bindet
an die **Vorschau**, also muss das Ziel feststehen, *bevor* geschrieben wird.
Eine Auflösung im Schreibaufruf müsste ein zweites Mal stattfinden und könnte vom
bestätigten Ziel abweichen — genau das Loch, das T1.5 schließt. Die *Regel* steht
weiterhin an genau einer Stelle; nur der Aufruf steht dreimal, und beides ist
durch Wächter gepinnt.

**(3) `verifyWrite` hat seinen `nodeId`-Parameter verloren** und liest
`cs.nodeId`. Alle vier Aufrufstellen übergaben ohnehin denselben Wert. Mit
Umleitung wird dieser Parameter zu der Stelle, an der still gegen den *genannten*
statt den *geschriebenen* Knoten geprüft würde — die falsche Erfolgsmeldung, für
die dieser Schritt überhaupt existiert.

### Zwei benachbarte Pfade, bewusst NICHT geändert

Beide schreiben Metadaten an eine von der Aufruferin genannte id, aber **nicht**
über den Endpunkt, den F1/F2 gemessen haben — und ohne Messung wird hier nicht
umgeleitet:

- **`wlo_rename_collection`** schreibt über die Collections-REST-API
  (`PUT /collection/v1/collections/-home-/{id}`). Ob die einer Verknüpfung folgt,
  ist ungemessen.
- **`wlo_submit_content`** setzt den Workflow-Status über den Workflow-Endpunkt.
  Ungemessen, und eine Einreichung ist nicht so folgenlos rücknehmbar wie ein
  Feldwert.

`wlo_update_compendium` wurde dagegen einbezogen, obwohl auch dort keine Messung
für Sammlungs-Verknüpfungen vorliegt. Der Unterschied ist die Richtung des
Risikos: die Auflösung greift **nur**, wenn das Repository den Knoten selbst als
Verknüpfung ausweist (`originalId` gesetzt), und sie wird in der Vorschau
genannt. Nicht umzuleiten hieße dort: stiller Override ohne jede Anzeige.

**Nebenbefund, gehört zu T2.3:** die Beschreibung von `wlo_delete_content` sagt,
das Werkzeug „zerstört das Material für alle Sammlungen, in denen es vorkommt".
Über eine Verknüpfungs-id ist das nach F10 **falsch** — das Material überlebt.

## Phase 2 — `originalId` sichtbar machen  ✅ ERLEDIGT 2026-08-17

Step 0: `/better-coding-workflow`

- [x] **T2.1** Feld in `FormattedNode` + `formatNode`, Zusicherung auf den Textpfad.
- [x] **T2.2** Feld in `formattedNodeSchema`, **eigene** Zusicherung auf `structuredContent`.
- [x] **T2.3** Beschreibungen von `wlo_update_content` und `wlo_delete_content`,
  gepinnt in `tests/tool-descriptions.test.ts`; dazu `docs/TOOLS.md`.

### Eine Abweichung und eine Ergänzung

**Das Feld fehlt am Original, statt gleich `nodeId` zu sein.** Der Entwurf sah
`originalId: string` vor („sonst gleich `nodeId`"). Gebaut ist `originalId?:
string`, abwesend am Original — so wie das Repository-DTO es selbst hält. Damit
bleibt jede bestehende Antwort unverändert, und das Feld steht genau dort, wo es
etwas aussagt. Die Textzeile entsteht in `nodeIdLine` (`formatter.ts`), das sich
die Werkzeuge für Skills und für gewöhnliche Treffer **teilen** — die Skills
rendern diesen Satz seit langem, und zwei Formulierungen für eine Tatsache wären
dem Aufrufer nicht zuzumuten.

**Die Vorschau des Löschens sagt jetzt, welcher Fall vorliegt** — nicht nur die
Beschreibung. Sie hat den Knoten ohnehin gelesen, kennt also die Antwort, und
„Der Datensatz verschwindet aus allen Sammlungen" war über eine Verknüpfungs-id
der einzige Satz, den eine Person vor einem unumkehrbaren Schritt liest, und
falsch. `curation-delete.ts` fragt dafür `resolveWriteTarget` — dieselbe
Funktion, die den Schreibpfad umleitet, hier ausschließlich zum **Beschreiben**.
Genau das hat der Wächter aus P1 erzwungen: der erste Entwurf las `node.originalId`
direkt und fiel auf.

## Phase 3 — Erhebung  ✅ ERLEDIGT 2026-08-17 (Sperre für Phase 4 aufgehoben)

Step 0: `/better-coding-workflow`

- [x] **T3.1 — `scripts/survey-metadata.mjs`** (`npm run survey:metadata`),
  meldet und schreibt nie, Muster `sync-vocabs.mjs`. Zwei Beine: der volle
  Metadatensatz für die Feld- und Vokabularfrage, eine Facette je Feld für die
  Korpusfrage.
- [x] **T3.2 — Messdokument** `docs/plans/2026-08-17-metadatenfelder-erhebung.md`.

**F9 ist beantwortet: `ccm:oeh_quality_*` gibt es — 14 Felder.** F9 war damit
nicht falsch, sondern eine andere Aussage: auf *einem* Datensatz nicht gefunden
zu werden verträgt sich mit „existiert", wenn kaum jemand das Feld pflegt. Genau
so ist es (80–86 Belegungen bei 590 186 Datensätzen).

**Das Ergebnis verkleinert Phase 4 erheblich.** Drei Felder tragen die Messung,
nicht drei Feldgruppen — und der Grund ist nicht das Prüfsiegel-Argument des
Entwurfs, sondern eine unabhängige Messung: bei **11 der 14** Qualitätsfelder
liegen die gespeicherten Werte teils oder ganz **außerhalb des Vokabulars, das
dasselbe Feld deklariert** — dieselbe Skala einmal als URI, einmal als nackte
Ziffer, beides nebeneinander im selben Feld. `ccm:oeh_quality_correctness`
deklariert das Befund-Vokabular und speichert zu 100 % Sternebewertungen.

Zwei Folgerungen, beide im Messdokument belegt:

1. **Schreiben ist dort nicht definiert** — wer schreibt, wählt eine Schreibweise
   und ist zur Hälfte des Bestands inkonsistent. Das gilt auch für jemanden, der
   das Prüfsiegel-Argument nicht teilt.
2. **Lesen ist dort wertlos** — ein Feld, dessen Inhalt wir nicht beschriften
   können, reicht `"0"` oder `"4"` an ein Modell weiter.

Zwei Nebenbefunde am Facetten-Pfad (`facetLimit` ist keine Bucket-Obergrenze;
Staging hält 23 Lizenzschlüssel statt der gepinnten 16) stehen in §7 des
Messdokuments. Sie betreffen `services/license-search.ts`, gehören **nicht** in
diesen Plan und sind nicht behoben.

## Phase 4 — Felder  ✅ ERLEDIGT 2026-08-17

Step 0: `/better-coding-workflow`

> **Zuschnitt nach T3.2.** Aus drei Gruppen sind drei Felder geworden, alle
> vokabular-rein, alle **nur lesend**:
> `ccm:conditionsOfAccess` (198 699 Belegungen) · `ccm:accessibilitySummary`
> (3 475) · `ccm:license_oer` (1 121).

- [x] **T4.1 — entfällt in der geplanten Form.** Zwei Messungen haben ihn
  aufgelöst, beide 2026-08-17:
  1. **Das Repository beschriftet alle drei Felder selbst**
     (`<property>_DISPLAYNAME`, an echten Datensätzen belegt:
     `ccm:accessibilitySummary_DISPLAYNAME = ["A (am niedrigsten)"]`,
     `ccm:license_oer_DISPLAYNAME = ["kein OER"]`,
     `ccm:conditionsOfAccess_DISPLAYNAME = ["ohne Anmeldung"]`). Damit ist
     `vocabs-quality.ts` **ersatzlos gestrichen** — es wäre eine dritte Tabelle
     gewesen, die mit einer Instanz Schritt halten muss, für Werte, die die
     Instanz mitliefert. Genau die Quelle, die `formatter.ts` für die
     Vokabularfelder ohnehin bevorzugt.
  2. **Keine Property-Gruppen nötig.** `readNodeMetadata`/`getNodeMetadata`
     lesen ohne Projektion `-all-`; die Felder sind also bereits da. Eine
     Gruppe in `wlo-config.ts` hätte nichts verengt und nichts geholt.
- [x] **T4.2 — `includeAccessInfo`** an `get_node_details` und
  `get_nodes_details`, in beiden Ausgabeformaten. **Ein** Parameter statt zweier:
  eine Gruppe mit einem Feld ist ein Parameter, den niemand braucht.
  `src/node-access.ts` hält, was die Felder SIND (Projektion + Zeilen);
  Werkzeuge halten Schema und Verdrahtung.
- [x] **T4.3 entfällt.** Kein neues Feld ist zum Schreiben empfohlen; die
  Begründung steht als Kopfkommentar in `node-access.ts`, nicht nur hier.

`ccm:oeh_quality_login` wird **nicht** gelesen, obwohl es das einzige saubere
Qualitätsfeld ist: `ccm:conditionsOfAccess` sagt dieselbe Sache dreiwertig statt
zweiwertig und auf 198 699 statt 72 787 Datensätzen. Beide zu lesen hieße,
dieselbe Tatsache zweimal auszugeben, mit der Möglichkeit zu widersprechen.

**Neu gemessen dabei, und es gehört in die Beschreibung:** alle drei Felder
antworten als ngsearch-**Kriterium** mit HTTP 400. Sie sind ablesbar, aber nicht
suchbar — „zeig mir Material ohne Login" gibt es nicht. Aus demselben Grund ließ
sich nicht messen, ob `ccm:license_oer` etwas aussagt, das
`ccm:commonlicense_key` nicht schon sagt; das Feld ist trotzdem dabei, weil
opt-in niemanden etwas kostet, und die Unmessbarkeit steht im Code.

## Phase 5 — Doku  ✅ ERLEDIGT 2026-08-17

Step 0: `/better-coding-workflow`

- [x] **T5.1 — `wlo-collections-references` korrigiert**, in der Konvention des
  Skills selbst (`⚠ Korrektur (Datum)`, wie schon einmal 2026-08-01 benutzt).
  **An ZWEI Stellen**, und das ist der Punkt: dieselbe Falschaussage stand auch
  als Nummer 1 in seiner „Häufige Fallen"-Liste — die Stelle, die jemand im
  Zweifel zuerst liest. Nur die im Plan genannte zu korrigieren hätte die
  wirksamere stehen lassen. Mit korrigiert: die Vererbungszusage in Falle 7 (sie
  gilt nicht für ein Feld, das schon einmal direkt beschrieben wurde), die
  Aussage zu `node.originalId` (`undefined` am Original, und `ccm:original` als
  Falle), sowie die Gegenrichtung für Inhalte (F4/F5).
  `docs/` brauchte keine Korrektur: die einzigen Fundstellen im Repo benennen die
  Aussage bereits als widerlegt.
- [x] **T5.2** `CLAUDE.md`, `CHANGELOG.md`, `docs/TOOLS.md`, `STATUS.md` —
  fortlaufend je Phase gepflegt; hier nur noch der Verweis auf die erfolgte
  Skill-Korrektur.

## Verification

| Anforderung | Nachweis |
|---|---|
| Löschverhalten bekannt | ✅ `npm run test:live` — T0.1, F10 |
| Schreiben trifft das Original | ✅ `npm run test:live` — T1.4 |
| Umleitung ist bestätigungspflichtig | ✅ `npm test` — T1.5 |
| `originalId` in **beiden** Ausgabeformaten | ✅ `npm test` — T2.1 **und** T2.2 |
| Feldliste ruht auf Messung, nicht auf Vermutung | ✅ `2026-08-17-metadatenfelder-erhebung.md`, erzeugt von `npm run survey:metadata` |
| Standardantwort nicht länger geworden | `npm test` — T4.2 |
| Keine Regression | `npm test` vollständig · typecheck · eslint · build je exit 0 |

**Ausgangsstand vor Beginn:** `npm test` → 1896 Tests, 1896 pass, 0 fail ·
`npm run test:live` → 6 Tests, 5 pass, 1 fail (vorbestehend, F7).

**Stand nach Phase 0 (2026-08-17):** `npm test` → 1896 pass, 0 fail ·
`npm run test:live` → **7** Tests, 6 pass, 1 fail — derselbe F7-Timeout, jetzt als
Test 7 gezählt. typecheck · eslint je exit 0.

**Stand nach Phase 1 (2026-08-17):** `npm test` → **1907** pass, 0 fail ·
`npm run test:live` → **8 Tests, 8 pass** · typecheck · eslint je exit 0.
Der F7-Timeout lief diesmal knapp durch — er ist damit **nicht behoben**, nur
nicht getroffen; 16,8 s gemessene Laufzeit gegen 20 s Grenze bleibt eine
Zufallsfrage.

**Stand nach Phase 2 (2026-08-17):** `npm test` → **1916** pass, 0 fail ·
typecheck · eslint je exit 0.

**Stand nach Phase 3 (2026-08-17):** unverändert **1916** pass, 0 fail ·
typecheck · eslint je exit 0 — Phase 3 hat kein Laufzeitverhalten angefasst. Der
Nachweis dieser Phase ist die Ausgabe von `npm run survey:metadata` (7–8 s gegen
Staging) und das daraus geschriebene Messdokument.

**Stand nach Phase 4 (2026-08-17):** `npm test` → **1932** pass, 0 fail ·
typecheck · eslint je exit 0. Zusätzlich live gegen Staging geprüft: die
Projektion an drei echten Datensätzen, jeder mit einer anderen Teilmenge der drei
Felder — nur was der Datensatz trägt, erscheint.

In derselben Sitzung mit erledigt, außerhalb dieses Plans:

1. **`FACET_BUCKET_MAX`** — `facetLimit` ist keine Bucket-Obergrenze; der Server
   liefert bis zu **5 ×** so viele (an `ccm:taxonid` an sechs Punkten bestätigt:
   1→5, 2→10, 10→50, 50→250, 80→376 = alle). `services/license-search.ts` prüfte
   gegen das angeforderte Limit und verwarf damit auf jeder breiten Lizenzsuche
   eine **vollständige** Zählung.
2. **Der Lizenz-Korpus-Pin** in `tests/vocabs.test.ts` (23 statt 16), jetzt in
   zwei Listen: was auflösen MUSS, und vier Freitext-Werte, die unaufgelöst
   bleiben MÜSSEN.
3. **Zwei übersehene `nodeId:`-Zeilen** aus Phase 2 (`get_node_details`,
   `get_subject_portals`) plus ein Wächter, der handgebaute Zeilen fängt.
