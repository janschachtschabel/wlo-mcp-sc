# Design: Skill-Registry-Cache

## Goal

Jede Sammlung in einer Antwort trägt ihren Skill-Katalog — ohne einen einzigen
zusätzlichen Abruf zur Laufzeit, gespeist aus einem Cache, der sich im
Hintergrund alle 5 Minuten selbst erneuert.

## Context

Heute kostet die Anreicherung **1,0–1,4 s je Sammlung** (gemessen 2026-08-10),
bezahlt über den `/children`-Aufruf — und zwar auch für Sammlungen, die gar keine
Registry führen, was derzeit auf jede zutrifft. Deshalb ist sie standardmäßig aus
und wird durch eine kostenlose Hinweiszeile ersetzt.

Am 2026-08-11 gegen Staging gemessen: eine **einzige** repository-weite Suche
findet den **gesamten** Skill-Korpus in ~1,2 s, und jeder Treffer trägt seinen
Elternknoten bereits mit. Damit lässt sich die Zuordnung *vorab* aufbauen, statt
sie je Anfrage zu erfragen.

### Messungen, auf denen dieser Entwurf ruht

Staging, 2026-08-11. Vor einem Widerspruch neu messen.

| Frage | Ergebnis |
|---|---|
| Repository-weite `ai_prompt`-Suche in einem Aufruf? | **Ja** — 28 Treffer, 1175 / 1215 / 1322 ms (drei Läufe) |
| Alles Markdown? | 28/28 |
| Referenzen darunter? | **0/28** — alle Originale |
| Trägt ein Treffer seinen Elternknoten? | **Ja**, `virtual:primaryparent_nodeid`, 28/28 — **bereits in `SKILL_PROPS`**, kostet nichts extra |
| Ist der Elternknoten immer die Sammlung? | **Nein.** Bei geharvestetem Material ist es der Spider-Ordner (`dwu_spider`, `memucho_spider`, `leifi_spider`) — ebenfalls `ccm:map` |
| Trägt ein Treffer seine Sammlungen? | **Nein** — `usedInCollections` bei 0/20 Material-Treffern und 0/28 Skills gefüllt |
| Skills, die heute in einer Inhaltssammlung liegen? | **0** — 28 Skills, 28 verschiedene Eltern, jeder in einem eigenen Ordner |

Die vorletzte Zeile ist der Grund, warum der Cache **nach Elternknoten-id**
gruppiert und **mit der Sammlungs-id abgefragt** wird: ein Skill in einem
Spider- oder Skill-Ordner trifft nie eine Sammlungs-id, nach der jemand fragt.
Die Zuordnung prüft sich damit selbst — kein Typcheck nötig, keine Falschtreffer.

Die letzte Zeile heißt: der Cache ist heute **leer an Registries**. Das ist
korrekt und kein Fehler — es existiert schlicht noch keine.

## Scope

**In scope**

- Ein Cache-Modul, das den Skill-Korpus in einem Aufruf holt, nach Elternknoten
  gruppiert und je Sammlung den fertigen Katalog (Titel + nodeId je Skill)
  vorhält.
- Hintergrund-Erneuerung alle 5 Minuten, nicht blockierend, mit Skip für
  unveränderte Dokumente.
- Anreicherung aus dem Cache an **allen** Pfaden, die Sammlungsknoten rendern:
  `search_wlo_all`, `search_wlo_collections`, `get_collection_contents`,
  `get_node_collections`, `browse_collection_tree`.
- `includeSkillRegistry: true` bedeutet künftig **Live-Abruf erzwingen**.
- `WLO_REGISTRY_IN_SEARCH` entfällt; dafür `WLO_SKILL_CACHE=off`.

**Out of scope**

- REST-HTML und Widgets: Sie erhalten das Feld über `searchAll` automatisch mit,
  und die HTML-Seite rendert es seit 2026-08-10 — aber eine eigene
  Darstellungsarbeit an den Widgets ist **nicht** Teil dieses Pakets.
- Vererbung auf Untersammlungen (kein Parent-Aufstieg) — ausdrücklich
  zurückgestellt, es gibt dafür keine Automatik.
