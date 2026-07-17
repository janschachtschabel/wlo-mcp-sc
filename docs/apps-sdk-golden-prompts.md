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
| D1 | „Finde WLO-Materialien zur Photosynthese für die Sekundarstufe I." | `search_wlo_all` | **search-results** widget | widget renders content + collections + topic pages |
| D2 | „Zeig mir die WLO-Themenseite zu Optik." | `get_topic_page_content` | **topic-page** widget (swimlanes) | swimlanes render as tile grids |
| D3 | „Welche Fachportale gibt es bei WLO?" | `get_subject_portals` | **browse** widget | portal list renders |
| D4 | „Klappe im Fachportal Mathematik die Unterthemen auf." | `browse_collection_tree` (from the widget) | **browse** widget drill-down | expanding a portal loads its children live (**F3**) |
| D5 | „Welche Anbieter liefern die meisten Biologie-Materialien auf WLO?" | `lookup_wlo_publishers` | text (publisher counts) | ranked publisher list |
| D6 | „Gib mir einen Wikipedia-Überblick zu Zellatmung." | `get_wikipedia_summary` | text | summary with source link |
| D7 | „Welche WLO-Sammlungen gibt es zum Klimawandel?" | `search_wlo_collections` | text/JSON list | collections returned |
| D8 | „Zeig mir Details und den Volltext zu diesem WLO-Inhalt: `<nodeId>`." | `get_node_details` | text | metadata + text content |
| D9 | „Finde in der Sammlung `<nodeId>` nur die Videos zur Zellteilung." | `search_wlo_within_collection` | text/JSON list | scoped results |
| D10 | „Gibt es fertige Anleitungen/Skills, um ein Arbeitsblatt zu erstellen?" | `find_wlo_skills` | text (skill list + instructions) | skills returned (requires `WLO_SKILLS_COLLECTION_ID`) |

## B. Indirect-intent prompts

No explicit "WLO" — the model should still recognise an OER / teaching-material
need and reach for the app.

| # | Prompt (DE) | Expected tool | Pass criteria |
|---|-------------|---------------|---------------|
| I1 | „Ich suche Unterrichtsmaterial zur Bruchrechnung für die 6. Klasse." | `search_wlo_all` | app fires; relevant results |
| I2 | „Gibt es eine gute Übersichtsseite zur Französischen Revolution für den Unterricht?" | `search_wlo_topic_pages` / `get_topic_page_content` | a topic page is surfaced |
| I3 | „Wer stellt am meisten Material für Informatik bereit?" | `lookup_wlo_publishers` | publisher facet used |
| I4 | „Was passt inhaltlich noch zu diesem Material `<nodeId>`?" | `get_related_content` | related items returned |
| I5 | „Wie umfangreich ist diese Sammlung `<nodeId>`?" | `get_collection_stats` | file/sub-collection counts |
| I6 | „In welchem thematischen Kontext steht die Sammlung `<nodeId>`?" | `get_node_breadcrumb` | ancestor path returned |

## C. Negative prompts

The app should **not** fire — no WLO tool call. A tool call here is a
false-positive (hurts precision and the review).

| # | Prompt (DE) | Expected | Pass criteria |
|---|-------------|----------|---------------|
| N1 | „Wie wird das Wetter morgen in Berlin?" | no WLO tool | model answers without the app |
| N2 | „Schreib mir ein kurzes Gedicht über den Herbst." | no WLO tool | no tool call |
| N3 | „Was ist die Hauptstadt von Australien?" | no WLO tool | general-knowledge answer |
| N4 | „Übersetze ‚Guten Morgen' ins Spanische." | no WLO tool | no tool call |
| N5 | „Erstelle eine Tabelle mit meinen Ausgaben letzten Monat." | no WLO tool | no tool call |
| N6 | „Fasse mir diesen Text zusammen: …" | no WLO tool | no tool call |

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

## Results log template

Copy per run (date + deployment URL + commit):

| # | Expected tool | Actual tool fired | Widget rendered? | Pass/Fail | Notes |
|---|---------------|-------------------|------------------|-----------|-------|
| D1 | search_wlo_all | | | | |
| … | | | | | |
| N1 | (none) | | n/a | | |

**Precision** (direct + indirect) = correct tool fired ÷ prompts where a tool
should fire. **Recall** = prompts where the app fired at all ÷ prompts where it
should have. **False-positive rate** = negative prompts where a tool fired ÷ all
negative prompts. Capture a screenshot of each rendered widget for the submission
review (audit item S9).

## Acting on the results

- Wrong tool fired for a direct/indirect prompt → sharpen that tool's
  "Use this when… / Do not use for…" description in `src/tools/*` and re-test.
- Negative prompt fired a tool → tighten the over-broad tool's description.
- Widget blank → the F1 MIME flip above.
- Drill-down dead → the F3 check above.
