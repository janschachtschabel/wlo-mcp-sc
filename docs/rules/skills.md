# Skills, the skill registry and its cache, contexts

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- **Skill-Abruf (`search_skill` / `get_skill`) — COMPLETE (2026-08-08),
  Redaktions-Anleitung: `docs/SKILLS.md`, Verlauf in `STATUS.md`:**

  A skill is a `ccm:io` whose **content type** marks it
  (`ccm:oeh_extendedType = …/contentTypes/ai_skill`, full URI — the slug matches
  nothing; it was `ai_prompt` until the vocabulary split on 2026-08-12) and whose attached file is the `SKILL.md`. Both tools are registered
  unconditionally; `WLO_SKILLS_COLLECTION_ID` only NARROWS the search, and
  `WLO_SKILL_TOOL_MODE=one-tool` swaps **the search alone** for
  `get_skill_for_task` — `get_skill` is registered in EVERY mode (2026-08-16),
  because it is the only tool that takes a nodeId and the surfaces handing them
  out are not governed by that switch: `get_skill_registry` is unconditional and
  IS a list of them, every collection result carries that list, and a skill names
  its references and companions by id. Leaving it out made the approval list
  unusable in that mode. The swap is therefore 1:1 and the tool count does NOT
  change — two docs said 41 because `tests/docs-claims.test.ts` derived the
  expectation from a COMMENT about the code (`names.length - 1`) instead of the
  code; it now measures both modes through `registerSkillTools`.

  Four measurements bind any change here (2026-08-08, re-measure before
  contradicting): (1) `ngsearch` returns **no collections at all**
  (`contentType=FOLDERS` → 0) and the collections endpoint takes **only**
  `ngsearchword` — so a skill must stay a `ccm:io`, and a collection scope must be
  WALKED (`virtual:parent_recursive` → 400 on ngsearch, unlike the page_variant
  query). (2) That walk is level-parallel and bounded on three axes; sequential it
  took 90.3 s over a subject portal. Any collection left unread — cap, depth or a
  failed listing — must be logged, and a root that is wholly unreadable THROWS
  rather than reporting an empty catalogue. (3) `ccm:original` is the identity: it
  is in the projection, results dedupe on it, and the original wins over a
  reference. (4) The instruction TEXT reads fine through a reference id; only the
  companion-folder lookup has to resolve `ccm:original` first.

  Three rules the tool layer holds: the server-derived sections (activation
  line, file manifest, `:::` references) are rendered BEFORE the untrusted
  document, because after it they are indistinguishable from sections the
  document forged; a companion is pointed at the tool that fits its MIME type —
  `get_skill` returns the file VERBATIM, so anything that is not `text/*` goes
  to `get_wlo_content_text` — and since the audit of 2026-11-12 `get_skill`
  itself holds that line: an instruction is loaded WHOLE OR NOT AT ALL
  (`readSkillText`). Never cut (the user's decision of 2026-08-20), but a
  record that is certainly binary is not downloaded (a DENY list: only
  `text/x-web-markdown` is measured, so "not `text/*`" would refuse on a
  guess), and a text past
  `SKILL_TEXT_MAX_BYTES` (2 MiB) is refused whole and reported as
  `contentRefused` — the path had no bound at all, and the nodeId is the
  caller's, so any downloadable file was buffered in full; and a loaded skill ANNOUNCES itself
  (`services/skill-activation.ts`, 2026-08-15) with a line the model is asked to
  print — `[ edu-sharing Skill ] <cclom:title> - aktiv`, also carried as the
  `activation` field so a client rendering the answer itself does not depend on
  the model complying. Two things bind any change to it. It rests on the CONTENT
  TYPE, not on which tool was called: `get_skill` also serves a skill's
  companion files, and announcing a template as an active skill asserts what the
  record denies. And the title goes through `sanitizeText`, never `oneLine` —
  it lands inside an instruction reproduced verbatim to a person, which is the
  elevated-authority boundary, not the delimiter protection an ordinary rendered
  value gets. Compliance cannot be enforced; that is the same standing a host's
  own skill files have.

  **A catalogue says it is not the instruction (2026-08-16).** Every surface
  that lists skills BY NAME closes with `DESCRIPTIONS_ONLY_NOTE` — one constant
  in `registry-render.ts` (split out of `formatter.ts` 2026-11-05, re-exported
  there), beside `registrySummaryLines`, pinned by
  `tests/shared-rule-discipline.test.ts`; two of the three surfaces already
  carried their own closing pointer, identical by luck, and the third had none.
  It reaches `registrySummaryLines` (so: search results, `subjectRegistryText`,
  `get_node_details`, topic pages), `search_skill` and `get_skill_registry`,
  each in BOTH formats (`hint` in JSON, same rule as that tool's untrusted
  warning), and in `get_skill_registry` it stays ahead of the `---`. Three rules
  bind any change. (1) It is emitted only where a skill nodeId was PRINTED —
  not on the head-line tier and not for an empty catalogue: naming `get_skill`
  "mit dessen nodeId" over an answer that carries none promises a step the
  content cannot support. `get_skill_for_task`'s alternatives are excluded for
  the neighbouring reason — under `one-tool` the named tool is not registered.
  That rule is PER FORMAT, and both JSON sites broke it in the first cut:
  `get_skill_registry` answers its JSON branch BEFORE the `!registry` check, so
  an unconditional `hint` shipped beside `registry: null`. What made it
  invisible is worth more than the fix — the positive tests covered both
  formats and the negative ones only markdown. The `hint` field itself belongs
  to those two tools ALONE: prose hints are markdown-only everywhere else
  (`registryHintFor`; `renderToJson` carries none), and the envelope says the
  same thing through `registryChecked`/`licenseFilter`/`skillRegistry`. These
  two build their payload by hand, which is the whole reason they need it.
  (2) It says what the listing is NOT and never what it HOLDS: the two surfaces
  hold different things (a node's catalogue is title+nodeId only, the tool's
  adds descriptions and keywords), so a first draft naming the fields — "nur
  Titel und Beschreibungen" — was false on the surface that shows the most of
  them. (3) It is INDENTED with the entries it closes; flush left it lands
  between the last skill and the node's own `Typ:` line and reads as a claim
  about the record. Both (2) and (3) were found by rendering the output, not by
  a test — which is why each now has an assertion. (4) It RULES OUT the two ids
  standing beside the right one, because naming the tool is not enough where
  THREE nodeIds are in view — the collection's on the record line, the registry
  document's on the head line, the skill's on its entry, and the one nearest
  the note is the registry's. Indefinite ("einer Registry oder Sammlung"), not
  definite: `search_skill`'s catalogue holds neither, so "der" would point at
  things its answer does not show.

- **Skill-Registry pro Inhaltssammlung — CODE COMPLETE (P0–P3, 2026-08-10);
  only the live `:::` run is open, and it waits on editorial work:**
  - Design: `docs/plans/2026-08-10-skill-registry-design.md`
  - Tasks:  `docs/plans/2026-08-10-skill-registry-tasks.md` (12 Aufgaben, 4 Phasen)

  The editorial process inverts the question `search_skill` answers: not "which
  skills exist" but "which skills are APPROVED for this collection", declared by
  a registry document inside the collection. A registry is built like a skill
  record — attached Markdown, `:::` blocks — but keeps the `ai_prompt` content
  type that skills left behind on 2026-08-12 (`REGISTRY_CONTENT_TYPE_URI`), so
  `parseSkillReferences` and `readSkillText` are reused rather than rebuilt (both
  duplications were written before being caught; `readSkillText` is exported from
  `skills.ts` for exactly this).

  Four measurements from T1 bind any change here (2026-08-10, re-measure before
  contradicting): (1) `/children` carries `mimetype`/`mediatype` in EVERY
  projection but `ccm:oeh_extendedType` **only when the request asks for it** —
  same node, same call, empty under `DISPLAY_PROPS` — so the registry lookup must
  pass `SKILL_PROPS` or every candidate is invisible. (2) A SKILL.md reports
  `text/x-web-markdown`, not `text/markdown` (25/25). (3) **28/28** skill files
  are named `SKILL.md`, so the `SKILL_REGISTRY.md` tie-break distinguishes
  nothing today and the ambiguity disclosure is the RULE, not a corner case.
  (4) **0/28** documents contain `:::` at all and **0/28** are collection
  references — the block format was documented but unexercised on staging.
  **Superseded 2026-08-12:** the editorial team filed one. `loadSkillRegistry`
  on the Optik collection returned "Skillkatalog Physik Optik" (16 717 chars,
  **28** `:::` blocks — the 56 counted here was the number of FENCE LINES, an
  opening and a closing one per block) resolving to **28 entries, 0
  unresolved**. The path is measured; what was waiting was editorial work, not
  code. **Those 28 are gone (2026-08-18, the user's decision):** the same
  document is now 985 characters with **3** blocks, restructured into contexts.
  Do not treat the 28 as a target or a regression — what the measurement proved
  is the PATH, and that still holds. One of the three answers HTTP 403 (not
  publicly readable), so the live document is also the first real case of
  `unresolved` being non-empty.

  The registry is found through the collection's CHILDREN listing, never the
  search index: the two are separate systems, and the Optik case (2026-08-09)
  showed a record can fall out of the index while sitting in the node store. An
  approval list must not depend on it.

  Two rules the service holds: the catalogue has TWO cost tiers in ONE function
  (`resolveHeads`) — the search tier costs exactly 2 upstream calls per
  collection no matter how many skills are declared, because the `:::` block
  already carries the title, and a test COUNTS those calls because the cost is
  part of the contract; and a found-but-unreadable registry comes back NAMED with
  `reason: 'unreadable'`, because "there is no registry here" is a different and
  wrong claim.

  **Reach and caps changed 2026-08-15 (the user's decision), and the two changes
  interlock.** (a) `REGISTRY_SEARCH_MAX` IS `REGISTRY_MAX` (100): one number, so
  a listing and `get_skill_registry` cannot disagree about what "the approved
  skills" are. It costs no request — the cheap tier reads title and nodeId from
  the `:::` block. The sentence moved with it: a capped listing may no longer
  say "mehr mit get_skill_registry" (the tool caps at the same 100) and points
  at the registry DOCUMENT instead, which that tool returns unchanged; the
  equality is pinned in `tests/skill-registry.test.ts` because raising one
  number alone makes that sentence quietly wrong. (b) The catalogue was attached
  to a tool's RESULTS, which answered for every collection except **the one the
  tool was called on** — `get_collection_contents`,
  `search_wlo_within_collection`, `get_node_details`, `get_topic_page_content`
  all take it as an argument and never return it (and with
  `contentFilter="files"` the results are materials, so nothing was attached at
  all). `subjectRegistryText` (`tools/shared.ts`, over `ensureRegistryFor`) is
  the ONE place that answers for a single collection — enforced by
  `tests/shared-rule-discipline.test.ts` — and for a Themenseite the id is the
  COLLECTION's, never the variant's. Its block NAMES the collection in words:
  it lands under the last listed record, and without that line it reads as that
  record's registry, which for a material cannot exist. Three rendering tiers
  now exist and the rule is the answer's SHAPE, not its subject: record lists
  and the subject collection get the full catalogue; a tool that renders one
  block per node (`browse_collection_tree`, `get_subject_portals`,
  `search_wlo_topic_pages`) gets the head line via
  `registrySummaryLines(…, {entries:false})` and reads the cache ONLY
  (`cachedRegistriesFor`) — thirty portals or fifty branches paying a children
  listing each is the crawl this cache exists to prevent. **Since 2026-08-19
  the TOPIC-PAGE bucket of `searchAll` carries the catalogue too** — a
  Themenseite IS a `ccm:map` and the live Optik page holds three approved
  skills; only the plain-collection bucket was enriched, so a search's one hit
  for "Optik" named none of them. Three rules bind the change: BOTH buckets go
  into ONE `ensureRegistries` call (they share the live-fallback cap — two
  calls would double a search's upstream budget); the function returns the SET
  of answered nodeIds rather than a count, because each bucket reconciles its
  own `registryChecked` against the shared call — a count cannot say which side
  an answer belongs to, and the count-based union marked the NORMAL mixed
  search unchecked while its catalogues stood in the answer; and
  `topicPages.registryChecked` is declared in `searchAllEnvelopeSchema` (an
  undeclared key breaks the advertised schema with nothing failing — see the
  note below on what zod does and does not do). `get_topic_page_content`
  additionally carries the catalogue INLINE in markdown — it was a second
  content block, and at least one real client hands the model only the first,
  so the server had answered and the model never saw it; JSON keeps the second
  block, because block 1 is pure JSON there and prose inside breaks every
  parser. `get_related_content`
  answers for the collection it TOUCHES, exposed as `registryCollectionId`, and
  which one that is depends on the SEED — the tool takes a material or a
  collection: a collection seed IS the collection in play (its own
  `virtual:primaryparent_nodeid` is a level the caller never named, which is
  what a `siblingCollectionId` named after the siblings got wrong), a material
  seed points at the parent the siblings were read from, and with no siblings
  requested there is no collection and nothing is said. Its two RESULT lists
  come from `FILES` queries and can hold no collection at all, which is why the
  `registryHintFor` call over their union was unreachable code and is gone.

  Two rules the review of the same day added, and both are about a NEGATIVE.
  (1) The catalogue is attached to the NODE, before any `outputFormat` branch —
  both browse tools computed it after the JSON early-return, so a JSON caller
  got nothing while the docs promised it to both. It costs no schema work:
  `CollectionTreeNode` IS a `FormattedNode` and both browse schemas extend
  `formattedNodeSchema`, so the field and its zod entry already exist — and an
  undeclared key breaks the advertised schema, which is why `structuredContent`
  is asserted separately from the text. (2) `ensureRegistryFor` reports THREE outcomes
  (`{registry, answered}`), not two: a catalogue, "answered, none there", and
  "not answered" — collapsing the last two into one `null` made a failed listing
  read as a collection that approves nothing. A lookup that learned nothing is
  QUEUED, or the tick never warms it and every request repeats the live call.
  `subjectRegistryText` renders silence for the middle case and the "nicht
  geprüft" sentence for the last, and nothing at all for an empty id — which
  `get_topic_page_content` passes whenever a query matched no page.

  P3 adds the search-side enrichment (then `enrichSkillRegistry` in
  `services/search.ts`; removed 2026-11-13 — the cache's `ensureRegistries` /
  `refreshRegistries` are the one way in), rendered once in `renderToText` (both tools go through
  it, every line via `oneLine`, the FULL catalogue listed per collection).
  Two rules from 2026-08-11, both the user's decision, and they interlock —
  changing one without the other makes a sentence in the output false.
  (a) `REGISTRY_LINES_MAX` was 4, is now **30**: an approval list showing four of
  nine is the "short list standing for a long one" shape this project refuses
  elsewhere, and the entry a model needs may be the fifth. (b) The catalogue cap
  is per TIER, and the tier IS `resolveHeads`: `REGISTRY_SEARCH_MAX` = **30** for
  the listing (equal to `REGISTRY_LINES_MAX`, so a listing is always complete for
  what it carries), `REGISTRY_MAX` = **100** for the tool, which fetches one head
  per skill and is called about ONE collection. The head line follows from the
  pair: nothing capped → "alle hier gelistet", and `get_skill_registry` is named
  for what it ADDS (descriptions, keywords, prose), not for completeness it
  cannot improve; capped → "hier die ersten 30, mehr mit get_skill_registry",
  which is true only because the tool cap is higher — and never "alle", because
  past 100 the tool caps too. **(b) was superseded on 2026-08-15** — the tiers
  now carry the SAME 100 and the capped sentence had to stop offering the tool;
  see the Skill-Registry-Cache block below. (a)'s reasoning is what survived and
  was applied again. **(a) itself was superseded on 2026-08-18**: the constant is
  GONE — `REGISTRY_INLINE_MAX` (12) replaced it, and it bounds LINES rather than
  entries, so the catalogue answers with a shorter FORM instead of a truncated
  list. What survives is the objection (a) was raised against, and it is the
  reason the middle form names every context rather than the first few: a short
  list standing for a long one is what this project refuses; a differently shaped
  complete answer is not that. See the Kontexte block below.
  It is **off by default** and the default is a MEASUREMENT: the
  live run showed ~1.0–1.4 s added per search, paid through the `/children` call
  whether or not a registry exists — neither collection in that run had one and
  it still cost 1.4 s. What replaces it is FREE: a pointer line on every
  collection result (`registryLines` emits it when `skillRegistry` is absent and
  `nodeType === 'collection'`), the server instructions, and cross-references
  pinned in `tests/tool-descriptions.test.ts`. The lookup then happens once, for
  the one collection in play, rather than for all five. Three rules bind any
  change: `WLO_REGISTRY_IN_SEARCH` is read INSIDE `searchAll`, not at the three
  call sites; a new `FormattedNode` field
  must be DECLARED in `formattedNodeSchema` (found in this diff). The reason
  given here until 2026-11-07 — "zod strips unknown keys" — is FALSE for the
  tool pipeline (measured on SDK 1.32.2): the SDK validates and passes the
  original object on. The rule still holds for a different reason: the schema
  in `tools/list` carries `additionalProperties: false`, so an undeclared key
  breaks the advertised contract for every strictly validating client; and the measured cost is **~1.0–1.4 s** per search, not
  the 0.5 s first estimated — driven by the child COUNT of the largest
  collection, while the projection costs nothing (27 fields vs 3: 531 vs 523 ms,
  measured before the "obvious" optimisation was written, which is why it was
  not). Staging's variance is large enough that one measurement pair proves
  nothing: a run WITHOUT the enrichment took 7.0 s, slower than any run with it.

  Live-verified 2026-08-10: `no_registry` on a real collection,
  `collection_not_found` on an unknown id, and an unreadable listing degrading
  rather than throwing. The `:::` path itself was the one gap and is now closed
  (2026-08-12): a real registry on the Optik collection resolves 28 of 28
  declared skills with nothing unresolved.

  The review of this package (2026-08-10, 7 findings) adds four rules and they
  bind any change here. (1) A registry's TITLE is read through `nodeTitle`
  (`node-match.ts`), the canonical chain, never through one property: `cm:title`
  is in the same projection and is the carrier this repo measured as actually set
  — reading `cclom:title` alone made a marked registry invisible and, with a
  second `ai_prompt` document present, answered with the WRONG document's
  catalogue. Every fixture goes through `makeNode`, which writes only
  `cclom:title`, so the suite was validating the implementation's choice; a
  detection test must set `cm:title`. (2) The registry pointer is an ANSWER-level
  line, not a list-level one — `registryHintFor` is exported and a composed
  answer (`search_wlo_all`: three lists, and topic pages are `ccm:map` so they
  format as collections) suppresses `renderToText`'s own hint and emits it once.
  `get_related_content` was the second such caller until 2026-08-15, when its
  union hint turned out to be unreachable (see above). (3) Whether the lookup RAN is reported as
  `collections.registryChecked`, the same shape and the same reason as
  `content.licenseFilter`: a collection without a registry carries no field, so
  the results cannot tell "not looked up" from "looked up, none there", and a
  renderer that guesses tells a caller its answered question was skipped.
  (4) A bounded scan discloses its bound — `scanTruncated {scanned,total}` from
  `pagination.total`, because "diese Sammlung führt keine Registry" over 50 of
  400 files is a claim the read does not support. Corollary that cost two of the
  seven findings: `WLO_REGISTRY_IN_SEARCH` living inside `searchAll` means every
  caller inherits the cost, so a path that cannot RENDER the field either learns
  to (`/api/search?format=html`) or declines it (`knowledge.ts`, whose
  `{id,title,url}` shape has nowhere to put it).

- **Skill-Registry-Cache — COMPLETE (2026-08-11), inkl. Review (8 Befunde) und
  Live-Lauf gegen Staging; offen ist nur der `:::`-Pfad (0 Registries vorhanden):**
  - Design: `docs/plans/2026-08-11-skill-registry-cache-design.md`
  - Tasks:  `docs/plans/2026-08-11-skill-registry-cache-tasks.md` (11 Aufgaben, 4 Phasen)

  `services/skill-registry-cache.ts` makes the catalogue part of every collection
  answer: `ensureRegistries` serves from memory and falls back to a bounded live
  children listing for what it lacks. That retires `WLO_REGISTRY_IN_SEARCH`
  (gone) and re-points `includeSkillRegistry` at FORCING a fresh lookup — it no
  longer decides whether the registry appears at all. Five rules bind any change.

  (1) **A NEGATIVE may only come from the CHILDREN listing; the index may only
  produce a POSITIVE.** The asymmetry is the whole design. A corpus hit is a
  record the index handed over, so "this collection HAS a registry" rests on
  evidence and is adopted at once (fast path: one document read, no listing).
  Absence from the index rests on a gap nobody can see — a record can fall out
  of it while sitting in the node store (2026-08-09) — so a parent the corpus
  does not name stays UNKNOWN and the listing answers it. Same asymmetry inside
  the tick: only a lookup that ANSWERED is remembered; a throw or `unreadable`
  is remembered as nothing and re-queued, or an outage becomes a statement.
  (Measured 2026-08-11: `virtual:primaryparent_nodeid` is on 28/28 records and
  already in `SKILL_PROPS`, but for harvested material the primary parent is the
  spider folder — `dwu_spider`, `leifi_spider` — which is a `ccm:map` too, so a
  type check would not save you; looking up BY collection id is what makes the
  mapping self-validating.)

  (2) **The live fallback is bounded per request** (`LIVE_FALLBACK_MAX = 10`,
  pooled): a listing of 50 collections must not fire 50 upstream calls. What
  does not fit is queued and reported as UNANSWERED, so the caller's "nicht
  geprüft" line stays true instead of implying a look that never happened.
  `collection_not_found` IS remembered — a nodeId that does not exist will not
  start existing.

  (3) **No pre-built index of the tree.** Measured 2026-08-11: level 1 = 35
  collections, level 2 = 331, level 3 ≈ 1335 → a full walk is ~1700 collections
  and ~3400 requests per cycle, ~11 req/s sustained on a 5-minute schedule.
  The queue is bounded by real usage instead (a search returns five).
  Re-measure before contradicting.

  (4) **`registryChecked` needs the live pass as its own term**, not inferred
  from how many nodes carry a field: a live lookup that found NOTHING also
  leaves no field, so counting fields reports a completed check as skipped
  (caught by an existing test the day it was written).

  (5) **The cache starts ONLY from `http.ts`/`stdio.ts`**, never at module load —
  a timer firing on import hits the network in every test and `tests/netguard.mjs`
  fails the run. Pinned by `tests/shared-rule-discipline.test.ts`, which also
  names the three files that must call `ensureRegistries`.
  `tools/browse.ts` was excluded at the time, because it rendered its own line
  formats with no registry line. **Superseded 2026-08-15:** the browse tools
  carry the head line and read the cache only (`cachedRegistriesFor`) — see
  the block on reach and caps above.

  The review of this package (2026-08-11, 8 findings) adds three rules and they
  bind any change here. (6) **A lookup has THREE outcomes, not two.** Beside
  "answered" and "failed" there is the scan cut short at `REGISTRY_SCAN_MAX`:
  `loadSkillRegistry` reports `scanTruncated` for exactly this, and both cache
  paths dropped it — so 50 files read of 400 was cached as "this collection has
  no registry", held for the TTL and re-affirmed by every refresh, because the
  same first page comes back each time. It is remembered (re-reading answers
  nothing) but does NOT count as answered, so the caller keeps its pointer line.
  Do not simplify that to "remember nothing and re-queue": that is an endless
  crawl for an answer the cap makes unobtainable. (7) **`WLO_SKILL_CACHE` covers
  the REQUEST path**, not only the timer — the switch is flipped for the cost,
  and a live fallback that kept running charges every request the full children
  listing while no tick exists to expire anything or drain the queue it feeds.
  (8) There is **one** function that turns a `SkillRegistry` into the field a
  result node carries (`toRegistrySummary`, `services/skill-registry.ts`), its
  return type is `FormattedNode`'s own field rather than a re-declaration, and
  the discipline test fails a second copy — four existed, and what a copy drifts
  on is `truncated`, the disclosure that the catalogue is shorter than the
  registry declares.

- **Kontexte in der Skill-Registry — VOLLSTÄNDIG (P0–P6, 2026-08-18):**
  - Entwurf:  `docs/plans/2026-08-18-registry-kontexte-design.md`
  - Aufgaben: `docs/plans/2026-08-18-registry-kontexte-tasks.md` (17 Aufgaben, 6 Phasen)
  - Redaktionsanleitung: `docs/SKILLS.md` („Contexts"), Ablauf: `docs/SKILL-TRIGGER.md`

  Ein Registry-Dokument gliedert seine Skills über Markdown-Überschriften
  (H1 = Dokumententitel, H2 = Kontext, H3 = Unterkontext) und trägt je Kontext
  eine Nutzungsanleitung der Redaktion. `services/markdown-sections.ts` liest die
  Überschriften (rein, kein I/O), `services/registry-contexts.ts` legt Blöcke und
  Prosa darauf, `narrowRegistry`/`contextInstructions` (`skill-registry.ts`)
  verengen. `get_skill_registry` nimmt `context`, die fünf Sammlungs-Werkzeuge
  `skillContext`.

  **Was es kostet, und was nicht.** Kontexte kosten **null** zusätzliche Abrufe —
  der billige Tarif bleibt bei exakt 1 × `/children` + 1 × Download + 0 ×
  Metadaten, und ein Test ZÄHLT das, weil die Kosten Teil des Vertrags sind.
  Ein **benannter** `skillContext` kostet dagegen **einen Live-Abruf (2 Anfragen,
  ~1,0–1,4 s)**: der Cache hält die ZUSAMMENFASSUNG (Titel, nodeId, Kontextnamen,
  Anzahlen) und nicht die Prosa der Redaktion, die je Sammlung Kilobytes wäre und
  dann in JEDEM Treffer läge. Der Entwurf hatte „null" auch dafür zugesagt; das ist
  beim Bauen gefallen und im Entwurf korrigiert, nicht stillschweigend anders
  gebaut. `all` verlangt keine Prosa und wird deshalb aus dem Cache beantwortet —
  es in den Live-Pfad zu schicken war ein Review-Befund (2026-08-18).

  **Das Budget: `REGISTRY_INLINE_MAX` (12 Zeilen) ersetzt `REGISTRY_LINES_MAX`
  (100)** und entscheidet zwischen drei Formen — gruppiert mit nodeIds,
  Kontext-Index ohne UUIDs, Kopfzeile allein. Gedeckelt ist die OBERGRENZE, nicht
  jede Größe: innerhalb des Budgets kostet die Gruppierung eine Zeile je Kontext,
  eine kleine Registry wird dadurch etwas länger als ihre flache Liste (gemessen
  am echten Optik-Dokument 2026-08-18, 3 Skills in 2 Kontexten: 818 gegen 659
  Zeichen). „Je größer, desto kürzer“ stand zwischenzeitlich in vier Dokumenten
  und ist falsch — gefunden hat es der Live-Lauf, kein Test. Kontextnamen werden **gepackt** (mehrere je
  Zeile, `·`-getrennt, Umbruch bei 100 Zeichen, nie mitten im Namen), weil ohne
  Namen niemand gezielt nachfragen kann. Der `reach`-Satz der Kopfzeile hängt an
  der FORM, ebenso `DESCRIPTIONS_ONLY_NOTE`: Formen 2 und 3 drucken keine
  Skill-nodeId und dürfen deshalb keinen `get_skill`-Schritt versprechen.

  **Vier Regeln über die Struktur, und jede ist eine Entscheidung, auf die sich
  die Redaktion verlässt.** (1) Ein Abschnitt OHNE Titel ist durchsichtig: sein
  Inhalt gehört dem nächsten benannten Abschnitt darüber, sonst dem allgemeinen
  Teil — eine Regel mit zwei richtigen Ergebnissen (leeres `##` als Trenner →
  allgemein; leeres `###` in einem benannten Kontext → dieser Kontext). (2) Ein
  benannter Abschnitt IST ein Kontext, **auch ohne Skill**. Der erste Entwurf
  verlangte einen Block; ein Live-Lauf am echten Optik-Dokument (2026-08-18)
  widerlegte ihn — die Redaktion hatte `## Browserplugin` mit Anleitung und noch
  ohne Skills geschrieben, und die alte Regel machte diese Überschrift unsichtbar
  UND antwortete „unbekannter Kontext" auf einen Namen, den jeder im Dokument
  liest. (3) `skills` bleibt **innerst** zugeordnet, damit Elternkontext und
  Unterkontext denselben Skill nie doppelt zählen; ein rein gruppierender Eltern
  steht mit `(0)` da, was (2) zusätzlich bestätigt. (4) Die Anleitung ist die
  Prosa von der Überschrift bis zum ERSTEN `:::`-Block — Text danach gehört dem
  Skill davor. Deshalb steht in der Redaktionsanleitung „Anweisung VOR die
  Blöcke".

  **`resolveContext` meldet DREI Nicht-Treffer, nicht zwei** — `unknown`,
  `ambiguous` und `no_contexts` (ein Name über einem Dokument ohne Gliederung).
  Der dritte fehlte bis zum Review 2026-08-18: die Funktion antwortete `all`, und
  BEIDE Aufrufer leiteten den Unterschied selbst her — mit verschiedenen
  Bedingungen. `get_skill_registry` nahm das reservierte `all` aus,
  `subjectRegistryText` nicht, also meldete `skillContext: "all"` auf einer flachen
  Registry, „all" habe nicht gegriffen. Der Wächter konnte das nicht sehen: er
  prüft, dass die FUNKTION einmal definiert ist, nicht dass die ENTSCHEIDUNG einmal
  getroffen wird. Wer hier einen Ausgang hinzufügt, gibt ihm einen eigenen `kind` —
  eine Lage, die zwei Aufrufer rekonstruieren müssen, rekonstruieren sie
  verschieden.

  **Die Anleitungsebenen bleiben getrennt und benannt (2026-08-18).**
  `contextInstructions` liefert `{scope, title, text}` je Ebene (allgemein ·
  Elternkontext · Kontext), und `subjectRegistryText` rendert **eine Zeile je
  Ebene** mit einer Beschriftung davor (`instructionLabel`, `tools/shared.ts`).
  Vorher wurden sie mit einem Leerzeichen verkettet, und ein Leser konnte nicht
  sehen, wo der allgemeine Teil endet und der Kontext beginnt — die Redaktion
  schreibt sie als getrennte Abschnitte, weil sie Verschiedenes bedeuten. Zwei
  Regeln binden das: **`flattenText` läuft je TEIL, nie über den
  zusammengesetzten Block** (es kollabiert jeden Whitespace-Lauf, Zeilenumbrüche
  eingeschlossen — über dem Block angewandt macht es die Trennung sofort wieder
  rückgängig), und die Kappung bleibt EINE über dem ganzen Block, damit das
  Budget dasselbe ist wie vorher. Der Kontextname geht durch `sanitizeText`,
  nicht `oneLine`: er landet in Prosa, die eine Person befolgen soll.

  **Jede Sammlungs-Antwort trägt die Beschreibungen der ersten DREI Skills
  (2026-08-18, Nutzerentscheidung — zuerst nur am benannten Kontext, am selben Tag
  auf beide Pfade erweitert).** Eine Stelle rendert es (`skillDescriptionLines`,
  `tools/shared.ts`), weil beide Pfade es brauchen und eine zweite Kopie still den
  Deckel verlöre. `describeEntries` (`services/skill-registry.ts`) läuft **nach**
  dem Verengen — nicht `loadSkillRegistry({resolveHeads:true})`, das jeden
  deklarierten auflöst (bis `REGISTRY_MAX` = 100) und für eine verengte Antwort
  die falsche Rechnung stellt. Fünf Regeln binden das. (1) **`DESCRIBED_MAX` = 3
  ist ein Deckel auf die ABRUFE, nicht nur auf die Ausgabe** — das ist der ganze
  Grund, warum es bezahlbar ist; wer ihn hebt, hebt die Abrufe je
  Sammlungs-Antwort mit. Der Katalog, der mit SUCHTREFFERN reist, ist ein anderer
  Weg (Cache, bis zu 10 Sammlungen je Anfrage) und bleibt kostenlos — dorthin
  gehört die Prosa weiterhin NICHT. (2) Schlagworte bleiben draußen (gemessen ~175 Zeichen je
  Skill gegen ~170 für die Beschreibung). (3) Die Beschreibungen stehen
  **unterhalb** der Liste, nicht darin: die Liste ist auf `REGISTRY_INLINE_MAX`
  Zeilen gedeckelt, und je eine Zeile mehr pro Skill kippt einen Vier-Skill-Kontext
  in die Kurzform ohne nodeIds — Information hinzuzufügen darf die Antwort nicht
  ihre brauchbare Hälfte kosten. (4) Eingerückt wird **nach** dem Kappen:
  `capText` trimmt, also gehen vorher eingebaute Führungszeichen genau auf der
  ERSTEN Zeile verloren, was wie eine Überschrift mit Unterliste aussieht. Und die
  Kopfzeile bekommt dafür einen vierten `reach`-Fall (`opts.described`): wo die
  Beschreibungen schon dastehen, darf sie nicht auf `get_skill_registry` „für
  Beschreibungen" verweisen, sondern nennt Schlagworte und das Dokument.
  (5) Ein Skill, dessen Kopf sich nicht lesen ließ, kommt als `unreadable`
  zurück und wird als „Nicht abrufbar (geprüft für die ersten N)" benannt statt
  mit „laden mit get_skill" angeboten — wir haben den Abruf bezahlt, also WISSEN
  wir es. Der Satz nennt seine eigene Reichweite, weil der Deckel bedeutet, dass
  die übrigen ungeprüft sind; ohne diese Angabe liest sich ein Befund über drei
  von zehn wie ein Urteil über alle zehn.

  **Der Katalog hängt VOLLSTÄNDIG an jeder Sammlungs-Antwort (2026-08-18,
  Nutzerentscheidung).** Skills + erste drei Beschreibungen + die **allgemeine
  Anweisung** der Redaktion. Drei Regeln. (1) Die Anweisung liegt auf
  `CacheEntry.generalInstruction`, **niemals** auf `CachedRegistry` — das ist der
  Typ, den ein Suchtreffer-Knoten trägt, und Prosa dort landet in jedem Treffer.
  Gemessen ist das auch der Grund gegen den naheliegenden Live-Pfad: warme
  Übersicht 286–393 ms gegen ~1 851 ms mit Dokument-Lesen. (2) Sie ist beim
  SPEICHERN gedeckelt (`GENERAL_INSTRUCTION_MAX` = 1200), nicht beim Rendern —
  der Cache hält bis zu `CACHE_MAX_ENTRIES` = 2000 Einträge, ungedeckelt wäre die
  Eintragsgrenze keine Speichergrenze mehr. (3) Ein TREFFER behält **seinen
  eigenen** Kontext in der Gliederung (`contexts.filter(c => c.path === …)`), damit
  die Gruppierung Kontext-Skills von den immer geltenden trennt — wie
  `get_skill_registry` es tut. Das frühere `contexts: []` war der Fix für einen
  ANDEREN Fehler (die Zahl des Dokuments über den Einträgen eines Kontexts); ein
  einzelner Kontext mit seiner eigenen Zahl hat ihn nicht. Darunter stehen die
  übrigen Kontextnamen, damit ein zweiter, genauerer `get_skill_registry`-Aufruf
  ohne Zwischenschritt möglich ist.

  Zwei Sätze waren dabei falsch und sind korrigiert: „in 1 Kontexten" (eine
  Registry mit genau einem Kontext ist normal) und die Kontextzahl auf einer
  verengten Antwort — die war die der SICHT in einem Satz, der wie eine Aussage
  über die Registry liest. Eine verengte Antwort nennt jetzt gar keine Zahl;
  ihren Kontext nennt sie in der Eingangszeile.

  **Ein Fehlgriff liefert alles, nie nichts.** Ein unbekannter oder mehrdeutiger
  Name fällt auf die vollständige Antwort zurück (bei `get_skill_registry` auf das
  ganze Dokument) und nennt die vorhandenen Namen — ein Modell lernt den richtigen
  Namen aus genau der Antwort, in der es danebengriff. Nie `isError`, und nie eine
  kurze Liste, die wie ein Ergebnis aussieht. Bei einem Fehlgriff kommt allerdings
  **keine** Anleitung mit: ein Tippfehler darf nicht die teuerste Antwort auslösen.
  Umgekehrt legt ein TREFFER die Gliederung ab und ein Fehlgriff behält sie —
  gefunden im Live-Lauf, weil sonst „Material (3)" über einer leeren Gruppe steht:
  die Zahl ist die des Dokuments, die Einträge sind die des Kontexts.

  **Drei Regeln aus den Review-Runden, und alle drei über Aussagen, nicht über
  Code.** (a) Eine Aussage, die von einem FELD in PROSA wandert, geht für jeden
  Aufrufer verloren, der keine Prosa rendert: die Kappungs-Offenlegung
  `truncated` wurde beim Verengen aus der Sicht herausdestrukturiert und durch
  einen Satz ersetzt — im JSON stand danach gar nichts mehr. Das Feld bleibt,
  `renderDisclosures` kennt die Verengung. (b) Jeder Leere-Satz muss sagen, WESSEN
  Leere er meint: „Die Registry nennt keine abrufbaren Skills" wurde über den
  VERENGTEN Einträgen gefällt und war damit eine falsche Aussage über die Registry.
  (c) Der Wächter (`resolveContext` und `narrowRegistry` je genau einmal
  definiert) blieb bei eingespielter Verletzung **grün** — zu viele Backslashes im
  Regex-Literal, geprüft wurde auf ein literales `\b`. Ein Wächter, der nicht rot
  war, ist kein Wächter; die Verletzung einspielen ist Pflicht, nicht Kür.

  Die zweite Hälfte von (c) ist der Grund für den Ort: `narrowRegistry` sitzt im
  DIENST, nicht im Werkzeug. Eine Kopie, die die immer geltenden Skills vergisst,
  antwortet mit einer KÜRZEREN Freigabeliste und sieht dabei völlig plausibel aus.
  Die Prosa bleibt je Oberfläche eigen, die Regel nicht.

  **Deckel:** `REGISTRY_CONTEXT_MAX` = 50 über H2 und H3 zusammen, offengelegt als
  `contextsTruncated`. Gemessen 2026-08-18: die Skills eines gekappten Kontexts
  bleiben im Katalog (der ungefilterte Zweig listet `registry.entries` flach), nur
  ihr Name ist nicht mehr aufrufbar.

- **The registry cache is keyed by who read (audit 2026-11-14).** Entries, the queue and lookups in flight are
  kept per `sharedReadScope()` — `service` (the tick, `/mcp` without `Authorization`), `anonymous` (`/api`) — where
  one map served all three kinds of reader, so a catalogue read with the service account was handed to an anonymous
  caller. Five rules. (1) A PERSONAL login reads nothing from and writes nothing to the scope caches, with one
  exception in each direction: it is LENT the positive entries of the anonymous scope (what an anonymous reader may
  read, everyone may), and the ids it asked about are queued for an ANONYMOUS lookup so the tick warms them. A
  negative, a refusal or "not answered" is never lent — a login may see more. (2) What a personal login's own
  lookups answered is kept in `personalMemo`: keyed by a keyed digest of the credential, 60 s, bounded over all
  identities, never shared, and only an ANSWER is kept. Without it every signed-in answer paid the live listing
  again for each collection that has no registry — the common case. (3) There is ONE entry point,
  `ensureRegistries(nodes, { force })`. A forced pass attaches nothing remembered: with two calls (`refresh…` then
  `ensure…`) the fresh "none" of a forced lookup was overwritten by the lent positive — K-15 again, for every
  signed-in caller. (4) A listing answered 401/403 is an ANSWER for that scope: remembered as a non-settling entry
  (like the truncated scan — not re-read every tick, and not "answered: none" for the caller), logged once. It was
  re-queued on every tick for good. (5) The caps apply per scope, and the tick alternates scopes, so anonymous
  traffic cannot evict or starve the service scope.