- Der Registry-**Text** (die Prosa der Redaktion) wird nicht gecacht ausgeliefert;
  dafür bleibt `get_skill_registry`.

## Approach

### Die Quelle ist die Kinderliste — nur nicht im Anfragepfad

`CLAUDE.md:366` verbietet, eine Freigabeliste vom Suchindex abhängig zu machen:
„the registry is found through the collection's CHILDREN listing, **never the
search index** … An approval list must not depend on it." Der Grund ist gemessen
(Optik-Fall, 2026-08-09): ein Datensatz kann aus dem Index fallen, während er im
Node-Store einwandfrei liegt.

Dieser Entwurf umgeht die Regel nicht, sondern **erfüllt** sie: der Cache ist ein
Gedächtnis für genau den autoritativen Abruf, den der Live-Pfad macht — nur
findet er im Hintergrund statt. Was langsam ist, stört dort nicht.

```
Anfrage  →  Map-Lookup  →  Treffer? Katalog mitliefern.  0 Abrufe, synchron.
                        →  Fehltreffer? nichts mitliefern, Sammlung VORMERKEN.

Hintergrund → Warteschlange abarbeiten (loadSkillRegistry, Kinderliste)
            → Ergebnis merken — auch ein „hier ist keine"
            → alle 5 min: Einträge erneuern, die älter als die TTL sind
```

Damit ist ein Cache-Treffer **dieselbe Aussage** wie ein Live-Abruf, nur bis zu
einer TTL alt. Ein gemerktes „diese Sammlung führt keine Registry" darf deshalb
`registryChecked` setzen — es ruht auf der Kinderliste, nicht auf dem Index.

### Warum kein Vorab-Durchlauf des Baums

Gemessen 2026-08-11: Ebene 1 = **35** Sammlungen (1,65 s), Ebene 2 = **331**
(6,6 s bei Pool 10), Ebene 3 hochgerechnet **~1335** (Schnitt 4,0 Kinder je
Sammlung aus 30 Stichproben). Ein vollständiger Durchlauf wären **~1700**
Sammlungen und mit den Dateilisten **~3400 Abrufe je Zyklus**, rund 3–4 Minuten.
Im 5-Minuten-Takt ergäbe das ~11 Anfragen/Sekunde Dauerlast gegen eine
geteilte Instanz. Nicht vertretbar.

Die Warteschlange ist stattdessen durch die **tatsächliche Nutzung** begrenzt:
eine Suche liefert 5 Sammlungen, ein Browse 35. Wer dieselben Sammlungen wieder
abruft — der Normalfall — zahlt ab dem zweiten Mal nichts.

### Die Suche ist der Startschuss, nicht die Quelle

Beim Start setzt **ein** `ngsearch` (~1,2 s, gemessen) die Warteschlange auf:
alle `virtual:primaryparent_nodeid` des Skill-Korpus sind die Knoten, an denen am
ehesten eine Registry hängt. Sie werden **vorgemerkt**, nicht übernommen — was
der Cache am Ende weiß, hat die Kinderliste gesagt. Eine Index-Lücke verzögert
damit höchstens, bis die Sammlung zum ersten Mal in einer Antwort auftaucht; sie
kann nichts Falsches erzeugen.

### Verworfene Alternativen

**A — Cache aus dem Suchindex befüllen.** Ein Aufruf, sofort vollständig, aber
die Freigabeliste hinge am Index — verboten, und die Lücke wäre unsichtbar.
Verworfen; der Index bleibt Startschuss.

**B — Vollständiger Baumdurchlauf im Hintergrund.** Autoritativ und
vollständig, aber ~3400 Abrufe je Zyklus (gemessen, s. o.). Verworfen wegen der
Dauerlast. Falls der Bedarf entsteht, wäre ein Durchlauf mit **langem** Takt
(stündlich) und Ebenenbegrenzung der Ausbauweg — nicht dieses Paket.

**C — Anreicherung über einen Haken in `formatNodes`.** Ein einziger Seam statt
fünf Aufrufstellen. Verlangt aber, dass `formatter.ts` — ein Blattmodul ohne
Service-Abhängigkeiten — einen netzgespeisten Dienst konsultiert, oder eine
global gesetzte Lookup-Funktion. Beides versteckt eine Abhängigkeit in einer
reinen Renderfunktion; genau diese Bauform hat den doppelten Hinweis erzeugt, den
der Review gefunden hat. Verworfen zugunsten expliziter Aufrufe, die ein
Disziplin-Test festhält.

