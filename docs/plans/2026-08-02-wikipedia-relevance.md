# Wikipedia: picking the right article

**Status:** implemented 2026-08-02 · **Code:** `src/wikipedia-relevance.ts`,
`src/wikipedia-api.ts` · **Tests:** `tests/wikipedia-relevance.test.ts`,
`tests/wikipedia-api.test.ts`

Originates from a hand-over by the Boerdi chatbot team, which had built a
post-hoc relevance filter (`backend/src/boerdi/services/wikipedia_service.py`)
because `get_wikipedia_summary` returned wrong articles. This document records
what we measured, why the implementation sits somewhere else than the proposal,
and what it deliberately does not do.

## 1. Why it matters more than it looks

A wrong article is not a cosmetic problem downstream. A caller that turns the
extract into teaching material appends *"Quelle: Wikipedia-Artikel „X" (URL).
Inhalte unter CC BY-SA 4.0 verarbeitet."* — so a plausible-but-wrong article
publishes a **false attribution** on a worksheet.

## 2. The measurement that decided the design

Measured live against `de.wikipedia.org` on 2026-08-02 (scratch probe, direct
summary vs. `action=opensearch&limit=10`):

| query | direct summary | opensearch candidates (first 6) |
|---|---|---|
| `Photosynthese` | 200 `Photosynthese` | Photosynthese \| Photosynthese (Spiel) \| … |
| `Bruchrechnen` | 200 **`Bruchrechnung`** (redirect) | Bruchrechnung |
| `Zellteilung` | 200 `Zellteilung` | Zellteilung \| … |
| `Satz des Pythagoras` | 200 `Satz des Pythagoras` | Satz des Pythagoras |
| `Feinoptik` | **404** | Feinoptiker |
| `Stadt Berlin` | **404** | Stadt Bern \| Stadt Überlingen (Schiff, 1929) \| Stadtbergen \| Stadtegerling \| **Stabi Berlin** \| … |
| `Dreiecke` | **404** | Dreiecker \| Dreiecketer \| Dreieck Essen-Ost \| Dreieck Erlenbruch \| **Dreieck** \| … |
| `Qwertzuiop Blubb` | 404 | (none) |

Three conclusions, each of which changed the plan:

1. **Every wrong article came from the opensearch fallback**, never from the
   direct lookup. A direct hit is the exact title or a Wikipedia **redirect**,
   and a redirect is a human editorial statement that two names denote the same
   topic.
2. Therefore the check belongs **before** the article is fetched, on the
   candidates — not after, on the result. This removes the proposal's
   "Schwäche B" (`Bruchrechnen`/`Bruchrechnung` wrongly rejected) *structurally*:
   redirects are never judged, so no stemmer is needed.
3. For `Dreiecke` the **correct** article sat at position 5 while the wrong one
   was first. Judging the single title `limit: 1` returns can only ever reject;
   choosing among ten can also get it right. So the module **picks**, it does
   not merely veto — `Dreiecke` now answers `Dreieck` where the proposal would
   answer `found: false`.

## 3. The rule

`pickRelevantTitle(query, candidates)`. Tokens are normalized (NFKD, combining
marks dropped, lowercase, non-alphanumerics as separators; `ß` survives, the
umlauts are already gone by then — which is why they are *not* in the keep-class).

A candidate must satisfy **both** directions:

1. the query's longest content word (≥4 chars, not a stop word) must relate to
   some title word — otherwise the title is not about the topic;
2. the title's leading non-stop word must relate to some query content word —
   otherwise the topic is only a qualifier of a different subject.

`relate(queryWord, titleWord)` is deliberately **asymmetric**:

- query longer, query starts with the title word → accepted on the prefix alone
  (`bruchrechnung` ⊃ `bruch`: the article is the base concept, which is what was
  asked about);
- title longer, title starts with the query → accepted only when the remainder
  is a recognised German suffix of **≥2 characters** (`feinoptik` + `er`). This
  single rule is what separates `Dreiecke`/`Dreieck` (accepted) from
  `Dreiecke`/`Dreiecker`, a mountain in the Allgäu (rejected).

Ranking among accepted candidates: topic-word relation first, then how many of
the query's content words the title accounts for (`Satz des Pythagoras` beats
`Pythagoras` for the query `Satz Pythagoras`), then the shortest title —
`Dreieck` beats `Dreieck Essen-Ost`, a motorway junction. Same "shortest title
wins" tie-break as `matchSubjectPortal` in `tools/browse.ts`.

