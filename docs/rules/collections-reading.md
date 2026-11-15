# Reading collections: unreachable, refused, order, by name

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- **"Not reachable" is not "nothing there" (audit 2026-11-12, K-3/K-15).** Since
  2026-11-13 there is NO listing helper left that drops `reachable` (the plain
  `getChildCollections` is gone): every caller that "only navigated" turned an
  unanswered listing — a 5xx or our own full gate — into a branch without
  children. The
  low-level collection searches and the portal listing say whether they
  ANSWERED (`…Result` variants: `reachable` / `unreachable[]`); `searchAll`
  carries `collections.incomplete` / `topicPages.incomplete`,
  `search_wlo_collections` `incomplete`, and no renderer prints "Keine …
  gefunden." over a source that did not answer (`incompleteNotice`, one
  wording). `searchPageVariants` THROWS on a non-answer like `ngsearch` — it is
  the primary read of the listing it serves — and `findTopicPagesByQueryResult` throws
  only when ALL its sources are down. A forced registry lookup
  (`includeSkillRegistry`) goes THROUGH the cache (`refreshRegistries`): the
  fresh answer replaces the entry (a removed registry removes the node's
  catalogue), and only ids that really answered count as checked — the forced
  pass as a whole used to be taken for an answer, so a failed lookup read as
  "checked, none there".
