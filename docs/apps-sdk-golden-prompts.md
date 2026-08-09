# Apps-SDK Golden Prompts — WLO MCP Server

An evaluation prompt set for dogfooding the WLO app in **ChatGPT developer mode**
and for the discovery-quality check the Apps-SDK submission review expects
(the "golden prompts" / precision-recall regimen, audit item **S4**, and the
developer-mode render gate **P3.6**).

The prompts are the German user utterances an evaluator types into ChatGPT; the
surrounding structure is English (project convention). Node tests verify tool
*mechanics* offline — this set verifies the live model's *tool selection* and the
*widget render*, which can only be observed against the running ChatGPT runtime.

> Related: [submission checklist](apps-sdk-submission-checklist.md) ·
> [deployment](DEPLOYMENT.md)

## Prerequisites

1. A public `https://…/mcp` deployment with **SSE** enabled (`MCP_SSE=1`) and a
   reverse proxy that does **not** buffer the SSE stream (`proxy_buffering off;`) —
   see [DEPLOYMENT.md](DEPLOYMENT.md).
2. ChatGPT **developer mode** enabled; add the deployment as a connector.
3. `WLO_REPOSITORY_URL` pointing at the intended edu-sharing origin (its origin
   must match the widget CSP / `_meta.ui.domain`).

Replace every `<nodeId>` below with a real WLO node id taken from a prior result
in the same session (e.g. run prompt D1, then copy an id into D8/D9).

## What a machine can check first — the mechanics pass

Each prompt has two halves. **Which tool the model picks** needs a live model and
a ChatGPT session; nothing here can substitute for that. But **whether the
expected tool delivers at all** is checkable without a model — and running it
first is worth the minutes: if D2 comes back empty in a manual run, the evaluator
otherwise cannot tell whether the model chose wrong or the tool is simply dry.

Result of that pass, run 2026-08-03 against
`repository.staging.openeduhub.net` through a real MCP client:

| # | Expected tool | ms | Delivered |
|---|---|---|---|
| D1 | `search_wlo_all` | 2671 | ✅ content + collections |
| D2 | `get_topic_page_content` (`query: "Optik"`) | 3619 | ✅ 3 swimlanes, variant *Vorlage "Optik"* |
| D3 | `get_subject_portals` | 837 | ✅ |
| D4 | `browse_collection_tree` (`subject: "Mathematik", depth: 1`) | 1709 | ✅ 11 children (Algebra, Analysis, …) |
| D5 | `lookup_wlo_publishers` | 445 | ✅ |
| D6 | `get_wikipedia_summary` | 255 | ✅ |
| D7 | `search_wlo_collections` | 857 | ✅ |
| D8 | `get_node_details` | 381 | ✅ |
| D9 | `search_wlo_within_collection` | 1400 | ✅ |
| D10 | `search_skill` → `get_skill` | — | ⬜ registered, but no `ai_prompt` record exists in the repository yet |
| I1–I6 | `search_wlo_all`, `search_wlo_topic_pages`, `lookup_wlo_publishers`, `get_related_content`, `get_collection_stats`, `get_node_breadcrumb` | 456–2571 | ✅ all six |

**17 of 17 runnable prompts delivered.** Two apparent failures in the first
attempt were the probe's own fault, not the server's — `get_topic_page_content`
takes `query`, not `topic`, and `browse_collection_tree` takes `depth` and
answers in `results`. Worth writing down: a golden-prompt run that reports a
tool as broken should check the parameter names against `tools/list` before
filing it.

Still open and only observable in ChatGPT: **tool selection** (A/B/E), the
**negative prompts** (C — a false positive needs a model that could have fired),
and the **widget render + drill-down** (D).

### The `search` / `search_wlo_all` payload delta — measured

Section **E** below asks which of the two the model picks. What the choice
*costs* does not need a model, and was measured 2026-08-09 against
`repository.staging.openeduhub.net` through a live MCP client, calling both tools
with the same query and the same service limits (`maxContent: 10`,
`maxCollections: 5` — the values `search` hardcodes).