## Global constraints

Aus `CLAUDE.md`, wörtlich bindend:

- ESM, intra-Projekt-Importe mit `.js`-Endung.
- `services/` darf **nicht** aus `tools/` importieren.
- Konfiguration nur über Env, keine Secrets im Code.
- Tests: `node:test` über tsx, Upstream über `tests/fetchMock.ts`; `npm test`
  lädt `tests/netguard.mjs` und lässt **keinen** ungemockten Non-Loopback-Fetch
  durch. Ein Cache, der beim Modul-Load Netz anfasst, bricht die ganze Suite.
- Interaktionssprache Deutsch, Code/Kommentare/Doku Englisch.

## Architecture

### Files

| Datei | Verantwortung |
|---|---|
| **neu** `src/services/skill-registry-cache.ts` | Warteschlange, Hintergrund-Abarbeitung über `loadSkillRegistry`, Ablauf nach TTL, Startschuss aus der Suche. Kein MCP-Import. |
| `src/services/skill-registry.ts` | **unverändert.** Der Cache ruft `loadSkillRegistry` auf, statt dessen Bestandteile nachzubauen — eine Erkennungsregel, ein Auswahlverfahren, eine Kappung. Das ist der ganze Grund, warum dieses Paket so klein ausfällt. |
| `src/wlo-config.ts` | `WLO_SKILL_CACHE`, `WLO_SKILL_CACHE_REFRESH_MS`; `WLO_REGISTRY_IN_SEARCH` entfällt |
| `src/http.ts`, `src/stdio.ts` | starten den Cache — der **einzige** Ort, an dem er anläuft |
| `src/services/search.ts` | `searchAll` reichert aus dem Cache an; Live nur bei `includeSkillRegistry` |
| `src/tools/collections.ts` | `search_wlo_collections`, `get_collection_contents` |
| `src/tools/node-relations.ts` | `get_node_collections` |
| `src/tools/browse.ts` | `browse_collection_tree` |
| `tests/shared-rule-discipline.test.ts` | hält fest, dass jeder Pfad mit Sammlungsknoten anreichert |

### Data flow

```
Start (http.ts / stdio.ts)
  └─ startSkillRegistryCache()          ← kehrt SOFORT zurück, wartet auf nichts
       ├─ Startschuss: 1× ngsearch → alle primaryparent-ids VORMERKEN
       └─ setInterval(tick, 5 min).unref()

tick():
  ├─ abgelaufene Einträge (älter als TTL) vormerken
  └─ Warteschlange abarbeiten, mapPool(REGISTRY_POOL = 10):
        loadSkillRegistry(id, { resolveHeads: false })   ← die KINDERLISTE
        → Registry gefunden  → Eintrag { registry, checkedAt }
        → keine gefunden     → Eintrag { registry: null, checkedAt }   ← auch das ist Wissen
        → Abruf fehlgeschlagen → NICHTS merken, erneut vormerken

Anfrage:
  ensureRegistries(nodes)                    ← der Einstieg jedes Sammlungspfads
    ├─ 1. attachCachedRegistries(nodes)      ← synchron, 0 Abrufe
    │      ├─ Treffer mit Registry  → Feld setzen, als geprüft zählen
    │      ├─ Treffer ohne          → nichts setzen, aber als geprüft zählen
    │      ├─ Treffer, Scan gekappt → nichts setzen und NICHT als geprüft zählen
    │      └─ Fehltreffer           → nichts setzen, Sammlung vormerken
    └─ 2. Live-Rückfall für die Fehltreffer, höchstens LIVE_FALLBACK_MAX = 10,
          gepoolt und über lookupOnce entdoppelt — was nicht hineinpasst, bleibt
          vorgemerkt und wird als UNBEANTWORTET gemeldet.

  Bei `WLO_SKILL_CACHE=off` kehrt `ensureRegistries` sofort mit 0 zurück: der
  Schalter deckt den Anfragepfad mit ab, nicht nur den Hintergrund.
```