**Stop words carry more weight than they look.** The topic is taken from the
*longest* content word, so a generic classifier noun that happens to be longer
than the proper name takes over the match entirely. Measured live before the
classifier group existed in the list:

| query | answered | what it is |
|---|---|---|
| `Insel Rab` | `Insel (Album)` | a music album |
| `Element Zinn` | `Élément moral` | a French legal concept |
| `Fluss Po` | `Fluss-Greiskraut` | a plant |

In each case the classifier matched and the proper name was never weighed. The
hand-over had the same mechanism with three entries (`stadt`, `land`, `ort`) and
the same reasoning; it was simply too short. The list is necessarily open-ended —
when the "no candidate was on topic" log shows an unlisted classifier, add it.

Rule 2 is the part the hand-over did not have, and it is needed **because** we
widened the candidate list: `Stabi Berlin` (the state library) contains `Berlin`
as a whole word and would pass a pure occurrence check. The narrow version never
saw it; ours would have returned it.

## 4. Contract

`WikiSummary.match`: `'exact'` (title as asked, or a redirect from it) |
`'fuzzy'` (resolved by search and checked). Present on the MCP tool's JSON, on
`GET /api/wikipedia`, and in the Apps-SDK output schema; the Markdown output
states the substitution for a fuzzy hit. When nothing is on topic the answer is
"no article" and the rejected candidates are logged at `info`.

**Deviation from the hand-over's §4, deliberately:** no `relevance: {verdict,
rule, checked}` object and no `relevanceCheck: off|annotate|enforce` parameter.
With the check moved to candidate selection there is no "returned but doubtful"
state to annotate — the result is either trusted or absent, so `enforce` is the
only mode and `annotate` would describe a case that cannot occur. `match` covers
what a caller acts on (may I cite this as the article the user named?) at a
fraction of the surface. If the chatbot team needs the verdict object to retire
its own filter, adding it is small — but it should be asked for, not assumed.

## 5. Known limitations

- **A compound query can reach the article of its MODIFIER.** Measured:
  `Wasserstoffperoxid` + `["Wasser"]` → `Wasser`; likewise `Wasserfall` →
  `Wasser`. German compounds are head-final, so the first element — the one the
  prefix rule matches on — is the wrong half. **This cannot be tightened without
  losing a required hit:** `bruch` is 5 of 13 characters (38%), `wasser` 6 of 18
  (33%), so every length ratio that rejects the peroxide also rejects
  `Bruchrechnung` → `Bruch`, which the hand-over lists as a match. The looseness
  is a deliberate trade, and it only fires when the direct lookup already 404'd
  and no better candidate exists. Do not "fix" it without a rule that separates
  the two — a ratio does not.
- **A query whose topic word is absent from every candidate yields nothing, even
  when a good article exists under another name.** `Stadt Berlin` returns null,
  not `Berlin`. Stripping stop words and re-querying would fix that case; it is
  extra round trips for a query shape we have not seen in the wild, so it is not
  built. Reconsider if the logs show it.
- **A multi-word query is judged on its longest content word only.** Requiring
  all of them would reject `Photosynthese Biologie` against the article
  `Photosynthese`. The length floor for that word is a preference, not a hard
  rule: when stop words and short words are all that is left, the short words
  are used (`Stadt Rom` → `Rom`), because answering nothing was worse.
- **A disambiguation page still ends the search.** `Bruch` direct-hits a
  disambiguation page, which is not an article, and the top candidate is `Bruch`
  again — so we stop rather than walk further down the list. Deliberate: the
  measured candidate list for `Bruch` contained no better article either. Same
  for `Element`, verified to behave identically with and without its stop-word
  entry — the disambiguation page is what ends it, not the classifier list.
- **An UNLISTED classifier can still hijack a two-word query**, by the mechanism
  in §3. There is no rule that separates `Element Zinn` → `Élément moral` (bad)
  from `Photosynthese Biologie` → `Photosynthese` (good) structurally — both are
  "generic word plus specific word", and only the vocabulary says which is which.
  A stop list is that vocabulary. Extend it from the logs rather than reaching
  for a positional or length heuristic; both were tried and each breaks a case
  the other fixes.
- The rules are German-shaped (stop words, suffixes). For `lang != 'de'` the
  normalization and the whole-word rules still apply; the morphological ones
  mostly will not fire, which is conservative, not wrong.