Query `"Photosynthese Sekundarstufe I"` returned **the same 4 nodes in the same
order** from both tools. Retrieval is identical; only the projection differs. Per
hit, `search` keeps `{id, title, url}` and drops:

| Dropped by `search` | Consequence |
|---|---|
| `previewUrl`, `previewIsIcon` | no thumbnail — the card grid has nothing to show |
| `license`, `publisher` | no attribution, and OER without a licence is unusable |
| `disciplines`, `educationalContexts`, `learningResourceTypes` | the model cannot tell a Sek-I worksheet from a university script |
| `description`, `keywords` | no basis to rank or summarise the hits |
| `contentUrl`, `downloadUrl`, `mimeType`, `fileSize` | no direct open/download |
| `nodeType` | see below |
| the `{content, collections, topicPages}` split and `content.total` | see below |

Two consequences are worse than "fewer fields", and query `"Optik"` shows both.
`search` returned **13 undifferentiated entries** where `search_wlo_all` returned
10 contents, 2 collections and 1 topic page in separate pots:

- **The pots are flattened and `nodeType` is dropped**, so a collection
  (`f35c17d1…`, `13c03c9b…`) and a topic page (`bf729405…`) arrive in the same
  list as a single worksheet, with nothing marking them as containers.
- **A topic page gets the wrong URL.** `search` builds
  `url: n.url || n.topicPageUrl || buildRenderUrl(n.nodeId)`. In every container
  node observed, `n.url` was already non-empty — `formatNode` falls back to
  `node.content.url`, the `components/render/…` link (`src/formatter.ts:182`) —
  so the `topicPageUrl` branch never ran. Measured for the topic page
  `bf729405…`: `search` emitted `…/components/render/bf729405…`, while the node's
  real topic-page URL is `…/components/topic-pages?collectionId=bf729405…`.
  Whether `node.content.url` is set for *every* topic page is not established;
  three of three were.

Neither is visible from the schema — both needed the live call.

### Section E mechanics pass, run 2026-08-09 against staging

The same "does the expected tool deliver at all" pass as the table above, so a
ChatGPT run cannot mistake a dry tool for a wrong choice. Expected tool only —
this says **nothing** about which tool a model picks.

| # | Expected tool | Delivered |
|---|---|---|
| S1 | `search_wlo_all` (`Zellatmung`, `educationalContext: "Sekundarstufe I"`) | ✅ 39 contents, 2 collections; licence + level + preview on every hit |
| S2 | `search_wlo_all` (`Bruchrechnung`, `learningResourceType: "Video"`, `educationalContext: "Sekundarstufe I"`) | ✅ 195 contents, 3 collections; every hit typed `Video` and Sek I — the filters are honoured |
| S3 | `search_wlo_all` (`Klimawandel`) | ✅ 5941 contents, 3 collections; `topicPages` empty for this query |
| S4 | `search_wlo_all` (`Photosynthese …`) | ✅ licences present (`CC BY-SA 4.0`, `CC BY 4.0`) |
| S5 | `search` → `fetch` | ✅ `fetch` returned document text + licence + publisher |
| S6 | `search` (`Wellenoptik`) → `fetch` | ⚠️ delivers, but see the duplicate note below |
| S7 | `get_topic_page_content` (`query: "Optik"`) | ✅ 3 swimlanes, variant *Vorlage "Optik"*, owner *Wellenoptik*, correct `topicPageUrl` |
| S8 | `search_wlo_all` (English `photosynthesis teaching material`) | ⚠️ 14 hits, but the top hit is a Hochschule microbiology course — recall is weak for English |

Two things to know before reading a ChatGPT run of this section:

- **S6 duplicates — fixed in the code, still present in the repository.** `search`
  for `Wellenoptik` returned **eight entries with the same `url`
  (`de.wikipedia.org/wiki/Optik`) under eight different node ids**; a citing model
  would emit eight identical sources. Probing them settled what they are: eight
  separate `ccm:io` records, `originalId` null, `ccm:original` pointing at each
  node itself, `cm:name` carrying edu-sharing's `… - 2` … `- 6` collision
  suffixes — repeated imports, not one record seen repeatedly, so the
  `ccm:original` rule collapses nothing. Both search paths now collapse them
  (`src/result-dedupe.ts`). Re-measured after the change: 8 kept from a 15-node
  page, no duplicate URL survives. **Not yet deployed** — a ChatGPT run against
  the current deployment will still see the copies.