Ein gekappter Scan (`scanTruncated`) wird **gemerkt**, damit dieselbe erste Seite
nicht bei jedem Takt und jeder Anfrage erneut gelesen wird — er **beantwortet**
aber nichts: 50 von 400 Dateien gelesen heißt „unter denen war keine", nicht
„diese Sammlung führt keine". Der Aufrufer behält seine Hinweiszeile.

### Interfaces

```ts
// src/services/skill-registry-cache.ts

/**
 * One collection's answer, as the CHILDREN listing gave it.
 * `registry: null` is a real answer ("looked, none there"), not a gap —
 * unless `scanTruncated` is set, which weakens it to "none among the files
 * we saw" and keeps the question open.
 */
export interface CacheEntry {
  registry: CachedRegistry | null;
  checkedAt: number;
  scanTruncated?: ScanTruncation;
}

/** The field itself, not a second declaration of its shape. */
export type CachedRegistry = NonNullable<FormattedNode['skillRegistry']>;

/** Free, synchronous, never throws. `undefined` = never checked. */
export function lookupCachedRegistry(collectionId: string): CacheEntry | undefined;

/** Queue a collection for background resolution. Idempotent, never blocks. */
export function queueCollections(collectionIds: string[]): void;

/**
 * Attach what the cache knows; queue what it does not.
 * @returns how many of `nodes` the cache had an authoritative answer for.
 */
export function attachCachedRegistries(nodes: FormattedNode[]): number;

/**
 * THE entry point for every collection-rendering path: attach what is known,
 * then resolve the rest live (bounded, pooled, de-duplicated) and remember it.
 * Returns 0 immediately when `WLO_SKILL_CACHE` is off.
 * @returns how many of `nodes` are answered authoritatively.
 */
export async function ensureRegistries(nodes: FormattedNode[]): Promise<number>;

/** Drain the queue once and expire stale entries. Exported for tests. */
export async function runCacheTick(opts?: { now?: number }): Promise<CacheTickReport>;

/** Seed from the search corpus (one ngsearch), then start the interval. Returns immediately. */
export function startSkillRegistryCache(): void;

/** Stop the interval and clear state (tests, shutdown). */
export function stopSkillRegistryCache(): void;

/** The in-flight warmup, settled — tests and shutdown. */
export function cacheWarmup(): Promise<void>;

/** How many answers are held, and the bound they are held under. */
export function cacheSize(): number;
export const CACHE_MAX_ENTRIES = 2000;

export interface CacheTickReport {
  resolved: number;      // collections the listing SETTLED — registry or none
  found: number;         // of those, ones that carry a registry
  failed: number;        // lookups that threw — re-queued, nothing remembered
  inconclusive: number;  // listings cut short at the file cap — kept, but settle nothing
  expired: number;       // entries past the TTL, re-queued
  queueLeft: number;     // still waiting after the batch cap
  ms: number;
}
```

### Data model

`Map<collectionId, CacheEntry>` plus ein `Set<collectionId>` als Warteschlange.
Beide Obergrenzen sind hart: `CACHE_MAX_ENTRIES = 2000` (die ältesten fallen
heraus), `QUEUE_MAX = 500` (danach wird nichts mehr vorgemerkt und **gewarnt**).
Ohne diese Deckel wäre die Warteschlange von außen befüllbar — jede erfundene
nodeId in `excludeNodeIds`-Nähe würde Speicher belegen.

Kein Persistenz-Layer: die Registry-Allow-list ist der einzige Disk-Writer
(`CLAUDE.md`), und ein Neustart wärmt sich aus der Nutzung neu.

### Dependencies

Keine neuen. `ngsearch`, `loadSkillRegistry`, `mapPool`, `log` existieren alle.

## Non-functional

**Performance.** Je Anfrage: **0 zusätzliche Abrufe**, ein Map-Lookup, synchron.
Je Takt: höchstens `TICK_BATCH_MAX = 50` Sammlungen à 1 Kinderliste, gepoolt mit
10 → ~7 s im Hintergrund im Vollausschlag. Startschuss einmalig 1 Suchaufruf
(~1,2 s, gemessen). Im eingeschwungenen Zustand fällt fast nichts an: eine Suche
liefert 5 Sammlungen, und beim zweiten Mal sind sie bekannt.