- **Refused is not unreachable (chatbot feedback 2026-11-13, D6).** A child
  listing answered 401/403/404 carries `refused` beside `reachable: false`.
  Whoever REPORTS an outage (`incomplete`, `childrenUnread`,
  `source_unreachable`, the skill walk's `unreachable`) asks `didNotAnswer`
  (`wlo-node.ts`), never `!reachable` — "try again" over a listing a login may
  not read never comes true. Deliberately opt-in: a caller that only checks
  `reachable` keeps reading a refusal as "could not find out", which is what the
  write paths need (`listChildCollections`, the variant check of
  `wlo_set_topic_page`). A refused START node is an error that says so
  (`notReadable`, which carries `HTTP <status>` so `failureCode` answers
  `not_found` / `forbidden` — a 404 is `not_found` wherever a failure is coded,
  never the `upstream_error` of an outage). **And refused is not EMPTY either
  (chatbot team, 2026-11-14):** D6 took the outage report away and put nothing
  in its place, so a tree with a closed branch looked complete. A refusal met
  BELOW the start node is said: `childrenRefused` on a tree node,
  `restricted` + `RESTRICTED_NOTICE` (`services/collection-traversal.ts`, one
  wording, no promise of a retry) on a list answer — and a sub-collection's
  refused CONTENTS are treated like its refused listing: left out and marked,
  never the end of the call. A read of ONE node's contents inside the tree walk
  (`readNodeContents`: count, preview) marks the node (`contentsRefused` /
  `contentsUnread`) and never removes it — thrown through `mapPool` it became a
  `null` that was filtered out, and the branch was gone. Whoever adds a walk
  answers three cases, not two. Three rules from the second review of the same
  day: a notice goes INTO the first Markdown block (as its first lines where
  an untrusted document follows) — a block of its own ahead of the answer
  pushed a whole skill instruction out of the one block some clients read; the
  parts of an answer are JOINED (`filter(Boolean).join`), never concatenated,
  and an EXISTING case keeps its sentence when a neighbouring one loses it;
  and the widgets are renderers too — `restricted` dropped in `toEnvelope`
  showed "Keine Treffer gefunden." over a closed branch. The phrase „mit
  dieser Anmeldung nicht lesbar" is what the chatbot recognises a refusal by
  (pinned in `tests/refused-branch-is-said.test.ts`). Deliberately different: a Themenseite whose
  variants this login may not read reports "no variant" — for that login there
  is no page to show. The four notice wordings a client recognises are pinned in
  `tests/refused-is-not-unreachable.test.ts` — change them only with notice.
- **The order of sub-collections (S1, 2026-11-14).** The children listing answers
  in the order of CREATION and ignores a set order — unless it is asked with
  `sortProperties=ccm:collection_ordered_position` (`ORDER_POSITION_PROPERTY`,
  `wlo-node.ts`; measured on both the node and the collection listing,
  `npm run measure:order`). Asked that way, a child without a position stands
  behind those that have one. `getChildCollectionsResult(…, { stored: true })`
  is the one place that sends it; `order: "stored"` on `browse_collection_tree`
  / `get_collection_overview` and all of `list_collection_tree`
  (`services/collection-tree-flat.ts`) go through it. The default of the two
  older tools stays `title` and sends the request it always sent. The flat list
  walks level by level and stops at a full page, so what it has read is a
  PREFIX — that is what makes `skipCount` mean the same on every call; it reads
  every child of a parent (never cut per parent) and answers the three cases
  per branch (`childrenUnread`, `childrenRefused`, listed). Counts come from a
  listing, never from `childReferencesCount` / `childCollectionsCount`: those
  lag by seconds and count the sub-tree at the root (chatbot team, B2). One
  call sends at most `FLAT_TREE_LISTINGS_MAX` (400) listings — the page size
  alone does not bound a walk that restarts on every page — and a walk that
  hits the bound ENDS (never one level further: that leaves a hole in the
  list) and says `walkCapped`. Plan
  for the whole wish list: `docs/plans/2026-11-14-sammlungsstrukturen.md`.

- **A collection by NAME (Z3, 2026-11-13)** — `services/collection-by-name.ts`,
  wrapped around five read tools by `tools/collection-arg.ts`. EXACTLY ONE
  collection with the same title is taken; never a prefix or substring guess
  (the write side showed where guessing leads). An incomplete search or a full
  window is never "unique": one wider pass decides, and what it cannot decide
  is refused. Both halves are measured (staging, 24 titles): refusing on a full
  window outright resolved 3 of 24; with the wider pass 12. Do not widen for
  "no equal title" — measured unhelpful. Write tools keep requiring the id.
  **A subject asked for DECIDES (chatbot team's measurement, 2026-11-15):** a
  namesake that carries no subject is neither excluded nor confirmed by one.
  Exactly one namesake carries it → taken, the unknown ones named
  (`alsoFound`); none carries it → an unknown one is NEVER taken
  (`unverified` + `disciplineUnverified`) — it passed for unique once the
  namesakes of other subjects had fallen away. A second search with umlauts
  put back runs only when nothing equal was found, and what the FIRST search
  could not rule out (a full window) stays unruled. The line puts everything
  the server knows first and the title LAST, quoted, its quote marks replaced:
  title and path are repository-supplied, and ahead of the id a title spelled
  out an id and a path of its own. Since 2026-11-15 that is the rule for
  EVERY line that names a record with its id (`quotedTitle`, `text-line.ts`:
  registry head and entries, the browse tree, `find_content_by_url`, the
  overview, parent collections) — except the forms the chatbot reads word for
  word, which are pinned in `tests/line-forms.test.ts` and change only with
  notice: `get_skill_registry`'s `### Titel` / `nodeId:` entries, `get_skill`,
  `lookup_wlo_vocabulary`, the write preview `Datensatz: „Titel“ (id)` and
  `confirmToken:`, the outage and refusal wordings, the overview's markers.

- **Bounds, said where they bite (audit 2026-11-14).** `listDisclosures` (`src/formatter.ts`) is the ONE object a
  list tool hands to `renderToJson` (JSON block 0) and to `structuredContent`; a flag given to only one of them is
  the "envelope field the renderer drops". The recursive contents walk says `walkCapped`, `contentsCut`,
  `totalIsLowerBound` (as "mindestens N" in the count line, not a sentence of its own on every page) and
  `skipLimitReached`; the within-collection search says it sampled (`truncated`, `collectionTotal`); the tree
  fallback of the collection search says `scanCapped` instead of "Keine Sammlungen gefunden". **A `more` never names
  an offset the tool refuses** (chatbot team, 2026-11-14): `list_collection_tree` clamps `nextSkipCount` to its
  bound and sets `skipLimitReached` only where nothing further can be asked.
- **A subject portal by name (chatbot team, 2026-11-14).** Neither search index returns a portal for its own title
  word, so the resolution also reads the portal list (one listing, a minute in `short-cache`). A full window of 100
  portals is "not unique"; an unread portal list never lets a found collection be TAKEN (`portalsUnread`, the hit
  named as candidate) — a namesake it could not rule out is the guess the rule forbids. `unreachable` means the
  SEARCHES; the portal case has its own sentence.
- **A node that was not read is not absent (audit 2026-11-14).** `getNodeMetadata` collapses every failure to
  `null`; a caller that then states a negative ("nicht gefunden", "kein Kompendiumstext") uses `readNodeMetadata`
  and answers 404 / 401·403 / anything else apart. Fixed in related content, compendium, topic-page structure and
  content text.

- **"Set position, else title", and whether positions decide (S11–S13, chatbot team, 2026-11-15).** Measured
  anonymously on staging (`npm run measure:tree`, table in `docs/plans/2026-11-14-sammlungsstrukturen.md` —
  re-measure before contradicting): the children listing carries `ccm:collection_ordered_position` per child once
  it is in the projection, as one string holding an integer; a child without a position has NO such property. And
  **a tie is the normal case**: of 57 parents with positions 46 carry one value throughout, all 30 subject portals
  the same `"1"`. So `stored` (position, else order of creation) is right for a curriculum somebody arranged and
  arbitrary for a portal, and the answer could not tell which. Rules. (1) The order `position` and the flag live in
  ONE module, `src/collection-position.ts`: per parent the children with a position numerically, ties and children
  without one by title; only a plain integer in safe range is a position. (2) `childrenPositioned`
  (`subcollectionsPositioned` in the overview) is `true` when two DIFFERENT positions were SEEN, `false` only when
  the listing was read to its end, has at least two children and nothing decides, and absent otherwise
  (`positionedFlag(seen, readToEnd)`). The first cut said `false` over a cut listing — the listing is asked
  ascending by position, so a cut prefix of equal positions is exactly where the unseen tail differs. "At least one
  position" was rejected as the meaning: it is true for 48 of 57 parents where nothing is ordered. (3) In the flat
  list the children of a parent are sorted BEFORE they are appended to the level, and a sorting run reads every
  parent to its end — the list must stay one stable sequence across pages. With `position`, tree and overview cut
  in the repository's order and sort then, on every level. (4) The default request of each tool is unchanged:
  `title` sends no sort and no position property. (5) A count is ONE request with `maxItems=0` and one property
  (`countCollectionContents`): 139 ms against 307 ms with `maxItems=1`, same totals on 144 collections; the flat
  list pools counts at half the upstream gate, at most 12 (`countPool`). No facet counts per collection (five
  candidates refused, one empty). `delete-empty-plan.ts` keeps its own read on purpose — the one item is a second
  witness beside `total` before a delete. (6) `unreadParents` / `refusedParents` describe the WHOLE walk of the
  call and only what was observed — the start collection included, parents on other pages included, never a parent
  the walk did not reach (`walkCapped`, `more`). They come from the same arrays as `incomplete` / `restricted`,
  so one never stands without the other. (7) Line forms the chatbot reads stay: the item line of the flat list and
  the prefix `Untersammlungen: ` carry no order note; the note has a line of its own.