- **S8 is a weak signal.** Both tool descriptions are German and so is the
  corpus; a poor English answer may be recall, not tool choice. Judge S8 only on
  *which tool fired*, never on result quality.

S7 also confirms the URL defect above on the **deployed** server: for the same
node `bf729405…`, `get_topic_page_content` returned
`…/components/topic-pages?collectionId=bf729405…` while `search` returned
`…/components/render/bf729405…` in the same session.

## How to run

For each prompt: send it in a fresh ChatGPT turn, then record
- **which tool fired** (developer mode shows the tool call) vs. the expected tool,
- for widget prompts, **whether the widget rendered** (a visible card/tree, not a
  blank iframe) — this settles **F1** (MIME),
- for the drill-down prompt, whether expanding a node **loads children** — this
  settles **F3** (`widgetAccessible` / widget→host `tools/call`).

Log results in the [template](#results-log-template) and compute precision/recall.

## A. Direct-intent prompts

The intent explicitly names WLO / a topic page / OER discovery → a specific tool
should fire.

| # | Prompt (DE) | Expected tool | Expected output / widget | Pass criteria |
|---|-------------|---------------|--------------------------|---------------|
| D1 | „Finde WLO-Materialien zur Photosynthese für die Sekundarstufe I.“ | `search_wlo_all` | **search-results** widget | widget renders content + collections + topic pages; a card's „Details“ button opens the in-widget Einzelansicht, back/Escape returns to the grid |
| D2 | „Zeig mir die WLO-Themenseite zu Optik.“ | `get_topic_page_content` | **topic-page** widget (title/description header + swimlanes) | header + swimlanes render as tile grids |
| D3 | „Welche Fachportale gibt es bei WLO?“ | `get_subject_portals` | **browse** widget | portal list renders |
| D4 | „Klappe im Fachportal Mathematik die Unterthemen auf.“ | `browse_collection_tree` (from the widget) | **browse** widget drill-down | expanding a portal loads its children live (**F3**) |
| D5 | „Welche Anbieter liefern die meisten Biologie-Materialien auf WLO?“ | `lookup_wlo_publishers` | text (publisher counts) | ranked publisher list |
| D6 | „Gib mir einen Wikipedia-Überblick zu Zellatmung.“ | `get_wikipedia_summary` | text | summary with source link |
| D7 | „Welche WLO-Sammlungen gibt es zum Klimawandel?“ | `search_wlo_collections` | text/JSON list | collections returned |
| D8 | „Zeig mir Details und den Volltext zu diesem WLO-Inhalt: `<nodeId>`.“ | `get_node_details` | text | metadata + text content |
| D9 | „Finde in der Sammlung `<nodeId>` nur die Videos zur Zellteilung.“ | `search_wlo_within_collection` | text/JSON list | scoped results |
| D10 | „Gibt es fertige Anleitungen/Skills, um ein Arbeitsblatt zu erstellen?“ | `search_skill`, then `get_skill` with a returned nodeId | text (catalogue, then one instruction document) | catalogue returned; empty until skills carry the `ai_prompt` content type |

## B. Indirect-intent prompts

No explicit "WLO" — the model should still recognise an OER / teaching-material
need and reach for the app.

| # | Prompt (DE) | Expected tool | Pass criteria |
|---|-------------|---------------|---------------|
| I1 | „Ich suche Unterrichtsmaterial zur Bruchrechnung für die 6. Klasse.“ | `search_wlo_all` | app fires; relevant results |
| I2 | „Gibt es eine gute Übersichtsseite zur Französischen Revolution für den Unterricht?“ | `search_wlo_topic_pages` / `get_topic_page_content` | a topic page is surfaced |
| I3 | „Wer stellt am meisten Material für Informatik bereit?“ | `lookup_wlo_publishers` | publisher facet used |
| I4 | „Was passt inhaltlich noch zu diesem Material `<nodeId>`?“ | `get_related_content` | related items returned |
| I5 | „Wie umfangreich ist diese Sammlung `<nodeId>`?“ | `get_collection_stats` | file/sub-collection counts |
| I6 | „In welchem thematischen Kontext steht die Sammlung `<nodeId>`?“ | `get_node_breadcrumb` | ancestor path returned |

## C. Negative prompts

The app should **not** fire — no WLO tool call. A tool call here is a
false-positive (hurts precision and the review).

| # | Prompt (DE) | Expected | Pass criteria |
|---|-------------|----------|---------------|
| N1 | „Wie wird das Wetter morgen in Berlin?“ | no WLO tool | model answers without the app |
| N2 | „Schreib mir ein kurzes Gedicht über den Herbst.“ | no WLO tool | no tool call |
| N3 | „Was ist die Hauptstadt von Australien?“ | no WLO tool | general-knowledge answer |
| N4 | „Übersetze ‚Guten Morgen' ins Spanische.“ | no WLO tool | no tool call |
| N5 | „Erstelle eine Tabelle mit meinen Ausgaben letzten Monat.“ | no WLO tool | no tool call |
| N6 | „Fasse mir diesen Text zusammen: …“ | no WLO tool | no tool call |

## D. Widget-specific checks (settle F1 + F3)

- **F1 (MIME / render):** D1, D2, D3 must each render a **visible** widget. A
  blank iframe means the runtime does not accept the served widget MIME → flip
  `WLO_WIDGET_MIME` to the value the runtime expects (`text/html+skybridge` vs
  `text/html;profile=mcp-app`) and redeploy. No code change needed — see
  `src/apps/resources.ts` (`WIDGET_MIME_TYPE`).
- **F3 (drill-down):** in D4, expanding a portal node must load its children
  (the widget calls `browse_collection_tree` via the host bridge). If the tree
  expands but never loads, the host is blocking the widget→host `tools/call`;
  confirm `_meta.ui.widgetAccessible` / `openai/widgetAccessible` is present on
  the tool (it is, via the seam) and re-check.

## E. `search` vs `search_wlo_all` — the overlap check

Sections A and B ask whether the app fires at all. This section asks a narrower
question the others cannot answer: **when both `search` and `search_wlo_all`
would satisfy the request, which one does the model take?**

Why it matters is measured above: the two run the *same* retrieval at the *same*
upstream cost, but `search` returns three fields per hit, flattens collections
and topic pages into the content list, and — unlike every other search tool —
declares **no `widgetUri`**, so the answer renders as plain text with no WLO
interface. Picking `search` for a teacher's material request is therefore a pure
loss, and the only thing steering the model away from it today is prose: the
shouty second paragraph of `search`'s own description and the `search_wlo_all`
sentence in `WLO_SERVER_INSTRUCTIONS` (`src/apps/instructions.ts`).

Record the tool that fired for **every** prompt below, including the ones where
`search` is the right answer — the failure mode runs in both directions.

| # | Prompt (DE) | Expected tool | Why | Fail signal |
|---|-------------|---------------|-----|-------------|
| S1 | „Ich brauche Material zur Zellatmung für Klasse 9.“ | `search_wlo_all` | plain material request, no citation framing | `search` fires → no widget, no preview |
| S2 | „Zeig mir Videos zur Bruchrechnung für die Sekundarstufe I.“ | `search_wlo_all` | names a type **and** a level; `search` has no filter parameters at all | `search` fires → the filters are silently discarded |
| S3 | „Was gibt es auf WLO zum Klimawandel?“ | `search_wlo_all` | open-ended browse; the collections/topic-page pots are the point | `search` fires → containers arrive unmarked among single items |
| S4 | „Suche mir Unterrichtsmaterial zur Photosynthese und nenne die Lizenz.“ | `search_wlo_all` | the licence is only in the full projection | `search` fires → the model has no licence and either omits or invents it |
| S5 | „Belege deine Aussage zur Photosynthese mit Quellen aus WLO.“ | `search` → `fetch` | genuine citation intent — this is what the knowledge convention is for | `search_wlo_all` fires → acceptable, but note it |
| S6 | „Recherchiere gründlich zum Thema Wellenoptik und fasse die WLO-Quellen zusammen.“ | `search` → `fetch` (repeatedly) | research/RAG loop; `fetch` supplies the document text | either tool is defensible — record which, and whether `fetch` followed |
| S7 | „Finde die WLO-Themenseite zur Optik.“ | `get_topic_page_content` or `search_wlo_all` | tests whether `search` swallows a topic-page request | `search` fires → the topic page arrives with the wrong URL (see the measured delta) |
| S8 | (English) „Find OER teaching material about photosynthesis.“ | `search_wlo_all` | both descriptions are German; an English prompt may bias toward the English-named tool | `search` fires → the language of the *name* is deciding, not the description |

**Pass criteria.** S1–S4 and S7 must not fire `search`. S5/S6 may fire either —
they exist to show whether the knowledge tools are reachable *at all*, because a
`search` that never fires in any prompt is dead weight rather than a safety net.

**Reading the result.**

- `search` fires on **none** of S1–S4, S7 → the prose guardrails hold; leave the
  tools as they are and re-run this section after any description change.
- `search` fires on **some** of S1–S4, S7 → the description is not enough.
  Sharpen it first (cheapest fix, no convention risk) and re-run before touching
  the schema.
- `search` fires **often** → the leakage no longer costs what it used to. Since
  2026-08-09 `WLO_SEARCH_OUTPUT_MODE=rich` gives `search` the same buckets,
  metadata and widget as `search_wlo_all`, so a wrong pick still answers well.
  Turn it on and re-run this section — a high leakage rate with `rich` enabled
  is no longer a defect worth chasing. What it cannot fix is a prompt that
  needed a **filter**: `search` takes a single `query` by convention, so S2 stays
  a genuine failure however rich the output is.
- `search` never fires even on S5/S6 → the knowledge tools are not earning their
  slot at all. That is the case for dropping them behind an operator switch.
  **Open question before that route:** whether the Apps-SDK submission still
  passes without `search`/`fetch` — the
  [submission checklist](apps-sdk-submission-checklist.md) lists them as a met
  criterion, not as optional.

**Run the section twice** once `rich` is available — `lean` and `rich` — and add
one Deep-Research prompt to each run. The `rich` mode adds sibling keys next to
`results`, which OpenAI's docs neither permit nor forbid; a connector that
discards non-conforming payloads would make `search` return **nothing** there,
with no error. That check is the gate for enabling `rich` in production.

## Results log template

Copy per run (date + deployment URL + commit):

| # | Expected tool | Actual tool fired | Widget rendered? | Pass/Fail | Notes |
|---|---------------|-------------------|------------------|-----------|-------|
| D1 | search_wlo_all | | | | |
| … | | | | | |
| N1 | (none) | | n/a | | |
| S1 | search_wlo_all | | | | |
| S2 | search_wlo_all | | | | |
| S3 | search_wlo_all | | | | |
| S4 | search_wlo_all | | | | |
| S5 | search → fetch | | n/a | | did `fetch` follow? |
| S6 | search → fetch | | n/a | | did `fetch` follow? |
| S7 | get_topic_page_content / search_wlo_all | | | | |
| S8 | search_wlo_all | | | | |

**Precision** (direct + indirect) = correct tool fired ÷ prompts where a tool
should fire. **Recall** = prompts where the app fired at all ÷ prompts where it
should have. **False-positive rate** = negative prompts where a tool fired ÷ all
negative prompts. **`search` leakage rate** = S1–S4 + S7 where `search` fired ÷ 5
— the number that decides section E. Capture a screenshot of each rendered widget
for the submission review (audit item S9).

## Acting on the results

- Wrong tool fired for a direct/indirect prompt → sharpen that tool's
  "Use this when… / Do not use for…" description in `src/tools/*` and re-test.
- Negative prompt fired a tool → tighten the over-broad tool's description.
- Widget blank → the F1 MIME flip above.
- Drill-down dead → the F3 check above.
- `search` leakage rate > 0 → follow the three-way reading in section E; sharpen
  the description before considering the schema or an operator switch.