**Nicht blockierend — was das konkret heißt.** `startSkillRegistryCache()`
`await`et nichts; Startschuss und Takt laufen als nicht abgewartete Promises mit
eigenem `catch`. Das Intervall wird `unref()`t, damit es den Prozess nicht am
Leben hält. Keine Anfrage wartet je auf den Cache — ein Fehltreffer liefert
`undefined`, und die Antwort fällt auf den heutigen Hinweis zurück.

**Fehlerverhalten.** Ein fehlgeschlagener Abruf merkt sich **nichts** und wird
neu vorgemerkt. Das ist der Unterschied, auf dem die Ehrlichkeit ruht: nur ein
Abruf, der geantwortet hat, darf zu „hier ist keine Registry" werden. Ein
Netzausfall verzögert, er behauptet nicht.

Drei Ausgänge, nicht zwei. Der dritte ist die **gekappte Dateiliste**
(`REGISTRY_SCAN_MAX = 50`): sie hat geantwortet, aber nicht auf die gestellte
Frage. Sie wird gemerkt — ein erneutes Lesen liefert dieselbe erste Seite und
damit nichts Neues —, zählt aber nicht als geprüft, sodass die Hinweiszeile
stehen bleibt. Die TTL ist die richtige Frequenz für „hat sich die Sammlung
geändert", und sie greift wie bei jedem anderen Eintrag.

**Staleness.** Ein Cache-Eintrag ist bis zu einer TTL (Standard 10 min) alt. Eine
Registry, die vor zwei Minuten angelegt wurde, erscheint also verzögert.
`get_skill_registry` und `includeSkillRegistry: true` sind live und kennen sie
sofort. Steht in README und Werkzeugbeschreibung.

**Observability.** Eine Logzeile je Takt mit dem vollen `CacheTickReport`; eine
Warnung, wenn die Warteschlange den Deckel erreicht (dann bleiben Sammlungen
ungeprüft — Unvollständigkeit, die niemand sieht, ist genau das, was dieses
Projekt an mehreren Stellen verbietet).

**Security.** Keine neue Angriffsfläche: dieselben Endpunkte, dieselbe
Credential-Grenze (`wloFetch`). Registry-Titel und Skill-Titel bleiben
Repository-Daten und laufen wie bisher durch `oneLine` bzw. `escapeHtml`.

## Risks

| Risiko | Minderung |
|---|---|
| **Index-Lücke** — Registry existiert, Suche kennt sie nicht | Der Index ist nur Startschuss; die Antwort kommt aus der Kinderliste. Sobald die Sammlung einmal in einer Antwort auftaucht, wird sie geprüft |
| **Frische** — eine gerade angelegte Registry fehlt bis zu 10 min | Dokumentiert; `get_skill_registry` und `includeSkillRegistry: true` sind live |
| **Erster Kontakt bleibt kalt** — die allererste Antwort für eine Sammlung trägt nichts | Bewusst: Blockieren wäre die Alternative. Die Hinweiszeile steht, ab dem zweiten Abruf ist der Katalog da |
| **Warteschlange als Speicherhebel** — beliebige nodeIds von außen | Harte Deckel `QUEUE_MAX = 500` / `CACHE_MAX_ENTRIES = 2000`, beide gewarnt statt still |
| **Ein Ausfall wird zu „keine Registry"** | Nur ein Abruf, der **geantwortet** hat, wird gemerkt. Fehler → nichts merken, neu vormerken |
| **Ein gekappter Scan wird zu „keine Registry"** | `scanTruncated` wird mitgemerkt und zählt **nicht** als geprüft — gemerkt nur, damit dieselbe erste Seite nicht endlos neu gelesen wird |
| **Timer bricht Tests** | Der Cache startet **nur** aus den Transports, nie beim Modul-Load; Tests rufen `runCacheTick()` direkt |

## Open questions

Keine offen. Die zwei Zuschnittsfragen sind entschieden (2026-08-11): alle Pfade
mit Sammlungsknoten; `includeSkillRegistry` wird zum Live-Zwang.
