# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed — a collection card with a Themenseite offers BOTH actions; the Volltext chain relays an honest "no text" (2026-08-22)

Two live findings from the first day with the widgets in real use. First: a
collection that also has a Themenseite showed only "Themenseite öffnen" — the
deliberate one-action rule hid "Inhalte anzeigen" on exactly the richest
collections. User decision: both buttons, curated view first; a plain
collection keeps its single contents action.

Second: clicking "Volltext anzeigen" on an SWR video produced the surrounding
COLLECTION's compendium passages instead. Measured: the material is a
`video/mp4` whose `/textContent` is empty and whose `ccm:wwwurl` points at a
raw `.mp4` — `get_wlo_content_text` answered an honest "kein Text", and the
model substituted the nearest interesting text rather than relaying the
negative. Not a routing bug, but two of our sentences invited it: the no-text
result was a slug in parentheses (`no_text_no_url`), and the injected click
message said nothing about the empty case. Both now carry the rule — the
result states the reason in words plus "keinen Ersatztext aus anderen Quellen
liefern", and the Volltext click message closes with "Wenn kein Volltext
hinterlegt ist, sage das kurz — hole keinen anderen Text als Ersatz"
(localized). Model compliance cannot be enforced; both ends of the chain now
state the rule at the moment it applies.

Third, same day: the injected button message reached the model and the model
ANNOUNCED the call instead of making it ("Ja. Ich kann dir die Sammlung
gezielt anzeigen …") — while the tool itself answers fine (measured live: 28
items for the very nodeId on screen). The shared tool sentence
(`followUpTool`, all four tool actions) now asks for the result right away
and rules out the confirmation round.

### Fixed — restricted records no longer render the repository's permission shield (2026-08-22)

User report with screenshots: the same signed-in person sees preview images in
the edu-sharing UI, while the ChatGPT widget shows "Keine ausreichenden Rechte /
insufficient permissions" cards. Measured on the user's own two nodeIds
(staging): the records are `isPublic: false` — an AUTHENTICATED search returns
them ("SUPRA Licht Schatten": 0 anonymous, 13 authenticated), anonymous
metadata answers 403, and the anonymous `/preview` answers HTTP **200** with the
same 19 590-byte shield SVG every time. A widget `<img>` is always an anonymous
request — no header can carry the MCP login into it, and a token in the image
URL would put a credential into structuredContent, chat logs and history, which
this project's rules forbid. So the shield was the permission model working
correctly, rendered in the most alarming possible way; the HTTP 200 also means
the image-error fallback never fires.

The cheap signal exists and costs nothing: `isPublic` is a top-level field of
every search DTO regardless of `propertyFilter` (measured). `formatNode` now
carries `isPublic: false` — only the remarkable case, spread like `originalId`,
declared in `formattedNodeSchema` (zod strips undeclared keys) and in the REST
`fields` allowlist. The widgets never attempt the image for such a record: tile
and detail render a lock glyph plus a visibility fact row ("Sichtbarkeit: nicht
öffentlich — Anmeldung erforderlich", localized, text not icon-only). The
markdown surfaces say the same sentence — `renderToText` on every search list
and `get_node_details` — via one exported constant (`NOT_PUBLIC_LINE`), because
a model that recommends a record its audience cannot open is the same mistake
in prose.

And the signed-in caller DOES get the pictures — the user's follow-up question
named the right lever: metadata reaches the widget because the SERVER fetches
it under the caller's login, so the server now fetches the restricted previews
the same way. `services/preview-inline.ts` runs inside the same request context
(`wloFetch` carries the per-request credential), inlines up to 8 raster images
(≤300 KB each) as `data:` URIs, and ships them in the result's `_meta`
(`wlo/previewData`) — the Apps-SDK channel a host hands to the WIDGET and never
the model. Inlining into `structuredContent` would be the compendium disease
with pictures: 8 × ~40 KB of base64 read by the model on every editorial
search; a pinned test asserts structuredContent stays base64-free. The widget
reads `window.openai.toolResponseMetadata`, accepts only `data:image/*`, keeps
the visibility row (the picture does not make the record public), and falls
back to the lock — including via `data-fallback="🔒"` if a sandbox CSP refuses
data: images, which only a live ChatGPT run can confirm. Self-guarding by
content type: an anonymous/expired session gets the shield SVG back, and SVG
is never inlined, so the alarming image cannot return through this path.

What stays deliberately NOT built: a credential or ticket in the image URL —
that would put a login into structuredContent, logs and chat history. And
publishing the record remains the honest fix for "students should see the
picture": the inline path serves the signed-in editor, not the public.

A review round on the same patch (6 minor, 2 nits — all fixed) tightened the
edges. The preview fetch accepts only repository URLs, decided by the SAME
boundary the credential attach uses — `isRepositoryUrl`, extracted from
`wlo-fetch.ts` and shared, because two near-copies of a security boundary is
how one of them drifts; any other host serves an anonymous `<img>` just as
well, so inlining those would only move the fetch vantage to the server.
Materials only: a collection tile renders no thumbnail at all, so its bytes
were fetched and never drawn — a restricted collection now carries a 🔒 badge
with the visibility text instead of looking open. Each preview fetch gets its
own 4 s budget (`PREVIEW_FETCH_TIMEOUT_MS`) instead of inheriting the 20 s
upstream default, and a declared Content-Length over the cap is skipped
without buffering the body. Under `WLO_SEARCH_OUTPUT_MODE=rich`, `search` and
`fetch` render the same widget and now ship the same `_meta` channel (lean
never pays the fetches). The widget-side guard names the exact raster set the
server emits. Verified end-to-end against staging: the DTO's `preview.url`
sits inside the credential boundary, the credentialed fetch answers
`image/jpeg` (6 036 bytes, JPEG magic), the anonymous one the 19 590-byte
shield SVG.


### Fixed — the arrival of a result is now announced to screen readers (2026-08-21)

The loading state said "WLO-Inhalte werden geladen …" through `role="status"` —
and then `paint()` replaced `#wlo-root`'s innerHTML wholesale, live region
included, so the ARRIVAL was never announced (WCAG 4.1.3): a screen-reader user
heard "loading" and then silence for ever, while sighted users watched the
skeleton become content. Pre-existing for every repaint, but the loading state
made it a promise that was never kept.

`shared/announce.ts` owns the fix, and its two rules are the reason it works:
the live region lives OUTSIDE `#wlo-root`, appended to `document.body`, so the
repaint cannot destroy it; and it is created EMPTY on the first paint — a live
region inserted together with its text is unreliably picked up by AT, one that
already exists when the text lands fires dependably. Only the loading→result
transition speaks ("WLO-Inhalte geladen." / "WLO content loaded."): a grace
window that expires with nothing stays silent (announcing "geladen" over an
empty view would be false), output already present at mount was never "loading"
to the user, and later repaints (theme, selection) never re-announce.

### Closed without code — no educationalContext derivation from "Klasse 6" (2026-08-21)

The natural follow-up to the medium derivation was measured and rejected:
summing Primarstufe + Sek I + Sek II per topic, only 36 % (Bruchrechnung,
454/1269) to 72 % (Photosynthese) of content records carry ANY level. A derived
level filter would HIDE the unset majority rather than narrow — the same trap
the topic-page filters documented on 2026-08-07 ("a record without the field is
not 'wrong level', it is 'level unknown'"). Unlike the medium case, nobody asked
for it. The framing words `klasse`/`sekundarstufe` stay stripped-only.


### Fixed — the words a teacher says no longer delete the result set (2026-08-21)

Reported from Claude: for content questions the model answered with counts
instead of recommending anything. It was doing exactly the right thing with what
it got. The repository ANDs every word of a query, and the nouns that FRAME a
request are absent from virtually every record — so one of them empties the
answer. Measured against staging:

    "Französische Revolution"                        480 records
    "Unterrichtsstunde Französische Revolution"        0
    "Optik"                                          825
    "Bildungsinhalte zur Optik"                        4
    "Photosynthese"                                  211
    "Erklärvideo Photosynthese"                        1

Inflection is not the cause ("Französischen Revolution" still answers 450) — one
framing noun is enough. With 0–4 records in hand a model reports a number, and
in Claude no widget hides how thin that is; in ChatGPT the tiles made the same
answer look substantial.

`expandQuery` now emits a `topic:` variant with the framing dropped, weighted
0.92 — above the keyword variant so `MAX_VARIANTS` cannot trim away the one
variant that returns anything, below the exact-phrase variants so a record
matching the full wording still ranks first. It is emitted only when something
was removed AND something remains: an unchanged query would repeat `full`, an
emptied one would match everything. Nothing is taken away — the existing
variants are untouched and the reranker merges.

The word list is not invented. It is the vocabulary this server's own
instructions and `docs/TOOLS.md` put in the user's mouth ("ein Video zu
Bruchrechnung", "ein Arbeitsblatt zur Zellteilung", "eine Unterrichtsstunde
zu …", "Ich suche Bildungsinhalte für eine Mathestunde …", "Zeig mir ein Video
zur Eiszeit"), plus plurals. The request VERBS had to join the nouns: with
`suche` left in, the Optik request narrowed to a single record — worse than the
nouns alone achieved.

A/B over one entry point, same repository, same queries:

    Unterrichtsstunde zur Französischen Revolution     0 → 9
    Zeig mir ein Video zur Eiszeit                     0 → 10
    Arbeitsblatt zur Zellteilung                       3 → 10
    Ich suche Bildungsinhalte zur Optik …              2 → 5
    Erklärvideo Photosynthese                          1 → 4
    "Französische Revolution" / "Optik" (controls)    10 → 10

No query got worse; the controls are unchanged. The server instructions gained
the matching sentence — topic in `query`, medium/level/subject in the filters —
so a model narrows on purpose rather than by accident. It went there and not
into the `search_wlo_all` description, which sits at 1017 of the 1024 characters
a host truncates at.

**The medium is no longer thrown away, it becomes the filter.** "Arbeitsblatt KI"
asks two things — KI as the subject, worksheets as the type — and stripping the
medium recovered the hits while losing the constraint. `withDerivedResourceType`
fills in `learningResourceType` when the caller named none, in the two search
TOOL handlers rather than in `searchAll`: that is where `labeled` is built, so
the filter is disclosed in `_queryMeta` instead of narrowing a search silently.
An explicit parameter always wins.

The mapping is CURATED, and that is a measurement, not taste: `resolveVocab`
fuzzy-matches, so `material` resolves to Übungsmaterial and `bildungsinhalte`
resolves to **Bild** — deriving from whatever resolves would turn
"Bildungsinhalte zur Optik" into a search for pictures. Only words naming one
medium and nothing else are mapped (Video, Arbeitsblatt, Übung, Bild,
Simulation, Podcast); the generic and framing words stay stripped-only. Words
that resolve to nothing (`aufgabe`, `grafik`, `film`) are absent for the second
reason: a filter built from them would match no record at all. "Unterrichtsstunde"
is the case that proves the rule — mapping it to Unterrichtsplanung took
"Französische Revolution" from 480 records to 0.

A review of the change found the derivation's own disclosure gap and it is
closed: the derived filter was visible only in `_queryMeta` — the trailing
block a measured real client never hands to the model (2026-08-19) — so
"Podcast zur Französischen Revolution" with zero podcasts would have read as a
bare "Keine Inhalte gefunden." over a topic holding 480 records, the exact
misreport class the licence filter got its sentences for. The disclosure now
follows the licence pattern's two channels and goes one step further: a
sentence from `derivedResourceTypeNotice` lands INSIDE block 0 in markdown
(a JSON block 0 cannot take prose, so there it rides as its own block), and
`derivedResourceType` travels declared in `structuredContent` — top-level in
`nodeListSchema`, beside `licenseFilter` in the search_wlo_all envelope,
because both describe the content leg. Never set for an explicit
`learningResourceType`: reporting the caller's own choice back as a discovery
is noise. Both parameter descriptions and TOOLS.md now name the derivation;
the REST surface deliberately does not derive (its callers set explicit
parameters) and TOOLS.md says so.


### Changed — the compendium answer goes to the model, not onto the screen (2026-08-21)

`get_compendium_text` answers with editorial prose cut into paragraph chunks —
with `query` the BM25 passages, without it the per-section capped text. Read
straight off the screen those are disjointed fragments, and the reader is meant
to see what the model made of them. User decision: the reading widget now shows
a handover line instead of the text ("12 Passagen an die KI übergeben ·
4.812 Zeichen"), for BOTH shapes of the answer.

What the model receives is deliberately untouched — the `content` block and
`structuredContent.text` still carry everything, because the whole point is that
it has the full material to work from. The payload gains `forModel: true` and,
for a query answer, `passageCount` (both declared in `contentTextSchema`, or zod
would strip them). `get_wlo_content_text` shares that widget and that schema and
sets neither: a material's own text still renders as a document.

Two things the widget change alone would not fix. The model could still paste
the chunks into its answer, so the tool description asks for synthesis in its
own words and says the chunks are deliberately not displayed. And the
description had to be TIGHTENED to fit: it had grown to 1175 characters, and
`tests/tool-descriptions.test.ts` caught it — a host truncates at 1024 from the
END, which is exactly where the new instruction sat. It now stands ahead of the
mechanics, so a stricter host still delivers it.

The follow-up buttons stay: with the material out of sight, asking the model
about it is the only thing left to do in that panel.

A review of the same change caught one more, and it is the reason `truncated` is
now computed ABOVE both branches rather than inside the document one: the
handover branch had silently dropped it. `WLO_COMPENDIUM_SECTION_MAX` caps each
main section — the biggest staging text goes 65 250 → 18 744 characters — and
without that line the model's answer reads as a statement about the whole
compendium. The disclosure matters MORE here than in the document view, because
the reader can no longer check for themselves.

The same argument then applied to a second disclosure, and it had been waved
through with a reason that does not survive contact with the first one:
`unmatchedTerms` ("Nicht gefunden: thüringen, regelschule") lived only in the
markdown hint, and the handover renders no markdown. Dismissing it as "the model
gets it anyway" was inconsistent — the model gets the truncation notice too. It
now travels as a field beside `passageCount`, for a `query` answer only. Over a
bulk fetch it is the INTERSECTION, never the union: a term absent from one
collection but present in another has been found, and reporting it as missing
would tell the caller its search word does not occur while the answer in front
of it contains that very word.


### Fixed — a widget no longer reports "Keine Treffer gefunden." while it is still loading (2026-08-21)

User report from ChatGPT: every widget claimed an empty result for the whole
duration of the tool call. One line, repeated in all four shells, was the cause
— `render(host.toolOutput(), …)` painted at mount time, and `toolOutput` is null
until the host delivers the result, so each renderer correctly rendered its
EMPTY-payload state over a payload that had not arrived. The reading widget was
the worst: its miss-reason fallback asserts "Zu diesem Material ist kein Text
hinterlegt." — a claim about the material, made before anything was read.

"A result arrived" is now a term of its own (`host.awaitingOutput()`) and is
never inferred from the payload being empty — the same rule the server side
already follows for `registryChecked` and `content.licenseFilter`. Under the
standard bridge the term is the `tool-result` notification (a result whose
structuredContent is empty has still arrived); ChatGPT offers no such event, so
there the value is the only available signal. While a result is outstanding the
widgets render `shared/loading.ts`: a localized `role="status"` line plus a
decorative skeleton. The wait is bounded (`OUTPUT_GRACE_MS`, 30 s) so neither a host
that never delivers nor a tool that FAILS (`toolError` returns `isError` with no
structuredContent) can leave the frame in a skeleton for ever. The number is
measured, not guessed: live over every widget-bound tool on 2026-08-21 the
slowest is `get_topic_page_content` at 2 240 ms (`get_url_text` on a heavy
Wikipedia page 1 568 ms, a full `search_wlo_all` 1 287 ms), so 30 s is ~13× the
slowest observed call and cannot expire mid-call — which would put the false
sentence back on screen for exactly the slow calls the loading state exists for.
The timer repaints only when it changes something: a review of this change
caught it notifying unconditionally, which rebuilt every widget's DOM 30 s after
EVERY successful mount and destroyed keyboard focus (WCAG 2.4.3) and any
selection on a screen that had long since rendered.

### Fixed — preview images blocked by the widget's own CSP (2026-08-21)

Same report: many cards showed no image although the repository's anonymous web
UI shows one. Measured against staging over 92 unique materials from 12 queries
— 3 of 78 resolvable previews are answered by the repository with a `302` to
`https://img.youtube.com` (YouTube-sourced records). A browser re-checks the CSP
host on every redirect hop, and the widget policy named the repository origin
alone, so those were blocked and the card kept a broken-image box over a preview
that exists.

`WLO_WIDGET_IMAGE_DOMAINS` (new env, default `https://img.youtube.com`) widens
`resource_domains` by the measured thumbnail hosts. `connect_domains` stays the
repository alone — the widget issues no requests of its own, so a third-party
origin would gain a channel it has no use for. `none` switches it off for an
operator who does not want a viewer's browser contacting a third party at all;
that word rather than an empty value, because `docker-compose.yml` passes every
setting as `"${VAR:-}"` and an unconfigured container therefore always presents
an empty string — reading that as "off" would drop the default on every
deployment while looking like a choice.

Independently, a preview that fails anyway (an unmeasured redirect target, a
dead publisher URL, a 404) now degrades to the glyph the card would have shown
without a preview, instead of a broken-image box: the glyph travels on the
element as `data-fallback` and `shared/image-fallback.ts` performs the swap, so
neither side needs a copy of the other's decision. It listens in the CAPTURE
phase because `error` does not bubble — a delegated listener without that flag
never fires at all.

Not changed, and measured: 14 of 92 records carry `previewIsIcon: true`. The
repository never rendered a preview for those and answers with a generic
`link.svg`; no image field is set on them either (0 of 8 sampled). The widget
keeps suppressing the placeholder — there is nothing to show, and saying so with
the card's own icon is the honest rendering.

### Changed — full-text delivery raised to 200 000 chars, ceiling AND default (2026-08-20)

`maxChars` on the three full-text tools (`get_wlo_content_text`, `get_url_text`,
`get_wikipedia_summary`) is now 200 000 characters as both the ceiling and the
default — a call that names no `maxChars` gets the whole text (was: ceilings of
50 000/50 000/100 000 with an 8 000 default). The sources themselves never
capped — `/textContent` and the extraction service deliver whole, so the schema
was the only thing between a caller and a long document. The convention tool
`fetch` goes to a fixed 100 000-char cap (was 10 000): fixed, because it has no
parameter and its answer travels twice (text and `structuredContent`) — the cap
is the only bound the chat's context has there.

### Changed — search hits carry the compendium SIGNAL, never the text (2026-08-20)

Measured live: one Optik topic-page hit shipped 37 428 chars of compendium
inline — 75 % of a 50k JSON answer, in every search that returned it, in every
format (structuredContent travels with markdown too). The raw property is
uncapped, and the operator cap `WLO_COMPENDIUM_SECTION_MAX` never saw it.
`formatNode` now turns the property into `hasCompendium: true` (declared in the
output schema; the name deliberately matches the field the WLO chatbot's backend
had been enriching client-side until now, so its prompts hold without changes)
and drops the text; markdown renders one pointer line
("Kompendium: vorhanden — … get_compendium_text"). The text itself travels only
via `get_compendium_text` (TOC + targeted passages, the intended way) or the
explicit `includeCompendium` enrichment. `get_node_details` keeps its capped
markdown preview (read from the property directly) and its JSON carries the
signal — the full text in every detail answer was the same defect.

The change found its own would-be regression: `getCompendiumTexts` read the
text THROUGH `formatNode`, so dropping it there silently emptied the delivery
path itself — the gap-fill test caught it, and the service now reads the
property directly. A third site had the same disease and no test to catch it:
`fetch` preferred `f.compendiumText` as its document body, which silently
demoted every collection fetch to its description — found red-first while
raising the fetch cap, fixed the same way (read the raw property).

### Fixed — get_skill loads instructions whole (2026-08-20)

Asked by the chatbot developers: yes, `get_skill` truncated — the anonymous
download is byte-capped at 64 KiB for every ordinary file, and a SKILL.md past
that came back cut, with the marker. An instruction that arrives half is worse
than none: the model follows the half it got, and the cut half is where the
guardrails tend to live. The skill text path is now UNBOUNDED (a first fix
chose 1 MiB and was replaced the same day, on the user's decision: any bound is
a size at which a skill silently stops being followed) — registry documents
included, `readSkillText` serves both. The 64-KiB cap stays for every other
anonymous download; the residual risk rests on what this path reads: curated
records from the operator's own repository, never caller-supplied URLs.

### Changed — tool descriptions match the chatbot's actual routing (2026-08-20)

Reviewed against the WLO chatbot's master prompt, which encodes the intended
use: `search_wlo_all` is the OVERVIEW entry; once a request names a specific
single-content shape ("Arbeitsblätter zu Bruchrechnung"), `search_wlo_content`
is the narrowing. Our description claimed the opposite ("als Filter, nicht in
ein anderes Werkzeug") and fought that routing — reworded, and the
cross-reference is now pinned by the description test.

Four texts named `search_skill` unconditionally — on a registry-only deployment
(`WLO_DISABLE_SKILL_SEARCH`) they pointed at a phantom tool, and the
"no registry here" answer even RECOMMENDED it; the chatbot's prompt had to state
"Ein Werkzeug `search_skill` existiert nicht" to fight our own wording. All
skill descriptions and answers now name only tools the configuration registers
(`skillFinderName`, pure and mode-tested).

`get_node_collections` attached each collection's skill catalogue AFTER the
JSON early-return — markdown carried it, JSON silently did not (the same class
as the browse tools on 2026-08-15). Moved before the format branch; the
description now names the chain material → collection → approved skills.

`get_compendium_text` describes the editorial three-part structure (world
knowledge · curriculum competencies per level and state · collection overview)
and what the text is FOR: gap analysis, fact-checking baseline,
curriculum-aligned learning paths.

### Fixed — topic pages carry their collection's approved skills (2026-08-19)

A Themenseite IS a `ccm:map` with a page layout, and the live Optik page holds
three approved skills — but `search_wlo_all` attached the catalogue only to the
plain-collection bucket, and a search's one hit for "Optik" named none of them
(found live against staging). Both buckets now share ONE `ensureRegistries`
call, so they also share the live-fallback cap: no extra upstream requests.
`ensureRegistries`/`attachCachedRegistries` return the SET of answered nodeIds
instead of a count, because each bucket reconciles its own `registryChecked`
ledger against the shared call — 4 answered ids are not "2 of 2 collections",
and a count-based union would have marked the normal (mixed) search unchecked
while its catalogues were right there in the answer. `topicPages.registryChecked`
is declared in the output schema (zod strips undeclared keys silently), and the
"nicht geprüft" hint gates per bucket.

`get_topic_page_content` additionally carries the catalogue INLINE in markdown
mode — it travelled as a second content block, and at least one real client
hands the model only the first, so the server had answered "which skills are
approved here?" and the model never saw it. JSON mode keeps the second block:
block 1 is pure JSON there, and prose inside it would break every parser.

Hardening, tests, modularization, and a full documentation overhaul following the
code audits.

### Fixed — the quality captions can now be looked up (2026-08-19)

Review of the same day's work. `lookup_wlo_vocabulary` gained
`vocabulary="qualityScale"`: every position of every writable quality rating with
its caption, and the curation parameter that sets it. Two texts already pointed
here for exactly that — the refusal of an out-of-range position and the
description of each `quality*` parameter — and the tool had no scale vocabulary
at all, so the one recovery path a model is offered after a wrong value ended in
a second error. The other named route, `get_node_details` with
`includeQualityInfo`, only ever shows what a record already carries. A test now
takes the tool name out of the REFUSAL and calls it, so the pointer cannot rot
again. `qualityFinding` — added the day before and until now untested and
undocumented — is listed in the parameter description too.

One caption could not be written back at all: the repository stores
`quality_currentness/0` as `" 0-A veralteter Inhalt"` with a leading space, while
`validateField` trims every incoming value. So the input form both the parameter
description and the refusal promise — "oder die Beschriftung" — was refused for
it, by the same sentence that had just printed it. Captions are trimmed at
generation now, which also removes the stray double space from the rendered line.

### Added — an AI can rate a record on the 0–5 quality scales (2026-08-19)

The seven ordinal scales — didactics, language, media, neutrality, transparency,
data privacy, currentness — are writable through `wlo_create_content`,
`wlo_update_content` and `wlo_suggest_metadata`. A caller sends the digit (or the
caption); what reaches the repository is **the form the widget declares**, which
differs per field: a full URI for six of them, a bare digit for `currentness`.
Out of range is refused with the range named.

Two fields that look like they belong and do not, both measured:
`ccm:oeh_quality_login` and `ccm:oeh_quality_relevancy_for_education` declare
0–1 and are yes/no questions ("Ohne Login zugänglich", "Ja - geeignet"), not
truncated scales. `ccm:containsAdvertisement` declares 0–5 but 69 628 of its
69 688 stored values are `yes`/`no`, so writing a star would put a third
spelling into the one field that already carries two — it stays read-only.

### Fixed — the confirmation preview names what a person can check (2026-08-19)

Every vocabulary field showed its raw URI: `Bildungsstufe: (leer) →
"http://…/sekundarstufe_1"`. The confirm token binds to that sentence, and this
project already holds the rule elsewhere — a technical id is not something
anyone can check (`nameOf` for topic-page variants). It was survivable while the
values were subjects and school levels, and stopped being so when quality
RATINGS became writable: "…/quality_didactics/4" tells a curator nothing about
what they are approving. The preview now reads
`Didaktik (Bewertung): (leer) → "✰✰✰✰ moderne, gute Methodik"`. A value no table
names is still shown exactly as it is.

### Added — the quality ratings a record already carries can be read (2026-08-18)

`get_node_details` and `get_nodes_details` take `includeQualityInfo`: thirteen
fields — factual correctness, didactics, language, media, neutrality,
transparency, currentness, data privacy, educational relevance, copyright,
criminal law, personal rights, protection of minors — rendered as the captions
the repository declares ("✰✰✰ gute Methodik", "keine Auffälligkeiten gefunden
(Maschine)").

The 2026-08-17 survey had written these off, and the correction is worth
recording. It found the corpus storing values outside the declared vocabulary
and stopped there. Re-measured, the corpus stores TWO forms side by side in the
same field — `.../quality_didactics/1` and a bare `"4"` — and only the URI form
comes back with a `_DISPLAYNAME`. The bare digit is not a broken value; it is the
same position on the same fixed scale, so the caption existed all along and only
the lookup was missing. `src/vocabs-quality-scale.ts` supplies it, generated from
the metadata set by `scripts/generate-quality-scales.mjs` — 10 scales, 52
captions — rather than invented here.

That also corrects a fix from the same day. `includeAccessInfo` had started
DROPPING `ccm:containsAdvertisement = ["5"]` as an unlabelable number. It is
labelable: 5 means **"✰✰✰✰✰ ohne Werbung"**. Dropping it discarded a fact, and the
"Werbung: 5" it replaced stated the opposite of one. The drop rule remains for
values no source can name at all.

`ccm:oeh_quality_login` stays unread although it is clean and set on 72 787
records: `ccm:conditionsOfAccess` states the same fact three-valued and on
198 699, and reading both would print one fact twice.

### Added — an automatic quality check has a slot on the record (2026-08-18)

The five `ccm:oeh_quality_*` FINDINGS fields — factual correctness, copyright,
criminal law, personal rights, protection of minors — are writable through
`wlo_create_content`, `wlo_update_content` and `wlo_suggest_metadata`, with the
vocabulary the repository declares for them: "keine Auffälligkeiten gefunden
(Maschine)", "Auffälligkeiten gefunden (Maschine)", "ungeprüft".

This reverses half of a decision taken on 2026-08-17, and the correction is
worth stating: that survey found 11 of 14 quality fields storing values outside
the vocabulary they declare, and refused all 14 together. Re-measured, the 14
are two families. The seven STAR fields (didactics, language, …) really are
unusable — a bare digit where the widget declares a URI, and a star rating is an
editorial judgement besides. The five FINDINGS fields are not: they declare one
fully captioned vocabulary that distinguishes a machine check from a human one,
and four of the five are already used with it in the corpus (52 of 97 values in
copyright_law, 54 of 98 in criminal_law, 50 of 92 in personal_law).

**The two HUMAN verdicts are refused.** The value names who carried out the
check, and the caller here is a model; "geprüft (Mensch)" on a record no person
looked at is the one claim in this vocabulary that cannot be corrected by
reading the record afterwards. They stay in the vocabulary — `lookup_wlo_vocabulary`
reports what the repository holds — and only writing them is closed.

Everything else is unchanged: two-step confirmation, the fingerprint over the
change set, the read-back after the write, the redirection onto the original. A
quality verdict is a curation like any other.

### Fixed — a value nobody can label is no longer handed over as if it meant something (2026-08-18)

`includeAccessInfo` rendered `Werbung: 5` and could render `Kosten: false`: the
star scale leaking into `ccm:containsAdvertisement` (28 records) and four junk
booleans in `ccm:price` among 339 687 values. Neither is in the field's declared
vocabulary, so the repository does not label them either — and beside
`Kosten: nein` a bare "5" reads as a labelled statement whose direction nobody
can recover, on the one field where reading it backwards turns "werbefrei" into
"voller Werbung". Both shapes are now dropped. Measured: 63 word values against
1 number in the sample, and `ccm:license_oer` (whose slugs are numeric too) was
labelled on both of its carriers.

### Added — a compendium text answers a question instead of arriving whole (2026-08-18)

`get_compendium_text` takes a `query`. With one it returns the passages that
answer it, ranked by BM25 (`src/text-bm25.ts`), each under the heading path it
came from; without one the whole text, every main section capped on its own.
Either way the answer opens with the **outline** of the document's headings — a
model handed excerpts otherwise cannot tell what it did not see, and so cannot
ask the narrower second question.

Measured against staging over the 11 collections that carry such a text. The
largest is 65 250 characters: whole it now comes back as 20 802 (outline plus
capped sections, `truncated: true`, `charCount` still the full 65 250), and
`query: "Lehrplan Thüringen Regelschule"` as 4 964 — including the sentence
naming what did NOT match. That sentence is the point: two of the three words
occur nowhere in that text, and without it a page of Rheinland-Pfalz curricula
reads as an answer to the question that was asked.

Three shapes the measurement ruled out. Capping "per H1" would have capped each
document as a whole — 10 of 10 texts put their title in a single H1 and their
11–18 content sections in H2, so a main section is worked out from the document
(the shallowest heading level used more than once). A raw paragraph is the wrong
BM25 unit — 329 of 972 real paragraphs are under 40 characters, and length
normalisation puts a bare table row above the prose that explains it, so
paragraphs are accumulated to 200 characters first. And a whole section is too
coarse: the largest own-body section holds 16 317 characters.

New setting `WLO_COMPENDIUM_SECTION_MAX` (default 2000). An operator setting and
not a tool parameter: it exists so an answer cannot grow without bound, and a
caller who can raise it has no cap. At the default exactly one of the eleven
texts changes; the other ten come back untouched.

### Added — a skill registry can group its skills by working situation (2026-08-18)

A registry document now structures its catalogue with its own Markdown
headings: `##` opens a context, `###` a sub-context, and the prose above the
first `::: ki-skill` block is the editorial team's **instruction** for it. That
answers a question the flat list could not: not "which skills are approved
here", but "which of them do I want *right now*".

`get_skill_registry` takes a **`context`**; the five tools that answer about one
collection — `get_collection_contents`, `search_wlo_within_collection`,
`get_node_details`, `get_topic_page_content`, `get_related_content` — take a
**`skillContext`** and deliver the narrowed catalogue *and* the instruction with
the collection answer, so the second call is not needed. Case and spacing do not
matter; nothing, or `all`, means everything.

**A name that does not land never narrows.** An unknown or ambiguous context
returns the full catalogue plus the names that do exist — never an error, and
never a short list that looks like a result. A model learns the right name from
the answer that got it wrong. It gets no instruction in that case: a typo must
not trigger the most expensive answer the surface can give.

Three structural rules, each a decision editors can rely on: a section **without
a title** is transparent (its content joins the nearest named section above,
else the general part); a named section **is** a context even with no skills in
it yet — filling a group after creating it is how editorial work proceeds; and a
skill declared before the first `##` applies in **every** context.

Contexts cost **no** extra requests — they are read from the document text the
cheap tier downloads anyway (1 children listing + 1 download, unchanged).
A **named** `skillContext` is the one exception and is opt-in: it re-reads that
one document live (2 requests, ~1.0–1.4 s), because the cache holds the summary
and not the editors' prose. `all` needs no prose and is served from the cache.

Editorial guide: `docs/SKILLS.md`. Flow and output: `docs/SKILL-TRIGGER.md`.

### Changed — a collection result carries a catalogue that gets *shorter* as the registry grows (2026-08-18)

The catalogue attached to every collection result was unbounded in practice: a
registry with 28 skills wrote 30 lines into **each** hit (3436 characters), and
a search returning five collections spent over 17 000 on approval lists — 1008
of them bare UUIDs.

It is now bounded to **12 lines per collection** (`REGISTRY_INLINE_MAX`, which
replaces `REGISTRY_LINES_MAX`), whatever the registry's size, in three forms:

1. everything fits → the grouped catalogue with a nodeId per skill, as before;
2. too many to list, few enough to name → the **context index**: names with
   counts, several per line, no nodeIds;
3. not even that → the head line alone, with `get_skill_registry` as the way on.

Measured on the shape of the Optik registry (28 skills, 7 contexts): **3 lines
instead of 30, 407 characters instead of 3436**. A flat 50-skill document — no
contexts involved — collapses to a single line of 147, which is the larger share
of the saving.

Forms 2 and 3 print no skill nodeId and therefore drop the "this is only the
overview" closing note as well: it would promise a `get_skill` call the answer
carries no identifier for.

Nothing about this costs a request, and no tool lost an ability — the head line
names the count and the tool that lists them.

### Fixed — creating a record no longer times out while the repository is still working (2026-08-17)

Creating a record with a source URL is one upstream call that takes 12–19 s on
staging (measured per request: duplicate check 1.2 s, **create 18.6 s**,
metadata 0.5 s). It ran
against the 20 s budget meant for calls that answer in well under a second, at
93 % of it, so a slower moment aborted it. That reported a failure for work the
repository goes on to finish, and a retry can create a *second* record.

That one call now has its own 30 s budget — 1.6× the slowest measured run. An
operator who raised `WLO_FETCH_TIMEOUT_MS` above that keeps their setting.

The budget was briefly 25 s, held down by a ceiling that turned out not to
exist. `httpServer.requestTimeout = 30_000` reads like a cap on the whole
request and is not one: measured, a node:http server with that setting and a
handler answering after 35 s delivers its response. It bounds *receiving* a
request — which is also why this server's SSE streams survive. Three older
comments had made a response deadline out of it and used it to justify design
decisions; those caps stand on what the work costs instead, and what really
bounds the wait sits with the client.

### Fixed — a redirected write is now diffed against the record it writes (2026-08-17)

Found by review after the plan was complete. The three metadata tools resolved a
collection reference to the record correctly, but kept diffing against the
**reference's** properties. While a reference still inherits, the two are
identical and nothing looks wrong; they diverge exactly once the reference has
been written to directly — the state older versions of these same tools created.

Three consequences, all silent: a field counted as unchanged because the
reference already showed the wanted value, so the record never received it while
the tool reported success (for `wlo_decide_suggestion`, complete with marking the
proposal ACCEPTED); the preview showed the reference's value as "before", so the
approved diff described a different record; and keywords — a merged field —
merged into the reference's list and wrote that over the record's, dropping any
keyword only the record had.

`readWriteBaseline` now returns the target and its baseline together, and the
extra read happens only when a redirection is in play. An unreadable record
refuses rather than falling back to the reference.

### Added — the catalogue now hangs on every collection answer, whole (2026-08-18)

A collection or topic-page answer carries the approved skills, their first three
descriptions, AND the editors' general instruction — the prose above the first
H2, the words that govern the skills that apply always. It comes from the cache,
not from a live read: measured, the warm overview is 286–393 ms while re-reading
the document costs ~1.5 s. The instruction is stored on the cache ENTRY, never on
`CachedRegistry`, which is the field a search-result node carries — a collection
answer wants the prose, a list of fifty hits does not. Capped at 1200 characters
per collection, which is a memory bound: the cache holds up to 2000 entries.

Naming a `skillContext` narrows it the way `get_skill_registry` does, and now
keeps the same shape: the matched context is its own group and the always-valid
skills stand apart from it, instead of the flat list a reader could not take
apart. The other contexts are named below it, so a second and more precise
`get_skill_registry` call needs no round trip without a context first.

Two sentences were wrong and are fixed: „in 1 Kontexten" (a registry with one
context is ordinary), and the context count on a narrowed answer, which was the
VIEW's number in a sentence that reads as a claim about the registry. A narrowed
answer now claims no count — it names its context in its opening line.

### Added — a collection answer says what each skill is FOR (2026-08-18)

Every collection answer — with or without a `skillContext` — now carries the
description of its first three skills under „Wozu die Skills da sind". Skills
past the third keep title and nodeId, as before. Keywords stay out by decision:
measured at ~175 characters per skill against ~170 for the description, and the
description is what answers „is this the one I want“.

**Three is a cap on the READS, not just on the output.** A registry may declare a
hundred skills, and one metadata read each is the cost the cheap tier exists to
avoid; `describeEntries` also runs AFTER any narrowing, so a targeted context
pays for what it shows rather than for what the document declares. The catalogue
that travels with SEARCH RESULTS is a different path — the cache, up to ten
collections per request — and is unchanged and still free.

A skill whose record cannot be read is now named as such („Nicht abrufbar
(geprüft für die ersten 3)“) instead of being offered with „laden mit
get_skill“. We paid for that head, so we know; the sentence names its own reach,
because the cap means the check did not cover the rest.

The descriptions render below the catalogue rather than inside it. The list is
bounded to `REGISTRY_INLINE_MAX` lines, and a description line per skill would
push a four-skill context into the short form that prints no nodeId — adding
information must not cost the answer its usable half. The head line drops its
„descriptions with get_skill_registry“ offer where the descriptions are already
present, and names the keywords and the document instead.

### Changed — a collection answer keeps the instruction levels apart (2026-08-18)

`skillContext` on a collection tool delivers the editors' prose. A registry
writes it on two levels — the general part above the first H2, and the context's
own section — and they were joined with a space, so a reader could not tell
where one ended and the other began. Each now gets its own line and a label
(`Allgemein (gilt in jedem Kontext):` / `Kontext „Name“:` / `Übergeordneter
Kontext „Name“:` for an H3's parent), which also makes them separable by a
client rather than only by a human.

`contextInstructions` returns `{scope, title, text}` per level instead of a flat
list of strings. The cap over the whole block is unchanged, so a collection hit
carries no more prose than before.

### Added — cost and advertising, and what a label actually depends on (2026-08-18)

`includeAccessInfo` now reports five fields instead of three. The two new ones
were never surveyed: the 2026-08-17 run's three patterns matched neither
`ccm:price` (339 687 records, 58 % of the corpus) nor `ccm:containsAdvertisement`
(69 688). Both had been sitting in that report's own "remaining fields" list the
whole time. The survey script gained a fourth group so the next run cannot miss
them the same way.

The measurement behind it corrects how the previous one explained itself:
`<property>_DISPLAYNAME` resolves exactly what a field's WIDGET declares — not
the URI, not the published vocabulary. One record carried seven quality fields
and only `ccm:oeh_quality_login` came back labelled, because its widget is the
one declaring the bare digits it stores. So the quality fields stay out, but for
a measured reason rather than an inferred one.

`ccm:containsAdvertisement` is the single field with a local vocabulary table
behind it (`yes` → "Ja", `no` → "Nein"). Its widget declares the star scale
`quality_advertisement/0…5` while 69 628 of its stored values are
`containsAdvertisement/yes|no`, so the repository answers with no label at all.
The table is a fallback and never an override: if the metadata set is ever
pointed at the right vocabulary, it stops being consulted. That qualifies the
"no vocabulary table" rule rather than dropping it — the rule guards against a
third source drifting from an instance, and here there is nothing to drift from.

Details, including the full declared-vs-stored table for eighteen fields:
`docs/plans/2026-08-18-vokabular-abgleich.md`.

### Added — `includeAccessInfo` on the detail tools (2026-08-17)

`get_node_details` and `get_nodes_details` can now report three fields that
appeared nowhere before: access conditions (does it need a login?),
accessibility conformance (A/AA/AAA, BITV 2.0, WCAG) and OER status. Off by
default, and it costs no extra request — the detail tools already read every
property, so this is a projection of data in hand.

No vocabulary table came with it: the repository labels all three itself through
`<property>_DISPLAYNAME`, which is the source the formatter already prefers for
vocabulary fields. The quality fields are deliberately absent; the measurement
behind that is in `docs/plans/2026-08-17-metadatenfelder-erhebung.md`.

All three are readable but not searchable — as an ngsearch criterion each
answers HTTP 400, so "find me material without a login" is not available.

### Fixed — a complete licence count is no longer discarded as truncated (2026-08-17)

`facetLimit` is not a cap on how many facet buckets come back: measured on
staging, the server answers with up to five times the requested limit
(`ccm:taxonid` at limit 1/2/10/50/80 → 5/10/50/250/376 buckets, the last being
every distinct value there is). The exact licence count tested `buckets.length
>= FACET_LIMIT` and so treated a complete 23-bucket answer as possibly
truncated, falling back to the family total that the same module documents as
overstating by 98–164 %. The threshold is now `FACET_BUCKET_MAX`; `FACET_LIMIT`
stays at 20 because it sizes the user-facing facet output.

The corpus licence keys pinned in the tests were re-measured too — 23, not 16.
Seven are new since 2026-08-12 and most are free text somebody wrote into the
licence field (a company name, a copyright notice, a whole sentence of German
copyright law). They are pinned as values that must stay UNRESOLVED: inventing a
licence where the record names none tells a reader they may reuse the material.

### Fixed — the detail view says when a nodeId is a reference (2026-08-17)

`get_node_details` and the Fachportal listing build their `nodeId:` line by
hand, so both missed the shared rule introduced with `originalId` — the rendered
text said nothing while `structuredContent` carried the field. A guard now fails
any hand-built `nodeId:` line outside the one place that legitimately has no
`originalId` to state.

### Added — `npm run survey:metadata`, a metadata-field survey (2026-08-17)

Asks a live repository which fields it offers for quality, rights and
accessibility, and how the corpus actually fills them. Reports and never writes,
like `npm run sync:vocabs`. Two legs: the full metadata set (17.3 MB, ~1 s) for
what EXISTS and what carries a vocabulary, one facet per field for whether
anyone maintains it — neither question answers the other. Its output is the
input to a human decision, and the result is written up in
`docs/plans/2026-08-17-metadatenfelder-erhebung.md`.

The finding that matters: 11 of the 14 `ccm:oeh_quality_*` fields store values
their own declared vocabulary does not contain — the same rating scale spelled
once as a concept URI and once as a bare digit, both present in the same field.
One field declares a findings vocabulary and stores star ratings exclusively. No
runtime behaviour changed here; three fields survive the measurement as
read-only candidates, and the planned write surface for quality fields is
dropped.

### Added — results say when a nodeId is a collection reference (2026-08-17)

A collection listing hands out reference ids and nothing else, and until now no
output said so: a caller could not tell that the id they were given is not the
record, and had no way to find the one that is. Every result node now carries
`originalId` when — and only when — it is a reference, in the rendered text as
`nodeId: … (Verknüpfung; Original: …)` and as a field in `structuredContent`.
Absent on an original rather than set equal to `nodeId`, mirroring the
repository DTO and leaving every existing response unchanged.

The wording is shared with the skill tools, which have rendered this sentence
since before ordinary results could — one phrasing for one fact.

`wlo_delete_content` also stops promising something a reference id will not
cause. Its description said the tool "zerstört das Material für alle
Sammlungen, in denen es vorkommt" — true of a record id, false of a reference
id, which is the id a collection listing gives you. The preview now states
which of the two cases applies, using the record it has already read, and names
the record that will survive.

### Fixed — a metadata write aimed at a collection reference now reaches the record (2026-08-17)

Collection listings hand out REFERENCE ids, so the id a caller naturally passes
to `wlo_update_content` is usually not the record. Measured against staging: such
a write is **stored on the reference**, never reaches the original, and the
reference stops inheriting from then on — a silent, permanent local override that
the read-back step could not catch, because it re-read the same node and found
the value it had just written. The documented behaviour ("200 OK ohne Effekt")
was wrong, and wrong in the more damaging direction.

`wlo_update_content`, `wlo_update_compendium` and `wlo_decide_suggestion` now
resolve the record before building the change set, and the redirection is the
FIRST line of the preview — naming both ids — because which record is edited
outranks what changes in it. The confirmation token binds to it: a token minted
from a preview that named no redirection does not authorise one, in either
direction, and a redirection from a different reference is a mismatch too.

Two things deliberately unchanged. Deletion is **not** redirected: measured the
same day, deleting a reference removes the reference and leaves the record alone,
so following the original there would turn a harmless tidy-up into data loss.
And `wlo_rename_collection` / `wlo_submit_content` write through other endpoints
whose behaviour on a reference is unmeasured — they are named in the plan rather
than changed on a guess.

`verifyWrite` lost its `nodeId` parameter and reads the change set's. Every
caller passed the same value anyway, and once writes can be redirected that
parameter is precisely where a check would silently run against the node the
caller named rather than the one that was written.

### Fixed — `get_skill` is registered in every skill-tool mode (2026-08-16)

`WLO_SKILL_TOOL_MODE=one-tool` replaced `search_skill` **and** `get_skill` with
`get_skill_for_task`, which takes a task description and no nodeId. That left the
mode with no tool that accepts one — while `get_skill_registry` is registered
unconditionally and IS a list of nodeIds, every collection result carries that
list, and a skill's own answer names its references and companion files by id.
The approval list was therefore unusable in that mode: it named skills nobody
could load. `get_skill` is now registered in both modes; what the switch replaces
is the SEARCH, never the loader.

Two consequences. The tool count in one-tool mode is unchanged at 42 (the swap is
1:1), and `docs/TOOLS.md` and `docs/INTEGRATION.md` said 41 — the count test
derived the expectation from a comment about the code rather than from the code,
so it agreed with the stale number. It now measures both modes through
`registerSkillTools`. And a Markdown companion file is pointed at `get_skill`
again instead of `get_wlo_content_text`: the fallback returned the repository's
text EXTRACT where a skill needs the file verbatim. `readerFor` no longer takes a
mode, and the parameter is gone from the three functions that only threaded it.

### Changed — a skill catalogue now says it is not the instruction (2026-08-16)

Every surface that lists skills by name closes with one fixed sentence:

> Das ist nur die Übersicht — die Anleitungen selbst stehen nicht darin. Die
> Anleitung (SKILL.md) lädt `get_skill` mit der nodeId des gewünschten Skills,
> nicht mit der einer Registry oder Sammlung.

The failure it closes is a model answering FROM a catalogue. An entry carries a
title and a nodeId and nothing else, so "Fragen generieren" reads like a step
that has been handed over when it is the name of one nobody fetched — and what
follows is an invention of what the SKILL.md would have said. The sentence names
the tool *and* what it needs, because a pointer without the nodeId is a step a
model cannot take.

Naming the tool is not enough where THREE nodeIds are in view. A rendered
collection carries its own on the record line, the registry document's on the
head line and the skill's on its entry — and the one nearest the note is the
registry's. Both wrong picks fail usefully (`get_skill` on a registry hands back
the approval list, on a collection nothing), but a model that reads an approval
list as an instruction has been handed a document that looks like the thing it
asked for. The clause uses the indefinite "einer Registry oder Sammlung" rather
than "der": `search_skill`'s catalogue holds neither, so the definite article
would point at things its answer does not show.

It reaches a collection's catalogue in search results and in every tool that
reports the collection it was called on (via `registrySummaryLines`), plus
`search_skill` and `get_skill_registry` — in both output formats, as the field
`hint` in JSON, on the same grounds the registry's untrusted-content warning is
carried in both: a disclosure that exists in one rendering only is no disclosure
for whoever asked for the other. In `get_skill_registry` it stays ahead of the
`---` separator with every other server-derived section; past it, an instruction
to call `get_skill` would be indistinguishable from one the uploaded document
wrote for itself.

It is withheld wherever no skill nodeId is printed, and that rule holds **per
format**: the head-line tier (`browse_collection_tree`, `get_subject_portals`,
`search_wlo_topic_pages`) renders one line per node, a registry with no
resolvable entries lists nothing, and an empty `search_skill` answers "keine
Skills gefunden" — in the JSON of the last two the `hint` field is then absent
rather than empty. A listing that promises a step its own content cannot support
is worse than one that promises none. `get_skill_for_task` is excluded too —
under `WLO_SKILL_TOOL_MODE=one-tool` the tool named in the sentence is not
registered at all.

Both JSON sites shipped the field unconditionally in the first cut, which is the
inverse of the disclosure rule and was caught in review: `get_skill_registry`
answers its JSON branch BEFORE the `!registry` check, so `hint` arrived beside
`registry: null` — "das ist nur die Übersicht" over an answer stating there is
none. The positive tests covered both formats and the negative ones only
markdown, which is exactly how it stayed invisible; there are now negatives for
both.

Note the split this does *not* cross. Prose hints belong to the markdown path
and their machine-readable equivalent to the envelope — `registryHintFor` is
markdown-only, `renderToJson` carries no prose at all, and the JSON says the
same things through `registryChecked`, `licenseFilter` and `skillRegistry`. The
two skill tools build their payload by hand rather than through `renderToJson`,
which is why `hint` belongs there and nowhere else.

The sentence lives in exactly one module (`DESCRIPTIONS_ONLY_NOTE`,
`formatter.ts`), pinned by `tests/shared-rule-discipline.test.ts`: two of the
three surfaces already carried their own closing pointer, identical by luck
rather than construction, and the third had none.

Wording found by rendering the output rather than by a test. A first draft named
the fields — "nur Titel und Beschreibungen" — which is false on the surface that
shows the most of them: a node's catalogue carries title and nodeId only, while
`get_skill_registry` adds descriptions and keywords. It now says what the listing
is NOT and never what it holds. It is also indented with the entries it closes;
flush left it landed between the last skill and the node's own `Typ:` line, where
"das ist nur die Übersicht" reads as a claim about the record.

### Changed — the approval list reaches every collection tool, and is no longer cut at 30 (2026-08-15)

**Up to 100 skills ride along, not 30.** The listing tier and the tool tier used
to carry different numbers, so `search_wlo_collections` and `get_skill_registry`
gave different answers to "which skills are approved here" — and the entry a
model needed could be the 31st. `REGISTRY_SEARCH_MAX` is now `REGISTRY_MAX`.
It costs no request: that tier takes title and nodeId out of the `:::` blocks, so
the answer is two calls whatever the number.

One sentence had to move with it. While the listing was the narrower tier it
could honestly say "mehr mit `get_skill_registry`"; with both at 100 that is an
offer the tool cannot keep, so a capped listing now points at the registry
DOCUMENT, which `get_skill_registry` returns unchanged. The equality is pinned by
a test, because raising one number without the other silently makes that
sentence true or false again.

**The collection a tool was CALLED ON now answers too.** The catalogue was
attached to a tool's RESULTS, which answered for everything except the subject:
`get_collection_contents` returns a collection's materials,
`search_wlo_within_collection` a filtered slice, `get_node_details` its metadata
— and the collection whose approved skills the caller wants is in the arguments,
never in the result list. With `contentFilter="files"` the enrichment had nothing
to attach to at all. `subjectRegistryText` (`tools/shared.ts`, over the new
`ensureRegistryFor`) closes it for those three plus `get_topic_page_content`,
where the id is the COLLECTION's — a variant is one rendering of a page, not a
thing that can approve skills.

The block names its collection in words. It arrives under the last listed record
and without that line it reads as that record's registry — a material's, usually,
which is a thing that cannot exist. Only running it showed that.

**The browse tools mark, rather than list.** `browse_collection_tree`,
`get_subject_portals` and `search_wlo_topic_pages` render one block per node, and
a hundred skills under each destroys the shape they exist for. They carry the
head line — title, count, nodeId — through `registrySummaryLines(…, {entries:
false})`, the same function the full listing uses. And they read the cache ONLY
(`cachedRegistriesFor`): a portal list covers thirty collections and a tree
fifty, so first contact would charge a children listing for each, which is the
crawl the cache exists to prevent. What it does not know is queued for the tick.

**`get_related_content` answers for the collection it READ.** Its two result
lists come from `FILES`-only queries and can hold no collection, which is why
the `registryHintFor` call over their union was unreachable code — it could
never fire. But the tool does touch a collection: with `includeSiblings` it
reads the seed's parent to fill "Aus derselben Sammlung". That id is exposed as
`registryCollectionId`, and which collection it names depends on the seed, since
the tool takes "eine nodeId eines Inhalts ODER einer Sammlung": a collection seed
IS the collection in play (its own parent is a level the caller never named),
a material seed points at the parent the siblings came from, and without
siblings there is no collection and nothing is said.

**Review of the same change, eight findings, all fixed.** The one that mattered:
both browse tools computed the registries *after* their `outputFormat === 'json'`
early return, so a JSON caller got nothing while a Markdown caller got the head
line — and the documentation written in the same change promised it to both.
Fixed by attaching the catalogue to the NODE before either branch, which is also
smaller: `CollectionTreeNode` is a `FormattedNode` and both browse schemas extend
`formattedNodeSchema`, so the field and its zod entry already existed, and
`renderThemePages` lost the lookup-map parameter it had grown.

The rest: `ensureRegistryFor` now distinguishes **three** outcomes — a catalogue,
"answered, none there", and "not answered" — instead of collapsing the last two
into one `null` that read as a collection approving nothing; a lookup that
learned nothing is now QUEUED, so the tick warms it rather than every request
repeating the live call (the comment claimed this already happened); the subject
block moved *below* the licence and empty-result notices, which say why a result
may be short and must not sit under a hundred catalogue lines;
`get_node_details` no longer advertises "~0,3 s" without saying that a collection
adds one lookup; and one further defect the fixes themselves introduced, caught
by re-reading the diff — an empty collection id produced "Ob die angefragte
Sammlung  …", naming nothing and offering a call nobody can make.

### Added — a loaded skill announces itself (2026-08-15)

`get_skill` and `get_skill_for_task` now prefix the instructions with a line the
model is asked to print verbatim into the chat:

```
[ edu-sharing Skill ] Unterrichtsstunde planen - aktiv
```

Until now a skill worked invisibly — the answer changed and nothing said why, or
which uploaded document was steering it. The line closes that, and it is built
**server-side from `cclom:title`**: nothing has to be written into a `SKILL.md`,
so the editorial team maintains nothing and a document cannot choose its own
announcement. It is also carried as its own `activation` field in the JSON
output, so a client that renders the answer itself does not have to depend on
the model complying.

Two properties the implementation owes (`services/skill-activation.ts`): the
line rests on the **content type**, not on which tool was called — `get_skill`
also serves a skill's companion files, and announcing a template as an active
skill asserts what the record denies — and the title passes through
`sanitizeText`, not `oneLine`, because it lands inside an instruction reproduced
verbatim to a person. That is the elevated-authority boundary, not the delimiter
protection ordinary rendered values get. It sits ahead of the separator for the
same reason the file manifest does; the block says so, since it has just taught
the model to reproduce lines of that shape.

Compliance cannot be enforced — it is a request to the model, exactly as with a
host's own skill files.

### Fixed — seven findings from auditing the seven places nobody had checked (2026-08-13)

**Ticket blocks evicted the blocks people had made on purpose.** The
deterministic access id collapses every page load of one edu-sharing session
into a single registry entry — but the next session brings a new ticket, a new
hash and a new entry, so an embedded widget files roughly one per working day.
`MAX_BLOCKS_PER_LABEL` counts deliberate acts; its own reasoning is "a laptop, a
phone, two or three AI hosts". Ten days of widget use therefore retired the block
that person had pasted into their AI host weeks earlier: the connector answered
401, re-pasting the same block did not help because it was off the allow-list,
and nothing said why. A registry entry now records `k: 'ticket'` (mirroring
`AccessPayload.k` in name, values and meaning) and **the cap applies per kind** —
one constant over two classes, so automatic entries are only ever retired by
other automatic ones. `removeByLabel` is deliberately not split: a ticket block
is as much of an access as a pasted one, and revocation must take both.

The on-disk format version is deliberately **not** bumped: a mismatch makes the
registry answer null, which switches per-user access off entirely, so a bump
would take every deployed block out of service the moment the new image starts.
An optional field does not need one as long as both directions hold — a new
build reads an old file and treats its entries as deliberate, an old build reads
a new file, ignores the field and carries it through, because serialisation
writes whole entry objects rather than rebuilding them. Both are pinned by
tests; an entry naming a kind the build cannot interpret fails the file closed.
`docs/PRIVACY.md` (which lists what is stored, and for how long),
`docs/DEPLOYMENT.md` (budget for up to twenty entries per active account, not
ten) and `docs/TOOLS.md` moved with it.

**What a dead ticket does was measured, and `docs/AUTH.md` had it wrong.** The
document claimed every upstream call fails `401`. Against staging: the identity
endpoint answers **404**, and search, node metadata and children listings answer
**500** `A valid SecureContext was not provided in the RequestContext`. What
matters is the answer that does NOT occur — a dead ticket never answers 200 as a
guest, which is the silent failure `auth/identity.ts` exists to prevent. Because
`ngsearch` throws on any non-OK rather than degrading, the failure reaches the
caller as an error and not as "keine Treffer". No expiry of our own is needed or
wanted; the table is in §5c.

**Three guards, for three things nothing was watching.** `http.ts` cannot be
imported by a test (it listens on import), so nothing noticed that deleting its
`ticketAbuseLimiter` line left all tests green while `/auth/ticket` silently fell
back to the tighter password budget and refused the eleventh signed-in person
behind a school's NAT — `shared-rule-discipline.test.ts` now checks that wiring
in the source, the way `env-parsing-discipline.test.ts` already does for `parseInt`.
The byte guard added a fortnight ago scanned by extension only and so missed ten
files, three of them read mechanically: `.env.example` (parsed line by line by
`deploy-env-passthrough.test.ts`, and copied to `.env` by every operator),
`public/llms.txt` and `public/robots.txt`, both served. Its scope rule now lives
in one predicate instead of two copies. And `REGISTRY_LINES_MAX` must equal
`REGISTRY_SEARCH_MAX` or the renderer samples a catalogue the service considers
complete while the head line still promises "alle hier gelistet"; the two cannot
be one constant (leaf-module cycle), so a test renders `REGISTRY_SEARCH_MAX`
entries and requires every one to be printed.

Three comments — one in `formatter.ts`, two in its test — named `REGISTRY_MAX`
(100) as that partner instead of `REGISTRY_SEARCH_MAX` (30). A wrong name is how
the next person "restores" a mirror by raising the number it does not mirror.
`renderToText` also got its summary line back, which had been orphaned above an
unrelated constant.

### Fixed — raw control characters made two test files binary (2026-08-13)

Five bytes across `tests/ticket-exchange.test.ts` and
`tests/widgets-followup.test.ts` were control characters written as themselves
rather than as escapes — a NUL, plus `0x1b` and `0x1f` inside a regex range.
They were there as legitimate test DATA (does the ticket check refuse a control
character? does the follow-up prompt strip one?), which is exactly why nobody
looked twice.

What it cost: **git classifies a file containing NUL as binary**, so
`git diff --numstat` answered `-  -` and both a local review and GitHub showed
"Binary files differ" instead of a diff. **ripgrep skips it** for the same
reason, printing "binary file matches" and no content — leaving the file
invisible to the grep-based checking used throughout this repository. No gate
saw it: lint, `tsc` and all 1852 tests passed with the bytes in place, because a
byte that is legal inside a string literal is legal to every tool reading the
file as text.

Each is now written as its `\uXXXX` escape — identical at runtime, and the 24
tests in the two files pass unchanged. `tests/source-bytes-discipline.test.ts`
reads the tree as BYTES and fails on any raw C0 character or DEL outside tab,
LF and CR, so the next one is caught at authoring time rather than after it has
already made a file unreviewable.

### Fixed — three findings from reviewing the day's own changes (2026-08-12)

**`wlo_suggest_metadata` did not bind its rationale to the confirmation.** The
token binds a fingerprint of the change set, and the change set holds only
`property/before/after` — so `reason` travelled beside it: not in the preview,
not in the fingerprint, but in the POST body and from there into the repository.
A token minted for one rationale confirmed a call carrying a different one, and
that text is precisely what the reviewing curator decides on (`description` is
mandatory upstream). This is the rule `wlo_submit_content` already states in full
for its note to the editorial team — applied in one tool and not carried to its
sibling. The rationales now go into the change set's `action`, which is what puts
them in both the preview and the fingerprint, and `reason` gained the same
`.max(1000)` bound the note has. Over the prepared-write route the unapproved
text would additionally have been filed under a signed-in person's name.

**A repeated ticket exchange rewrote the whole access registry.** `add` always
commits — it serialises the list, writes a temp file and renames it — while the
registry is the one thing this server writes to disk at runtime. An embedded
widget exchanges on every page load, so every page load rewrote the file, and the
only difference between old and new content was a refreshed `iat`. The exchange
now skips `add` when the id is already listed; the entry keeps the timestamp of
its first exchange, which is the more accurate record anyway.

**`/auth/ticket` spent the password budget.** Ten distinct logins per address is
right for a human-chosen secret with guessable neighbours. A ticket is
machine-issued and unguessable — the argument the endpoint's own CORS carve-out
rests on — while the address it arrives from is routinely SHARED, because an
embedded widget on a portal page puts a whole class behind one NAT address. The
eleventh signed-in person of the day was refused: the relay-client failure this
project already made once on `POST /mcp`, in the same shape. The exchange now has
its own limiter instance and its own budget (`TICKET_CREDENTIAL_LIMIT`, default
**200**) — a separate instance rather than a bigger number, so page reloads
cannot eat the same address's `/auth/issue` budget. Not unlimited: the bucket
retains one digest per distinct ticket for the window, and this is what bounds
that. It is the looser of the two bounds either way — `API_RATE_LIMIT_RPM` caps
the same address at ~300 attempts in the same window. An entry point that does
not wire it falls back to the tighter password budget, so forgetting over-refuses
rather than running unbounded.

Documentation moved with all three. `docs/PRIVACY.md` had gone factually wrong
about the ticket path: it described every allow-list entry as carrying "a random
access id", which a ticket block's is not — it is a SHA-256 of the ticket, and
the privacy document is the one place that must not be approximate about what is
stored. It now also lists the ticket itself among the data that transits, and
names both limiter budgets. `CONTRIBUTING.md`/`.de.md` told contributors that
`npm run build` and `npm test` were the gates before "done" — they have been four
since the lint gate landed, so following the guide meant a red PR; the live
write-contract run is named there too, with why it is deliberately not a gate.
Both README env tables gained `TICKET_CREDENTIAL_LIMIT`, and `docs/AUTH.md` §5c
no longer says the exchange shares the password limiter.

### Changed — a registry may be called a catalogue (2026-08-12)

The document that declares a collection's approved skills was recognised by one
file name (`skill_registry.md`) and one title phrase (`skill registry`). The
editorial team writes it three ways, and two of them were invisible to the
tie-break: staging carries `skill_katalog.md` (measured, see
`skill-catalogue.ts`) beside the English `skill_catalog.md`, and the live
registry on the Optik collection is titled **"Skillkatalog Physik Optik"** —
which the old phrase did not match at all, so it won only by being the sole
candidate. Beside a second prompt document it would have been a coin flip on
nodeId order.

Both carriers now go through ONE pattern — `skill` followed by `registry`,
`catalog`, `catalogue` or `katalog`, in any case and with spaces, hyphens or
underscores between. Matching a little eagerly is the safe direction and is why
this may be one loose rule rather than an exact-name list: it decides a TIE-BREAK
among documents that are already `ai_prompt` Markdown in one collection, never
whether a registry is recognised at all. `docs/SKILLS.md` names the accepted
spellings instead of the single one.

### Added — a lint gate and a live write-contract test (2026-08-12)

Two of the three actionable findings of the 2026-08-12 whole-codebase audit,
implemented together with the third (`serverupdate.txt` joined `.gitignore` —
operator deployment notes must not be one `git add -A` away from publication).

**`npm run lint`** (ESLint 10 + typescript-eslint, gated in CI after the type
check) runs the recommended CORRECTNESS rules only — deliberately no formatter
and no style rules, because the codebase predates the linter and a formatting
sweep would bury every real change in the diff. The first run found 256
problems; all but nine were the stray agent worktrees under `.claude/`
(now ignored), missing environment globals (declared per area: Node for
`*.mjs`, browser for `public/*.js`), and the test suite's `as any` fixture
idiom (~170 sites — the rule is off for `tests/**` and stays ON for `src/`).
The nine real ones: three useless initializers, two `_dropped` names the rule
now knows are deliberate, and four deliberate test payloads (a zero-width
space, a control-character range) that carry inline disables naming why. The
project-specific invariants stay where they were — a generic linter cannot
check "this rule has exactly one copy", `tests/shared-rule-discipline.test.ts`
can.

**`npm run test:live`** closes the audit's top finding: the offline suite fakes
the upstream, so it proves the code sends what we decided to send — never that
edu-sharing accepts it, the gap that let `wlo_create_collection` and
`wlo_rename_collection` pass every test while never working (research doc §9).
`tests/live/write-contract.test.ts` runs the mutating contract against a real
repository — collection create → rename → delete, record create → delete, every
assertion riding on the pipeline's own read-back. It is staging-ONLY (the host
is hard-coded and checked in the file, because "testing target is staging,
never production" must not be one env line away from breaking), needs the
service credential from `.env`, and never enters `npm test` or CI:
`scripts/run-tests.mjs` reads `tests/` flat, so `tests/live/` is invisible to
the offline runner while `tsconfig.typecheck.json` (`tests/**/*`) still
type-checks it. First run 2026-08-12 against staging: 2/2 pass, both throwaways
deleted and confirmed gone (collection 5.3 s, record 23.1 s — the create alone
is measured at 4.2–8.0 s).

Not implemented from that audit, deliberately: the `get_url_text` SSRF residue
(TOCTOU between our DNS check and the extraction service's fetch) is only
closable INSIDE the fetching service — this repo already refuses literal and
resolved private hosts and ships the tool off-switchable; and no Prettier, see
above.

### Changed — a skill is now marked `ai_skill`, a registry keeps `ai_prompt` (2026-08-12)

**Behaviour change, driven by the vocabulary.** The openeduhub `contentTypes`
vocabulary gained an `ai_skill` entry ("KI-Skill") alongside the existing
`ai_prompt` ("KI-Prompt"), and WLO moved skill records onto it. `search_skill`,
`get_skill` and the repository-wide catalogue now filter on
`…/contentTypes/ai_skill`; against a repository still tagged the old way they
return **nothing** rather than an error, so this is a coordinated change with the
data.

The registry lookup did **not** move with it. `skill-registry.ts` and
`skill-registry-cache.ts` previously imported the skill constant on the reasoning
that "a registry is marked exactly as a skill is" — true only while `ai_prompt`
was the single entry available. Now the vocabulary distinguishes them and a
registry is precisely what `ai_prompt` still means: a prompt document *about*
skills. The term therefore has its own constant, `REGISTRY_CONTENT_TYPE_URI`, and
existing registry documents need no re-tagging.

Two things measured on staging while migrating the 28 Lehrtoolkit records:
`mds_oeh` still lists only the nine older values, so the editorial dropdown shows
the field blank for a skill — but the **index takes the new value regardless**,
re-indexing all 28 under `ai_skill` within ~45 s of the write and dropping them
out of the `ai_prompt` result set in the same pass. Afterwards the only
`ai_prompt` records left in the corpus were the two registry documents and one
skill belonging to another skillset; re-measured later the same day that last one
is gone too — **31** records under `ai_skill`, **2** under `ai_prompt`, both
registries. Both figures are as the service user: anonymously the same two
queries answer **28** and **1**. Quote the identity with the count, or the next
reader re-measures without one and concludes something moved.

Every existing test used these constants symbolically and so stayed green through
the switch — the value itself was unpinned. Two tests in `services-skills.test.ts`
now assert the literal URIs, which is the only thing that catches a typo in a
value whose failure mode is an empty result set.

The prose migrated by hand, and two documents were missed: `README.md` still
called a skill a "curated AI prompt", `docs/TOOLS-KOMPAKT.md` a "kuratierter
KI-Prompt". The tool descriptions had a guard (`tests/tools-skills.test.ts`); the
documents had none, which is the whole difference. `tests/docs-claims.test.ts`
now checks the four overview documents for the old noun. The editorial guides
(`docs/SKILLS.md`, `docs/SKILL-TRIGGER.md`) stay outside that guard on purpose:
they describe the VOCABULARY, where "KI-Prompt" is still the right word for the
one thing that kept it, and a guard must not push a document into calling a
registry something it is not.

### Changed — `license: "OER"` no longer returns material that is merely free to read (2026-08-12)

**Behaviour change.** The OER bundle contained five licence keys, one of which
grants no reuse right: `COPYRIGHT_FREE` means "kostenfrei zugänglich" with
ordinary copyright otherwise — gratis, not libre. It answered **12 445 of
403 461 records** to callers asking for "every freely reusable licence", which is
the direction this codebase already calls the harmful one: a surplus *more*
restrictive than what was asked for, invisible to the caller. A teacher filtering
for OER to remix was handed material they may not remix.

All three tool descriptions had always promised exactly the four remaining keys
(CC0, public domain, CC BY, CC BY-SA) and never named the fifth — the code was
the outlier, and what hid it was the label corrected below.

What changes for callers: an OER search returns fewer results and a smaller
total (measured live for "Mathematik": 13 620 instead of ~14 400), and everything
it returns is genuinely reusable. `docs/TOOLS.md` and `docs/INTEGRATION.md` named
the removed key by its old, wrong label ("urheberrechtsfrei") and now say why it
is excluded.

### Fixed — the licence vocabulary said the opposite of what it meant (2026-08-12)

`COPYRIGHT_FREE` was displayed as **"urheberrechtsfrei"**. The repository means
the opposite by it — its own description reads "Das Werk ist kostenfrei
zugänglich. Nutzung und Quellenangabe gemäß den allgemeingültigen gesetzlichen
Regelungen (UrhG)": copyrighted, merely free to access. It is the third most
common licence in the corpus (**12 445 of 403 461 records**), so the wrong word
was on a lot of screens. It now reads **"Copyright, freier Zugang"**, the
repository's own name for it, and the misleading alias is gone: someone typing
"urheberrechtsfrei" is asking for material free *of* copyright, and
`gemeinfrei` → `PDM` is the answer to that question.

Two more defects in the same table:

- **Three keys were unknown**, together 1 871 records — `COPYRIGHT_LICENSE`
  (1 359), `CC_BY_SA_NC` (497), `UNTERRICHTS_UND_LEHRMEDIEN` (15). An unknown key
  costs twice: the raw string is shown to a reader, and `filterByExactLicense`
  drops the record from every licence-filtered result. `CC_BY_SA_NC` is a legacy
  spelling of the same three terms as `CC_BY_NC_SA` and became an alias of it,
  because two keys for one licence must not read as two licences.
- **Every CC label asserted "4.0"** — an invented fact. `ccm:commonlicense_version`
  is absent on 90 of 90 sampled CC records, is not in the display projection, and
  is not even facetable. The version is gone from the display forms and kept as
  an alias, so "CC BY 4.0" in a prompt or tool description still resolves.

New: `npm run sync:vocabs` (`scripts/sync-vocabs.mjs`) compares all six
checked-in vocabularies against a live repository and reports the differences. It
never writes — labels need judgement, and the defect above was a label that
existed and looked fine. Two sources, because one does not cover both cases: the
mds `values` endpoint carries captions for the five concept vocabularies but
answers with the bare key for all 16 licence values in every locale, so licence
names come from `config/v1/language/defaults` → `LICENSE.NAMES`.

### Fixed — a collection search now asks both repository backends (2026-08-11)

The repository answers "which collections match this word?" through two unrelated
indexes, and measured against staging, **neither is a superset of the other**. The
one the server used could not return the collection `9e7ae956` ("Optik") for *any*
search word — terms occurring only in that record's own keywords
("Oberflächenphänomene", "Die Lehre vom Licht") returned zero hits there and find
it through the other endpoint every time. The reverse gap is real too: the mds
query matches a collection's compendium text, which the second endpoint does not
read at all.

`services/collection-search.ts` merges both, and is the single place that knows
they are two — pinned by `tests/shared-rule-discipline.test.ts`, because three
call sites reach a collection search and a rule re-derived per call site is the
shape this codebase has already seen drift twice.

Two properties of the second endpoint shaped the implementation, both measured:

- It **ignores `propertyFilter`** and answers with a fixed projection that omits
  `ccm:page_config_ref` — the property the Themenseiten split is derived from.
  Adopting its nodes verbatim would file a topic page as an ordinary collection,
  so it is used as an ID source and what it contributes is re-read with our own
  projection. Nothing new to fetch costs nothing.
- Its latency scales with the number of collections it returns (~0.25 s each), so
  it gets its own small cap (5) instead of the caller's. At the caller's cap of
  10 the first version tripled the collections leg (984 → 3396 ms for
  "Mathematik"); the leg is a repair for records the index cannot return at any
  rank, not a second full search, and those rank high.

Cost after that correction, median of 5 against staging: +0.6 to +1.2 s on the
collections leg, one term unchanged. `search_wlo_all("Optik")` now returns the
missing collection at position 1 of its topic-page bucket.

### Added — `get_skill_registry`: the skills a collection declares approved (2026-08-10)

The editorial process inverts the question `search_skill` answers. Not "which
skills exist" but **"which skills are approved for this collection"**, declared
by a registry document that lives in the collection. The new tool finds it, reads
it, and returns the catalogue — title, nodeId, description, keywords per skill —
plus the registry's own prose, which is where the editors put usage notes. The
instructions are not included: the model picks and calls `get_skill`, as before.

A registry **is** a skill record — same `ai_prompt` content type, same attached
Markdown, same `:::` blocks — so the parser and the download rule are reused
rather than rebuilt. It is found through the collection's CHILDREN listing, never
the search index: the two are separate systems in edu-sharing, and a record can
fall out of the index while sitting perfectly in the node store (a live
collection did exactly that on 2026-08-09). An approval list must not depend on
it.

**How a model learns a registry exists — a pointer, not a lookup.** The search
does NOT check: measured against staging, doing so adds **~1.0–1.4 s** to every
search, and the cost is the children listing, which is paid whether or not a
registry is there (neither collection in that run had one, and it still cost
1.4 s). Instead every collection result carries a free line naming
`get_skill_registry` with its nodeId, the server instructions say when to reach
for it, and the collection tools' descriptions cross-reference it — so the lookup
happens once, for the ONE collection in play, instead of for all five.

A caller that knows it wants them can skip the second call: `search_wlo_all` and
`search_wlo_collections` take **`includeSkillRegistry: true`**, whose description
states the cost so a model can weigh it. `WLO_REGISTRY_IN_SEARCH=1` makes that the
default where registries are widespread enough to be worth it. It then costs **two requests per collection** —
the children listing and the document — no matter how many skills are declared,
because the `:::` blocks already carry title and nodeId; descriptions and
keywords need one read per skill and stay with the tool. `getNodeDownloadText` is
called directly rather than `getSkill`, since the children listing already
supplied the node.

The other switch, `WLO_DISABLE_SKILL_SEARCH`, drops `search_skill` for a
deployment that reaches skills only through the collection approving them.
`get_skill` survives both — it is what the registry's node ids are for.

Disclosed rather than assumed: an ambiguous pick (several `ai_prompt` documents
in one collection), references naming no readable record, and a capped catalogue.
The ambiguity case is the RULE and not a corner case — measured 2026-08-10, all
28 skill records on staging are named `SKILL.md`, so the `SKILL_REGISTRY.md`
tie-break distinguishes nothing until the convention spreads, and the title rule
is what carries it. `docs/SKILLS.md` gains the editorial guide with an example
document.

**Measured before any of it was written** (staging, 2026-08-10; re-measure before
contradicting): `/children` carries `mimetype` in every projection but
`ccm:oeh_extendedType` **only when the request asks for it** — same node, same
call, empty under the default projection. A SKILL.md reports
`text/x-web-markdown`, not `text/markdown`. And **0 of 28** documents contain
`:::` at all, so that path is exercised by unit tests and not yet by any live
record — the live run waits on editorial work, not on code.

Tool count: **42** (28 read + 14 curation); 22 offer `outputFormat`.

### Added — the skill-registry cache: collection results carry their catalogue for free (2026-08-11)

Collection results now arrive with the skills their collection has approved.
A background service remembers, per collection, what its children listing said
and refreshes every 5 minutes; anything it does not know is resolved live, once,
and then remembered too. So the catalogue is always in the answer, and the
~1.0–1.4 s it used to cost is paid at most once per collection instead of on
every search. It is on by default (`WLO_SKILL_CACHE=off` disables it),
and it reaches every path that renders collections: `search_wlo_all`,
`search_wlo_collections`, `get_collection_contents`, `get_node_collections`.

**The cache is a memo of the CHILDREN listing, not of the search index.** That
distinction is the whole design. `CLAUDE.md` forbids resting an approval list on
the index — a record can fall out of it while sitting perfectly in the node store,
which a live collection did on 2026-08-09. So the tick calls the same
`loadSkillRegistry` the live path calls, and one `ngsearch` serves only as a
starting shot: the parents it names are QUEUED, never adopted. A remembered "no
registry here" therefore rests on a listing that replied, and may count as an
answer; a lookup that threw is remembered as nothing and simply tried again.

**No pre-built index of the collection tree, and that is measured**
(staging, 2026-08-11): level 1 holds 35 collections, level 2 holds 331, level 3
about 1335 — a full walk is ~1700 collections and ~3400 requests per cycle,
roughly 11 requests per second sustained on a five-minute schedule against a
shared instance. The queue is bounded by what callers actually ask for instead:
a search returns five collections, and the second time they cost nothing. The
first contact with a collection stays cold on purpose — blocking would be the
alternative — and the free pointer line covers it.

Two measurements made the seeding possible at all: one query returns the whole
skill corpus (28 records in 1175/1215/1322 ms over three runs), and every hit
already carries `virtual:primaryparent_nodeid` in the existing projection. What
it does NOT give is a collection: for harvested material that parent is the
spider folder (`dwu_spider`, `leifi_spider`), which is a `ccm:map` as well — so
the mapping is validated by looking up BY collection id rather than by any type
check.

Two things carry the speed. The warm-up adopts what the search corpus already
reveals — a hit is a record the index handed over, so a POSITIVE finding needs
no listing — while absence from the index is never treated as absence, because
that is the claim an index gap can fabricate. And the per-request live fallback
is bounded at ten pooled lookups, so a listing of fifty collections cannot turn
one request into a crawl; the rest is queued and honestly reported as unchecked.

`WLO_REGISTRY_IN_SEARCH` is **removed**; `includeSkillRegistry: true` now means
"force a fresh lookup instead of the remembered one", which matters right after
a registry is created or edited. New: `WLO_SKILL_CACHE`,
`WLO_SKILL_CACHE_REFRESH_MS` (default 5 min), `WLO_SKILL_CACHE_TTL_MS`
(default 10 min).

### Added — `variantPreset`: how a Themenseite comes up before anyone filters it (2026-08-11)

A user lands on a topic page with no filter and can then pick a role and an
education level. Measured against staging: that is neither a variant switch (the
URL carries only `?collectionId=`) nor a swimlane filter — **0** grid cells
reference a variable. The profile selector's INITIAL state is stored per variant,
in the `variables` block of `ccm:page_variant_config`:
`virtual:profiling_widget_intention` (`teach`/`learn`) and
`…_education_level` (educationalContext URIs, comma-joined in ONE string).

`search_wlo_topic_pages` now reports it as `variantPreset` — raw values plus
German labels, the same shape `targetGroup`/`targetGroupLabel` uses. It costs no
request: `ccm:page_variant_config` was already in the projection, because the
swimlanes come from the same document.

**It is a separate field on purpose, and that is the whole point.** The coverage
is tempting — 25/69 and 32/69 non-template staging variants against 17/69 and
21/69 for the official profiling properties — but the two sources overlap on
1 resp. 2 variants and **disagree in 3 of 3** of those (`targetGroup: learner`
beside `intention: teach`; `educationalcontext: [elementarbereich]` beside a
preset spanning sekundarstufe_1…erwachsenenbildung). They are different facts:
metadata ABOUT the variant against the initial state of a widget INSIDE it.
Using one as a fallback for the other would nearly double the reported coverage
while making the answer wrong invisibly.

What it is worth, live: a listing of 12 pages returned 15 variants, **13 of
which carry a preset while `targetGroup` was empty on all 15** — for those pages
the audience question had no answer at all before.

Not queryable upstream (`400 DAOValidationException` for both
`virtual:profiling_widget_intention` and `ccm:page_variant_config`), so it is
read from the config and filtered locally, like the other profiling fields.

### Fixed — subjects and education levels are shown under their official names (2026-08-11)

`Sekundarstufe i`. `Deutsch als zweitsprache`. `Mint` — for the MINT subject.
These were in every search result, because Fach and Bildungsstufe are printed on
every node.

The cause: one array does two jobs. `labels[0]` is both the display form and a
matching alias, and it was written all-lowercase for the matching half, while
`labelFromUri` only upper-cases the first character. Checked against the SKOS
source of record, **19 of 116** concepts were affected, including one that was
wrong beyond casing: `Umweltgefährdung, Umweltschutz` had lost its comma.

Every display form now comes from the concept's official German prefLabel. The
matching is untouched — every matcher lowercases both sides, so casing is free —
and the one label that changed by more than casing keeps its previous spelling as
an alias, so a caller who types it still resolves.

`tests/vocabs.test.ts` pins the values with their source, and a second test pins
the aliases that must survive. What proved the change reaches real output is the
topic-page test that had pinned `Sekundarstufe i` as measured reality: it failed,
which is what it was for.

A second pass over the remaining four tables found **4 more** — all in the
aggregated LRT vocabulary, `Interaktives medium`, `Projekt-material`,
`Entdeckendes lernen`, `Kreative aktivität`. The first pass had missed them
because it asked for a vocabulary key that does not exist (`learningResourceType`
rather than `lrt`) and swallowed the throw. **23 of 152** concepts in total.

The same pass also established what is NOT a defect. Nine aggregated-LRT display
forms are shortened on purpose — `Tests` for `Tests / Fragebögen`, `Event` for
`Event, Wettbewerb` — and every dropped part exists as a matching alias, so the
shortening costs nothing and lengthening it would be taste overruling a
maintained decision. Only the casing was fixed. And `vocabs-lrt.ts` is a verbatim
copy of its source: **220 of 220** labels identical, which is what makes the
hand-curated aggregated table the exception rather than the rule.

A test now fails ANY label whose continuation is lowercase, so this cannot return
through a new entry — verified by injecting `Darstellendes spiel`, which it named.

Where this actually shows: `formatNode` prefers the server's
`<property>_DISPLAYNAME` and only falls back to this table, so a normal hit list
usually carries the repository's label. What is rendered from our table alone —
and was therefore wrong — is the facet breakdown, the licence,
`lookup_wlo_vocabulary`, and the topic-page fields built from raw URIs, including
`variantPreset.educationLevelLabels`.

Both places are measured against staging, not merely reasoned about:
`lookup_wlo_vocabulary` returns all four corrected LRT labels, and the facet
breakdown — the one path with no `_DISPLAYNAME` at all — now reads
`Sekundarstufe I (22 504)`, `Berufliche Bildung (1 838)`. The two GENERATED
tables were checked against their sources as well and are clean:
`vocabs-lrt.ts` 220/220, `vocabs-hochschule.ts` 344/344 identical.

### Changed — `topic-page-variant.ts`: what a variant IS, apart from how it is fetched (2026-08-11)

`topic-page-api.ts` had grown to 389 lines around two jobs: the rules and shapes
of a page variant, and the repository calls that find one. Split along that seam.

The numbers are why it was worth doing rather than a matter of taste. **8 of its
13 importers needed only the rule half** — a type, a filter predicate, a property
list — and were pulling in the HTTP module for it. One of those eight was
`topic-page-title.ts`, whose type import pointed back at the module that imports
it: the one import cycle in this corner. `pickThemePageTitle` moved beside the
type it operates on, and `topic-page-title.ts` now imports nothing at all.

`TOPIC_PAGE_PROPS` sits next to `variantFields` on purpose: adding a field to the
projection without adding it to the property list reads back empty with nothing
failing, and in one small module that pairing is visible.

Behaviour-preserving by construction — code moved, nothing rewritten — and
checked rather than assumed: 1757 tests, and a live run against staging producing
the same comparison across both search routes as before the move. Nothing needed
a barrel; every importer now names the module it actually depends on.
`tools/shared.ts` still re-exports `pickThemePageTitle`, so no tool changed.

### Changed — one variant, one description, whichever search mode found it (2026-08-11)

A page variant is reached on two independent routes — a collection's
`ccm:page_config_ref` down to its config folder's children, and the page_variant
index walked back up — and each carried its own copy of the same seven property
reads.

They had drifted on the one field of the seven that needs a rule rather than a
read. `variantTitle` is documented as the value that keeps the technical
`PAGE_VARIANT_<uuid>` string off a screen, and 22 of 68 staging variants carry
exactly that string in `cclom:title`. One route ran it through
`displayTitleOrEmpty`; the other returned it raw. It stayed invisible only
because `pickThemePageTitle` checks again downstream — the broken promise sat one
consumer short of a visible bug. Adding `variantPreset` is what exposed the
duplication: the field had to be written into both copies by hand.

The projection now lives once, as `variantFields` in `topic-page-api.ts`, beside
`variantMatchesFilters` and for the same reason. Page-level facts —
`topicPageUrl`, `collectionId`, `collectionName`, `isDefault` — deliberately stay
out: the two routes genuinely learn those from different places.

`tests/shared-rule-discipline.test.ts` fails a second copy, and a new test drives
the same variant through both routes and compares. Verified live against staging:
four pages compared across both routes, identical on all of them.

### Changed — the approval list is shown in full, and the tool carries 100 (2026-08-11)

Two decisions that interlock; changing one without the other makes a sentence in
the output false.

A search result listed at most **4** of a collection's approved skills and
counted the rest ("… und 3 weitere"), on the grounds that five collections
carrying thirty skills each is a wall of text where a search result should be.
That traded away the wrong thing: an approval list showing four of nine is
exactly the "short list standing for a long one" shape this project refuses
everywhere else, and the entry a model needs may well be the fifth. The listing
now shows the **whole** catalogue, up to the `REGISTRY_MAX` of 30 that the
service already applies before a renderer ever sees it.

The head line changed with it. It used to promise the full list "vollständig mit
`get_skill_registry`" — pointing at a round-trip for something the caller was
just handed. It now names what that tool actually adds: descriptions, keywords
and the editors' prose. And when the SERVICE capped the catalogue, the line says
plainly that `get_skill_registry` cannot close that gap either, because it caps
at the same number:

**Second: the catalogue cap is now per tier.** It was a single 30 for both, so a
capped listing could promise nothing — `get_skill_registry` returned the same
thirty, and the pointer beside the listing led to an answer no larger than the
one already given. The cap now follows the tier, and the tier is `resolveHeads`:

| Tier | Cap | Why |
|---|---|---|
| Listing (`resolveHeads: false`) | `REGISTRY_SEARCH_MAX` = 30 | five collections in one answer have to stay readable; equal to `REGISTRY_LINES_MAX`, so a listing is always complete for what it carries |
| Tool (`get_skill_registry`) | `REGISTRY_MAX` = 100 | one explicit call about one collection; a curated list of sixty is a legitimate thing to declare |

The tool tier fetches one metadata record per skill, pooled at 10 — extrapolated
from the 2026-08-10 measurement (28 records in 1095 ms), a full hundred lands
around 4 s, paid on request rather than per search.

The head line follows from the pair, and says something different in each case:

> 9 freigegebene Skills, alle hier gelistet; Beschreibungen und
> Redaktionshinweise mit `get_skill_registry`

> 44 freigegebene Skills, hier die ersten 30, mehr mit `get_skill_registry`

Never "alle mit get_skill_registry": past 100 the tool caps as well, and a
promise beside a declared 140 is one it cannot keep.

### Fixed — the documentation now agrees with the server, and a test keeps it that way (2026-08-11)

**Twelve wrong numbers across five documents.** The tool counts had drifted apart
so far that README.md contradicted *itself* — "28 read tools" in the opening,
"27 MCP read tools" fifty lines later, "registers all 39 tools" in the file tree.
`docs/TOOLS.md` headed its sections "Lesende MCP-Tools (27)" and "Kuratierende
MCP-Tools (13)" over a table of 28 and 14. The truth, measured: **42 = 28 read +
14 curation**, and 41 under `WLO_SKILL_TOOL_MODE=one-tool`.

**One of them was not stale but false.** Both READMEs told a reader that an
anonymous request gets "25" / "27" public tools. It gets all 42 — the curation
tools included, listed for everyone and refusing at call time, which is the whole
mechanism by which a host learns to offer the login. That is the claim
`docs-claims.test.ts` already forbids in prose, walking past the check in the
shape of a digit. Both sentences now say what happens and why.

**`get_skill_registry` was in no README.** It shipped on 2026-08-10; the
reference had it and the two documents people actually open did not.

**Two documented parameters do not exist.** `search_wlo_collections` was
documented with `userRole?` (it has none — `search_wlo_content` does, and the
entries are adjacent) and `get_node_collections` with `maxResults?`. A model
reading either sends an argument the schema rejects.

Three new tests in `tests/docs-claims.test.ts` derive all of this from the
running server, so the documents cannot drift again: no stated count may
contradict `tools/list`, every registered tool must be named in the reference and
in both READMEs, and no `` `name?` `` in a tool entry may be a parameter the
schema does not have. Each was verified to fail on a deliberately introduced
regression. One of them passed for the wrong reason first — a bare `\n\n` in the
entry-splitting regex matched **zero** entries against these CRLF files, so it
checked nothing; it now asserts its own scan found something before trusting it.

### Added — skill handling, documented where people look

Both READMEs gain a **Working with skills** section (three tools, three
questions), the missing `get_skill_registry` entry, and a **skill-registry
cache** section: what the background cache is, why a "no registry" only ever
rests on a children listing, why a failed lookup is remembered as nothing, and
why a file listing cut short at 50 settles nothing. `docs/TOOLS.md` gains the
same as a decision table, `docs/SKILLS.md` the corrected scope of
`WLO_SKILL_CACHE=off`. Newly documented in the env table:
`WLO_SKILL_TOOL_MODE`, `WLO_SKILL_CACHE`, `WLO_SKILL_CACHE_REFRESH_MS`,
`WLO_SKILL_CACHE_TTL_MS` — the last three had shipped undocumented in both
READMEs, one of them on by default.

### Fixed — two bounds that bit without saying so (2026-08-11)

**The unsafe-tool notice is a startup notice again.** Found by a live smoke run,
not by a test. The warning that names each tool declared `unsafe` says in its own
comment that it exists so an operator sees it "at startup" — but registration
runs once per `createMcpServer()`, and the Streamable HTTP transport builds one
per REQUEST. Measured against a live server: one start, six identical warnings
for six requests; at the configured 120 rpm that is 120 lines a minute, which is
how a real warning stops being read. Both unsafe-tool notices are now emitted
once per process, keyed by tool name so a second unsafe tool still gets named —
the notice exists to say which ones are switched on. Re-measured after the fix:
8 requests, 1 warning.

**A skill corpus larger than one page now says so.** The cache's starting shot
reads one page (`CORPUS_PAGE_MAX = 100`); staging holds 28 records, so the bound
does not bite today, but past it the collections simply lose the fast path. The
numbers were in an info line and nothing marked the inequality — the same
invisible incompleteness this module already warns about at its queue cap and
its scan cap. It now warns when the corpus does not fit.

### Fixed — eight review findings on the skill-registry cache (2026-08-11)

**A scan that hit the file cap is no longer cached as "this collection has no
registry".** `loadSkillRegistry` reports `scanTruncated` when it read 50 of a
collection's 400 files, precisely so a null result cannot pass for a finding of
absence — and both cache paths discarded it. The negative was then held for the
TTL and re-affirmed by every refresh, because the same first page comes back each
time. It is now carried into the entry: remembered, so the capped page is not
re-read on every tick and every request, but not counted as answered, so the
caller keeps its pointer to `get_skill_registry`. The tick reports it separately
(`inconclusive`).

**`WLO_SKILL_CACHE=off` now switches off what it says it does.** The guard sat
only on the background timer, so the per-request live fallback kept running: an
operator who flipped the switch for the cost got the worst of both — every
request paying the full children listing, and with no tick to expire anything, a
queue filling to its cap and warning forever. `ensureRegistries` returns 0
immediately when the switch is off, which is what `.env.example`,
`docs/SKILLS.md` and the startup log line already promised.

**`CACHE_MAX_ENTRIES` exists.** The design named it as the mitigation against
"the queue as a memory lever" and only `QUEUE_MAX` had been built. Entries are
now bounded at 2000 — above the ~1700 collections this repository holds, so it
does not bite in practice — and eviction drops the answer checked longest ago,
with a log line rather than silently.

**One mapping, not four.** The eight lines turning a `SkillRegistry` into the
field a result node carries were copied across the live fallback, the tick, the
seed and `enrichSkillRegistry`. They are now `toRegistrySummary`, whose return
type is `FormattedNode`'s own field rather than a second declaration of the same
shape, and `tests/shared-rule-discipline.test.ts` fails the fifth copy.

Also: the corpus seed no longer overwrites an answer the children listing already
gave (the index may only ever produce a positive for a collection nobody looked
at); two concurrent requests for the same cold collection share one lookup
instead of firing two; and `checkedAt` is taken after the lookup returns on both
write paths rather than before it on one of them.

### Fixed — seven review findings on the skill registry (2026-08-10)

**A registry is recognised by the canonical title chain, not by one property.**
Detection read `cclom:title` alone, while `cm:title` sits in the same projection
and is second in `nodeTitle` — the chain every other consumer uses, and the
carrier this repository has measured as the one actually set. A registry titled
there was invisible, and with a second `ai_prompt` document present the nodeId
tie-break then answered with the **wrong document's catalogue**. Every test
fixture went through `makeNode`, which writes only `cclom:title`, so the suite
validated the implementation's choice rather than the repository's reality.

**The pointer belongs to an answer, not to a list.** It was emitted inside
`renderToText`, so `search_wlo_all` — three rendered lists, and topic pages are
`ccm:map` and format as collections — printed it twice, and printed "nicht
geprüft" directly under a bucket where the registry HAD been looked up.
`get_related_content` renders two lists and had the same shape. `registryHintFor`
is now exported, composed answers suppress the per-list hint and emit it once,
and `searchAll` reports **`collections.registryChecked`** — because a collection
without a registry carries no field, so the results alone cannot tell "not looked
up" from "looked up, none there".

**A capped scan no longer claims absence.** The lookup reads 50 file children;
`pagination.total` was discarded, so a larger collection whose registry sorts
past that page was told "diese Sammlung führt keine Skill-Registry". It now
reports what it read of what there was, and logs it.

Also: the three tool descriptions carried the superseded 0,5–1,3 s estimate where
a model decides whether to pay — corrected to the measured **1,0–1,4 s** and
pinned by a test; a truncated registry no longer promises "alle mit
`get_skill_registry`", which caps at 30 itself; `/api/search?format=html` renders
the registry it was already paying for instead of dropping it, while the ChatGPT
`search` tool declines the lookup its schema cannot carry; and the tool's JSON
output carries the same untrusted-source note as its Markdown view.

### Added — `docs/AUTH-CONCEPT.md`, the authentication concept and its alternatives (2026-08-09)

`AUTH.md` documents how the mechanism works; nothing explained **why** it looks
like that, and the pre-OAuth decision paper had become history. This closes that:
a TL;DR that carries the whole argument, the three access modes the brief
required side by side, what is done for security, and a comparison against every
alternative — relaying a token, a password vault, a session store, edu-sharing's
app signature, OAuth without the paste route, and forcing anonymous callers
through a 401. Each says why it was not chosen and what our design took from it.
The constraint everything follows from — edu-sharing has no token to relay, so
every scheme carries the password — sits in the TL;DR rather than in a chapter
of its own.

Two sections deliberately included: what the concept does **not** protect (a
block is a bearer credential, it does not expire, we see the password once), and
the one alternative that would be **better** than ours — WLO enabling OIDC, which
is an organisational ask, not a code change.

### Fixed — two descriptions of an architecture that no longer exists (2026-08-09)

Found while writing the concept document, and confirmed by starting a server:
`createMcpServer` takes `{ issuer }`, not a write mode, and all 14 curation tools
are listed for every caller including anonymous ones. Both `CLAUDE.md` and the
header comment of `services/write/credential-gate.ts` still described the
reversed design — registration gated by write mode, write tools absent from
`tools/list`. That was deliberately reversed on 2026-08-05 (a tool nobody sees is
a login nobody starts); only the descriptions were left behind.

### Added — `docs/INTEGRATION.md`, the handover for team & chatbot developers (2026-08-09)

One document answering the three questions an integrator actually has: which
tools exist (all 41, grouped), which URLs can be called from outside (MCP, REST,
user-facing pages, OAuth, access block), and which behaviour an integration has
to know — licence family vs. exact matching, the disclosure fields
(`licenseFilter`, `unresolvedFilters`, `truncated`/`collectionTotal`), the
two-step write, the limits, who may do what, and a section on what deliberately
does **not** exist, so nobody plans on it. Plus a troubleshooting table keyed by
symptom.

The tool list and every route in it were produced by starting a server and
routing real requests, not by enumerating from memory.

### Fixed — five stale tool counts across the docs (2026-08-09)

`wlo_set_topic_page` was added as the 14th curation tool and the counts were
never carried over: both READMEs said "thirteen"/"dreizehn", the German one also
said "25 öffentliche Werkzeuge" (27), and `docs/TOOLS.md` said "40 MCP-Tools" and
"13 kuratierende" in four places. The tool itself was documented everywhere — only
the arithmetic was stale. Measured against a running server: 41 = 27 + 14.

Also corrected: a comment in `http-app.ts` claimed the request-body cap defaults
to 1 MB. There is no default there at all — the entry point hands in
`MAX_BODY_BYTES`, 4 MiB, which is what every other document already said.

### Fixed — two deferred Themenseiten defects (2026-08-09)

Both were recorded as open, described as defects, and postponed as effort. Neither
turned out to be a design question.

- **A `PAGE_VARIANT_<uuid>` placeholder could be displayed as a page title.**
  `cm:title` was excluded as a fallback because it holds that technical string on
  109 of 109 production variants — but `cclom:title`, the field we trusted, holds
  it on **22 of 68 staging variants**: a page nobody renamed keeps it there too.
  It reached `variantTitle`, and from there the REST response, `structuredContent`
  and the widget heading. The rule now checks the VALUE rather than the field, at
  both places the value is read from the repository.

  It also reached the confirmation preview of `wlo_set_topic_page`, which is worse
  than a display glitch: the confirm token binds to the sentence naming page and
  variant, so a person could be asked to approve a change to a technical id they
  cannot check. All three sentences in that path now share one naming rule
  (`nameOf`) — real title, else the id. Two of them previously had no fallback.

  `isPlaceholderTitle` moved from `tools/shared.ts` to the leaf module
  `src/topic-page-title.ts`, which is the remedy `tests/shared-rule-discipline.test.ts`
  names for exactly this — a lower layer must not import from `tools/`. Same move
  `mapPool` and `buildFilterCriteria` made before it.

- **`search_wlo_topic_pages` passed an unresolvable vocabulary filter on as raw
  text.** Compared against URIs it never matched, so only variants declaring NO
  educational context survived — a typo silently hid nine pages in ten, with no
  notice. It is now dropped and reported through the same `buildFilterCriteria` /
  `formatUnresolvedHint` pair the five other search tools use. `_queryMeta` no
  longer lists it as an applied criterion either; the comment above that builder
  already stated the rule for `ngsearchword`.

### Fixed — `/api/collection` ignored every filter unless `q` was given (2026-08-09)

Found by the pre-deploy review and measured before fixing: `?nodeId=…&license=OER`
over three children returned **all three** — a CC BY-NC-ND record and one with no
licence at all — with no `licenseFilter` to show that anything had been dropped.
A query-less call went to the plain listing, which takes no filters.

Matching never needed a query (`searchWithinCollection` treats an empty one as
"all contents", which is why the MCP tool was always correct here), so the branch
now asks whether there is anything to match at all. The filter-less, query-less
case keeps the plain listing: it pages upstream, while local matching reads one
bounded page of children.

That bound is now disclosed too. The matched path adds `truncated` +
`collectionTotal`, the same fact the MCP tool states in words — without it a
filtered answer over a 900-item collection read as exhaustive, and this fix
widened how many calls take that path.

### Fixed — the licence disclosure was missing on both REST paths (2026-08-09)

"Every path that accepts `license` discloses its exactness pass" was written down
the same day it was broken on two of the five paths. Both are in `rest/`, and
both share one cause: **an envelope field is not a disclosure if the renderer
drops it.**

- **`GET /api/search?format=html` said nothing about the licence filter.** The
  JSON view discloses through `content.licenseFilter`; the HTML view — the most
  visible of all the paths, and the one an AI browsing pipeline actually reads —
  rendered neither number. A filter that removed every candidate showed up as a
  bare "Keine Treffer.", over material that is demonstrably there (staging holds
  18 793 OER records for `Mathematik` alone). The page now carries the same
  sentences the MCP tools emit, through the existing `warnings` strip. The counts
  are read from the UNPROJECTED envelope: `fields=…` may drop `licenseFilter`,
  and a disclosure that vanishes when a client trims the response is none.
- **`GET /api/collection?q=…&license=…` returned only its post-filter `total`.**
  Indistinguishable from an empty collection. It now carries the same
  `licenseFilter { checked, kept }` contract as `/api/search`.
- **A doc comment repeated the `virtual:primaryparent_nodeid` claim** that the
  backend answers with 400 (live-probed 2026-07-17) — the same wrong mechanism
  already corrected in both READMEs. `handleCollection` matches locally against
  the collection's direct children.
- The two REST response shapes and the licence disclosure are documented in both
  READMEs; neither had mentioned `licenseFilter` at all.
- **The search-results widget explains an empty grid the licence filter caused.**
  The third renderer of the same envelope, and it had the same gap: "Keine
  Treffer gefunden." over material that exists. The empty state now names the
  licence and how many candidates were checked, localized DE/EN through the
  widget's own string table (no German sentence leaking into the English UI).
  Only the emptied case — when results are shown the user sees material, and the
  tool's text block carries the exact counts.
- **`content.licenseFilter` is emitted only when the content leg actually ran.**
  With `include: ['collections']` the field used to appear as
  `{checked: 0, kept: 0}` — which reads like a filter that emptied the bucket
  rather than a search that never happened. Its presence now means "a licence
  pass happened here", which is what makes it usable as the single gate for the
  disclosure sentences. `search_wlo_all` and the HTML page both gate on it;
  re-deriving the condition from `include` at each call site was a second copy
  of one rule.

### Fixed — five things the reviews had named but left standing (2026-08-09)

Everything the two review rounds listed as an observation or a known limitation,
worked through rather than carried forward.

- **`search_wlo_all` filtered by licence and never said so.** The third search
  path with a `license` parameter, and the last one that dropped candidates
  silently: the pass runs inside `searchAll`, and the envelope carried no number
  the tool could have reported it with. `content.licenseFilter {checked, kept}`
  now travels with the envelope (REST included) and the tool renders the same
  notice the other two paths give. Neither `count` nor `total` could stand in —
  one is post-cap, the other is the corpus figure.
- **A facet answer that may be truncated is no longer trusted as a total.**
  `ngsearch` asks for at most `FACET_LIMIT` (20) buckets; a full list means the
  aggregation MIGHT have been cut, and a sum over it understates the corpus while
  looking exact. It falls back instead. Staging holds 16 distinct licence keys,
  so this does not fire there — that is a property of one instance, not of the
  format, which is why the limit is now one exported constant.
- **Paging over the OER bundle says that it is not a continuation.** The bundle
  hands the same `skipCount` to each of its five keys, so page two is "the second
  page of every licence" — material repeats and material is skipped. There is no
  fix at this layer (one ordering across five result sets is not something the
  repository can produce), so the notice names the condition and points at
  `excludeNodeIds`.
- **The OAuth surface no longer spends the password budget on machine traffic.**
  Four of the requests one login costs — both discovery documents, the
  registration, the token exchange — come from the CLIENT's address, and a hosted
  connector serves many users from few egress addresses. Those now use the same
  budget the MCP endpoint gives that same client, while `/oauth/authorize` keeps
  the tight `/auth*` bucket, because that is where a password is typed.
- **The consent screen ranks the checked fact above the claimed one.** Open
  registration means `client_name` is whatever the caller typed, so the page led
  with an invented value and listed the verified redirect target below it as an
  equal row. The destination now comes first and carries the emphasis; the name
  is labelled as self-declared, with one line saying which of the two decides.

### Fixed — an access block had no length bound, and the code store retains one (2026-08-09)

Found reviewing the OAuth surface (T5.3). `decodeAccessToken` checked the shape
of a `wlo2.…` block but not its size, and the payload takes arbitrary padding:
measured, a block carrying a 1 MB junk field is 1 333 836 characters and **decodes
successfully** — `validatePayload` drops the unknown field from the returned
object while the caller keeps the string it was handed.

That matters because `/oauth/authorize` RETAINS the string: the authorization-code
store bounds the number of records (1 000) and not their size, and the block
arrives in a request body capped at `MAX_BODY_BYTES` (4 MiB). A holder of one
valid WLO account could therefore have up to 4 GB held for the code's 60-second
lifetime. Availability only — nothing is disclosed — but the answer is an
OOM-killed process.

`MAX_BLOCK_CHARS = 4096` now bounds it in `decodeAccessToken`, the one place every
path decodes a block (the paste route, the `Bearer` header, the OAuth consent), so
the oversized input is refused before an RSA operation runs over megabytes. A real
block measures 573 characters locally and 605 against the deployed instance's
RSA-2048 key; the bound leaves room for an RSA-4096 rotation.

Two smaller things from the same review: `/oauth/register` is now reached by an
explicit path comparison rather than by elimination (a path added to `ROUTES`
without its own branch would have become client registration silently), and the
two OAuth log sites that named a WLO user pass it through `sanitizeText` like the
four others — the logger's JSON encoding already closed line forging, so this is
the length cap and the rule reading the same way everywhere.

### Fixed — the licence filter reported a count that did not exist (2026-08-09)

A review of the OER fan-out shipped the same day found three defects, all
live-verified on staging before and after the fix.

- **The reported total counted the same records twice.** The bundle summed the
  five keys' `pagination.total`, but `ccm:commonlicense_key` matches a licence
  FAMILY and the CC_BY family *contains* CC_BY_SA — measured on `Mathematik`,
  family 27 351 against exact 3 848 + 9 554. The sum also carried the NC/ND
  records, which are not OER at all. Overstatement: **+98 % to +164 %**
  (`Mathematik` reported 37 851 where 14 343 is true). A single licence had the
  same defect one size smaller: `Optik` + CC BY reported the family's 343 over a
  list of 42. The total now comes from a facet aggregation that counts EXACT keys
  server-side (`exactLicenseTotal`) — one extra request, and only when a licence
  is filtered. Facet buckets are matched through `resolveVocab`, the same
  resolution the node filter applies, so the count and the list it describes
  cannot disagree: staging holds `CC BY-SA` spelled with spaces as its own key,
  and those records are kept by the filter and counted by the total (Optik +6,
  Musik +1). A failed aggregation falls back to the previous number rather than
  failing the search.
- **`search_wlo_within_collection` did not apply the OER bundle at all.** That
  path matches filters locally, and a licence SET contributes no criterion to
  match — so `license: "OER"` returned everything, including CC BY-NC-ND and
  records with no licence declared. It now runs the same exactness pass as the
  other two search paths (live: 44 → 42 and 10 → 9 on real collections), and
  renders the same "why is this empty" notice, because a licence pass that can
  empty a result must say so — otherwise the existing hint sends the caller into
  the sub-collections while the material is right there under another licence.
- **A total upstream failure was reported as "no hits".** If all five fan-out
  requests failed, the merged result was empty and indistinguishable from "there
  is no freely reusable material on this topic". It now throws, like every other
  search path.

The caller-visible notice was corrected with it: the total no longer "names all
hits of the search" — it names the records with exactly the requested licence.

### Added — `wlo_set_topic_page`: choose which variant a Themenseite renders (2026-08-09)

The 14th curation tool, and the first whose result is immediately public: it sets
`default` in the page builder's `ccm:page_config` document, which decides what a
visitor of the topic page sees. It creates, deletes and reorders nothing.

**The repository validates none of this, so every guarantee is local.** Measured
on staging: `POST …/property?property=ccm:page_config` answered 200 for the
literal string `"not json at all"` and stored it verbatim, and accepted the
property on a `ccm:io` that is never a page-config folder. A malformed document
does not fail at the API — it fails in the page builder, on a public page. So:

- The stored document is **edited, never composed** (`setDefaultVariant`).
  Unknown keys and the variant list survive untouched; 28/28 real documents carry
  a `variants[]` that a fabricated document would drop.
- `default` is written as a **store ref** (`workspace://SpacesStore/…`), matching
  28/28 existing documents. Only 2/28 carry a `default` at all, so setting one
  normally adds a key.
- A variant that is not a usable child of *this* page's config folder is refused,
  and an unreadable child listing is refused as unreadable rather than as "no
  such variant".
- An unparseable stored document is left alone — overwriting it would silently
  drop an editor's variant list.
- The read-back compares the **parsed** document, not the string: the repository
  stores whatever it is handed, so matching bytes would only prove it echoed us.
- Asking for the variant that already renders is refused rather than written
  again. The other tools get this from `buildChangeSet`, which drops unchanged
  fields; this change has none. Only an explicitly recorded `default` counts —
  with none the page renders `variants[0]` by position, so writing that same
  variant down is a real change and is allowed.

The confirmation token binds to the sentence naming page and both variants with
their ids, not to the property value — a document of store refs is not something
a person can check in a preview, and any upstream change that alters the outcome
re-plans to a different sentence and invalidates the token.

Live-verified against staging on a topic page the probe built and deleted itself:
preview → confirm → `default` set, switch back, a foreign variant refused with
the document unchanged, and `get_topic_page_content` reading the result back.

### Not built — `wlo_register_usage`: the repository gates it on an app signature (2026-08-09)

`POST /usage/v1/usages/repository/{repositoryId}` answers **403
`app signature required to use this endpoint`** for an authenticated service user
— for every `appId` tried and for an empty body, so the gate sits before the body
is read. With the four `X-Edu-App-*` headers present but bogus it answers **500
`Signature could not be verified!`**, including with a registered app id: the
signature is genuinely verified and needs the private key of an application
registered at the repository. `prepareUsage` answers 200 but records no usage.
The read side (`GET /usage/v1/usages/node/{id}`) works and currently returns
nothing anywhere.

Obtaining such a key is not a code change: an edu-sharing app signature lets its
holder act on behalf of arbitrary users, which reverses this server's auth design
("there is no token to relay; nothing more powerful than the user's own
credential rests on our disk"). Left as an operator decision.

### Fixed — the OER bundle answered "no hits" over tens of thousands of OER records (2026-08-09)

`license: "OER"` cannot be expressed as one upstream criterion, so the first
version sent none and filtered the generic result page locally. Measured with
server-side facet counts the same day, that was not a weak filter but a wrong
one: staging's `Mathematik` holds **18 793** records carrying an OER licence —
41.9 % of everything with a licence at all — and the tool replied **"kein Treffer
mit genau der Lizenz OER"**. The first fifty hits by relevance carried no
`ccm:commonlicense_key` whatsoever (50/50 absent in the plain search; 23× CC
BY-NC-SA and 2× CUSTOM through `enhancedSearch`). Relevance ranking and licence
are unrelated, so the top of one is no sample of the other.

Each key on its own *does* narrow upstream, so the bundle now fans out over its
five keys and merges (`src/services/license-search.ts`). Five requests instead of
one, and only for the bundle — a single licence and no licence stay at one call
each. Measured after the change, same queries:

| Query | Candidates checked | With an exact OER licence |
|---|---|---|
| Mathematik | 50 → **152** | 0 → **127** |
| Optik | 40 → **140** | 2 → **107** |
| Musik | 25 → **104** | 0 → **102** |
| Klimawandel | 50 → **97** | 0 → **94** |

The merge is **round-robin, not concatenation**, and that too came from a live
run: appending the five result sets handed the whole result cap to the key listed
first, so `Mathematik` + OER returned six hits that were all CC 0 — the rarest of
the five at 191 records — while the 11 563 CC BY-SA ones never reached the page.
There is no ranking across the five sets, so each key contributes its best hit
before any key contributes its second. After the change the same six hits carry
CC 0, Public Domain Mark, Urheberrechtsfrei, CC BY 4.0 and CC BY-SA 4.0.

### Added — licence filter on `search_wlo_content`, `search_wlo_all` and `/api/search` (2026-08-09)

A `license` parameter, taking a label ("CC BY 4.0", "gemeinfrei") or the
repository key ("CC_BY"). Resolved in `buildFilterCriteria`, so both search
tools, the `searchAll` service and the REST layer gain it at once, including the
existing "did you mean" reporting for a value that does not resolve.

**The repository filters by licence FAMILY, so exactness is enforced locally.**
Measured on staging: `ccm:commonlicense_key=CC_BY` returns 343 hits for "Optik"
including CC BY-ND, CC BY-NC-SA and CC BY-NC-ND; quoting changes nothing. The
same holds one level down (`CC_BY_NC` 172 covers its NC-SA and NC-ND variants),
while `CC_BY_SA` (110) and `CC_BY_ND` (19) are leaves. Plain **CC BY is the one
licence that cannot be isolated upstream** — the one people filter for when they
intend to remix, and the surplus is *more* restrictive than requested. Passing
the criterion through alone would answer "may I remix this" with No-Derivatives
material, so `filterByExactLicense` keeps only exact matches.

That pass starves without headroom: the first live run returned **zero** results
for CC BY 4.0, because the page of ten from those 343 held no exact record.
`pageSizeForLicense` therefore widens the candidate window to 50 — only when a
licence is filtered, because only there is the over-match systematic. After the
change, `Optik` + CC BY 4.0 returns CC BY 4.0 and nothing else.

**`license: "OER"` is the one bundle beside the individual licences**, covering
`CC_0`, `PDM`, `COPYRIGHT_FREE`, `CC_BY`, `CC_BY_SA`. NC and ND are deliberately
out: ND forbids revision and NC restricts reuse, so including them would answer
"may I adapt this?" with material nobody may adapt — the same failure the family
over-match caused.

The bundle sends **no** upstream criterion, and that too was measured rather than
assumed: the OR that works on `ccm:oeh_extendedType` does not transfer. Two
values at `ccm:commonlicense_key` answer **400 DAOValidationException**, the
criterion repeated twice **AND**-s (343 + 110 → 110), and an "A OR B" string
matches 0. Narrowing on `CC_BY` instead would keep both CC members but silently
lose every public-domain record — and the live run proves that matters: `Optik` +
OER returned CC BY 4.0, CC BY-SA 4.0 **and** an `Urheberrechtsfrei` item.

**An emptied licence result now says why.** Live, `Optik` + CC BY-NC 4.0 reports
172 backend hits and returns none, because the checked candidates held only its
NC-SA and NC-ND relatives. A bare "0 Treffer" reads as "there is nothing", which
is false, so `licenseFilterNotice` names how many candidates were checked and why
the total still differs.

`search_wlo_within_collection` takes the filter as well — the package contract was
widened for it. Its filters are matched locally against the stored property
(`nodeMatchesCriteria` → exact `includes`), so the family over-match does not
apply there at all.

One limit stated plainly: the candidate window is 50, so a family-heavy query can
still come back short — and now says so.

`resolveVocab` now also matches a vocabulary's own id, not only its labels —
without it, "label or the raw repository value" (what every filter description
promises) held for every vocabulary except licences, whose ids are bare keys
rather than URIs.

### Added — `WLO_SEARCH_OUTPUT_MODE=rich`: `search` **and** `fetch` stop being lean dead ends (2026-08-09)

`search` may now carry the same buckets, the same per-hit metadata and the same
results widget as `search_wlo_all`; `fetch` carries the full record and renders
the same detail view as `get_node_details`. Off by default (`lean` = today's
behaviour). Both tools, because `search` → `fetch` is one flow: enriching only
the first step leaves the second rendering nothing, which is the fallback this
was meant to remove.

What `fetch` was missing, measured against `get_node_details` on the same node:
`compendiumText`, `contentUrl`, `description`, `downloadUrl`, `fileSize`,
`keywords`, `mimeType`, `previewIsIcon`, **`previewUrl`**, `topicPageUrl`,
`userRoles` — eleven fields, the preview image and the download link among them.
Rich adds the node in the `nodeListSchema` shape the widget already renders.

Descriptions now delimit in **both** directions, on the property that actually
separates the tools: `search_wlo_all` is the only search tool with filters, and
`search` takes a bare query by convention, so a request naming a subject, level,
media type or publisher belongs to `search_wlo_all` — it "would silently ignore
the narrowing" otherwise. Making room for that sentence meant shortening
`search_wlo_all`'s mechanics tail: at 1219 characters `tests/tool-descriptions.test.ts`
failed the 1024-character truncation guard, and the new guidance sat at the end
where truncation would have eaten it first.

**Why the two tools cannot simply be merged, which was the original question:**
the convention gives `search` a *single* `query` string
([OpenAI](https://developers.openai.com/api/docs/mcp)). `search_wlo_all` has 18
input parameters and `get_node_details` 5, so folding either into its
convention counterpart would delete 17 resp. 4 capabilities — filters, paging,
facets, and every opt-in enrichment. Measured contrast: `Bruchrechnung` with
`learningResourceType: Video` + `educationalContext: Sekundarstufe I` returns 195
Sek-I videos; the same query with no parameters returns 1331 hits headed by a
university prep course. Output and display, however, do NOT depend on the input
schema — which is exactly what this mode copies.

`results` stays first and each item keeps exactly `{id, title, url}`; rich only
adds sibling keys. `tests/tools-knowledge-rich.test.ts` re-asserts that shape in
every mode, because the risk here is invisible from our side: OpenAI's docs
neither permit nor forbid extra keys, and a third-party report describes
connectors discarding "any or all items" that do not match — which would make
`search` return nothing in Deep Research, silently. Hence an env switch:
reverting is a variable, not a deploy.

Live check with the built server against staging, whole `search` → `fetch` flow:

```
[lean] widget: search=none    fetch=none
[lean] fetch keys: id, title, text, url, metadata
[lean] preview=no  download=no  description=no
[rich] widget: search=WIDGET  fetch=WIDGET
[rich] fetch keys: id, title, text, url, metadata, total, count, results
[rich] preview=YES download=YES description=YES
```

`search` in rich mode: top-level keys `results, query, content, collections,
topicPages`; result items exactly `id, title, url`.

**Payload: the cost is accepted deliberately, but not the part nobody asked
for.** The convention sends the same JSON twice (`content[0].text` **and**
`structuredContent`), so rich doubles a much larger answer. Keeping the full
metadata in the *text* copy is a decision, not an oversight: the model itself
needs licence, subject and level, and `search_wlo_all`'s trick of sending
compact markdown instead would hide exactly those from it. Do not "optimise"
this into a lean text without revisiting that.

What was removed is `compendiumText`: on `search_wlo_all` the compendium is
opt-in (`includeCompendium`, default off), the search projection carries it
inline anyway, and `search` — one `query` parameter — can never opt in. No
widget reads it, and `get_compendium_text` exists for whoever wants it. Measured
per query (characters of `content[0].text`, doubled on the wire):

| query | lean | rich, before | rich, after |
|---|---|---|---|
| `Photosynthese Sekundarstufe I` | 868 | 7 564 | 7 564 |
| `Zellatmung` | 2 324 | 26 994 | 26 994 |
| `Klimawandel` | 2 750 | 58 548 | **25 987** |

For `Klimawandel` the inline compendium was 61 742 of 93 583 characters — 66 %.
`Zellatmung` is unchanged because its bulk is genuine `description` text
(10 844 characters of YouTube boilerplate across 11 hits); that is content the
model reads, so it stays.

Noted while measuring, not a defect here: `search` can return an id that `fetch`
cannot resolve. `1f71f84a-…` was in the search index while
`/node/…/metadata` answered `404 DAOMissingException` — the index and the node
store disagree on staging. `fetch` reports it as "nicht gefunden", which is
correct; expect it in a ChatGPT run without concluding the tool is broken.

### Changed — one hit per external URL, in both search paths (2026-08-09)

New `src/result-dedupe.ts` (`dedupeByUrl`) collapses content hits that point at
the same `ccm:wwwurl`, applied in `searchAll` (feeding `search_wlo_all`, `search`
and REST) and in `search_wlo_content` — two independent paths, one rule,
enforced by `tests/shared-rule-discipline.test.ts`.

Measured on staging: the query `Wellenoptik` returned **eight separate `ccm:io`
records** all carrying `ccm:wwwurl = https://de.wikipedia.org/wiki/Optik`. None
was a collection reference — `originalId` was null and `ccm:original` pointed at
each node itself — so the existing `ccm:original` rule collapses nothing here.
Their `cm:name` carried edu-sharing's collision suffixes (`… - 2` … `- 6`):
repeated imports of one web page.

**The first hit wins, not the newest**, and the difference was measured: the
newest by `cm:created` was an untouched `1.0` copy, while the only record with
editorial work (`cm:versionLabel 1.2`) was the *oldest*. Ordering by date would
have discarded the edited one — and neither `cm:created` nor `cm:versionLabel`
is in the search projection, so it would widen every request. The incoming order
is the ranking, so the first hit is the copy the search already judged best.

Dedupe runs **before** the result cap, so no duplicate can occupy a slot. The
upstream page is still requested at the caller's size, so a page dominated by
copies now returns fewer results — `total` continues to report the real backend
count. Widening the page to compensate would double the bytes of every search
for a repository data problem, and is deliberately not done.

Live check after the change (staging, `maxContent: 15`): `Optik` 15/15 distinct,
`Wellenoptik` 8 kept from a 15-node page (seven copies collapsed), `Photosynthese`
15/15, `Bruchrechnung` 14/14.

### Fixed — `search`/`fetch` cited every topic page by the wrong URL (2026-08-09)

Both knowledge tools built their `url` as `url || topicPageUrl || renderUrl`. For
a topic page `url` is never empty — `formatNode` falls back to `node.content.url`
for a collection node — so the `topicPageUrl` branch was unreachable, and a topic
page was cited as `…/components/render/<id>` instead of
`…/components/topic-pages?collectionId=<id>`. The order is now
`topicPageUrl || url || renderUrl`; only topic pages carry `topicPageUrl`, so
content nodes are unaffected.

Found by a live call against staging, not by the schema — and the regression
tests only reproduce it because they populate `content.url` on the mocked node.
Without that the empty `url` falls through and the bug is invisible.

### Added — a golden-prompt section for the `search` / `search_wlo_all` overlap (2026-08-09)

`docs/apps-sdk-golden-prompts.md` gains section **E** (S1–S8) plus a
`search` leakage rate, to settle whether ChatGPT picks the poorer of two tools
that run the same retrieval. The document now also records the measured payload
delta: same query → same nodes, but `search` drops preview, licence, publisher,
subject, level, resource type and description, flattens the
`{content, collections, topicPages}` pots without a `nodeType` marker, and
declares no `widgetUri` — so its answers render without the WLO interface.
Which tool the model actually picks remains **unmeasured**; the section is the
harness for measuring it. The mechanics half — does the expected tool deliver at
all — was run against staging on 2026-08-09: 8 of 8 deliver, with two caveats
recorded for whoever reads the ChatGPT run (eight identical Wikipedia entries
under eight node ids for `Wellenoptik`, and weak English recall on S8).

### Changed — skills are found by content type, in two steps (2026-08-08)

`find_wlo_skills` is replaced by **`search_skill`** (catalogue: nodeId, title,
description, keywords — no instruction body) and **`get_skill`** (the Markdown
attached to one nodeId). Splitting the two keeps the choice with the model and
stops one call from pulling every skill document into the context window.

A record now counts as a skill through its **content type**, not through where it
sits: `ccm:oeh_extendedType = http://w3id.org/openeduhub/vocabs/contentTypes/ai_prompt`.
Measured 2026-08-08 on staging and production — the field is indexed and
facetable, the criterion narrows (110 of 403 431 for `organization`), several
values are OR-ed (110 + 42 = 152), and it AND-s with `ngsearchword`. It takes the
FULL vocabulary URI; the bare slug matches nothing. No `ai_prompt` record exists
in either repository yet, so the filter is proven to work and has not yet been
seen selecting a real skill.

Both tools are therefore registered **unconditionally**: without a configured
collection the search filters the whole repository, so the capability no longer
depends on an env variable. `WLO_SKILLS_COLLECTION_ID` now *narrows* the search
to one collection subtree — walked, not queried, because `ngsearch` refuses
`virtual:parent_recursive` with 400 `DAOValidationException` on both instances
(the `page_variant` query accepts it; `ngsearch` does not).

New `WLO_SKILL_TOOL_MODE`: `two-tool` (default) or `one-tool`, which swaps both
for `get_skill_for_task` — same ranking, but taken away from the model and
answered in one call. It exists to be measured against the default.

Ranking now counts **keywords** alongside title and description (title 3,
keywords 2, description 1) and uses the shared German-aware matcher
(`queryTerms`/`termMatches`) instead of a local tokenizer, so a skill that names
its trigger only in `cclom:general_keyword` is findable.

The subtree walk reads one level at a time through a pool of 10. It was
sequential first, and a live run over a subject portal (30 collections, two reads
each, 717 records) took **90.3 s** — longer than any client waits for one tool
call. Parallelised, the same walk takes **8.1–8.4 s**.

Measured against the documented structure instead (root → skillsets → skill
records, see the new [`docs/SKILLS.md`](docs/SKILLS.md)), the walk is two waves:
**2.0 s for 6 skillsets, 2.4 s for 12**. The 8 s figure is what a *misconfigured*
root costs — the id pointing at something that is not a skills collection.

A second bound, **depth two below the root**, was added for the other shape of
that misconfiguration: a deep tree. It does **not** improve the portal case
above — that one is wide, not deep, so the 30-collection visit cap is what stops
it, and the time is unchanged. Both bounds are pinned by tests (without the visit
cap the walk does not terminate at all), and when either bites, the server logs
that the listing is incomplete instead of presenting a truncated crawl as the
catalogue.

`search_skill` and `get_skill_for_task` take a **`collectionId`** — for any
collection, not just the configured root — so "welche Skills hängen an
Physik/Optik?" is answerable. `includeSubcollections` decides how far it reads,
and the default follows the source: a collection the caller NAMES is read on its
own (measured on Physik: **1 request, 0.8 s**), the configured root is read with
its skillsets (2 waves). Walking a subject collection's subtree costs 60 requests
and 12.9 s — a crawl a model should have to ask for, not stumble into.

Skills stay `ccm:io` records rather than becoming collections, and that is now
measured rather than assumed: **`ngsearch` never returns collections at all**
(`contentType=FOLDERS` → 0 hits; `ALL` → the same 403 431 `ccm:io` and no
`ccm:map`), and no real collection carries `ccm:oeh_extendedType`. A skill built
as a collection would be unfindable by search. As a record it is also
referenceable, so one skill can sit in the catalogue AND in a subject collection
without being copied.

**`get_skill` reads the `:::` blocks of the SKILL.md** and returns them as
`references` — kind (`wlo-material` / `ki-skill`), title, url, nodeId — beside
the Markdown, which is handed over untouched. The editor already writes these
blocks; parsing them here rather than leaving it to the model removes an
extraction task whose failure mode is a plausible id for the wrong record: a
material's title link points at its external source, so its id comes from the
preview image, while a skill's id is in its title link. A block with no
repository URL keeps an empty `nodeId` instead of being dropped, and an unclosed
block is ignored — the download is byte-capped, and half a block is not a
reference. New module `services/skill-references.ts`, no upstream calls.

**First run against real skills (2026-08-08).** 28 test records in a staging
collection; the whole chain works anonymously: catalogue 25 hits in 0.6 s, a
scoped query 0.4–0.5 s with the right skill on top each time ("Elternbrief
schreiben" → `elternkommunikation`, "Klassenarbeit korrigieren" →
`korrektur-auswerten`, "Vertretungsstunde" → `vertretung-planen`), `get_skill`
0.8 s for 11.7 kB of Markdown.

It also cost a wrong belief: **`propertyFilter=-all-` does not return
`ccm:oeh_extendedType`.** A raw probe using `-all-` reported the field missing on
all 28 records while the explicit projection reported `ai_prompt` on all 28 — the
code was right and the probe was lying. The claim "no collection carries the
field", which rested on the same flawed probe, was re-measured with an explicit
projection and holds.

**Linking a skill to a subject by metadata** — `search_skill` and
`get_skill_for_task` gained `discipline` and `educationalContext`. `ccm:taxonid`
composes with the content type (measured: Physik 9878 alone, 9877 with
`learning_material`), so "welche Skills gehören zu Physik" is answerable without
placing a reference in that collection, where a skill would sit among the
teaching material. Repository-wide the labels go out as criteria; scoped to a
collection the resolved URIs are matched locally, because `/children` takes none.
An unresolved label is REPORTED rather than dropped — a dropped filter silently
widens the result set (`⚠ Filter "Phsyik" … Meintest du: Physik?`), and the JSON
output carries `unresolved`.

**Review round, eight findings fixed (2026-08-08).** The three that mattered:

- The one-tool mode printed "load it with `get_skill`" for every referenced
  skill — a tool that mode does not register. Rendering is now mode-aware, and
  `get_skill_for_task` carries the companion-file manifest too, because that mode
  registers no tool taking a nodeId and a companion was otherwise both invisible
  and unreachable.
- The manifest pointed at `get_skill` for EVERY companion. That tool hands the
  file back verbatim and decodes it as UTF-8, so a DOCX arrived as up to 64 KB of
  decoded ZIP. Each entry now names the tool that fits its MIME type;
  anything that is not `text/*` goes to `get_wlo_content_text`.
- The subtree walk could truncate in silence: when the visit cap refused every
  child of the LAST level read, no next level remained and the "listing may be
  incomplete" warning never fired. Refused and unreadable collections are now
  counted, and a collection that cannot be read AT ALL throws instead of
  returning an empty catalogue — the same rule `getCollectionContents` follows.

Also: the server-derived sections (manifest, references) moved BEFORE the
document, since after it they are written in the same Markdown the document may
contain and would be indistinguishable from sections it forged; `get_skill` now
discloses a reference like the catalogue does.

One finding did not survive its measurement: the text read was suspected to fail
on a reference id. It does not — staging returned the same 3466 bytes and a 200
from both the reference and its original, so `readSkillText` deliberately does
not resolve `ccm:original` (only the folder lookup has to).

**`ccm:original` is now part of the skill identity.** Every result carries
`originalId` beside `nodeId`, and `search_skill` de-duplicates on it: a skill
that sits in the catalogue AND in a subject collection is returned once, as the
ORIGINAL — the only id that may be written to, and the only one whose companion
files resolve without a second lookup. A hit that is a reference says so in the
listing. Without this the same skill appeared twice under two ids, which reads as
two skills.

**`get_skill` now returns a manifest of the skill's other files** — name,
nodeId, MIME type, size, and nothing else. The model reads the instructions, sees
what exists, and fetches only what it needs with `get_skill` on that nodeId;
nothing beyond the `SKILL.md` is downloaded unasked. The manifest is built at
call time from the workspace folder, so there is no catalogue to maintain.

The resolution rules (`services/skill-files.ts`, all measured 2026-08-08): from a search
hit, `virtual:primaryparent_nodeid` → `/children` reaches the other files in its
workspace folder anonymously; from a collection entry the chain is
`ccm:original` → `/metadata` → `virtual:primaryparent_nodeid` → `/children`,
because a reference's own primary parent is the collection. Both verified on
staging, every step 200 without credentials. A folder holding more than 25 files is
reported as a COUNT rather than listed — it is somebody's inbox, not a bundle:
real WLO folders measured at 484–3744 records and 1.7–20.6 s to list, and one of
six refused anonymous access. A skill's own folder (1–2 files) lists in
0.2–0.4 s. A folder that cannot be read costs nothing; the instructions come back
regardless.

Two further measurements, neither acted on yet. Collections **are** directly
searchable (`/queries/-home-/mds_oeh/collections`, `contentType=COLLECTIONS`, 46
hits for "Physik") but **only by keyword** — `ccm:oeh_extendedType` and
`ccm:taxonid` are both refused there with 400. And on `ngsearch` the content type
AND-s with `ccm:taxonid` correctly (9878 Physik records, 9877 of them
learning_material), so a skill could be linked to a subject by TAGGING it rather
than by placing a reference in that collection. `search_skill` does not expose
those filters.

`services/skills.ts` passed 300 lines and was split: `skill-catalogue.ts` now
holds what makes a record a skill and how a skills collection is enumerated (the
constants, the bounded walk), `skills.ts` the skill contract (search, ranking,
`get_skill`). Behaviour-preserving; the importers were repointed rather than
re-exported.

Read tools: 26 → 27.

### Fixed — the listing leads with the variant the page renders (2026-08-07)

A collection can own several page-config folders, and they are resolved
independently. When the superseded one came back first, its variant led the
merged entry — and `search_wlo_topic_pages(includeContent: true)` resolves the
first variant, so it rendered a superseded copy of the page. The rendered variant
is now moved to the front whenever it arrives.

Where the listing resolved none of the active folder's variants at all, no
variant is marked as rendered — and `includeContent` then hands over no variant
id instead of guessing, so `get_topic_page_content` walks the authoritative chain
(collection → `ccm:page_config_ref` → `ccm:page_config.default`). Measured live:
that page now resolves its real variant instead of a stale copy.

Also in this round: `targetGroup` no longer carries the German placeholder
"nicht gesetzt" in the machine field (empty string in every mode; the wording
stays in `targetGroupLabel`); `_queryMeta.criteria` reports only what the
dispatched mode actually used, instead of claiming a full-text search for a query
the mode discarded; the page-variant search says so when it hits its 300-item
cap; and the owner-resolution memo, dead since the listing groups by folder, is
gone.

### Fixed — one filter, one meaning, across all Themenseiten modes (2026-08-07)

`targetGroup` used to mean two different things. The listing mode handed it to
the repository search, which can only match a value that is present; the
collection modes filtered locally and kept variants that declare none. Measured
against production: **98 of 109 topic-page variants carry no target group and 97
carry no educational context**, so the upstream filter was not narrowing the
result — it was hiding nine pages out of ten. A request for 20 Themenseiten with
`targetGroup: 'teacher'` returned 16 pages; it now returns 20.

Both filters are applied in one place and a variant that declares no value is
never excluded. They no longer make the call faster, and `docs/TOOLS.md` no
longer claims they do.

### Added — every Themenseite below a collection (2026-08-07)

`search_wlo_topic_pages` takes `withinCollectionId`: all topic pages in a
collection **subtree**, not just the one that collection owns. For the Physik
portal that is 20+ pages instead of 1. Backed by `virtual:parent_recursive`,
which takes exactly one collection id per query — candidate sets cannot be
batched into a single search.

### Added — which variant the page actually shows (2026-08-07)

A Themenseite can hold several variants, and they are mostly editorial copies
rather than target-group fassungen — so which one renders was not derivable from
anything we returned. It is recorded on the page-config folder, in a property
the server never read: `ccm:page_config` carries the variant order and a
`default`. Present on 99/99 production and 45/45 staging pages.

The rendering variant now comes first and is marked `isDefault`, in the JSON and
in the Markdown listing. The previous behaviour took the first child of the
folder, which landed on the same node in all 13 measured multi-variant pages — by
an ordering the repository never promised. The extra read only happens when a
page has more than one variant (6 % of pages), and on the listing path it costs
nothing at all: the folder was already being read for its parent.

`cm:title` is no longer a fallback for a variant's label. It holds the technical
`PAGE_VARIANT_<uuid>` string on 109 of 109 production variants, so falling back
to it replaced "no label" with a UUID that merely looks like one.

### Changed — the Themenseiten listing resolves only what it returns (2026-08-07)

The listing fetched page variants but returns Themenseiten, and several variants
can belong to one page — so it used to guess the ratio: a pool of `maxResults*2`
plus a one-shot top-up of up to 50, i.e. two searches and up to fifty owner
resolutions charged to a caller who asked for five results.

`virtual:primaryparent_nodeid` comes back on every hit and one page-config folder
is one Themenseite, so variants are grouped into pages **before** any owner is
resolved. One search, and one owner walk per page actually returned.

Two defects surfaced only when this ran against a real repository, and neither
could have been caught by a mocked upstream:

- A collection may hold several page-config folders, so grouping by folder
  under-delivered against a merge that keys on the collection (20 requested, 19
  returned) and listed the same collection three times. Resolution now proceeds
  in waves until enough distinct pages are in hand — from the search result
  already in memory, so no second search.
- Each folder has its own `default`, which claimed several rendering variants
  for one page. Only the folder named by the collection's own
  `ccm:page_config_ref` can hold the rendering variant; the others stay listed
  but unmarked.

Measured, evidence and repository-side blockers:
`docs/plans/2026-08-07-topic-page-variants-analysis.md`.

### Added — replace the file on an existing record (2026-08-06)

`wlo_update_content` takes the same `content` / `fileBase64` / `contentFormat`
parameters as the create tool. A call may change only metadata, only the file, or
both — a file alone counts as a change, which it did not before.

Replacing is not creating, and the preview says so: **the current content is
replaced and the previous version stays in the version history**. That sentence
sits in the change set beside the file's name, type, size and digest, so the
confirmation token is bound to the new bytes exactly as on the create side —
confirming with different content is refused.

The file name is derived from the record's **stored** title when the call is not
changing one, so replacing content without touching the title still produces a
sensibly named file.

The metadata write and the upload are two separate repository operations and
either can fail alone, so both are reported rather than merged into one verdict.
The upload runs after the metadata, so a record whose content replacement fails
still carries the fields meant to describe it. The read-back is the same:
`size`/`downloadUrl` decide, and an upload the record does not show afterwards is
reported as such.

The rules that decide whether bytes may be uploaded — type detection from the
magic bytes, the size caps, the encoding check, the derived name — are shared
with the create path through `resolveFileUpload`, not copied. What differs
between the two tools is only the question around them: creating needs a source
and `url` is one of them, while on an existing record `url` is an ordinary
metadata field and no file at all is a perfectly good call.

### Fixed — a flaky curation test, root-caused (2026-08-06)

`tools-curation-create-file.test.ts` failed about once in five runs, on a
different test each time. Not the token store: the helper that pulls the
confirmation key out of a preview was written as `/confirmToken[^\w]*(…)/`, and
`[^\w]` matches `-`. A base64url key may begin with `-` — roughly one in 64 does
— and the greedy run swallowed it, so the key handed to the store was one it had
never issued. The six older curation test files already exclude `-` from that
class; the shorter form was copied here without it. Twelve consecutive runs green
after the fix, and the reason is now written down where it was missing.

### Added — create a record that carries its own file (2026-08-06)

`wlo_create_content` takes a second kind of source beside `url`. The two paths
stand side by side and neither replaces the other:

- **`url`** — the material lives elsewhere and the record points at it. The
  repository crawls it. Unchanged.
- **`content` / `fileBase64`** — the record **carries** the material: Markdown
  written in the conversation, or a generated image. For everything that has no
  URL of its own.

Exactly one source per call. Two given is a refusal, never a silent priority —
"url wins" would file a link while the person watched their worksheet in the
preview.

**What the caller cannot get wrong, because it cannot say it.** The image type is
read from the bytes (PNG, JPEG, GIF, WebP), never declared, so nothing can be
stored under a type that would get it served as something else; anything
unrecognised is refused rather than guessed. The file name is derived from the
title, so there is no caller-supplied name and no traversal surface at all.

**HTML and SVG are deliberately absent.** A record whose bytes the repository
serves as `text/html` from its own origin is stored XSS, and an SVG is a document
that executes script — magic bytes cannot separate a drawing from a payload
there, because the same file is both.

**The bytes are in the confirmation fingerprint.** The preview names the file's
name, type, exact size and a SHA-256 prefix, plus the readable beginning of a
text. The token is bound to that, so confirming with different bytes is refused —
otherwise an approval for one worksheet could upload another. That property is
pinned by a test, and verified by removing the description and watching the test
fail.

**And the upload is read back.** edu-sharing answers `200` for writes it discards;
a `ccm:io` without content reports `size` and `downloadUrl` as null, and both are
set once bytes arrive. An upload that did not land is stated next to the new
record's id — "the record was created and carries NO content" — instead of being
folded into a general success. A failed upload does not fail the create either:
the node exists, its id has to reach the caller, and reporting failure over an
existing record invites a retry that would produce a second one.

Filing the same thing twice is still checked, with the anchor each path has: the
URL blocks (it identifies the material exactly), while a same-title record in the
storage location only *warns* in the preview — two worksheets may legitimately
share a name, and refusing the second would be worse than a duplicate somebody
can merge.

The request shape is measured, not inferred: `wlo-content-files` (validated
2026-05-08 against production and staging) and staging's own `openapi.json`, read
2026-08-06. The single-call variant `POST …/children/_content` exists in the spec
and has never been run, so the two-call path is used — a measured path beats a
tidier unmeasured one.

`MAX_BODY_BYTES` rises from 1 MB to **4 MB**, because an image arrives as base64
inside the JSON-RPC body (2 MB decoded, ~2.7 MB encoded) and the old limit
refused a call the tool is meant to serve — in the transport, before the tool
could say anything useful. The `413` now names the likely cause and the variable.
This widens a memory-exhaustion vector by the same factor; it is bounded per
request and an operator who does not want uploads can set it back.

### Added — end every access of your WLO account (2026-08-06)

`POST /auth/revoke-all`, and a second form on `/auth-revoke.html`: type your WLO
login, and every access block listed for that account stops working.

This closes a gap found in use rather than in review. Revocation until now took
the access **id**, and the only place that id exists is inside the block — but on
the OAuth route the block travels to the AI host and **the person never sees it**.
So the users most likely to want a revocation, having connected a client and
later removed it, had no way to reach one; the operator editing the registry file
was the only remaining path. Deleting the connector in the AI host does not
revoke anything: the server keeps no client state, only the allow-list.

The check the endpoint stands on is that the login is **verified upstream before
anything is removed**. Our public key is published so browsers can encrypt, which
means anyone can build a block naming any user — the same property that makes the
id a secret on the other path. Without the upstream check, a guessed username
would disconnect a stranger's AI host. That check now lives once, in
`auth/access-verify.ts`, which issuance, OAuth authorization and revocation all
go through; `tests/shared-rule-discipline.test.ts` pins that there is one such
module and that both block-consuming callers use it. Checking a password also
makes this a guessing oracle, so it passes the same two limiters as `/auth/issue`.

Matching is by **exact** user name. Whether edu-sharing treats `Jan` and `jan` as
one login is unmeasured; folding case would be a convenience if they are the same
account and a way to wipe a stranger's accesses if they are not. The page reports
how many went, so a differently spelt name is visible rather than silent.

`docs/AUTH.md` claimed that one revocation ended both routes at once. That was
true for the paste route and false for OAuth, and it is corrected there.

### Added — connect without a WLO account of your own (2026-08-06)

The consent page has a third button next to "Anmelden" and "Ablehnen":
**"Ohne eigenes WLO-Konto verbinden"**.

Measured on claude.ai the same day: entering the MCP URL is enough for the client
to find our discovery documents and start the OAuth flow, and from there it
*wants a token* — it cannot simply send no header. So a person who only wanted to
search had two choices, signing in or cancelling, and cancelling is not a
connection. There was no way to use the server anonymously from that client at
all.

The new exit issues the token `wlo-anon.v1`. It is a constant, and deliberately
so: it grants exactly what a request with no `Authorization` grants, so forging
it saves the forger the trouble of omitting the header. No key material, no
allow-list entry, no revocation, no expiry — none would protect anything, and
each would suggest it did. It works on a deployment with no access blocks
configured at all.

"Anonymous" here means what it meant before authentication existed: the API is
used without a personal login. On a deployment with a service account that is the
account's identity, exactly as for a call with no header.

Two properties keep it from becoming a hole. The **intent must be stated** — a
consent request that merely forgot its access block still fails rather than
quietly becoming an anonymous connection — and the **match is exact**, so a typo
surfaces as a broken token (401) instead of slipping through. The 401 rule for a
Bearer we cannot use is otherwise unchanged; this is the single value where "no
credential" is the answer rather than the failure.

Also in this change: the consent page builds its POST body in **one** function
now, shared by both exits. A second literal is exactly where `response_type`
went missing on 2026-08-05 and broke every consent.

### Changed — the tool descriptions speak the user's language, not the repository's (2026-08-06)

A model picks its tool from the description and nothing else, and several of ours
were correct while never matching the request. Teachers do not ask for
"Bildungsinhalte" — they ask for "ein Video zu Bruchrechnung", "Medien zum
Klimawandel", "ein Arbeitsblatt", "Material für Klasse 7".

- **`search_wlo_all` now leads with those phrasings** instead of with the shape
  of its return value, and says explicitly that a named medium is a *filter*, not
  a reason to pick a different tool.
- **The server instructions name the repository's other names** — WirLernenOnline,
  WLO, edu-sharing, openeduhub. Until now only one of the four appeared anywhere
  in the surface, so "leg das bei WirLernenOnline an" matched nothing. One line
  in the instructions rather than the same aliases in thirteen write-tool
  descriptions.
- **The Wikipedia gap is closed.** Measured live: asked to build a record from a
  town's Wikipedia page, Claude ran its own web search. `get_wikipedia_summary`
  advertises a *lead extract* — correct, and not what that task needed — and
  nothing pointed from a Wikipedia URL to `get_url_text`, which returns the page.
  Both now name the other.
- **Every description is under 1024 characters** (longest: 1006; four were over,
  up to 1573). Truncation cuts the end, which is where the "do NOT use this for …"
  guidance sits — i.e. exactly the half that prevents a wrong pick. Whether
  ChatGPT enforces the cap is still unmeasured; writing under it makes the
  question moot. What was cut is implementation detail that also lives in the
  parameter descriptions, never a stated behaviour: `get_node_details` keeps the
  five `raw` field names, because a test pins that promise to what it delivers.

`tests/tool-descriptions.test.ts` now holds the trigger words, the aliases and
the length cap, so the next rewrite cannot quietly drop them.

### Changed — the default repository is now STAGING, not production (2026-08-06)

**Breaking for any deployment that relied on the default.** A server started
without `WLO_REPOSITORY_URL` now talks to `https://repository.staging.openeduhub.net/edu-sharing`.
Writing to production requires naming it.

What prompted it: a deployment whose `.env` simply lacked the line created a
record in the **live** catalogue. Everything around it said staging —
`NODE_ENV=staging`, a staging text-extraction service, the operator's own belief
— but `NODE_ENV` is read by nothing in this codebase, and the one variable that
decides silently fell back to production. It only surfaced because someone read
the render URL of the record that had been created.

Whichever way the default points, a forgotten variable lands somewhere. The two
outcomes are not symmetric: against staging a mistaken write is a test record,
against production it is somebody's live catalogue — so the dangerous target is
the one that has to be named out loud.

Three further changes make the same class of mistake harder:

- **`docker-compose.yml` no longer restates the default.** The line was
  `${WLO_REPOSITORY_URL:-https://redaktion…}` — a second copy of a decision
  `src/wlo-config.ts` already owned, and the copy that decided was not the one
  anyone read. It is now an empty pass-through, like every other line there.
- **`.env.example` ships staging active**, with production as a commented
  alternative — and a test pins that its value equals the code default.
- **`WLO_TEXT_EXTRACTION_URL` ships active again**, pointing at the staging
  service. It was banned from being active after it once pointed at staging
  while the repository pointed at production, sending production material URLs
  to a foreign host. A test now enforces the actual rule — repository and
  extraction service must name the **same** environment — instead of the blanket
  ban, which also cost every operator a lookup. The code still has no default
  for it: unset means the path stays off.

Existing deployments: check `docker compose exec <service> printenv WLO_REPOSITORY_URL`
before updating. If it is empty and you intended production, add the line.

### Fixed — the password-checking endpoints were reachable from any web page (2026-08-06)

`/auth/issue`, `/auth/revoke` and `POST /oauth/authorize` parsed whatever body
arrived, without looking at `Content-Type`. The CSRF argument in the source —
"a JSON body cannot be sent cross-origin without a preflight" — only holds if the
server *requires* `application/json`. A `<form enctype="text/plain">` is a
**simple** request, needs no preflight, and its body can be crafted to parse as
JSON.

What that allowed: a page could make every visitor submit an attacker-built
access block from the visitor's own address. The response stays unreadable
cross-origin, but the author holds the block and learns the outcome by presenting
it at `/mcp` afterwards. `authAbuseLimiter` — the guard both modules name, which
counts distinct logins per **address** — was therefore bypassable by spreading
the guessing across visitors.

All three now answer `415` unless the body is declared `application/json`
(parameters such as `; charset=utf-8` allowed). That makes the request
non-simple, so a browser must preflight, and the preflight fails on the missing
CORS header. All three access-block pages already send the header, so nothing on
our own surface changes. `/oauth/register` and `/oauth/token` are deliberately
left alone: neither carries a credential, the token endpoint is form-encoded by
RFC 6749 §4.1.3, and requiring a type there would only risk breaking a conforming
client. The rule itself is one function, `isJsonContentType` in `read-body.ts`.

### Fixed — four smaller findings from the auth review (2026-08-06)

- **`WWW-Authenticate` values are escaped** (`auth/oauth-metadata.ts`). Every
  caller passes a `URL.origin` whose host has already been through the `HOST`
  pattern, so no quote can arrive today — but that invariant lives two modules
  away, and the builder gained a second caller when the write tools began
  sending a challenge inside a tool result.
- **The loopback loosening no longer forgives userinfo**
  (`auth/oauth-clients.ts`). `isValidRedirectUri` rejects `user:pass@` at
  registration; the RFC 8252 §7.3 branch compared only scheme, path and query, so
  a *presented* target could add credentials the registered one never had — and
  the final redirect is built from the presented value.
- **A `client_id`'s redirect list is held to the registration rule when it is
  opened**, not merely to "non-empty string". Unreachable from outside (the AEAD
  proves we minted the id), but it is the last gate before a code is sent
  somewhere.
- **`code_verifier` must be 43–128 characters** (RFC 7636 §4.1). Only bites where
  a client *chose* a short verifier and registered its challenge — which is the
  case the RFC bounds, because an interceptor holds the code and the challenge
  both.

Plus a corrected claim: `access-registry.ts` said "revoking a block requires
holding it". It does not — `remove` is keyed on the access id, and anyone can
build a block carrying one, since the public key is published. The trade is
deliberate, but it makes the id the secret, so it must never be logged or
returned. A test now pins both halves.

### Changed — the curation tools are listed for everyone and ask for the login themselves (2026-08-05)

Until now a caller with no identity got 25 tools and no hint that thirteen more
existed. That looked like the safe choice and was the reason the login never
started: a model that never sees a write tool never calls one, so nothing ever
asks the host to authenticate, and a connector added without OAuth stayed
anonymous forever — which is exactly what happened live.

The pattern that replaces it is the one OpenAI's own mixed-auth example uses
(`authenticated_server_python`, read 2026-08-05):

- **Every caller gets the same tool list.** The curation tools declare
  `securitySchemes: [{type:'oauth2', scopes:['wlo']}]` and are always present.
- **They refuse without a write identity**, answering with an error result that
  carries `_meta["mcp/www_authenticate"]` — an RFC 6750 challenge with the
  `resource_metadata` pointer. That is the client's cue to run the OAuth flow.
  The HTTP status stays `200`, so anonymous reading is untouched.
- **The read tools now declare both schemes** (`noauth` + `oauth2`). They work
  without a login and see more with one; saying only `noauth` stated half of it.

The refusal itself is unchanged and absolute: an anonymous call reaches no write
code and makes no upstream request (asserted against the recorded fetch calls,
not against the reply text). The gate lives in ONE place —
`registerCurationTool` in `tools/curation-shared.ts`, which every curation tool
now goes through; a source scan in `tests/shared-rule-discipline.test.ts` fails
if one is ever registered past it.

`createMcpServer` consequently no longer takes a write mode — the list does not
depend on the caller any more — and takes the public origin instead, for the
pointer in that challenge.

### Added — one log line per MCP request, naming the surface it was served (2026-08-05)

`mcp request` with the JSON-RPC `method` and the resolved `mode`
(`none` / `user` / `service`). Written after a day of live debugging in which
the log answered everything except the question that mattered: it could say
"nobody called us" — which twice ruled out the server in one step — but never
"somebody called us, and this is the tool list they got".

No label, no credential, no params: the question is which surface a request was
served, not who read what. A test asserts both the fields and their absence.

### Changed — `get_wlo_content_text` says when to reach for it (2026-08-05)

Live: "hole den Volltext" called the tool, "zeig mir den Inhalt des
Arbeitsblatts" did not. The description named the capability but not the
phrasings a teacher uses, and a model picks a tool from its description.

It now leads with the triggers ("zeig mir den Inhalt", "was steht in dem
Arbeitsblatt", "den ganzen Text", "den vollen Inhalt anzeigen", "zusammenfassen"
…), names `get_node_details` as the tool NOT to use for content, and says
explicitly that a missing text is an answer to report — **not** something to
invent around. `get_node_details` points back for the content in German.

Rewritten rather than extended: the description was 1162 characters, over the
1024 commonly enforced on function descriptions, and a cap that truncates
mid-sentence would cut exactly this guidance. It is now under the limit, and a
test holds it there.

### Fixed — the curation tools declared a security scheme no client knows (2026-08-05)

They carried `_meta.securitySchemes: [{ type: 'http' }]`, borrowed from OpenAPI.
The Apps SDK knows exactly two types — `noauth` and `oauth2` — and **one
unrecognised type refuses the entire tool list**. That is why ChatGPT connected
happily without authentication (25 tools, all `noauth`) and reported "a problem
occurred while connecting" on every attempt that carried a login: the 13
curation tools joined the list and took it down. Nothing appeared in the server
log, because the request was answered correctly — the client simply would not
accept the answer.

They now declare `[{ type: 'oauth2', scopes: ['wlo'] }]`, from one shared
constant instead of thirteen literals, with the scope taken from the
authorization server's own metadata so the two cannot drift.
`tests/tool-security-schemes.test.ts` holds the rule over the whole surface in
both modes. Confirmed live on 2026-08-05: the connector now links without an
error and its tools are available in the chat.

Worth knowing when using it: ChatGPT asks for a **per-conversation** consent
("wlo verbinden") that only appears once a request triggers it. A connector
linked in the settings is not automatically active in a conversation, and a
model with no tools attached answers as if it had searched — plausibly, and
entirely made up.

### Fixed — `/auth` offers the block without the `Bearer` prefix too (2026-08-05)

The field on the access page is labelled "value for the Authorization field", so
`Bearer <block>` belongs in it. Somebody pasting that where only the block is
wanted ends up sending `Authorization: Bearer Bearer wlo2…`, which the server
correctly refuses — and the message says the access is invalid, not that the
word is in there twice. Found the hard way during the live run.

The page now has two buttons ("Mit „Bearer" kopieren" / "Nur den Block
kopieren"), and the status line names which form went to the clipboard.

### Added — OAuth login: the exchange, and with it the whole flow (2026-08-05)

`POST /oauth/token` completes the login: a one-time authorization code becomes
the access itself. What comes back **is** the `wlo2.…` access block — there is
no second credential, which is why one revocation on `/auth-revoke.html` ends
both the pasted block and the OAuth token at once. No `refresh_token` and no
`expires_in`: nothing here expires on a clock, it ends when the holder revokes
it or changes their WLO password.

PKCE is proof, not decoration: the verifier is hashed and compared in constant
time, and the code is removed from the store **before** any check runs, so a
failed attempt cannot be retried. A native client may come back on a different
loopback port (RFC 8252 §7.3); everything else about the redirect target must
match character for character.

`tests/oauth-flow.test.ts` walks the whole way through a real server —
discovery, registration, consent, exchange, a tool call with the token,
revocation, and then the two lines that matter most: the revoked token is
refused, and a request with no header still gets the full anonymous tool list.

### Added — OAuth login: the consent page (2026-08-05)

`GET /oauth/authorize` shows a page where a WLO editor logs in and allows a
client to act as them; `POST /oauth/authorize` verifies that login and hands the
client a one-time authorization code. Both are off (404) wherever access blocks
are off.

The order is the point: **the request is checked before anyone is shown a
password field.** An unknown client, a redirect target that was not registered,
`code_challenge_method` other than `S256`, a `response_type` we do not
implement — each is refused with a page in German and **no redirect**, because
bouncing an error to an address we did not recognise would make this server a
redirector for anyone who can write a link.

The password is encrypted in the browser exactly as on `/auth`, and the
resulting block waits in memory — as ciphertext, never opened — for
`/oauth/token` (package 4). Codes live one minute, work once, are stored under
their SHA-256, and are capped in number.

The page names the client that is asking. That name comes back from this server,
not from the query string: `client_id` is a ciphertext only the server can open,
so `GET /oauth/authorize` with `Accept: application/json` answers with the values
it recognised, and the page shows those.

### Added — OAuth discovery (2026-08-05)

The server now publishes the two OAuth metadata documents an MCP client looks
for — `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`, each under both the plain and the
`/mcp`-suffixed path clients variously guess. They name the endpoints of the
login flow that packages 2–4 will build; today they exist so that a client
stops concluding this server has no OAuth at all. Off (404) without
`WLO_AUTH_PRIVATE_KEY` or without a resolvable public origin.

New: `WLO_PUBLIC_BASE_URL`, the address clients type in. The documents name it
as their own, so it is deliberately NOT taken from the request's `Host` header
unless `TRUST_PROXY` is set — a forged header would otherwise point somebody's
client at a login page this server does not own.

### Changed — an unusable Bearer token now answers 401 (2026-08-05)

A `Bearer` header that cannot be turned into a credential — forged, revoked, or
encrypted for a key this server does not hold — is answered with `401` and a
`WWW-Authenticate` challenge pointing at the protected-resource document, rather
than being served anonymously. That is how a client learns where to authorize,
and a revoked block now says "fetch a new one" instead of quietly returning less
than it used to.

Two things deliberately did **not** change: a request with **no** `Authorization`
still answers `200` with the full anonymous tool list, and a `Basic` header that
cannot be parsed still degrades to anonymous — a wrong WLO password is not an
invalid token of ours, and an authorization flow would answer a question the
caller did not ask.

### Added — personal access blocks (2026-08-04)

A user can now sign in with their own WLO account without handing their password
to their AI provider. On `/auth` the password is encrypted **in the browser**
with a key only this server can undo; the resulting `wlo2.…` block goes once into
the connector's `Authorization` field and can be revoked at `/auth-revoke.html` (or
`/auth/revoke` — the same page, since that is the path people guess). Off unless
`WLO_AUTH_PRIVATE_KEY` is set — the `/auth/…` endpoints then answer 404, the
pages say so, and a Bearer header is refused exactly as before. Anonymous
reading, the service account and the Basic header are untouched.

Why it is worth the machinery: today's `Basic <base64>` is the password in a thin
disguise. It is readable by whoever stores it, it works against **all** of WLO
rather than just this server, and it cannot be withdrawn short of a password
change. A block is unreadable to the AI provider, useless anywhere but here, and
revocable.

- **Hybrid encryption, not plain RSA.** RSA-2048-OAEP caps the plaintext at 190
  bytes; a long password plus the id can exceed that, and the failure would hit
  only some users and only in production. A fresh AES-256-GCM key encrypts the
  payload, RSA wraps the key. Everything — including the access id — is inside
  the authenticated payload, so an id cannot be swapped to dodge revocation.
- **The browser and the server are tested against each other.** The test imports
  the very file the page loads and hands its output to the real decoder, which
  works because `crypto.subtle` is a global in Node 20. Two implementations of
  one wire format is the seam that breaks silently otherwise.
- **Revocation needs a record, so the server now persists one thing.** An
  ALLOW-list of issued access ids (id, user name, issue time — never a
  credential) in a file on a dedicated volume; `read_only: true` still covers
  the rest of the container. Positive rather than deny: losing the file stops
  every issued block (inconvenient) instead of resurrecting every revoked one
  (unsafe). It belongs in the backup — see `docs/DEPLOYMENT.md` §3.1.
- **`/auth/issue` checks the reported authority, never `res.ok`.** Measured on
  staging: this API answers `200` with the guest authority for credentials that
  do not work, and an anonymous read of `-userhome-/children` answers `200` too.
  Trusting the status code would issue blocks for logins that fail, and the
  holder would find out days later as "the tools return nothing".
- **The one endpoint that checks a password is guarded twice** — requests per
  address and *distinct logins* per address — because it is otherwise a guessing
  oracle with this server's address as the origin. Both guards count per client
  ADDRESS, which is why `/auth*` sends **no CORS header at all**: a wildcard
  origin would let a web page spend every visitor's quota on a different guess
  and read which one worked. The pages are served from this origin and need
  none. (The MCP and REST surfaces keep theirs — their clients are not browsers.)
- **A registry entry is not forever.** Revoking a block requires holding it, so
  blocks people fetch and lose would otherwise stay valid indefinitely and the
  file would only grow. Each account keeps its ten most recent blocks, oldest
  first — per account and never global, so no one can push another's access out.
- **A failed write stays a failed write, not a broken registry.** The chain that
  serialises writes used to carry one rejection forward to every later one, so a
  full disk at the wrong moment disabled *revocation* until a restart; and the
  entry stayed in memory while missing from the file, briefly granting what was
  never recorded. Writes are now attempted again and undone on failure.
- **The `/auth` endpoints answer even when they fail.** A failing write escaped
  into a handler with no boundary there, and node:http does not await one — the
  caller got no response at all for 30 seconds. Now a generic `500`, with the
  reason in the log only.
- **Key rotation exists before it is needed.** `WLO_AUTH_PRIVATE_KEY_PREVIOUS`
  opens an overlap window; without one, changing the key would invalidate every
  user's configuration at the same moment.
- The two pages carry a **stricter CSP than the launcher** — no inline script or
  style at all, and `form-action 'none'` so a scripting failure cannot fall back
  to posting the password in clear. A test pins the policy, a second pins that
  the markup complies with it.
- Documented in both READMEs, `docs/DEPLOYMENT.md`, `docs/TOOLS.md` and
  `docs/PRIVACY.md` — the last of which no longer claims the server stores
  nothing, because it now stores this.

### Changed — module boundaries (2026-08-04)

A size-and-responsibility pass over every source file. Two findings, both the
project's recurring shape: something placed where its first caller needed it,
then reached for from everywhere else.

- **The browse tree walk moved out of the tool module.** `browse_collection_tree`
  held its bounded, cycle-guarded, budget-derived traversal inline — a 190-line
  handler in a 376-line file — although `CLAUDE.md` states that a tool module
  holds its schema and its rendering, never an algorithm, and names
  `services/collection-traversal.ts` as where such walks live. It is now
  `buildCollectionTree` there, beside the two walks split out of
  `tools/collections.ts` for the same reason. `browse.ts` drops to 274 lines and
  keeps what a tool owns: schema, subject→portal resolution, rendering.
  Behaviour-preserving — the 17 existing browse tests pin it, and the walk gained
  5 tests that assert the returned STRUCTURE instead of inferring a tree from
  rendered markdown.
- **`services/` and `rest/` no longer import from `tools/`.** `mapPool` (a
  concurrency primitive) and `buildFilterCriteria`/`formatUnresolvedHint`
  (vocabulary label→URI resolution) sat in `tools/shared.ts` because the MCP
  tools were their first callers; four services and the REST layer then imported
  them from there, pointing the dependency at the layer above. Neither has
  anything to do with MCP, so both moved to leaf modules — `src/concurrency.ts`
  and `src/filter-criteria.ts` — that any layer may use. No cycle existed yet;
  this removes the conditions for one. `tools/shared.ts` drops 300 → 171 lines.
  A third guard in `tests/shared-rule-discipline.test.ts` now fails on any
  reintroduced import, naming the file and line.

Not changed, and deliberately: the other `register*Tools` functions are long
because they carry tool schemas, German descriptions, and rendering — which is
what a tool module is for. Their algorithms already live in `services/`.

### Fixed — second full-project audit (2026-08-04)

A re-audit after the round below found five more instances of the same shape.
Two of them were live in every container.

- **An unparseable request target is answered instead of hanging the socket.**
  node:http accepts request targets the WHATWG URL parser refuses — `GET //[`
  among them. Three layers parsed the same `req.url` and only the dispatcher
  guarded its parse; its fallback handed the raw string to the REST router and
  the static router, where the throw escaped the handler (node:http never awaits
  the promise a handler returns). Reproduced over a raw socket: **no response at
  all**, the socket held until `requestTimeout` (30 s), and a generic
  `unhandledRejection` line as the only trace — from an unauthenticated request
  on a path neither rate limiter covers. The parse now lives in one leaf module
  (`src/request-url.ts`) and every layer gives the same total answer.
- **Docker deployments no longer run a timeout that was measured too short.**
  `docker-compose.yml` pinned `WLO_FETCH_TIMEOUT_MS` at `10000` while the code
  default had moved to `20000` and `.env.example` documented `20000`. Compose
  wins, so *every* container ran the value that cuts a 4.2–8.0 s create off
  mid-flight — the precise condition that makes a tool report a failure over a
  record the repository has already made. All numeric tuning defaults are now
  forwarded empty, so the number lives only where its measurement does.
  `docs/DEPLOYMENT.md` carried the stale `10000` too and now agrees.
- **The confirmation preview discloses what it leaves out.** Values were capped
  at `sanitizeText`'s 120 characters with a bare ellipsis, while the write
  surface allows 20 000 characters for a description and 100 000 for a
  compendium text. Measured: 526 characters written, 120 shown, nothing said
  about the rest — and the token binds the full value, so the person approved
  text the preview never showed them. Sharpest for `wlo_decide_suggestion`,
  where the value was written by somebody else and the preview is the only place
  it is ever seen. The budget is now 600 characters (enough for essentially every
  real description) and anything beyond it is cut at a word boundary and reported
  with its full length. The cutting rule is shared with `text-cap.ts` rather than
  copied; only the marker differs, because a newline would forge a second line in
  a line-oriented preview.
- **`.env.example` no longer activates a cross-environment setting.**
  `WLO_TEXT_EXTRACTION_URL=https://text-extraction.staging.openeduhub.net` sat
  active directly below a production `WLO_REPOSITORY_URL`, so `cp .env.example
  .env` — the copy step `docker-compose.yml` itself recommends — rebuilt exactly
  the leak that removing the code-side default was meant to end: the URLs of
  production material sent to a staging host.
- **A stale comment above the tool registration** claimed every WLO tool is
  "public, read-only OER data with no authentication", twenty lines above the
  registration of the 13 curation tools. Last remnant of the read-only drift
  corrected in the round below.
- **Three dead imports removed** (`safeHref` and `followUpButton` in the
  search-results widget renderer, the `ThemePageInfo` type in `tools/topic-pages.ts`)
  — each with exactly one occurrence, its own import line. Surfaced by running
  the type checker with `--noUnusedLocals`, which is not part of the normal gate.
- **The shared truncation rule is now actually shared.** `text-cap.ts` says in
  its own docstring that it was extracted "when a second caller needed the
  identical rule — two copies of a truncation marker drift silently". It was then
  used by **2 of 8** call sites: six modules carried their own
  `x.slice(0, CAP) + '\n[…gekürzt]'`, cutting mid-word where the shared rule cuts
  at a word boundary, and the byte-capped download path had already drifted to
  `'\n\n…[gekürzt]'` — the ellipsis on the other side of the bracket. All six go
  through `capText` now; the download path cannot (it caps bytes on a stream, not
  characters on a string) and takes the exported marker instead.
- **The identity probe parses its body through `readJson`** like every other
  upstream call. `read-json.ts` and `CLAUDE.md` both claim every client goes
  through it; `auth/identity.ts` did not, so a proxy maintenance page answering
  `200` with HTML surfaced as `identity check failed: Unexpected token <` rather
  than naming the call and its status.

### Added

- `tests/deploy-env-passthrough.test.ts` gained two guards for the class the
  compose drift belongs to: no numeric default may be restated in
  `docker-compose.yml` (mode flags whose deployment default deliberately differs
  are named with their reason), and `.env.example` may activate no setting a copy
  would silently adopt. The existing tests in that file pinned that a setting is
  *forwarded*; nothing pinned its *value*, which is why the drift was invisible.
- `tests/shared-rule-discipline.test.ts` — source-level guards for the pattern
  every audit round of this project has turned up: a rule extracted into a shared
  module, then not adopted by the modules written afterwards. Two rules so far —
  the truncation marker belongs to `text-cap.ts` alone, and an upstream body is
  parsed only through `read-json.ts`. A unit test of a helper proves the helper
  is right and says nothing about whether anyone uses it; only a source scan can.
  Sibling of `env-parsing-discipline.test.ts`, which exists for the same reason.

### Fixed — full-project audit follow-up (2026-08-04)

A whole-codebase audit across 12 dimensions found no exploitable vulnerability
and one recurring shape: a rule identified, named, solved in one place — and then
not carried to the other places it applies to. Every finding below is an instance.

- **An aborted write is no longer reported as a failure.** `isUpstreamTimeout`
  existed and was applied to exactly one of thirteen curation tools. The other
  twelve answered a timeout with "… konnte nicht … werden" — a claim about
  something we do not know, since the abort hits the response, not the work
  (measured 2026-08-02: a timed-out create had already produced the record). The
  worst case was reproducible: a **successful** `DELETE` whose read-back timed
  out reported `Der Datensatz konnte nicht gelöscht werden`, which is exactly the
  sentence that stops a curator from checking whether their material is gone.
  A shared `timeoutOrError` in `tools/curation-shared.ts` now separates "the
  repository refused" from "we stopped listening" at every mutation, and
  `confirmDeleted` turns a thrown read-back into the `unverified` outcome its own
  type already had.
- **Confirmation previews no longer truncate mid-sentence.** `renderChangeSet`
  passed the whole assembled action line through `sanitizeText`, whose 120-char
  cap is meant for a single foreign value. The fixed German prose plus a 36-char
  nodeId plus a title exceeded it routinely: a submit preview ended at `… zur…`,
  and a *decline* preview — which has no field changes and is therefore only that
  line — lost both the nodeId and the clause saying the record stays untouched.
  `sanitizeText` is now `flattenText` plus the cap, and the renderer uses
  `flattenText`. The same trap had already been identified and avoided in
  `fields.ts`; this is it reintroduced one module over.
- **`wlo_submit_content` binds its editorial note to the confirmation token.**
  The note travelled to the editorial queue under the submitter's name while
  appearing in neither the preview nor the token's fingerprint — so an approval
  for "submit this record" carried whatever text arrived with the confirming
  call. It is now part of the previewed action, and both it and
  `versionComment` are length-bounded (`max(1000)`) like every other free text
  that reaches the repository.
- **Five environment variables stopped silently mis-parsing.** `resolvePositiveInt`
  was written because `WLO_FETCH_TIMEOUT_MS=20s` resolved to a 20 ms timeout;
  `MAX_BODY_BYTES`, `RATE_LIMIT_RPM`, `API_RATE_LIMIT_RPM`,
  `AUTH_CREDENTIAL_LIMIT` and `WLO_POOL_SIZE` still used raw `parseInt`, so
  `MAX_BODY_BYTES=1MB` became a one-byte cap that answered every request with
  `413`, with nothing in the log pointing at the cause. All five now go through
  the shared parser; the rate limits use a new `resolveNonNegativeInt`, because
  `0` is documented there and means "disabled".
- **`rest/routes.ts` dispatches on the parsed path**, matching `http-app.ts`.
  Matching the raw request target made the two disagree for a request-target in
  absolute form, which HTTP/1.1 permits.

### Documentation — three published documents said "read-only" (2026-08-04)

Write support shipped in 2026-08; three documents that state publicly what this
server does still described a read-only, unauthenticated proxy.

- **`docs/PRIVACY.md` rewritten.** It claimed "no authentication", "the server
  never writes", "no write/mutation tools exist" and — of credentials — "it has
  none", for a server that accepts an `Authorization` header, forwards it to the
  repository, and registers thirteen write tools. It also omitted the
  text-extraction service as a third-party recipient and the 10-minute hashed
  credential digest the abuse guard keeps, and described the *first*
  `X-Forwarded-For` hop where the code takes the rightmost. The policy now covers
  the credential chain, what curation writes and where that data then lives, all
  four recipients, and an operator checklist that starts with "say which mode
  this deployment runs in".
- **`docs/apps-sdk-submission-checklist.md`**: the row a reviewer reads said
  "no write tools ✅". Replaced with the argument that is both true and stronger
  — write tools exist, are unregistered without an identity, refuse again at call
  time, are two-step confirmed and are read back.
- **`public/llms.txt`** — which is *served* at `/llms.txt` — advertised "22
  read-only tools" long after there were 25. The count is gone rather than
  corrected; `tools/list` is authoritative and a hand-maintained number in a
  served file will drift again.
- **`tests/docs-claims.test.ts`** now pins all three to the source: it derives
  the curation tool names from `src/tools/` and fails if the documents claim
  otherwise. Nothing connected code and prose before, which is why the drift
  survived four sessions.
- README (EN + DE), `CLAUDE.md` and `docs/DEPLOYMENT.md` updated in step: the
  open-outcome rule, the number-format rule for env variables, a rollback
  procedure with the two things that do *not* roll back with the image
  (configuration, and anything curation wrote), the `/health` deploy fingerprint,
  and the widget count in the verification step (three → four).

### Added

- `npm run test:coverage` — the same suite with the runner's coverage report.
  Opt-in, so `npm test` stays short.

### Verified — MCP Inspector re-run and the golden prompts' mechanics pass (2026-08-03)

- **Official MCP Inspector CLI, against the running HTTP server:** `tools/list`
  returned 25 tools and a scripted check over title, description, `readOnlyHint`,
  `destructiveHint`, both `openai/toolInvocation/*` strings, `securitySchemes`
  and `inputSchema` found **0 objections**. `resources/list` returned the 4
  widgets with `text/html;profile=mcp-app`, and a `tools/call` over the same
  connection returned real results (315 hits for "Photosynthese"). This closes
  the gap left by the previous run, which was clean at 22/22 on 2026-07-17 and
  predated four tools.
- **Golden prompts, mechanics half:** 17 of 17 runnable prompts delivered live
  against the staging repository (D10 needs `WLO_SKILLS_COLLECTION_ID`). Two
  first-attempt failures were the probe's own fault — `get_topic_page_content`
  takes `query`, not `topic`, and `browse_collection_tree` takes `depth` and
  answers in `results` — which is itself worth recording: a golden-prompt run
  should check parameter names against `tools/list` before filing a tool as
  broken. Tool *selection*, the negative prompts and the widget render still
  need a live ChatGPT session.
- **Deployment posture recorded:** the server runs on the `nip.io` address for
  now and is not being submitted to the GPT store, so `WLO_WIDGET_DOMAIN` stays
  unset — which is what every non-ChatGPT host requires anyway. Verified that no
  public origin is hardcoded anywhere in `src/` or `public/`, so the later switch
  to a real domain is a redeploy with changed env variables. The checklist now
  separates "ready now" from "deliberately deferred" instead of leaving both as
  bare open boxes.

### Documentation — every tool named, counts corrected (2026-08-03)

- **`docs/TOOLS.md` documented 24 tools; there are 39.** It listed neither the
  13 curation tools nor `get_node_collections` and `get_url_text`. It now opens
  with what a session actually sees (25 anonymous · 26 with a skills collection ·
  +13 with write rights · minus `get_url_text` where the operator disabled it)
  and carries a curation section with chat triggers and the three rules that
  bind every write: two-step confirmation, read-back, and irreversible deletion.
- **A rendering defect in the same file:** four rows of the browse table sat
  *after* a blockquote, so they had no header above them and rendered as literal
  pipe characters rather than as table rows.
- **Stale counts corrected** in `README.md` ("25 read tools"), `README.de.md`
  ("24 MCP-Tools"), the project tree in both ("registers all 23 tools") and the
  Apps-SDK submission checklist. The checklist's *historical* measurement — the
  Inspector run that was clean at 22/22 on 2026-07-17 — is left as it was; only
  the claims about today were changed, and `get_url_text` was added as the
  second tool carrying `openWorldHint`.
- Both READMEs gained per-tool detail entries for `get_node_collections` and
  `wlo_auth_status`, which had table rows but no description.

### Added — `get_url_text` and a generic unsafe-tool switch (2026-08-03)

- **`get_url_text`** reads the text behind an arbitrary web URL through the
  extraction service — for a URL named in the conversation rather than a WLO
  record. WLO material keeps its own path: `get_wlo_content_text` reads the
  repository directly and is both faster and more reliable. "No text" is a
  normal outcome with a `reason`, not an error; the service renders with
  Playwright and has known gaps (protected pages, bot detection, media files),
  so the description names `method: "simple"` as the one sensible retry.
- **A tool can declare itself unsafe.** `WloToolDef.unsafe = { reason }`, and
  the single registration seam skips it when the operator sets
  `WLO_DISABLE_UNSAFE_TOOLS` (names, or `all`). Unsafe tools are registered by
  default and each logs a startup **warning** naming itself and the reason — a
  default-on risk documented only in a changelog is one nobody inheriting a
  deployment will read. `.env.example` and `docker-compose.yml` ship `all`, so a
  real deployment starts without them. Ordinary tools are untouched by the
  switch; that is asserted, because a security knob that empties the server is
  an outage, not a mitigation.
- **`get_url_text` is documented as not-for-production.** Before anything is
  requested it refuses a literal private host, a public name whose DNS record
  resolves into a private range, and a name it cannot resolve at all. What it
  cannot check is the decisive part: we never fetch the target — Playwright
  inside the extraction service does — so a redirect into an internal address,
  or a DNS answer that changes between our lookup and the service's, is
  invisible here. That needs enforcement inside the fetching service.

### Fixed — IPv4-mapped IPv6 addresses passed the private-network check (2026-08-03)

- **`http://[::ffff:127.0.0.1]/` was not recognised as loopback.** `new URL()`
  rewrites that host to `[::ffff:7f00:1]`, so the dotted quad is gone before any
  check runs and the IPv6 branch had no idea that `7f00:1` is 127.0.0.1.
  Measured, not theorised. This was **live on the existing `ccm:wwwurl` path**:
  anyone able to set that field — including through this server's own write
  tools — could have pointed the extraction service at its own loopback.
  `isPrivateHost` now unwraps the mapped address in both spellings (`::ffff:10.0.0.1`
  as DNS returns it, `::ffff:a00:1` as `new URL()` produces it) and judges the
  IPv4 inside; a mapped PUBLIC address such as `::ffff:808:808` stays public.
- The rule moved into its own module (`src/url-safety.ts`) with tests. It had
  none: it was a private function reached only through a tool that degrades to
  `null` on refusal, so a hole in it looked exactly like a service switched off.
- Correction to an earlier assumption recorded in the plan: decimal and hex IPv4
  literals (`http://2130706433/`) were never a hole — `new URL()` normalises them
  to `127.0.0.1` first — and a DNS check would not have caught them either
  (`dns.lookup('2130706433')` answers `ENOTFOUND`).

### Fixed — Supporting layer: test honesty, deployment config, docs (R12, 2026-08-03)

- **Eleven documented settings never reached the container.** `docker compose`
  auto-loads a neighbouring `.env`, but only for `${…}` *interpolation* — a
  variable the compose file never names is not passed to the service. Measured
  with `docker compose --env-file … config`: with `WLO_SKILLS_COLLECTION_ID`,
  `WLO_ALLOW_SERVICE_WRITES` and `WLO_TEXT_EXTRACTION_URL` all set, the rendered
  service environment contained none of them. These are not tuning knobs — they
  decide which tools *exist*: `WLO_ALLOW_SERVICE_WRITES` gates all 13 curation
  tools, `WLO_SKILLS_COLLECTION_ID` registers `find_wlo_skills`, `WLO_INBOX_ID`
  is required before the service account can create anything. An operator set
  them, restarted, and the capability was still missing with nothing logged.
  All eleven are now forwarded (`PORT` deliberately is not — the port mapping
  hardcodes the container side, so overriding it would leave the server
  listening where nothing is published), and
  `tests/deploy-env-passthrough.test.ts` pins `.env.example` and
  `docker-compose.yml` to each other so the next new setting cannot drift.
- **Two validation tests passed over a deleted constraint.** Both named
  themselves "(no network)" and wrapped the call in a `try/catch` that accepted
  *any* failure as the rejection they were looking for. Measured: with the
  `excludeNodeIds` cap removed from the schema, the handler ran, its upstream
  call failed because the network was unreachable, the catch read that as the
  rejection — 11/11 green over a removed input-validation cap. Rejection before
  any upstream request is now asserted (`assertRejectsWithoutUpstream`), which
  fails with "4 !== 0" instead of passing.
- **The offline guarantee is now enforced instead of promised.** README and
  CONTRIBUTING state "no network required" in six places and nothing checked it.
  `npm test` loads `tests/netguard.mjs`, which fails any fetch to a non-loopback
  host that no `installFetchMock` intercepted; loopback stays allowed because the
  transport and REST tests boot a real local server. Verified twice: the full
  suite is genuinely offline (1021/1021 with every external host blocked), and a
  probe test fetching `example.com` fails with the guard's message.
- **`CLAUDE.md` documented a test command that runs nothing on the shipped
  runtime.** It gave `node --import tsx --test "tests/*.test.ts"`; Node 20 —
  what `engines` and the Docker image declare — takes that glob literally, which
  is exactly why `scripts/run-tests.mjs` exists.
- **`package.json` declared no license** although the repository ships
  Apache-2.0, and was not marked `private`, so a stray `npm publish` would have
  attempted to publish an internal server package. Both added.
- **The project tree in both READMEs omitted `scripts/`** — the directory
  `npm test` depends on — and `docs/TOOLS.md`.

### Fixed — Matching and ranking, measured live (carry-overs from R4/R7, 2026-08-03)

- **A German article in the query no longer makes the local matcher accept
  everything.** `nodeMatchesText` split the query on whitespace with no stopword
  filter and matched any word as a substring — and German stopwords sit inside
  ordinary words ("Stu-die-n", "Me-die-n"). Measured over a 60-node pool from a
  real search: `"Bruchrechnung"` correctly matched 0 nodes, `"die
  Bruchrechnung"` matched 43 (72%), `"der Wald"` 48, `"IT"` 47. The filter was a
  no-op for any query phrased the way a person speaks. It now drops stopwords
  and single characters, and a query of nothing but stopwords matches nothing
  rather than everything.
- **A short query term must match at a word start.** A substring test is right
  for German — "Rechnung" belongs inside "Bruchrechnung" — but for a two- or
  three-letter term it is mostly accident: the query "IT" put "s-it-ting",
  "Maur-it-ius", "Pol-it-ik" and "C-it-izenship" in the top five of a live
  search. Compounds and inflections carry the term at a word start while the
  accidental matches bury it mid-word, so short terms now require that boundary.
  "EU" still matches "Europäische" and "Bio" still matches "Biologie".
- **The relevance scorer's phrase bonus follows the same rule.** It awards +30,
  its largest single bonus, for `title.includes(query)` — which for a one-word
  query is exactly the substring test the term branch had already given up, and
  it outweighed that branch four to one. Multi-word phrases are unaffected.
- **The three copies of "which query words count" are now one function.** Scoring,
  the quality floor and the local matcher each had their own; the copy in the
  scorer decided the order a user sees.
- **`get_compendium_text` no longer fetches every property to read two.**
  Measured read-only against the editorial repository: a `propertyFilter`
  returns each field it names byte-identical to the `-all-` read, including a
  4914-character description — the filter bounds which properties come back,
  never their content. Responses shrink ~43%.

### Fixed — Transport, REST & entry points (review R11, 2026-08-03)

- **The CORS policy no longer invites a browser to relay credentials.** The MCP
  endpoint forwards a caller's `Authorization` header to the WLO repository,
  which is why it caps how many *distinct* logins one client may present. That
  cap keys on the client address — and advertising `Authorization` as a
  cross-origin-allowed header was the way around it: a web page could spend
  every visitor's address on a different guess and read the outcome, since a
  write-capable login yields a longer tool list. CORS restrains browsers and
  nothing else, and no browser is a client of this endpoint, so the header is
  simply no longer offered.
- **The dispatch matches on the path, not on the raw request target.**
  `req.url` carries the query string, so `POST /mcp?v=1` answered "Not found.
  Use POST /mcp" and `GET /health?t=1` 404'd — while the REST router and the
  static layer had normalized correctly all along.
- **Both public HTML surfaces declare a Content-Security-Policy.** The search
  view (`?format=html`) and the prompt launcher embed repository-supplied text;
  escaping was the only control. The search view denies everything but inline
  style; the launcher additionally permits its own inline script and a
  same-origin fetch. Neither may be framed.
- **The HTML search view is readable in a dark-mode browser.** It hardcodes a
  light palette but declared no background, so the browser painted its own dark
  canvas under near-black text — measured at roughly 1.1:1, i.e. unreadable. It
  now states its background and `color-scheme: light`, giving ~16:1.

### Fixed — Apps-SDK & widgets (review R10, 2026-08-03)

- **A material title can no longer forge an entry in the multi-select
  hand-off.** "Use selected" injects a message *as the user* listing one
  material per line as `- „title" (nodeId: x)`, and the title — which comes from
  spidered external sources — went in raw. A line break in one forged a second
  entry naming an id the teacher never picked, which the model would then act
  on. The single-tile buttons have sanitized their title since 2026-07-28; this
  path built its own message and did not. HTML escaping does not help here: the
  delimiter of a prompt list is the newline, not `<`.
- **The detail view states the licence even when the record has none.** The
  tile always shows the row, deliberately — teachers must be able to tell "free
  to reuse" from "no licence stated". The Einzelansicht omitted it, and that is
  the view where the reuse decision is actually made.
- **Inlined widget JS and CSS are escaped against their own closing tag.** The
  build writes the bundle into `<script>…</script>`; an HTML parser ends a
  raw-text element at the first `</script`, whatever the JavaScript grammar
  says, and esbuild does not escape it because it cannot know the output is
  being inlined. One string literal would have truncated the bundle and spilled
  the rest into the document as markup.
- **A tree node's `aria-controls` no longer depends on the node id being
  id-safe.** `aria-controls` is a space-separated id list, so a node id carrying
  whitespace pointed the disclosure button at two elements that do not exist.

### Fixed — Curation tools (review R9, 2026-08-03)

- **`wlo_remove_from_collection` never worked.** Filing material into a
  collection creates a *reference* node with its own id, and the two directions
  of the repository API do not take the same one: the `PUT` that files material
  takes the original node id, while the `DELETE` that removes it requires the
  reference id. Measured against staging, the delete with the original id
  answers `200` and removes nothing — the reference was still readable
  afterwards. The tool now resolves the reference from the collection listing
  first, accepts either id from the caller, and says plainly when the material
  is not in the collection at all instead of reporting a removal that did not
  happen.
- **The removal is confirmed on the reference node, not through `/usage/v1`.**
  That endpoint answers `500` for exactly the state this check exists to
  observe: a material whose reference was just deleted keeps a usage row
  pointing at the node it can no longer resolve. Every successful removal would
  have been reported as unverified.
- **Removing a compendium text now reads the record back.** Writing one already
  did; removing one reported success from the status code alone.
- **A confirmation token now binds the whole change, not part of it.** Three
  fields sat outside the change set and were therefore not covered by the
  fingerprint: a collection's `description` on create and rename, and
  `commit`/`versionComment` on `wlo_update_content`. A token approved for one
  description authorised writing a different one; an approved metadata edit
  could silently cut a new version.
- **`cm:title` and `cm:description` are named in the writable-field list.** Both
  were already written by the collection tools; the list understated the write
  surface it exists to declare.
- **Repository-supplied values are sanitized before they are interpolated into
  a confirmation preview or a rejection message** — field names, offered
  vocabulary values, suggestion ids and statuses. These messages carry elevated
  authority: they are what a curator approves.
- **A collection title longer than 255 characters is refused before anything is
  sent.** Every other written field passes the length check; this one reached
  the repository unchecked.

### Fixed — Detail & auxiliary tools (review R8, 2026-08-03)

- **Repository text can no longer forge a detail record.** `get_node_details`
  rebuilt `renderToText`'s line format by hand — `## title`, `nodeId:`,
  `Lizenz:` — but without its `oneLine` protection, so a newline in a title
  opened a second, fabricated record with its own nodeId and its own licence
  line. The same gap is closed in `get_related_content`, `get_node_collections`,
  `get_node_breadcrumb`, `find_wlo_skills`, `get_wlo_content_text`,
  `get_collection_stats`, `lookup_wlo_publishers` and `get_compendium_text`.
  Decided per site, not swept: prose bodies (the stored full text, a compendium
  text, a skill's instruction Markdown) keep their line breaks — they are
  documents, not fields.
- **`get_wlo_content_text` states a provenance that cannot be forged.** A
  newline in the title used to fabricate a second `Quelle:` line, i.e. claim
  repository origin for text taken from a linked page — the one line a teacher
  reads to attribute the material.
- **A record that is merely not public is no longer reported as non-existent.**
  `getNodeMetadata` returns `null` for every non-OK status, so `get_node_details`,
  the knowledge-convention `fetch` and `get_node_collections` all answered "Node
  X nicht gefunden" for a 401/403 (not public — measured: such a node refuses
  its metadata too) and for a 503. New `readNodeMetadata` carries the status;
  the three answers are now kept apart.
- **`get_node_breadcrumb` no longer invents a cause.** A failed `/parents` read
  was reported as "probably a file node or the root". New `readNodeBreadcrumb`
  reports the failed read as one.
- **`get_node_details` no longer claims a full text is absent after a failed
  read**, and its JSON output carries `textContentError` alongside the empty
  string, mirroring `parentsError`.
- **Two unbounded values in the detail record are capped** to the same limits
  `renderToText` applies: the compendium text (500 chars) and the description
  (400). A call asking for title and licence used to return an entire editorial
  essay inline.
- **`get_nodes_details` bounds its full-text fan-out** to the first 20 nodes.
  Concurrency alone does not bound wall-clock: 50 slow reads at pool width 10
  could outlast the server's own 30 s request timeout, and the caller lost the
  connection instead of receiving the metadata it also asked for. Skipped ids
  are named in `textContentSkipped` — never silently dropped.

### Fixed — Wikipedia returned the wrong article (2026-08-02)

- **A search-resolved Wikipedia hit is now checked for relevance, and the
  candidate the query is about is chosen instead of the first one.** Measured
  before: `Stadt Berlin` answered with `Bern`, `Dreiecke` with `Dreiecker` — a
  mountain in the Allgäu. That is not cosmetic: a caller turning the extract
  into teaching material appends "Quelle: Wikipedia-Artikel „…"", so a wrong
  article publishes a false attribution.
  The check sits on the **candidates**, not on the finished summary, because
  every wrong article measured came from the opensearch fallback and never from
  the direct lookup — a direct hit is the exact title or a curated **redirect**
  (`Bruchrechnen` → `Bruchrechnung`), which is an editorial statement that both
  names mean the same topic and is trusted as such.
  The candidate list also grew from 1 to 10, which turns a rejection into a
  correct answer: for `Dreiecke` the right article was the fifth result.
  Live-verified against de.wikipedia.org, 10/10 cases as expected.
- **`WikiSummary` carries `match`** (`exact` | `fuzzy`) on the MCP tool, on
  `GET /api/wikipedia` and in the Apps-SDK output schema, so a consumer that
  attributes the text can tell whether the article is the one the user named.
  The Markdown output states the substitution for a fuzzy hit.
- **A generic classifier noun no longer outvotes the proper name.** The topic is
  taken from the longest content word, so `Insel Rab` answered `Insel (Album)` (a
  music album), `Element Zinn` answered `Élément moral` (a French legal concept)
  and `Fluss Po` answered `Fluss-Greiskraut` (a plant) — the classifier matched
  and the name was never weighed. Found by a live probe, not by review. Among
  accepted candidates, one that accounts for more of the query now wins over one
  that accounts for less (`Satz des Pythagoras` over `Pythagoras`).
- **A short topic word no longer empties the query.** `Stadt Rom` reduced to
  nothing at all — "stadt" is a stop word and "rom" fell under the length floor —
  so the search never ran. The floor is now a preference: when nothing longer
  survives, the short words are used, and they can still only match a whole word.
- **No candidate on topic now means "no article", not the closest string.** The
  rejected candidates are logged so a miss can be diagnosed.
- The substitution notice is shared by `get_wikipedia_summary` and
  `search_wlo_all` instead of living on one of them — it had been written on the
  less-used surface and forgotten on the documented default entry point.
  Rationale, measurement and the deliberate deviations from the proposal are in
  [`docs/plans/2026-08-02-wikipedia-relevance.md`](docs/plans/2026-08-02-wikipedia-relevance.md).

### Removed — the Vercel serverless path (2026-08-02)

- **`api/mcp.ts`, `vercel.json` and `tests/api-mcp.test.ts` are gone.** The
  serverless entry point had been retained but not operated for months, which
  meant every change to the credential chain, the tool registration or the
  transport had to be made twice and reasoned about twice — the R6 review found
  it drifted exactly there. Vercel is no longer a deployment target, so the
  second copy is now a liability rather than an option.
  **Nothing was lost with the tests:** each of the six properties they pinned
  (health payload, 405 on a wrong method, the `Accept` patch, the relay-abuse
  guard, an unusable `Authorization` header not borrowing the service account,
  and per-user credential propagation) has a twin against the self-hosted path
  in `tests/http-app.test.ts` and `tests/auth-per-user.test.ts`.
  Earlier entries in this same Unreleased section that describe `api/mcp.ts` are
  superseded by this one; they are kept as the record of what was done.
  The type gate (`tsconfig.typecheck.json`) and CI still cover `tests/` and the
  widget entry points — only `api/**/*` left its `include`.
  **Serverless constraints no longer apply anywhere in this codebase.** The
  server is a long-lived process: in-memory rate limiting, per-process caching
  and startup work are all sound, and the README/PERFORMANCE caveats about cold
  starts are gone rather than merely qualified.

### Fixed — R7 review: search & discovery tools (2026-08-02)

- **`search_wlo_within_collection` no longer corrupts its own JSON.** With
  `outputFormat:"json"`, the sampling note ("searched the first 100 of 214") and
  the sub-collection hint were appended to the JSON string, so `JSON.parse`
  threw for every client that read the text block. Both now ride as their own
  content blocks, the way the unresolved-filter hint already did.
- **Repository text can no longer forge a tool's own record delimiters.**
  `renderToText` has collapsed newlines in repository values since the licence
  fix; four tools rendered their own line-oriented text and did not. A
  collection title containing a newline could add a branch to the collection
  tree, a Fachportal to the portal list, an entry to the Themenseiten listing,
  or a section to a swimlane outline — each with a `nodeId` of its choosing,
  which is what the next tool call acts on. `oneLine` is now exported from
  `formatter.ts` and applied in `browse.ts`, `topic-pages-present.ts` and
  `topic-page-content.ts`. A Wikipedia extract in `search_wlo_all` is rendered
  as a blockquote instead: prose may wrap, but no line inside it can open one of
  the answer's own `#` sections.
- **An unreadable collection listing is no longer reported as an empty one.**
  `getChildCollections` degrades to `[]` on any non-OK status, so a 503 reached
  the user as "no collections found — try a broader term", as `WLO Fachportale:
  0`, or as `Sub-Sammlungen: 0` per portal. The new `getChildCollectionsResult`
  reports whether the listing was readable; the four places that turn emptiness
  into a claim now fail loudly or omit the count instead of asserting a fact
  about the catalogue that is really a fact about the server.
- **A facet query can no longer take down the process.** `searchFacets` was
  started before the main search and awaited after it, so a throw from the main
  search left it unawaited — an unhandled rejection ends the Node process. The
  `.catch` now sits at the call site, where the floating promise is created,
  rather than relying on an invariant held in another module.
- A collection that is both a top-level entry and a sibling's child is no longer
  emitted twice in `browse_collection_tree`. The duplicate only appeared past the
  eleventh top-level node: the ids were claimed inside each worker, whose
  synchronous prefix covered exactly the first pool-width of them. The two
  argument-error paths now log like every other failure, and the stale Vercel
  reference in the `mapPool` rationale is gone.

### Fixed — R6 review: auth & credentials (2026-08-02)

- **An `Authorization` header the server cannot use no longer borrows the shared
  service account.** A refused scheme (Bearer, Digest) or a malformed Basic
  payload was indistinguishable from sending no header at all, so the caller
  quietly acted under the service identity — with rights they never asked for
  and, with `WLO_ALLOW_SERVICE_WRITES` set, the ability to write changes
  attributable to nobody. Such a request is now served anonymously, on both HTTP
  entry points, with a warning in the log. Sending no header still resolves to
  the service account; that fallback is the intended one.
- **A Basic header with an empty password is refused.** `resolveServiceCredential`
  already rejected a half-filled login for a documented reason; the header path
  accepted it, which produced `mode: "user"`, registered the curation tools and
  then failed every upstream call with 401.
- **The cleartext-transport warning no longer depends on a service account being
  configured.** It sat behind that early return, so the deployment where every
  individual user's own password travels in the clear — per-user mode, which
  needs no service account — was the one that never heard about it. The warning
  now fires for the transport itself at boot; loopback stays exempt.
- **The Vercel entry point guards forwarded credentials.** It relayed a
  client-supplied `Authorization` header upstream with no cap on distinct
  logins, the relay-abuse vector the self-hosted handler has guarded since it
  started forwarding headers. On serverless the in-memory guard is per-instance
  and resets on a cold start, so a platform rate rule is still required — but a
  weakened guard beats none. (Entry point retained, not deployed.)

### Fixed — R5 review: write pipeline (2026-08-02)

- **Six mutations reported success from the HTTP status alone; every one of them
  now reads the record back.** Creating and renaming a collection, filing and
  removing a reference, deleting a record and deleting a collection all answered
  "done" on `res.ok`, although the write pipeline's own rule is that a `200` from
  edu-sharing is not evidence — the collection endpoint is measured to discard
  `cm:description` while answering one, and the mechanism that discards a write
  when the caller lacks the right is not endpoint-specific. This is the gap that
  was found in production for `wlo_submit_content`. Create/rename compare
  `cm:title` (and the description) on a read-back; the reference tools ask the
  usage endpoint, which resolves a reference id to its original first; both
  deletions require the record to be unreadable (`404`), not merely a `200` from
  the DELETE. The three answers stay apart — `failed` (nothing happened),
  `not_visible` (accepted, not in the record), `unverified` (we could not find
  out) — because each permits a different sentence.
- **A commit that falls back to field-by-field no longer versions each field.**
  `POST …/metadata` creates a version every time, and the retry ran with the
  caller's options, so one rejected value out of five left four history entries
  carrying the same comment. The retry now drafts and a single commit covers
  whatever landed.
- **Upstream error bodies are sanitized before they reach the model.**
  `failureDetail` embedded up to 200 raw characters of an edu-sharing response in
  six user-facing replies; a newline in a stack trace ended our sentence and
  opened a line that read like one of ours.
- **Author names are escaped for vCard.** `toVcard` interpolated the name into
  `N:` and `FN:` unescaped, so a pasted line break ("Maria Schmidt⏎Universität
  Musterstadt") produced a card a strict parser drops whole — the author vanishes
  from the record rather than being slightly wrong. A `;` shifted every following
  `N:` component.
- **Write values are bounded in number as well as in length.** No property capped
  its value count, and only four of fourteen capped the length of a value; the
  real bound was the HTTP body cap, which the stdio path does not have.

### Fixed — R4 review: read services (2026-08-02)

- **The recursive collection walk is bounded by the collections it reads, not
  only by the rows it collects.** `collectRecursiveContents` stopped at
  `maxResults` rows — but rows are counted only when they are new, so a curated
  subtree whose sub-collections share their references de-duplicates itself into
  a standstill and the queue kept draining. Two sequential upstream calls per
  collection, continuing after the client's 30 s request timeout had already
  closed the socket. A visit cap (50 collections) now ends the walk, with a
  warning in the log; `totalHits` remains the "there is more below" signal. The
  module's own header had claimed both walks capped their fan-out; only the
  keyword-fallback walk did.
- **A refused parent lookup on a collection is no longer reported as "in no
  collection".** `getNodeParents` degrades to `[]` on any non-OK response, so a
  403 and a genuine root collection arrived identical, and
  `get_wlo_node_details` printed "Keine Eltern-Sammlungen gefunden." for a
  collection that is filed somewhere — the same confident falsehood
  `getParentCollections` was written to prevent on its material branch. New
  `readNodeParents` reports whether the repository answered (the split
  `getNodeTextContent` / `readNodeTextContent` already uses); the collection
  branch now returns `unknown` on a failed or unparseable read. `getNodeParents`
  keeps its graceful contract for breadcrumbs, where a missing crumb is cosmetic.
- **A failing keyword search no longer discards the topic-page portals.** In
  `findTopicPagesByQuery` the portal leg was guarded and its supplementary
  sibling was not, although only the portals carry `ccm:page_config_ref` — a
  timeout on the supplement failed the whole call. Same guard `searchAll`
  already carries.
- **The topic-page widget fan-out is capped per lane.** `MAX_LANES` bounded the
  swimlanes but not the widgets inside one: the grid is parsed unbounded and
  each widget node costs its own metadata request (measured in the new test:
  1200 requests for a 12×100 page). Only the first content-bearing widget of a
  lane is ever used, so at most four per lane are read.
- Doc fix: `enrichCompendium` described its gap-fill as "one bulk `-all-` fetch";
  `getNodesMetadata` is a pooled fan-out of one request per id — edu-sharing has
  no bulk metadata endpoint.

### Fixed — R3 review: vocabularies & presentation (2026-08-02)

- **A repository-supplied field can no longer forge a record in the Markdown
  output.** `renderToText` writes a line-oriented format (`## title`,
  `Key: value`) in which every value comes from the repository — titles,
  descriptions, publisher names, `_DISPLAYNAME` labels, URLs. A newline in any of
  them opened a second, fabricated record carrying its own `nodeId` and its own
  `Lizenz:` line; a forged "CC BY 4.0" over material that has no licence is
  exactly the claim a teacher acts on. Values are now flattened to one line each
  where the format needs one line. The text itself is unchanged — this is the
  renderer protecting its delimiters, not sanitizing (`text-sanitize.ts` remains
  the elevated-authority boundary), and JSON output keeps the line breaks.
- **`elementary school` now resolves to Grundschule, not Elementarbereich.** The
  alias sat on both entries and the first-wins exact match handed the English
  term for primary school to the pre-school concept — a wrong filter with no
  "did you mean" hint, because a non-null result reads as "resolved". A test now
  asserts that no label or alias is shared by two concepts of one vocabulary.
- **`resolveVocab` requires a real scheme before treating input as a URI.**
  `startsWith('http')` accepted any word beginning with those four letters and
  passed the typo on as a filter value: a guaranteed empty result, and the fuzzy
  suggestion suppressed along with it.
- **The eight aggregated learning-resource-type concepts missing from the local
  table were added** (48 in total). The repository derives them from `new_lrt`,
  so they appear as facet values — and facet values carry no server-side
  `_DISPLAYNAME`, so they rendered as bare UUID URIs. Labels are the official
  prefLabels from the published vocabulary, read once from the index rather than
  inferred from the child concepts.
- **Typo tolerance restored for university subjects spelled with "ß".** The word
  splitter used a Latin-1 range that excludes U+00DF, so "Gießereiwesen" was
  tokenised as "Gie"/"ereiwesen"; it now splits on Unicode letter classes.

### Fixed — remaining `res.json()` sites in the service and write layers (2026-08-02)

- The five call sites R2 deliberately left alone now go through `readJson` too,
  each keeping its own contract rather than inheriting one. `listSuggestions`
  and the collection-usage lookup **throw**, because both document that an empty
  array is the positive claim "there is nothing here" — a claim that must never
  cover "we could not look". The two create paths (`createCollection`,
  `createContentNode`) take the route their missing-id branch already took: the
  POST was accepted, so a record may exist, and reporting a plain failure would
  invite a retry — which with `renameIfExists` produces a *second* record rather
  than a no-op. Their message now says to look in the repository before
  repeating the operation. `auth/identity.ts` was checked and left unchanged:
  its parse is already inside the `try` that carries its "never throws" contract.

### Changed — modularization (2026-08-02)

Three files past the 300-line threshold were split along the seam where two
responsibilities had accumulated, not at the line count. All moves are
behaviour-preserving; the suite is the guard.

- `src/services/collection-traversal.ts` (new) — the DAG walks
  (`findCollectionsByTreeTraversal`, `collectRecursiveContents`) out of
  `tools/collections.ts` (461 → 338). Bounded fan-out over the collection graph
  changes with the repository's data; the tool schema changes with its contract.
- `src/services/topic-page-discovery.ts` (new) — the three-mode Themenseiten
  discovery out of `tools/topic-pages.ts` (311 → 174), same seam.
- `src/wlo-node-text.ts` (new) — `/textContent` and the anonymous file download
  out of `wlo-node.ts` (333 → 228). Reading a node's TEXT carries its own
  timeout budget, byte cap and UTF-8 handling; reading its metadata carries
  none of that. Re-exported through the `wlo-api` barrel, so no caller changed.

### Fixed — review package R2, upstream API clients (2026-08-02)

- **An upstream 200 that is not JSON no longer decides the failure mode.**
  `res.ok` says the server answered; it does not say the body is JSON. A reverse
  proxy's maintenance page, a captive portal and an empty body all arrive as
  HTTP 200 with something `res.json()` throws on — and every client function
  parsed unguarded, so the parse error escaped past functions that document
  themselves as degrading to `[]`/`null`. The worst case was
  `fetchWikipediaSummary`, whose whole contract is "returns null when no article
  matches": its `try` covered the network call but not the parse, so a Wikimedia
  CDN interstitial turned an optional enrichment into **HTTP 500 from
  `/api/wikipedia`** instead of a 404. That it bites was already visible in the
  code — `services/search.ts` wraps the call in `.catch(() => null)`, a
  workaround only needed because the function broke its own promise. A new
  `src/read-json.ts` leaf now parses once for all three clients: callers that
  degrade get `null` and log which call failed; callers that throw by contract
  (`ngsearch`, `getCollectionContents`) throw a named error instead of
  `Unexpected token <`.
- **A truncated download no longer ends in a broken character, and its cap is
  measured in bytes.** `getNodeDownloadText`'s no-body fallback compared
  `text.length` (UTF-16 units) against a byte limit, so German text could run to
  roughly three times the intended size; the streaming path cut at an arbitrary
  byte offset, which lands inside a multi-byte sequence and left a U+FFFD before
  the truncation marker.

### Security — review package R2 (2026-08-02)

- **A material URL pointing into a private network is no longer forwarded to the
  text-extraction service.** The URL comes from a repository record's
  `ccm:wwwurl` — content any curator can set, including through this server's own
  write tools — and the only check was that it began with `http`. The service
  fetches whatever it is given, so `http://169.254.169.254/…` or an RFC-1918
  address turned it into a probe of whatever network it sits in; self-hosted
  next to this server, that network is the operator's. Loopback, link-local,
  RFC-1918 and IPv6 unique-local/link-local hosts are now refused before the
  request is made, and the refusal is logged. Known limit, stated in the code: a
  public name that *resolves* to a private address still passes — closing that
  needs resolution-time enforcement inside the fetching service.

### Changed — review package R2 (2026-08-02)

- **The metadata fan-out can ask for the fields it actually reads.**
  `getNodesMetadata` had no projection parameter and always pulled `-all-`
  (~59 properties per node). Resolving a topic page's swimlane widgets reads
  exactly one property off each node and paid for all of them, on the hot path
  of the most expensive tool. It now takes an optional `props` list; the widget
  resolution passes `['ccm:widget_config']` and every other caller keeps `-all-`.
- **`wikipedia-api.ts` no longer imports the whole edu-sharing client.** It
  pulled its one shared constant through the `wlo-api` barrel while its own
  header claimed it must never pull WLO config in — a contradiction inside a
  single file. It now imports from the config leaf, and the header states what is
  actually true: no repository credential can reach Wikipedia, because this
  module calls `fetch` directly rather than the credential-attaching `wloFetch`.

### Security — review package R1, foundation & config (2026-08-02)

- **Invisible Unicode can no longer smuggle instructions through
  `sanitizeText`.** The rule flattened C0/C1 control characters, which left every
  invisible class untouched: the Unicode tag block (U+E0000–U+E007F) encodes a
  full ASCII sentence that renders as nothing, bidi overrides (U+202A–U+202E)
  make the displayed text differ from what is read, and zero-width space splits
  words invisibly. Measured: 32 tag codepoints carrying "IGNORE ALL PREVIOUS
  INSTRUCTIONS" survived unchanged. This is the exact threat the module was
  written for — a value posing as a fresh instruction block — in the variant its
  tests did not cover. The worst path is `followUpPrompt`, which embeds a
  repository-supplied title in a message injected with *user* authority; titles
  come from spidered external sources. Invisibles are now dropped (not turned
  into spaces, which would insert word breaks) and dropped *before* the length
  cap, so padding cannot push the readable part out. ZWNJ/ZWJ and LRM/RLM
  deliberately survive — Persian and Indic orthography and emoji sequences need
  them, and direction *hints* cannot reorder text the way an override can.

### Changed — review package R1 (2026-08-02)

- **`WLO_TEXT_EXTRACTION_URL` has no default any more.** It defaulted to the
  *staging* extraction service regardless of which repository was configured, so
  any production deploy that had not set it sent the URLs of production material
  to another environment — the outcome the surrounding validation exists to
  prevent ("a typo must not redirect material URLs to a host the operator never
  chose"); an unset variable is no more a choice than a typo. Unset now disables
  the external path and logs why, leaving `/textContent` as the only source.
  **Action for operators: set `WLO_TEXT_EXTRACTION_URL` explicitly**, or accept
  repository-only full text.
- **A malformed numeric env value is refused instead of half-parsed.**
  `parseInt` stops at the first non-digit, so `WLO_FETCH_TIMEOUT_MS=20s`
  resolved to a **20 ms** timeout — a deployment where every upstream call fails,
  with nothing in the log pointing at the cause. `resolvePositiveInt` now
  requires a plain run of digits and warns with the variable name and the
  rejected value. Unset and empty stay silent.
- **The credential boundary moved to a file named after it.** `wloFetch` and
  `withCredential` — the single function deciding who receives the operator's
  password — lived in `wlo-config.ts`, a 412-line module also holding env
  resolution, the shared node types and the property-filter helpers. Now
  `src/wlo-fetch.ts` (fetch + credential boundary + `logUpstreamMiss`) and
  `src/wlo-types.ts` (`WloNode`, `SearchResponse`, `SearchCriterion`); the
  barrel `wlo-api.ts` re-exports both, so no downstream import changed. Pure
  relocation, no logic touched.
- **The logger cannot become the failure it is reporting.** A field that cannot
  be serialised (circular reference, BigInt) made `JSON.stringify` throw inside
  `emit`, replacing the real error with a TypeError. The record now degrades to
  its header plus a `logError` field.

### Fixed — the remaining three findings from the chatbot team (2026-08-02)

- **`find_wlo_skills` is no longer offered unconfigured.** Without
  `WLO_SKILLS_COLLECTION_ID` every call failed with "set
  WLO_SKILLS_COLLECTION_ID" — a message aimed at the operator, delivered to a
  model that cannot act on it and cannot guess a valid nodeId. The tool now takes
  its collection as an argument and is registered only when one is configured,
  the same gate the write tools use. The unreachable runtime branch went with it.
- **`includeRaw` now matches its description, and itself.** It promised "the
  original ccm:* / cclom:* property URIs" and delivered five vocabulary fields —
  in JSON. Markdown carried only three, so switching output format silently
  dropped the target group and the resource type. Both now return the same five,
  and the description names them instead of implying the full property bag.
- **`search_wlo_collections` and `search_wlo_topic_pages` no longer contradict
  each other.** One said a Sammlung *is* a Themenseite, the other said it checks
  which collections have one. Measured for "Mathematik": 5 collections, 1 topic
  page. Both descriptions now state the containment — a Themenseite is a
  collection that additionally carries a curated page layout — and each names the
  other tool for its case.

### Fixed — `includeParents` answered "in no collection" for material that was in several (2026-08-02)
Reported by the chatbot team, confirmed by measurement. The flag read
`/node/v1/nodes/{id}/parents`, which carries the ancestor chain for a collection
and an **empty list** for a content item — always, with a `200`. A model reading
that answers "this is in no collection", which is a false statement rather than a
missing one.

- `includeParents` now picks the endpoint that knows: `/parents` for a
  collection, `/usage/v1/usages/node/{original}/collections` for a material
  (resolving a reference id to its original first).
- A failed lookup is reported as such instead of collapsing into an empty list —
  "we could not find out" and "it is in none" lead to different answers.
- Both `get_node_details` and `get_nodes_details` are fixed.
- The test mock that had served `/parents` with a collection for content nodes
  was corrected to what the endpoint actually returns. It was the reason the
  defect survived a full test suite.

### Changed — a timed-out create no longer claims nothing was created (2026-08-02)
The abort hits the response, not the work: measured, a timed-out
`wlo_create_content` had already produced the record. Raising the timeout makes
that rarer, never impossible, so the reply now states the outcome as open and
offers a retry — safe, because the duplicate check finds and names an existing
record instead of making a second one. An ordinary refusal from the repository
is still reported plainly as a failure.

### Changed — upstream timeout default raised to 20 s (2026-08-02)
`WLO_FETCH_TIMEOUT_MS` defaulted to 10 s, which cut a create off mid-flight while
the repository had already made the record.

- Measured per call against staging: creating a `ccm:io` takes **4.2–8.0 s** (18
  samples), everything else stays under 2.5 s, and production reads are faster
  still. The create is the outlier by a factor of three; 10 s left as little as
  1.26× headroom over the worst run.
- Two explanations were tested and discarded first: a cold process is not slower,
  and the total pipeline duration does not matter because the timeout is per
  request.
- The new default is ~2.5× the worst measured call and stays below
  `WLO_TEXT_TIMEOUT_MS` (25 s), which remains the deliberate outlier for
  full-text reads. Both defaults are now named constants, and the test asserts
  the *margin* over the measurement rather than the literal number.

### Changed — submitting for review now reads the record back (2026-08-02)
`wlo_submit_content` was the one write that reported success on the strength of
a `200` alone. The live run showed the submission is verifiable: a submitted
record carries `ccm:wf_status: 200_tocheck` and `ccm:wf_receiver`, one that was
never submitted carries neither.

- The reply now names the status the record actually carries and the group it is
  waiting for, instead of a bare "eingereicht".
- A call answered with `200` whose record shows no workflow status is reported as
  NOT submitted — the same treatment every other silent drop gets. A draft
  sitting in nobody's queue while the user believes an editor has it is the
  failure this prevents.
- A record that cannot be re-read afterwards leaves the outcome explicitly open.

### Fixed — collections could not be created or renamed (2026-08-02)
Found by the first live run against a real repository. Both calls had been
covered by tests the whole time; the tests asserted our own inference back to us,
because the faked upstream accepts any body.

- **`wlo_create_collection`** answered `500` (`cmNameReadableName is null`) on
  every call. The endpoint derives the node name from a top-level `title` field
  in the body; `properties['cm:title']` alone is not read for that.
- **`wlo_rename_collection`** answered `500` (`NodeRef.getId()` on null). The
  update DTO must carry `ref.id` even though the id is already in the path.
- **A collection's description was silently discarded.** The collection endpoint
  accepts `cm:description` with `200` and stores nothing — the fourth measured
  instance of that pattern. It now travels through the node metadata route, and
  a description that still fails to land is reported instead of swallowed.

### Added — metadata proposals (2026-08-01)
Three tools that separate "a model thinks this should say X" from "the record
says X". Both facts stay readable in the repository afterwards.

- **`wlo_suggest_metadata`** stores per-field proposals with a rationale and
  leaves the record untouched. **`wlo_list_suggestions`** shows them with their
  status and the id to decide on. **`wlo_decide_suggestion`** accepts or
  declines one.
- **Accepting applies the value; the endpoint does not.** Measured on staging: a
  suggestion moved to `ACCEPTED` left the node's property absent.
  `/suggestions/v1` records proposals and decisions, nothing more — so accepting
  runs the ordinary write pipeline with its read-back.
- **Order matters, and it is fixed.** The value is written and read back
  **before** the proposal is marked accepted. A proposal marked accepted over a
  record that never received the value reads, to the next curator, as work
  already done; a written value with the proposal still open costs one repeated
  decision and states nothing untrue. A write the repository discarded therefore
  produces no `ACCEPTED` at all, and the reply says the proposal is still open.
- **`type: AI` is permanent, `status` carries the human decision.** The upstream
  `PATCH` takes no type, which matches what the two fields mean: the type records
  that a model wrote the proposal, the status that a person approved it.
  Overwriting the type would not add the approval — it would erase the
  authorship.
- Proposals are validated against the same allow-list as a direct edit, both when
  stored and when accepted. A proposal naming a property this server must not
  write (e.g. `ccm:oeh_lrt_aggregated`) is refused with the property named, and
  declining stays available so it does not sit on the list forever.

### Added — curation, first slice (2026-08-01)
The server can change data for the first time. It is deliberately narrow: one
tool, and the whole safety apparatus around it built before the tool existed.

- **`wlo_update_content`** edits the metadata of an existing record — title,
  description, keywords (added to, not replacing), source URL, language, author,
  publisher, licence, content type, subject, educational level, target group.
- **Two-step confirmation.** A call without `confirmToken` reads the record,
  renders the diff, hands back a single-use key valid for ten minutes, and writes
  nothing. The key is bound to a hash of the planned change, so a preview of a
  harmless edit cannot authorise a different one.
- **Read-back after every write.** edu-sharing answers `200` in three measured
  situations where the value is discarded (MDS filter, missing aspect, missing
  right). Each field is re-read and reported as saved, discarded, or rewritten by
  the repository; a discarded field is never reported as success.
- **Gated twice.** Write tools are not registered for a caller who may not write,
  so they never appear in `tools/list` — and each refuses at call time as well,
  because a host may serve a cached list. Anonymous never writes; an individual
  login always may; the shared service account only with the new
  **`WLO_ALLOW_SERVICE_WRITES`**, since a change under a collective identity is
  attributable to nobody.
- **A fixed licence key list.** An invented licence (a university's name, say) is
  rejected with the value named rather than written to an OER record.
  `ccm:oeh_lrt_aggregated` is never written — the repository derives it.
- **Drafts do not create versions.** Editing uses `PUT`; `commit: true` with a
  `versionComment` closes a round of work as a new version (`POST`).
- Tool descriptors may now declare their own `_meta.securitySchemes`. The
  server-wide `noauth` default is a default, not a rule — a tool that refuses
  anonymous callers must not claim otherwise.
- **`wlo_create_content`** creates a record for a material reachable by URL. A
  duplicate check on that URL runs first and compares each hit's actual URL
  case-insensitively — the API's own "did anything come back" is too loose,
  because the search also returns neighbours. `cclom:title` is deliberately not
  in the create body: measured, the repository replaces a create-time title with
  one derived from the URL, so the title is written in the metadata step after.
  New records go to `-userhome-` under a personal login, or to the shared inbox
  named by the new **`WLO_INBOX_ID`** under the service account.
- **`wlo_submit_content`** hands a record to the editorial review queue. Kept
  separate from creating on purpose: submitting spends a reviewer's attention
  and cannot be taken back quietly, so no draft reaches the queue because
  somebody was still writing.
### Added — `get_node_collections`: from a material back to its collections (2026-08-01)
The one lookup that ran the other way was missing. `get_node_details`'s
`includeParents` returned an empty list for every content node tested, and a
model that receives an empty list answers "this is in no collection" — a false
statement, which is worse than a missing one.

- A **separate tool**, not a flag: `get_node_details` advertises itself as fast
  (metadata only) and is called casually. This costs two upstream round-trips
  for a question that is rarely asked.
- **A reference id is resolved to its original first, always.** Filing material
  into a collection creates a reference node with its own id, and collection
  listings hand those out — but the usage endpoint only knows the original and
  answers `200` with an empty array for a reference. A "try it, resolve on
  empty" fallback was rejected: an empty array is a legitimate answer, and
  reading it as "probably a reference" makes the normal case slow and the empty
  case ambiguous.
- **The empty case is named.** `not_in_any_collection` versus `node_not_found` —
  the usage endpoint answers `500` for an unknown id on both production and
  staging, so it cannot tell them apart, but resolving the node first can.
- A failed lookup throws rather than degrading to an empty list. "We could not
  find out" must not reach a user as "it is in nothing".

Reported and pre-measured by the chatbot team; every claim in that report was
reproduced here before any code was written, and the finished service was run
against the live API on the same nodes.

### Fixed — a local run ignored `.env` entirely (2026-08-01)
`npm run dev`, `dev:http`, `start` and `start:http` did not read `.env`: there is
no `dotenv` dependency and no `--env-file` flag, so only `docker compose` ever
loaded it. A developer who pointed `WLO_REPOSITORY_URL` at staging still had
every local call go to **production**, because the built-in fallback in
`wlo-config.ts` is the production instance. Nothing warned about it.

The four scripts now pass Node's own `--env-file-if-exists=.env` (no dependency
added). `npm test` deliberately does not — the suite must not depend on a local
file. `engines.node` is raised to `>=20.12.0`, the release that added the flag;
`>=20` was promising a runtime that lacks it.

- **Collections**: `wlo_create_collection`, `wlo_rename_collection`,
  `wlo_add_to_collection`, `wlo_remove_from_collection`. Adding and removing
  material are separate tools whose wording cannot be confused with deleting it —
  a collection holds references, and the reference endpoint is one path segment
  away from the node endpoint that would destroy the material for everyone.
- **`wlo_update_compendium`** writes, replaces, or removes a collection's
  editorial prose. Always through the property endpoint: the field is not in the
  metadata set, where `PUT` would answer 200 and store nothing. Removal is its
  own parameter rather than an empty string, because only `null` clears a
  property.
- **`wlo_delete_content`** and **`wlo_delete_collection`**. `recycle=true` is
  always sent explicitly rather than relying on a default. Neither tool promises
  the deletion can be undone: a person-scoped archive query found a deleted node
  once and then returned nothing for the same node minutes later, so
  recoverability could not be demonstrated, and a reassurance we cannot back up
  is how someone loses their material.
- The content type (`ccm:oeh_lrt`) now resolves against the full **`new_lrt`**
  vocabulary — 220 concepts, generated from the published SKOS source by
  `scripts/generate-lrt-vocab.mjs`. Two labels ("Suchmaschine",
  "Stationenlernen") belong to two different concepts each and are reported with
  both candidates rather than silently resolved. The six concepts the vocabulary
  maps to no aggregated type are accepted with a warning, because material
  tagged only with those does not appear under the aggregated content-type
  facets.

### Fixed — auth review (2026-07-31)
A review of the credential chain before deployment; the first finding is the
reason nothing was deployed until it was closed.
- **The public REST layer inherited the service account.** `GET /api/*` and the
  launcher are open to the internet with no login, but the credential chain
  applied to them too, so everything the account could see beyond public was
  world-readable without any authentication — a silent authorization downgrade,
  and a breach of the design's own "anonymous-only" requirement for that
  surface. Measured, not inferred: an anonymous `GET /api/search` produced
  upstream calls carrying `Basic …`.

  **Fixed at the default, not at the call site.** The whole HTTP handler now
  runs anonymous, and the MCP endpoint — the one branch that needs rights —
  resolves the credential chain itself. Opting out per surface would have left
  the same trap for the next surface someone adds; this way a new branch is
  safe without anyone remembering. Behaviour is unchanged, and that the outer
  scope carries the protection was confirmed by removing it and watching the
  public-REST test fail while the MCP one still passed.
- **A caller-supplied account name reached the model unsanitized.** In per-user
  mode the label is whatever precedes the colon in the Basic header; line
  breaks survived into `wlo_auth_status` output, letting a name read as a
  separate instruction block. The repository-supplied authority and profile
  name are now cleaned at the same boundary — those are editable by the
  logged-in person too. The rule moved out of the widget module into
  `text-sanitize.ts`, shared by both sides instead of duplicated.
- **A credential over a non-`https` repository URL** was sent in the clear with
  no warning; the boot check now says so (loopback exempt, so a local
  development instance does not train the operator to ignore it).
- **The endpoint could relay credential guessing.** A client-supplied header is
  forwarded upstream, so WLO logins could be tried from this server's address.
  Capped by the number of *distinct* logins per client
  (`AUTH_CREDENTIAL_LIMIT`, default 10 per 10 minutes) rather than by request
  rate — a per-user client legitimately sends its header on every call, so a
  rate cap would throttle exactly the people it should serve. Values are stored
  as digests, never in the clear.

### Added — tests closing a known gap (2026-07-31)
- **The SSE/ALS integration test the design called for but never got.** The
  plan listed "SSE response mode breaks ALS propagation" as a risk to be
  discharged by a dedicated test; only an isolated unit test existed, which
  would have stayed green while every per-user request silently fell back to
  the service account. Now driven through a real `node:http` server with
  `MCP_SSE=1`, including three concurrent users overlapping in flight. The test
  was confirmed to fail when the propagation is deliberately broken. Result:
  the risk is discharged — propagation works.

### Changed — consistency and drift guards (2026-07-31)
- **The retained Vercel entry point resolves the same credential chain.**
  `api/mcp.ts` ignored the `Authorization` header, so per-user mode would have
  silently done nothing if that path were ever revived — the quiet capability
  gap this server keeps finding elsewhere. It serves only the MCP endpoint, so
  the service-account fallback is correct there and no public surface needs
  holding anonymous.
- **The duplicated follow-up dispatch is pinned instead of merged.**
  `shared/mount.ts` and `search-results/main.ts` carry the same click-handling
  branch; the latter keeps its own copy because it also owns the multi-select.
  Merging them would parameterise the shell for one caller, and these `main.ts`
  files have no behavioural test coverage — only `render.ts` is tested — so a
  refactor could not be shown to preserve behaviour, and adding a DOM test
  runner for a cosmetic gain is not worth a new dependency. A source-level test
  now fails if the two copies drift apart, matching the idiom the project
  already uses for `main.ts`. Confirmed to fire by renaming an attribute in one
  copy.

### Fixed — a misconfigured server reported "nothing found" (2026-07-31)
Found while verifying the auth modes against the real repository, not by
reading code.

- **A rejected credential made every search answer "0 hits" with no error.**
  With a wrong service password, `search_wlo_all` returned
  "Gefundene Treffer gesamt: 0" and `isError: false` — a configuration fault
  rendered as a fact about the world, which the model then passes on as
  "there is nothing on this topic". Cause: `enhancedSearch` treats "every query
  variant failed" the same as "no matches" (`reranker.ts`). One variant failing
  is what `Promise.allSettled` is for; ALL of them failing means the search
  could not be performed, and that now throws. Live re-check with the same
  broken configuration: `isError: true`, "search failed: no query variant could
  be executed (ngsearch failed: 401 Unauthorized)".

### Corrected — a documented fact about edu-sharing was wrong (2026-07-31)
- **"edu-sharing does not reject wrong credentials, it answers as guest" is
  false.** Re-measured against production: wrong credentials get `401`, on the
  identity endpoint and the search endpoint alike, for a wrong password on a
  real account as well as for an unknown user. Only the ABSENCE of a header
  gives `200`/`esguest`. The claim had been copied from a 2026-07-30 probe into
  `.env.example`, both READMEs, `docker-compose.yml`, `docs/TOOLS.md`, the
  design doc, the boot warning, and the `wlo_auth_status` tool description —
  all corrected. The practical consequence is the opposite of what was
  documented: a typo does not degrade to public content, it stops the server
  answering at all.

### Verified live against the real repository (2026-07-31)
- **All three modes confirmed end to end**, the third one for the first time:
  anonymous (no configuration), service account (`mode: "service"`,
  `authenticated: true`), and per-user — the same credentials delivered as an
  `Authorization: Basic` header resolve to `mode: "user"`, proving the header
  path against real WLO rather than a fake.
- **The public-REST fix confirmed under production conditions:**
  `GET /api/search?query=Entwurf` reports 1459 (the public count) while the
  service account sees 1464. Before the fix that surface would have answered
  1464 to anyone, unauthenticated.

### Verified live (service account, 2026-07-31)
The credential chain confirmed against the production repository with a real
WLO account — the part that could not be tested from the API spec alone.
- `wlo_auth_status` → `mode: "service"`, `authenticated: true`, authority and
  display name reported; the boot check logs `repository credential verified`.
- **The account genuinely sees more**, stable across three alternating runs:
  `"Entwurf"` 1459 → 1464, `"Test"` 6805 → 6863, `"intern"` 481 → 482. Small,
  reproducible, and exactly the shape expected of drafts an editor may see.
  Public-facing queries (`"Bruchrechnung"`, subject portals) are unchanged, so
  the anonymous experience is not altered.
- **Operational trap found and documented:** an unquoted `#` in the password
  truncates the value silently — both in `node --env-file` and in Docker
  Compose's `.env` (measured: 13 characters became 3). Combined with
  edu-sharing's silent guest fallback that produces a server which looks
  configured and serves public data only. `docker-compose.yml` now carries the
  two variables plus the quoting rule, and `.env.example` states it.

### Added (the credential chain, finished, 2026-07-30)
- **A configured service account is verified at boot.** Credentials the
  repository rejects are invisible in a normal reply, so a typo would leave the
  server looking configured while nothing works. One probe at startup turns
  that into a log line. (This entry originally said edu-sharing answers as
  guest for wrong credentials; re-measured 2026-07-31 it answers `401` — see
  the correction under the auth review below.) Silent and network-free when nothing is configured: the
  default deployment does not pay for a feature it does not use, and an
  unreachable repository is a warning, never a failed boot.
- **The public REST layer stays anonymous by contract.** A caller-supplied
  `Authorization` header on `/api/*` is not adopted — pinned by a test that
  drives a real HTTP server and inspects the identity at the upstream call.
  Accepting credentials there would turn a deliberately public surface into an
  authenticated API without any of the decisions that would need.
- Setup instructions for the per-user login in `docs/TOOLS.md`, including how
  to build the header and how to confirm it took effect.

### Added (per-user login via the host's connector header, 2026-07-30)
The third rung. A WLO user configures their own credentials once in their AI
host's connector settings; the host sends `Authorization: Basic …` with every
request and the server calls edu-sharing as that person.
- **The model never sees the credentials, and the server never stores them.**
  No login page, no token in the conversation — the two weaknesses the earlier
  envelope design had to accept.
- **Per-request isolation via `AsyncLocalStorage`.** One endpoint serves
  everybody, so the identity cannot live in a module variable; a test
  interleaves three concurrent "requests" and asserts none sees another's.
- **Only HTTP Basic is accepted.** A Bearer header is refused rather than
  forwarded: edu-sharing ignores Bearer instead of rejecting it, so passing one
  on would produce a call that looks authenticated and silently is not.
- Precedence: user header → service account → anonymous. `wlo_auth_status`
  reports which one applied.

Correction to the previous entry: per-user login was never blocked by
edu-sharing. P0 proved OAuth2/Bearer unavailable, and that was over-read as
"no per-user login". `basicAuth` is a declared scheme — which is exactly how
other WLO clients log people in.

### Added (operating modes: anonymous or one service account, 2026-07-30)
The server no longer has to be anonymous. Identity is resolved as a CHAIN, not
as a deployment mode — a service account from the environment, otherwise
anonymous — so a per-user rung can be inserted later without touching callers.
- **`WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD`** authenticate every upstream
  call via HTTP Basic. Unset (the default) is byte-for-byte today's behaviour.
- **The credential travels to the repository and nowhere else.** One place
  attaches it (`wloFetch`), one rule bounds it: Wikipedia, the text-extraction
  service and a look-alike host never see it, pinned by test.
- **`wlo_auth_status`** reports the resolved mode AND whether it actually
  works — two different facts, because edu-sharing answers `200` as guest for
  wrong credentials instead of failing (probed live). A configured account that
  is not being honoured is named as a configuration error rather than hidden.

P0 verification (staging + prod, recorded in
`docs/plans/2026-07-25-wlo-mcp-optional-auth.md`) settled the transport:
edu-sharing's own OpenAPI declares only `basicAuth` and `cookieAuth` — **no
Bearer** — and offers no OIDC discovery or Dynamic Client Registration. The
earlier design's paste-back Bearer envelope and host-managed OAuth are both
unavailable; per-user login stays open pending a decision by the WLO operators.

### Added (the last two display gaps, 2026-07-30)
- **`get_node_details` renders.** The tool that answers "tell me about THIS
  material" returned neither `structuredContent` nor a widget, while the detail
  view for exactly that shape already existed. One node is a list of one: the
  results widget shows its tile, "Details" opens the Einzelansicht with licence,
  source and the follow-up actions. `get_nodes_details` stays plain — it is a
  model-internal batch resolver with no display job.
- **`get_compendium_text` renders in the reading view.** That widget was built
  for "material full text OR editorial compendium prose" (its own header), yet
  the one tool whose output IS editorial prose never reached it. A bulk fetch
  stays one readable document — the same joined markdown the text output
  carries — but with an empty `nodeId`, which is what gates the per-node
  "summarize this" buttons off: the question is ambiguous across several
  collections.

### Fixed (tool + widget audit, 2026-07-30)
All 23 tools called live, every button chain simulated end to end, every widget
fed real tool output. Mechanics were clean (0 tool errors, 0 broken chains, 0
empty widgets); the defects sat one level up, in what triggers what.
- **Three tools advertised the same example query.** `search`,
  `search_wlo_content` and `search_wlo_all` all carried the literal
  "Video zur Eiszeit", so the same request routed to whichever the model
  happened to pick — and `search` returns only `{id,title,url}`, too little for
  a widget. `search` is now described as what it is (the ChatGPT
  knowledge-convention entry point for citations, forwarding to `search_wlo_all`
  for anything user-facing) and `search_wlo_content` as the deliberate narrowing
  to materials only. `search`/`fetch` still overlap in PURPOSE — the convention
  requires them — but no longer in the example a router matches on. A test pins
  that no multi-word example appears in two descriptions.
- **The topic-page markdown headed the answer with the technical variant name.**
  `structuredContent.collectionTitle` said "Mathematik" while the H1 printed
  `variantTitle` — "Fachportalstartseite". The widget used the right order, the
  text path the exact opposite.
- **Searching a portal-level collection answered "0 Treffer" and nothing else.**
  Matching runs over a collection's DIRECT contents; on the Mathematik portal
  that is 15 entries, none matching, with 11 sub-collections one level down.
  The answer now says which of the two it is and names the way forward.
- **`search_wlo_topic_pages` was the last hit-list tool without
  `structuredContent`.** It now projects each theme page onto one collection
  tile (`nodeId` = owning collection, `topicPageUrl` set → "Themenseite
  öffnen") and carries the results widget. Variants stay in the text.

### Added (the topic page stops being a dead end, 2026-07-30)
- **Swimlane cards can now be opened and acted on.** The topic-page widget was
  the only one whose cards did nothing — an external link out of the chat and
  nothing else — which made the most curated view the one where a click replaced
  no typing. Each card now carries "Details" → Einzelansicht (licence, source)
  and, from there, "Volltext anzeigen" / "Ähnliche Inhalte"; a collection in a
  lane offers its contents directly.
- **`renderDetail` moved to `shared/detail.ts`** so both widgets render the same
  view instead of two copies drifting apart, and `shared/mount.ts` grew from
  "render + repaint" into the tile-widget shell (open/close, Escape, focus per
  WCAG 2.4.3, follow-up routing). `search-results/main.ts` keeps its own copy of
  that loop for now because it also owns the multi-select — folding it in is a
  separate change.
- **The selection message names its tool.** Every single-tile button named the
  tool that continues the flow; "Ausgewählte weiterverwenden" was the one that
  did not. It now points at `get_nodes_details` with `nodeIds` — the batch route
  that reports per-id failures instead of failing the whole call.

### Documented (2026-07-30)
- **Follow-up buttons are a ChatGPT capability, and the docs now say so.**
  Injecting a chat message uses `window.openai.sendFollowUpMessage`; the
  MCP-Apps standard bridge offers only `tools/call` and
  `ui/update-model-context`, neither of which starts a user turn. On other hosts
  the buttons are omitted rather than rendered dead, and the widgets are
  display-only — local interaction (detail view, back, tree expansion) works
  everywhere. README (both languages) and `docs/TOOLS.md` state this.
- Widget counts corrected throughout: **four widgets serving ten tools**.

### Fixed (widget flow audit, 2026-07-30)
Walked every button in all four widgets from the click to the tool that has to
answer it.
- **"Themenseite öffnen" named a parameter its tool does not have.** The message
  said "Rufe dazu get_topic_page_content mit dieser nodeId auf", but that tool
  takes query/collectionId/variantId and answers "Bitte query, collectionId oder
  variantId angeben." Proven live: the same id succeeds as `collectionId`
  (866 ms, 8 swimlanes) and fails as `nodeId`. Taken literally the button was
  broken; it worked only when the model translated the name on its own.
  `FOLLOW_UP_PARAMS` now maps each action to the parameter its tool really has,
  and a test checks every entry against the registered tool's input schema.
- **A capped browse branch looked complete.** `browse_collection_tree` bounds
  depth and per-node width and reports it via `hasMoreChildren` / `truncated`;
  the tool's text told the model, but the tree widget rendered neither, so a
  truncated catalogue read as exhaustive. Capped branches now carry a visible
  "… mehr vorhanden" marker.

### Fixed (first live-deployment feedback, 2026-07-30)
Five reports from the deployed server, each traced to a root cause before any
fix (`/better-coding-debug`).
- **One widget now serves every result list.** It was wired to `search_wlo_all`
  alone, so the same request rendered as tiles or as plain text depending on
  which search tool the model happened to pick — "ich suche etwas zur Eiszeit"
  came back as text, "ich suche inhalte zu bruchrechnung" as a widget. The
  renderer accepts the flat `{total,count,results}` shape as well as the
  `search_wlo_all` envelope, splitting it by `nodeType` so collections keep
  their band and their "Inhalte anzeigen" action. Wired to `search_wlo_content`,
  `search_wlo_collections`, `get_collection_contents`,
  `search_wlo_within_collection` and `get_related_content`.
- **Four list tools returned no `structuredContent` at all** — registered with
  the plain `server.tool`, they answered with a text blob. Two of them are what
  the widget's own buttons route to, so "Inhalte anzeigen" and "Ähnliche
  Inhalte" dead-ended in unstructured text. All four moved onto the Apps-SDK
  seam with `nodeListSchema`.
- **The full-text tool was invisible to the router.** `get_wlo_content_text`
  was absent from the server `instructions`, which additionally steered away
  from extra calls — so a request for a material's Volltext produced no tool
  call at all, only an apology. The instructions now name it (and
  `get_collection_contents`). Its own description claimed the call "dauert
  typisch 1–3 Sekunden" and advised against it; measured live, the repository
  path answers in **288 ms**. The claim is corrected and the discouragement
  scoped to the external-extraction fallback that is actually slow.
- **Content tiles were too tall and narrow.** The preview box was a portrait
  3/4, which at a 220px column made the card ~470px tall and cropped the
  landscape previews most materials have. Now 16/9 — the card stays portrait,
  the image stops dictating its height.
- **The selection bar sat behind every result.** It was emitted after the grid
  and pinned with `position: sticky`, but the widget document deliberately has
  no scrollport ("the host sizes the iframe"), so sticky degraded to static at
  the very bottom. It now renders above the grid.

### Fixed (pre-deploy audit follow-up, 2026-07-30)
Every finding from the pre-deploy audit, resolved.
- **Follow-up prompts sanitize the title.** A control character or a runaway
  title from repository metadata went into the message verbatim;
  `sanitizeTitle` now flattens control characters, collapses whitespace and caps
  the title at 120 characters. The three remaining prompt builders collapsed
  into the one in `shared/follow-up.ts`.
- **`src/topic-page-api.ts` split in two** (448 lines, two reasons to change).
  Discovery — searching page variants, resolving a variant to its owning
  collection — stays; parsing what a page SHOWS moved to
  `src/topic-page-structure.ts`. A pure move: 547/547 tests unchanged.
- **A broken `WLO_TEXT_EXTRACTION_URL` now disables the service instead of
  building an unusable request target.** No scheme, a non-http(s) scheme, or a
  query/fragment → the external path is off and a warning is logged. It
  deliberately does **not** fall back to the default: a typo must not redirect
  material URLs to a host the operator never chose.
- **Three env variables were missing from the README table** —
  `WLO_TEXT_EXTRACTION_URL`, `WLO_TEXT_TIMEOUT_MS`, `WLO_TOPIC_POOL` — although
  `CONTRIBUTING.md` requires both places. Added in both languages.
- **`get_wlo_content_text` was missing from README.de.md** (tool table and
  detail section) while the English README documented it.
- **Historical tool counts are now marked as historical** rather than silently
  read as current: the O9 benchmark covered the 22 tools registered that day,
  and the MCP Inspector cross-check ran against those same 22 — the 23rd is
  covered by the conformance test, not by that Inspector run.
- **Dev dependencies updated in range** (`@types/node` 20.19.43, `tsx` 4.23.1),
  clearing the low-severity esbuild advisory that came in through `tsx`.
  `npm audit` is clean at every level. `CONTRIBUTING.md` now records why
  `@types/node` 26, TypeScript 7 and zod 4 are held back.

### Added (every tile continues a flow, 2026-07-28)
An audit of all four widgets found the same gap repeatedly: cards that showed
something but offered no way to *do* anything with it, so the user had to type
what a button could have carried.
- **Collection and topic-page tiles were dead ends** — a link out to
  edu-sharing and nothing else. Each now carries the one action that continues
  the conversation: a collection with a Themenseite opens that, a plain one
  lists its contents. One primary action per card, never two competing ones.
- **The detail view now leads to the full text** (`get_wlo_content_text`) and to
  similar materials (`get_related_content`). The reading widget and its tool
  existed but nothing in the UI routed to them.
- **Branch nodes in the browse tree could only be unfolded, never opened.** They
  now carry the same "Inhalte anzeigen" button as leaf nodes, so a subject with
  sub-topics no longer hides its own materials behind typing.
- **`shared/follow-up.ts` is the single place a button becomes a message.** Two
  properties are pinned by test for every action: the message names the NODE ID
  (the content tools resolve by id; a title-only prompt made the model ask for
  one) and the TOOL that does the job, so the model continues the flow instead
  of guessing. Keeping the mapping in one module stops the four widgets' wording
  from drifting apart.
- Every action button is a real `<button>` with an accessible name that includes
  the material, and none is rendered unless the host can take a follow-up
  message — a control that cannot work is worse than no control.

### Fixed (tiles are uniform, and selectable, 2026-07-28)
Cards in a row were interchangeable in purpose but not in size: a tall document
scan next to a wide video thumbnail, or a terse description next to a verbose
one, moved the licence rows and the Details button to a different height in
every card (user report 2026-07-28). Portrait tiles are wanted — ragged ones
are not.
- **One preview format for all tiles** (`3 / 4`, portrait, `object-fit: cover`),
  so the image fills a fixed box instead of dictating the card's height.
- **Title and description clamped to a fixed line count** (2 and 3) with that
  height reserved up front, so a one-line description and a four-line one leave
  the card the same size. The full text stays in the DOM for screen readers and
  the title still links to the complete resource.
- **The fact rows and the Details button are anchored to the bottom**
  (`margin-top: auto` on a `flex: 1` body), so licence and source line up across
  a row rather than floating wherever the text happened to end.

### Added (pick materials and carry them into the chat, 2026-07-28)
A teacher who finds three fitting worksheets wants to work with *those three*.
- **A selection checkbox per content tile** — a native `<input type="checkbox">`
  (keyboard-operable and announced without ARIA gymnastics), named per material
  so it is unambiguous out of context, on a 32 px hit area over the preview.
- **An action bar** appears once something is ticked (never a "0 selected"
  strip), sticky so it stays reachable in a long list, and `aria-live="polite"`
  so the changing count is announced without interrupting.
- **"Ausgewählte weiterverwenden"** injects a user message listing each material
  **with its nodeId**, so the model can load them — the lesson from the browse
  widget, whose title-only prompt made it ask for an id. Widget state persists
  the ids; titles are backfilled from the rendered tiles after a re-mount, and a
  material whose title cannot be recovered travels as its id alone rather than
  as empty quotes.
- Selection is gated on `canFollowUp()`: without a host that can take the
  message, no checkboxes and no bar ship — a selection nothing can act on is
  worse than none. As everywhere else, the widget calls no tool itself.

### Added (W5 reading widget + Markdown subset renderer, 2026-07-28)
A 41 000-character full text is unreadable as a wall of plain text, and a reader
who sees a material wants to *do* something with it. W5 renders the text and
hands the conversation the next step.
- **`shared/markdown.ts` — a deliberately narrow Markdown subset**, not a
  parser: headings, paragraphs, lists, blockquotes, fenced code, rules, bold,
  italic, inline code and http(s) links. The source is escaped FIRST and only
  the recognised subset is turned back into markup, because the text comes from
  third-party publishers and an external conversion service. No package was
  added: a general parser widens the attack surface for no benefit and would
  dwarf the 7–9 kB widget bundles, and a pure function also serves the REST
  layer, which a browser-only package could not. A whitelist test asserts that
  eight hostile inputs (`<script>`, `<iframe>`, `<svg onload>`, `data:` links,
  markup inside headings/lists/quotes) can produce no element outside the
  renderer's own tag set.
- **Widget W5 `reading`**, attached to `get_wlo_content_text`. Shows the text,
  states its provenance as a visible fact (repository vs. linked page, with the
  link), flags truncation, and gives each empty cause its own wording instead of
  a blank panel — `access_denied` reads "not publicly accessible", not "no text".
- **Follow-up actions**: "Zusammenfassen", "Einfacher formulieren", "Aufgaben
  ableiten". They inject a user message that names the material AND its nodeId,
  so downstream tools can resolve it — the lesson from the browse widget, whose
  title-only prompt made the model ask for an id. Like the tree, the widget
  never calls a tool itself: ChatGPT mirrors a widget-initiated result back as
  new toolOutput and may re-mount the frame. Rendered only when the host can
  inject a message (`canFollowUp`), so no dead controls ship.
- Document headings render one level down (`#` → `h2`): the widget title owns
  the page's only `h1`, and two competing top-level headings would break the
  outline screen readers navigate by.
- **Every button now gets a visible focus ring by default.** The shared
  stylesheet declared focus rings per class, so each new control shipped without
  one until someone remembered — an accessibility floor that depended on memory.
  The existing per-class rules are left in place (now redundant, harmless).

### Added (`get_wlo_content_text` — the material's own text, 2026-07-28)
Until now every tool returned metadata *about* a material; none returned the
material. A teacher could be told a worksheet exists but not work with it.
Plan: `docs/plans/2026-07-28-content-text-and-widget-actions.md`.
- **New tool `get_wlo_content_text`** (23rd tool): full text by `nodeId`, with
  `source`, `charCount`, `truncated` and — on a miss — a `reason`
  (`no_text_no_url`, `extraction_failed`, `node_not_found`), matching the
  convention `get_topic_page_content` established.
- **The repository is the primary source.** Measured across 32 live records:
  edu-sharing's own `/textContent` already holds usable text for **29 of them**,
  for externally linked pages as well as attached files. The external
  text-extraction service is the fallback for the remaining link-only records —
  it offers *only* `POST /from-url` and answers **424** for an edu-sharing
  download URL, so it cannot serve repository-hosted files at all.
- **No in-process conversion** (no PDF parser, no Markitdown). Both paths are
  remote HTTP, i.e. asynchronous I/O; a CPU-bound converter would block the
  single Node thread for every other user — the explicit reason for this design.
- Node metadata and the text are read **in parallel**: the text read is the slow
  one (median 4.6 s live), so fetching the title and fallback URL alongside it
  costs no extra wall time.
- `WLO_TEXT_EXTRACTION_URL` (default the staging service, **empty disables the
  external path**) — every edu-sharing instance runs its own, so the address is
  configuration. Only public material URLs are ever sent there.
- `WLO_TEXT_TIMEOUT_MS` (default 25000) for both full-text paths.
  `getNodeTextContent` accepts the override: `/textContent` was measured at a
  maximum of 9.2 s, which the 10 s default would cut off — losing a text that
  exists.
- **edu-sharing converts PDF/DOCX/PPTX itself.** Of 10 real binaries found in a
  250-record sample, 9 are repository-hosted, and `/textContent` returns their
  text — 115 834 characters from one PDF, 44 764 from another, 37 940 from a
  PPTX, 13 083 from a DOCX. No local converter is needed for hosted files
  either; the question was never conversion.
- **`access_denied` as its own reason.** The remaining hosted files answer
  **403 on both** `/textContent` and their download URL: they exist but are not
  public. Reporting that as "no text stored" (or, worse, as `node_not_found` —
  such a node refuses its metadata too) points at the wrong problem. A refused
  read is now checked before the not-found branch and reported as
  `access_denied`; no converter can help there, only rights can. `wlo-node.ts`
  gained `readNodeTextContent`, which reports the HTTP status alongside the
  text; `getNodeTextContent` delegates to it and keeps its signature, so the
  five other call sites are untouched.
- Tool descriptions now state the cost trade-off explicitly: `get_node_details`
  is the fast metadata read (~0.3 s), `get_wlo_content_text` the slower content
  read (1–3 s). Both remain available; the model is told which to reach for.
- Verified live: worksheet records returned their actual text from the
  repository in 1.5–2.2 s with truncation and provenance reported, a
  permission-restricted DOCX returned `access_denied`, and an unknown id
  returned `node_not_found`.

### Fixed (licence is stated, never omitted, 2026-07-28)
A missing licence and a permissive one looked identical: the tile and the
Markdown output simply dropped the row. For a teacher that is the reading that
is unsafe to act on — "no licence stated" means *do not* treat it as free.
- The licence row is now always rendered; absent data reads "nicht angegeben"
  (`not stated` in English), matching the REST page's existing "Lizenz unklar".
- The property itself was never missing on our side: `ccm:commonlicense_key` is
  in `DISPLAY_PROPS` and reaches `FormattedNode.license`. It is genuinely unset
  upstream on many records — all six sampled Tutory worksheets lack it even at
  the full `-all-` projection, where edu-sharing itself reports a "none" licence
  icon.

### Changed (bounded, self-disclosing browse tree, 2026-07-27)
Measuring the tools' **opt-in modes** — which the first sweep had not covered —
exposed the real outlier: `browse_collection_tree` at depth 2 with
`includeContentPreview` took **11.7 s and returned 460 kB**. The tree fetched up
to 30 sub-collections per node with no overall bound (a 15-node portal yields
~100 nodes) and every enrichment then cost one upstream call per node — up to
1500 upstream calls from a single tool call in the worst case.
- **The tree is now bounded and says so.** The slice per parent is derived from
  a total node budget (150) and capped at 10, computed *before* the walk so
  every parent gets the same size — a counter drained by concurrent workers
  would have made the output nondeterministic. Depth stays capped at 2.
- **Truncation is disclosed, not silent.** A node whose children were cut
  carries `hasMoreChildren`, the envelope carries `truncated`, and the Markdown
  output names the exact follow-up call (`browse_collection_tree mit
  nodeId=…`). The tool description instructs the model to tell the user and
  open a branch deliberately instead of presenting a slice as the whole tree.
  Detecting "there is more" costs nothing: the walk fetches one child more than
  it shows rather than spending a round-trip on a count.
- The preview pass now runs at the level-1 width instead of 5.
- Measured against the production repository: depth 2 with preview 11.7 s →
  **6.5 s** (460 kB → 362 kB), with counts 5.1 s → **4.0 s** (103 kB → 84 kB),
  depth 1 with counts 2.0 s → **1.5 s**.
- Still expensive by nature: `includeContentPreview` costs one upstream call per
  tree node. It is opt-in, off by default, and now bounded — but a caller that
  enables it on a wide tree should expect seconds, not milliseconds.

### Changed (fan-out sweep across every tool, 2026-07-27)
All 22 tools were benchmarked live with realistic arguments (two runs each) to
find where time actually goes instead of guessing. Result: most tools already
answer in under a second; three call sites carried avoidable waiting.
- **Mode-B candidate check now uses `WLO_TOPIC_POOL`** instead of a hard-coded
  width of 4. `findTopicPagesByQuery` examines up to 12 candidate collections,
  each costing a metadata read plus (when it owns a page config) a children
  read — three to four sequential waves. Measured in isolation against
  production: 1797 ms at width 4, 788 ms in one wave. No second knob: it is the
  same class of work as the Mode-C fan-out, bounded by the same upstream.
- **`getTopicPageContent` gained a both-ids fast path.** Given a collectionId
  *and* a variantId it now reads both nodes in parallel instead of walking
  collection → page-config folder → variant. `findTopicPagesByQuery` returns
  both, so the query path and `search_wlo_topic_pages`'s `includeContent` leg
  now pass them through; the collection is still read, so the page header
  survives. Measured: 1238 ms → 774 ms for that stage.
- **`browse_collection_tree` level-1 fan-out 5 → 10.** At depth 2 each level-1
  node costs exactly one `/children` call and level-2 nodes do not recurse, so
  the width was four sequential waves for a 20-child portal. The nested pool is
  now a separate, deliberately narrow constant (4), because it only performs
  I/O on the opt-in `includeContentCounts` path — that keeps the worst case
  bounded at 40 concurrent calls rather than squaring the wider level-1 width.
- Also narrowed the candidate metadata read in `getCollectionThemePages` to the
  three owner fields it actually uses (it ran `-all-` on the Mode-B hot path).
- Measured locally against the production repository, best of two runs:
  `get_topic_page_content(query)` 3253 → **2175 ms**, `browse_collection_tree`
  depth 2 2899 → **1968 ms** and depth 1 1378 → **943 ms**,
  `search_wlo_topic_pages(query)` 1621 → **1191 ms**. Every other tool was
  already at or below ~1.2 s and was left alone.
- Concurrency was verified empirically rather than assumed: against the live
  server, five simultaneous tool calls cost the same per call as a single one
  (factor 0.96) and ten cost 1.65× — far from the factor 10 that serialization
  would produce. The limit that appears at ten is edu-sharing, not this server.

### Fixed (topic-page owner resolution was silently broken, 2026-07-27)
Follow-up to the latency work below: profiling the remaining 7 s revealed that
Mode C was not merely slow but **wrong**, and had been for as long as the
`/parents` walk existed.
- **`/parents` answers 500 (AccessDeniedException) for anonymous callers on
  page-config folders.** `getNodeParents` degrades a non-OK response to `[]`,
  so every owner resolution failed silently: the listing showed identical
  "Fachportalstartseite" titles, no `topicPageUrl`, and a `collectionId` that
  was really the variant id. Live-verified against production; `-all-` and a
  narrow projection fail alike, so this predates the projection change.
- **Replaced the walk with two `/metadata` reads** along
  `virtual:primaryparent_nodeid` (variant → page-config folder → collection).
  That endpoint works anonymously and costs ~0.19 s instead of ~1.1 s.
- A collection may own **several** page-config folders while its own
  `ccm:page_config_ref` names only the active one (5 of 25 sampled pages), so
  the folder is deliberately not required to match that ref — requiring it
  would drop those pages. Carrying `ccm:page_config_ref` at all is what marks a
  collection as a Themenseite owner, exactly as before.
- **Candidate pool factor 3 → 2.** The theoretical bound was three variants per
  page (one per target group); the live data averages 1.10 (108 variants across
  98 pages: 92 with one, five with two, one with six), so factor 2 keeps ample
  headroom and the one-shot top-up covers outliers.
- Filtering the listing to a single target group was evaluated and rejected:
  98 of 108 variants carry no target group at all, and a server-side `teacher`
  filter returns 3 variants covering 3 of 98 pages.
- Measured against the production repository at the default `WLO_TOPIC_POOL=10`:
  `{maxResults: 20}` 9.9 s → **3.2 s**, `{maxResults: 10}` 4.5 s → **1.4 s**,
  `{maxResults: 5}` 2.8 s → **0.66 s**, with `educationalContext` **0.55 s** —
  while the payload grew (real titles and URLs where there had been none).
  Against the originally reported 17–19 s that is roughly a factor of six.
- Scope check: `/parents` is fine for ordinary collections (200, ~0.4 s) and
  fails for content nodes (`ccm:io`), which `getNodeBreadcrumb` already
  documents and tolerates. Only the page-config case was undiagnosed.

### Security (dependency advisories, 2026-07-27)
The CI `npm audit --omit=dev --audit-level=high` gate failed; both advisories
came from the single runtime dependency `@modelcontextprotocol/sdk`.
- **`@modelcontextprotocol/sdk` 1.29.0 → 1.30.0.** The moderate
  `@hono/node-server` advisory (GHSA-frvp-7c67-39w9, path traversal in
  `serve-static` on Windows via encoded `%5C`) was unreachable under 1.29.0,
  which pinned `^1.19.9`; 1.30.0 declares `^1.19.9 || ^2.0.5` and the patched
  2.x becomes installable. Resolved: `@hono/node-server` 1.19.14 → 2.0.12.
- **`fast-uri` 3.1.3 → 3.1.4** (high, GHSA-v2hh-gcrm-f6hx, host confusion via a
  literal backslash authority delimiter), reached through `ajv`, whose `^3.0.1`
  range already allowed the fix — only the lockfile was holding it back.
- No `overrides` were needed; every version stays inside the range its parent
  declares. `npm audit --omit=dev --audit-level=high` now reports 0
  vulnerabilities.
- Verified beyond the suite because `@hono/node-server` crossed a major version
  and it builds the Web Request the transport sees: over a real socket, `POST
  /mcp` with `Accept: application/json` only, and with no `Accept` header at
  all, both still return 200 with all 22 tools — the `rawHeaders` Accept patch
  in `http-app.ts` survives the bump. Tool latencies and response sizes are
  unchanged.
- Re-checked the standing follow-up: SDK 1.30.0 still has zero occurrences of
  `securitySchemes`, so the `_meta.securitySchemes` fallback in
  `apps/tool-defaults.ts` remains the maximum this SDK can emit.

### Fixed (topic-page listing latency, 2026-07-27)
A client measured **17–19 s** for `search_wlo_topic_pages` without a `query`
(Mode C) while every other tool answered in 1.3–6.5 s. Analysis and plan:
`docs/plans/2026-07-27-topic-pages-latency.md`.
- **Removed a dead upstream call per variant.** Mode C fetched the owning
  collection's full metadata only to read `ccm:page_config_ref` — a value the
  parent walk already holds (it selects that collection *because* the property
  is set) and that `buildTopicPageUrl` only truthiness-checks. The resolver now
  returns it (`TopicPageOwner.pageConfigRef`), halving the round-trips. This
  also removes a silent failure path: a failed metadata fetch used to yield an
  empty `topicPageUrl`.
- **Fixed a cache stampede in the parent walk.** `resolveVariantCollection`
  cached the *resolved value*, so sibling variants enriched concurrently all
  missed the cache and re-ran the same walk (proven by a call-count test: three
  siblings of one page cost three walks). It now caches the in-flight promise.
- **Replaced the candidate floor.** `max(50, maxResults * 5)` charged a
  5-result request for 50 variant enrichments; now `max(10, maxResults * 3)`
  (three = the maximum variants per topic page), with a single top-up to the
  former pool size when the merge falls short — and none when upstream already
  returned everything it had.
- **Narrowed the projection on the hot path.** `getNodeParents` and
  `getNodeMetadata` accept an optional property list (default stays `-all-`);
  the owner walk now requests the three fields it reads instead of ~59 per node
  of the whole ancestor chain.
- Measured with the new `scripts/measure-topic-pages.mjs` against the production
  repository: `{maxResults: 20}` 9.9 s, `{maxResults: 10}` 4.5 s,
  `{maxResults: 5}` 2.8 s — and 6.3 / 3.0 / 1.8 s at `WLO_TOPIC_POOL=20`, at
  unchanged response sizes. That 10 and 5 now differ at all is the direct
  evidence the floor is gone (the client measured 8.5 s vs 8.2 s before).

### Added (topic-page diagnostics & tuning, 2026-07-27)
- **`WLO_TOPIC_POOL`** (default 10) — concurrency of the Mode-C owner
  resolution, the server's most fan-out-heavy path. Ships inert; raising it
  trades upstream load for wall-clock.
- **`reason` on empty topic-page results** — `get_topic_page_content` and
  `GET /api/topic-page` now report *which* of five causes produced an empty
  payload (`no_match`, `node_not_found`, `no_page_config_ref`, `no_variant`,
  `empty_config`). The reporting client was probing three candidate collections
  in sequence because every miss looked identical.
- **`outputFormat: json` is now honoured on the empty path too.** It previously
  returned German prose in the text block while the success path returned JSON,
  so clients parsing that field broke on exactly the case they needed to inspect.
- `search_wlo_topic_pages` states that it has **no `discipline` filter** and
  points at `educationalContext`/`targetGroup` (unknown arguments are dropped
  silently by schema validation — the client sent `discipline` for months
  without any signal). Its `sort` description no longer implies that `alpha` is
  a global A–Z index; it sorts the fetched candidate set.

### Changed (deployment scope, 2026-07-27)
- Documented that production runs **self-hosted and persistent** (Docker on the
  vServer). The Vercel entry point (`api/mcp.ts`, `vercel.json`) is retained but
  not operated; serverless cold-start reasoning no longer applies. `PERFORMANCE`
  O7 (in-process cache) was re-scoped accordingly and now carries the constraint
  that its cache key must include the identity once optional auth lands.

### Added (fetcher-proof search entry, 2026-07-17)
Root cause across all live chat tests: AI fetch layers strip the query string
from MODEL-built URLs (anti-exfiltration), so every REST call arrived as a bare
`/api/search` → 400 — reproduced live; the exact filtered URL returns 200 from
a browser/curl. Server-side countermeasures (nip.io stays for now, per
operator decision):
- **`GET /api/search/<term>` path form** — the term rides in the path and
  survives query-string stripping; optional filters stay query params and
  degrade gracefully. Explicit `q` wins over the path term. Malformed
  percent-encoding → 400 (guarded decode, like the skills route).
- **`GET /api/search` without a term → 200 guidance envelope** (deliberate
  contract change; over-long/bogus input still 400s). Hosts surface only the
  status of a 4xx to the model, so the recovery instructions must live in a
  200 body: empty buckets, empty `query` echo (trips the template's freshness
  check), and `warnings` teaching the path form + paste-back.
- **`/llms.txt`** (self-describing API surface for AI fetchers) on the static
  allow-list; **`Cache-Control: no-store`** on all REST responses.
- Launcher templates + example URL now lead with the path form (DE/EN), carry a
  fixed URL pattern with the example term "OER" (labelled "replace with the
  user's topic" — no warm-up call), and tell the chat to explain the options
  (topic + optional subject/level/type filters) before asking for the topic.
- **Templates rewritten in the USER's voice; authorization claims removed.**
  Live-observed: Claude flagged the launcher prompt as prompt injection at
  chat start and distrusted the URL even more. The prompt WAS carrying the
  classic injection signature — a prefilled instruction block in command tone
  ("Du hast Zugriff…") plus an authorization claim ("dein Abruf-Werkzeug DARF
  sie laden") and ALL-CAPS urgency ("ERSTER AUFTRAG"). Both language templates
  now read as the user's own request ("Ich möchte offene Bildungsmaterialien
  finden… bitte nutze die API so", "Meine erste Suche: {url} – bitte direkt
  abrufen"); the claim and the caps are gone, pinned by doesNotMatch tests.
  The launcher field hint still explains that a pre-picked topic lets Claude
  run the first search without a paste-back. In-chat FOLLOW-UP topics still
  need the paste in Claude's refusal mode — that is the host's provenance
  rule, only the MCP connector removes it.
- **Both bundled skills** (`public/skills/*.skill.md`) updated the same way:
  path-form search leads, the stripped-query failure mode is named with its
  recovery (path form / paste-back), and the wlo-search failure table reflects
  the new missing-term contract (empty `query` + `warnings` ≠ "no results").
  Pinned by a content test in `tests/rest-skills.test.ts`.
- **`?format=html` on `/api/search` (both forms)** — renders the same envelope
  as a minimal, escaped, self-contained HTML page (`src/rest/search-page.ts`,
  reusing the widgets' `escapeHtml`). Evidence arrived after the first pass:
  ChatGPT's browsing DID retrieve a user-pasted API URL but could not use the
  body ("keine WLO-JSON-Suchantwort") — its reader pipeline consumes HTML, not
  raw JSON. Templates + skills teach reader-only chats to try `?format=html`
  before falling back to the JSON paste. Doubles as the human share link.
Rejected from the same proposal, with reasons: positional multi-segment paths
(`/search/<q>/<fach>/<typ>` — ambiguous positions; filters already degrade
gracefully), blanket never-400 fuzzy matching (filters are already lenient;
invalid input should stay loud), HTML via `Accept`-header content negotiation
(invisible and fragile — superseded by the explicit `?format=html` view once
live evidence arrived), `Vary: Accept` (no content negotiation exists).

### Changed (launcher instruction templates, live-finding driven, 2026-07-17)
Both language templates (`instruction_tpl` in `public/launcher.html`) now encode
what the live chat tests showed:
- **MCP first** when the WLO MCP is registered natively.
- **No test/warm-up call** — without a topic the chat must ask, not invent
  "test" (observed live).
- **User-paste fetch fallback:** claude.ai's fetch tool restricts MODEL-built
  URLs — live evidence indicates it strips their query string (anti-exfiltration
  safeguard), so our API correctly answers 400 ("q is required"; reproduced:
  bare `/api/search` → 400, the exact status every chat test saw on every
  endpoint), while the same URL pasted by the USER is fetched intact → 200.
  This — not a response cache — explains "first call fails, re-pasted call
  works" AND the "cache ignores the query string" illusion. The template now
  teaches the workaround, including "a 400 on a correctly built URL = your tool
  stripped the query → ask for a paste-back, do not blindly retry".
- **Query-echo self-check** (`response.query` must match the term) and honest
  output rules: paraphrase noisy `description`, empty `license` = "licence
  unclear", never invent hits.
Pinned by 2 new template tests (DE + EN) in `tests/launcher-instructions.test.ts`.

### Added (deploy fingerprint on /health + audit quick wins, 2026-07-17)
- **`/health` now carries `widgets: { <name>: <8-hex build hash> }`** — the
  content-addressed widget hashes as a deploy fingerprint (self-hosted AND
  Vercel handler). Whether a fix is actually live is now one curl compared
  against the local build, replacing the manual byte-diff probe that two live
  test rounds were lost without (audit roadmap #3). Tolerant when widgets are
  not built (empty map).
- Audit quick wins: dead `.wlo-tree__loading` CSS removed; orphaned i18n keys
  `loading`/`loadError` removed from both locales (zero usages verified) —
  all three widget bundles shrank measurably.

### Fixed (browse "Inhalte anzeigen" asked for a Node ID, 2026-07-17)
- The follow-up button injected a title-only message ("Zeige mir die Inhalte der
  WLO-Sammlung „X“"), so the model had no nodeId and answered that it needs one
  (live). The prompt now embeds the nodeId and names the tool
  (`askFollowUpPrompt`, pure + unit-tested): "… (nodeId: <id>). Rufe dazu
  get_collection_contents mit dieser nodeId auf." The button already carried
  `data-node-id`; the click handler now passes it through.

### Changed (browse widget redesigned as a STATIC pre-expanded tree, 2026-07-17)
- **No more in-widget tool calls — the flicker class is eliminated by design**
  (user-approved). ChatGPT mirrors widget-initiated `callTool` results back as
  new toolOutput (and may re-mount the frame); the earlier echo-guard fix never
  got a valid live test (byte-probes showed the old build was still deployed),
  and rather than keep fighting undocumented host behaviour the widget now
  renders PRE-EXPANDED from the data the tool call already delivered (nested
  `children`, e.g. `browse_collection_tree` depth=2). Toggles are purely local;
  collapse choices persist via widget state.
- **Deeper levels via follow-up buttons:** childless collections render an
  "Inhalte anzeigen" button that injects a follow-up user message
  (`sendFollowUpMessage`, ChatGPT extension) — the MODEL runs the next tool
  call and renders a fresh card. Capability-gated: hosts without the API
  (standard MCP-Apps bridge) get no dead buttons, the ↗ links remain.
- Reducer shrank to init/toggle (loading/error states gone); `isOwnDrilldownEcho`
  removed as dead. Old drill-down tests deliberately replaced by the new
  contract's tests + source pins (`no callTool in browse main.ts` is now a
  hard regression guard; focus({preventScroll}) pin unchanged).

### Fixed (browse tree reset/flicker on expand in ChatGPT, 2026-07-17)
- **Expanding a subcategory no longer resets the tree.** Root cause: ChatGPT
  mirrors a WIDGET-initiated `callTool` result back as a new toolOutput
  (`openai:set_globals`); the browse widget's onUpdate treated that echo as a
  fresh seed and re-initialised the whole tree — visible as "loading… →
  flicker → expansion gone". Fix: the widget tracks which nodeIds it fetched
  itself; an output whose `parent` is in that set is recognised as an own
  drill-down echo (`isOwnDrilldownEcho`, pure + unit-tested) and repaints
  WITHOUT re-seeding. Foreign outputs (model-initiated calls, portal lists)
  still re-seed as before. This was the second, independent cause behind the
  earlier flicker report (the first — focus() scroll-jumping the iframe — was
  fixed this morning); wiring pinned by a source-level test since browse
  main.ts is DOM glue verified live.

### Fixed (ChatGPT "Failed to fetch template" after redeploys, 2026-07-17)
- **Stale widget URIs keep resolving.** Root cause: every redeploy rolls new
  content-addressed `ui://` URIs, but the server registered ONLY the current
  one — a host whose connector still held the previous tool descriptor
  (ChatGPT syncs tools/list on connect, not per chat) then read a dead URI →
  "Fehler beim Laden der App / Failed to fetch template" (the tool call itself
  succeeded; Claude was unaffected only because fresh chats re-sync). Fix: a
  per-widget `ResourceTemplate` (`ui://widget/<name>-{hash}.html`) now serves
  the CURRENT build for ANY old hash of a known widget — like a CDN keeping old
  asset paths alive. New URIs still roll (cache-busting intact); unknown widget
  names still 404. Regression test in `tests/apps-resources.test.ts`.

### Changed (tool descriptions lead with the trigger, 2026-07-17)
- **Every relevant tool description now LEADS with its trigger** (the user
  intent / when-to-use), well-formulated and up front, instead of opening with
  architecture or mechanics — so the model picks the right WLO tool from a
  natural teacher query.
- The primary search tools carry concrete, teacher-phrased triggers in the
  first ~256 chars (where ChatGPT/OpenAI weights tool selection): a query like
  "Video zur Eiszeit" now fires WLO instead of a generic web search.
  `search_wlo_all`, `search_wlo_content`, `search_wlo_collections`, the ChatGPT
  `search` tool and `get_topic_page_content` name concrete material types
  (Video/Arbeitsblatt/Übung) + example queries up front and say "statt einer
  Websuche".
- The drill/browse/detail tools were reordered trigger-first too:
  `get_subject_portals`, `browse_collection_tree`, `get_collection_contents`,
  `search_wlo_within_collection`, `get_related_content`, `get_node_breadcrumb`,
  `get_collection_stats`, `get_compendium_text` now open with the natural
  request they serve (e.g. "mehr wie dieses", "welche Fächer gibt es?", "was
  steckt in dieser Sammlung?"). Behaviour and parameters unchanged.
- Left as-is (already capability/trigger-first): `get_node_details`,
  `get_nodes_details`, `lookup_wlo_vocabulary`, `lookup_wlo_publishers`,
  `find_wlo_skills`, `fetch`, `wlo_health_check`. `get_wikipedia_summary` keeps
  its explicit "do NOT use for WLO material" guard so it does not steal
  material queries.
- Pinned by `tests/tool-triggers.test.ts` (concrete trigger + example query in
  the first 256 chars of the primary search tools).

### Added (get_topic_page_content one-step topic path, 2026-07-17)
- **`get_topic_page_content` now accepts a `query`** (topic name) and resolves
  the best-matching Themenseite itself, returning render-ready swimlanes in a
  SINGLE call. Root cause it fixes: the swimlane widget only triggered via the
  two-step chain `search_wlo_topic_pages` → `get_topic_page_content`, which the
  model broke in practice, so the swimlane view "never triggered" (live-observed
  2026-07-17; the tool itself resolves swimlanes correctly — proven by a live
  probe). A direct request ("zeig die Themenseite zu Optik") now renders in one
  step; `variantId`/`collectionId` still work for the post-search path.
- The topic→collection resolution (search_wlo_topic_pages Mode B) is extracted
  to `services/topic-page.findTopicPagesByQuery` and shared by both tools (no
  duplication); Mode B behaviour is unchanged (its 3 characterization tests
  stay green). A query that matches nothing returns the empty-payload contract,
  not an error. 3 new tests in `tests/tools-topic-page-content.test.ts`.

### Changed (search-results: collection band above content, 2026-07-17)
- The topic-page + collection tiles now sit in one lightly separated band above
  the material grid (edu-sharing look), replacing the per-section left-border
  accent with a single subtle divider + spacing. The band (and its divider) is
  dropped entirely for content-only results, so there is never a stray
  separator. `wlo-section--emphasis` removed as dead. Tests updated to pin the
  band + the no-band case.

### Fixed (browse tree flicker / viewport jump in ChatGPT, 2026-07-17)
- **`focus()` no longer scroll-jerks the host iframe.** Expanding a subcategory
  in the browse tree made the widget flicker and the view jump in ChatGPT. Root
  cause: `paint()` re-focuses the toggle with `element.focus()`, which
  scroll-into-views by default — and an expand repaints twice (loading → loaded),
  so the iframe scrolled twice per click. Fix: `focus({ preventScroll: true })`
  keeps the a11y focus restore (WCAG 2.4.3) without the scroll. Same pattern +
  fix in the search-results detail view (open/close). Pinned at source level
  (`tests/widgets-focus-scroll.test.ts`) since these main.ts files are DOM/host
  glue, verified live rather than unit-tested.

### Fixed (focused audit on widgets + REST, 2026-07-17)
Deep pass over the redesigned widgets and the REST layer; three Low findings,
all fixed test-first (no Medium+ findings; prod `npm audit` clean):
- The detail-view CTA arrow (`↗`) is decorative — now `aria-hidden` so screen
  readers announce only the action label (search-results widget).
- An empty topic page kept its header hidden: the title/description now render
  above the empty state (the title says WHAT is empty), and both empty branches
  (MCP tool + REST) pass `collectionTitle`/`description` through.
- `X-Content-Type-Options: nosniff` on every REST response (JSON + raw skill
  Markdown), matching the static-asset surface.

### Added (public robots.txt + repo-bound root default, 2026-07-17)
- **`GET /robots.txt`** (permissive) joins the HTTP static allow-list: AI fetch
  tools check robots.txt before touching the public `GET /api/*` surface, and a
  missing file left the decision to each fetcher's default policy. Live finding
  behind it: a Claude sandbox refused the REST API as "robots-disallowed" /
  `host_not_allowed` (its own egress allowlist blocks the nip.io host) while
  the same endpoints answered 200 JSON from outside — the server was never at
  fault.
- **Root-collection default is now resolved per repository host.** The root id
  is repository-bound; the known WLO hosts (prod + staging) each carry an
  explicit default — identical today, live-verified on both via node metadata
  (2026-07-17). An unknown host without `WLO_ROOT_COLLECTION_ID` now logs a
  startup warning instead of silently using a WLO id that cannot exist there
  (`resolveRootCollectionId` in `src/wlo-config.ts`, pure + unit-tested).

### Added (widget redesign toward the edu-sharing look, 2026-07-17)
Patterned on the official Apps-SDK examples (pizzaz list/carousel card
anatomy: image block, clamped title, labelled meta rows, one primary CTA) and
the edu-sharing search page, within the ChatGPT inline-card rules (wrapping
grids instead of nested horizontal scroll).
- **Collection tiles (edu-sharing style):** Sammlungen/Themenseiten render as
  colored blocks with a stack glyph, name below, and a text+icon "Themenseite"
  badge — never colour-only. Content cards gain labelled fact rows
  (Lizenz/Quelle).
- **In-widget Einzelansicht:** every content card carries a "Details" button
  (strictly opt-in per widget — no dead buttons elsewhere); the detail view
  replaces the grid with large preview, full description, all subject/level/
  type chips, licence/source, and Open-content / Topic-page CTAs. Zero extra
  tool calls — the data is already in structuredContent. Focus management per
  WCAG 2.4.3 (open → back button, close → originating card; host repaints
  never steal focus), Escape closes, selection persists via the ChatGPT
  widget-state extension. The i18n conformance test immediately caught a
  hardcoded German quote pair in the new aria-label — fixed via the locale
  table.
- **Topic-page header:** `get_topic_page_content` now carries the owning
  collection's title + description (optional, backward-compatible in schema
  and REST), and the widget renders them WLO-style above the swimlanes.
- Widget descriptions updated; content-addressed URIs roll automatically.
  README (EN/DE), the submission checklist, and the golden prompts are synced
  to the redesigned widgets and the widget `_meta` (description, CSP,
  `prefersBorder`).

### Fixed (Apps-SDK metadata completeness, 2026-07-17)
- **Every tool now carries a human-readable `title`.** The 14 tools registered
  via plain `server.tool` (a signature without a title parameter) shipped with
  the machine name only, while the Apps SDK expects a title alongside it and
  the submission scan reads it. Titles are stamped centrally in
  `tool-defaults.ts` (registration-site titles win). A new conformance test
  pins the FULL per-tool metadata set — title, the three annotation hints,
  `securitySchemes`, invocation status strings — for all current and future
  tools, so this class of gap cannot reappear silently. Audit result:
  annotations 22/22, noauth 22/22, status strings 22/22 were already complete;
  `outputSchema` remains deliberately on the 10 list-/widget-/knowledge-tools
  (extending it to the detail tools is the documented API design pass).

### Fixed (full live probe of all 22 tools, 2026-07-17)
Every tool was called against the PRODUCTION API — the gate the mocks could
never close, and the one that had let `fileSize` through. Two tools failed; both
are fixed and the probe now reports **22/22**.
- **`search_wlo_within_collection` had never worked in production.** It scoped
  its `ngsearch` with `virtual:primaryparent_nodeid` — a criterion the backend
  rejects with **400 Bad Request** on every call (isolated live: `ngsearchword`
  → 1985 hits, `ccm:taxonid` → 910 hits, `virtual:primaryparent_nodeid` → 400).
  The audit-H-A `/children` fallback never fired because it was written for an
  *empty* result, while the call *throws*. `GET /api/collection?q=` was broken
  the same way. The collection's own `/children` listing is now the only scope,
  with query + vocab filters matched locally — and the result discloses when a
  collection exceeds the sampled window instead of looking exhaustive.
  Two test files asserted the primaryparent criterion and thus kept a
  permanently broken tool green; they were rewritten (not quietly deleted) with
  the reason recorded in each file.
- **`get_related_content` died on an unreadable parent collection.** The
  optional siblings lookup hit `403 Forbidden` on real data,
  `getCollectionContents` threw, and the whole tool failed — discarding the
  related results it had already fetched. It now degrades with a warning, like
  the wiki/collections legs of `searchAll`.

### Fixed (live Claude session findings, 2026-07-17)
- **The widget cache key now covers the whole resource.** `ui://` URIs are
  content-addressed so hosts refetch changed widgets — but the hash covered only
  the HTML, not the `_meta`. A metadata-only fix (the `ui.domain` removal below)
  therefore kept the identical URI, and Claude went on serving its cached,
  broken copy: the deployed fix silently had no effect, and the live server
  provably emitted clean metadata while the host still reported the old value.
  The hash now covers HTML **and** `_meta`, so any change — including an
  env-driven one — yields a new URI.
- **`fileSize` violated our own outputSchema (MCP conformance):** the live
  edu-sharing API serialises `node.size` as a STRING; the formatter passed it
  through while the declared schema says `number`. Spec-compliant hosts
  (Claude) validate `structuredContent` against `outputSchema` and rejected the
  ENTIRE tool result ("Expected number, received string") whenever a hit
  carried a binary size — `search_wlo_content`/`search_wlo_all` failed on real
  data. Root-cause fix in the formatter (coerce once at the source; unparseable
  → 0), `WloNode.size` typed honestly (`number | string`), regression tests at
  unit and tool level. Mocks had never set `size`, which is why 394 green tests
  missed it — exactly the "live data shapes" gate the audit kept open.
- **The widget domain is no longer advertised unless configured.** A host
  validates the domain against its OWN sandbox format and rejects the whole
  widget for a foreign value — Claude expects `{hash}.claudemcpcontent.com`,
  reported "Invalid ui.domain format" and aborted the bound tool call
  (`search_wlo_all` surfaced as "server cannot be reached"). Both
  `_meta.ui.domain` and its `openai/widgetDomain` alias are now emitted only
  when `WLO_WIDGET_DOMAIN` is explicitly set (a ChatGPT plugin submission needs
  it), and then on both keys.
  Dropping only the standard key was NOT enough: the live payload proved Claude
  normalises the vendor alias onto `ui.domain` — the rejected value existed
  solely in `openai/widgetDomain`. A server cannot know a host's sandbox
  domain, so sending neither and letting each host assign its own is the honest
  default. Docs updated (README EN+DE, `.env.example`).

### Fixed (CI green on the runtime we ship, 2026-07-17)
- **`npm test` no longer depends on the Node version.** The script passed a glob
  (`--test "tests/*.test.ts"`); glob support in the test runner only arrived
  after Node 20, which instead takes the pattern as a literal path (`Could not
  find 'tests/*.test.ts'`) and exits 1 — and it auto-discovers only
  `.js/.cjs/.mjs`, never `.ts`. So the suite passed on the Node 22 dev machine
  and had never once been green in CI, which runs Node 20 (what `engines` and
  the `node:20-alpine` image declare). `scripts/run-tests.mjs` now expands the
  file list itself, which also fixes Windows, where `cmd.exe` does not expand
  globs either. It fails loudly on an empty match instead of reporting a green
  run of zero tests. Verified in a `node:20-alpine` container: the old command
  reproduces the CI error, the new one runs 394/394.
- **CI actions off the deprecated Node 20 action runtime:** `actions/checkout`
  and `actions/setup-node` pinned to v5 (`node24` runtime, SHAs verified against
  the GitHub API), clearing GitHub's force-migration warning. `node-version`
  deliberately stays 20 — that is our app's runtime, so CI keeps testing what we
  ship.
- **Lockfile back in sync with `package.json`:** the root entry lacked the
  `npm >= 9` engines floor added earlier (one line; no dependency was
  re-resolved).

### Fixed (Apps-SDK conformance follow-up, 2026-07-17)
- **Widget `_meta` on the read result:** the Apps-SDK doc places the widget
  metadata (CSP/domain/prefersBorder) on the `contents[]` entry of a resource
  READ; it was only emitted on the `resources/list` descriptor. Both surfaces
  now carry it, so a host reading either sees the CSP allowlist.
- **Standard-bridge `setWidgetState` is a deliberate no-op:** the fallback
  posted a `ui/update-model-context` message with a non-spec `{widgetState}`
  payload (the method expects model-visible `{content: […]}`). Widget-state
  persistence is a ChatGPT-only extension, so on the standard MCP-Apps bridge
  the state now simply stays in memory for the mount.
- **`WLO_WIDGET_DOMAIN` (new env):** the app identity domain advertised as
  `_meta.ui.domain` / `openai/widgetDomain` — required and unique per app at
  plugin submission — is now configurable instead of always being derived from
  `WLO_REPOSITORY_URL`. Default unchanged (edu-sharing origin); the widget CSP
  allowlist intentionally stays the data origin. Documented in README (EN+DE)
  and `.env.example`.
- **`securitySchemes` decision dated:** the Apps-SDK auth doc shows a top-level
  `securitySchemes` tool field, but the LATEST published
  `@modelcontextprotocol/sdk` (1.29.0, checked 2026-07-17) does not know the
  field — the `_meta.securitySchemes` mirror remains the maximum the SDK can
  emit; re-check on the next SDK bump (noted in `apps/tool-defaults.ts`).
- **Locale-appropriate quotes in the search-results widget:** the query heading
  used German „…“ quotes in every locale; the quote pair now comes from the
  widget string table (EN: “…”).

### Fixed (deep-audit remediation + live verification, 2026-07-17)
- **Topic-page variants read at the correct depth (audit #1, live-verified):**
  `getCollectionThemePages` now takes the page variants directly from the
  config folder's children (which themselves carry `ccm:page_variant_config`)
  instead of reading the children's contents — those are widget nodes, which
  produced subtly wrong `variantId`/`targetGroup` ("nicht gesetzt") while the
  title/URL looked correct. Also drops the per-child fan-out (one upstream call
  instead of N). Test mocks reduced to the single true shape.
- **Topic-page discovery repaired for the live API (new, live-verified):** the
  keyword-collections endpoint returns a fixed reduced projection WITHOUT
  `ccm:page_config_ref` and does not surface the subject portals at all — so
  `search_wlo_topic_pages` Mode B and the `search_wlo_all` topicPages bucket
  found NOTHING against production. New `searchTopicPageCollections()` matches
  the root subject portals locally (their `/children` projection carries the
  config ref); Mode B additionally metadata-checks keyword hits instead of
  pre-filtering on a property the projection can never deliver. Verified live:
  `searchAll('physik')` now returns the Physik portal as a topic page.
- **Malformed percent-escape no longer hangs the socket (audit #2):**
  `GET /api/skills/%ZZ` returned no response for ~30 s (`decodeURIComponent`
  threw outside its guard → unhandled rejection); now a clean 400.
- **`searchAll` degrades instead of failing (audit #3):** a thrown collections
  search (timeout/DNS/reset) no longer discards the already-fetched content
  results; the leg logs a warning and returns empty, like the Wikipedia leg.
- **Collection filters are now real (audit #4):** `search_wlo_collections`
  advertised discipline/educationalContext filtering but applied none. The
  backend rejects extra criteria (400, live-verified), so the resolved
  criteria are applied locally against node metadata on all three retrieval
  paths; `total` reflects the filtered set; the never-effective `userRole`
  parameter was removed (its property is absent from the keyword projection).
  `search_wlo_all` documents that vocab filters scope to the content bucket.
- **Relevance default un-deadened (audit #6):** the zod `.default('alpha')` on
  `search_wlo_topic_pages.sort` made the documented "relevance when a query is
  given" default unreachable — Mode B ranked by relevance and then re-sorted
  alphabetically. Queries now keep the reranked order by default.
- **Quality floor counts what the scorer counts (audit #8):** the reranker's
  minimum-score floor now uses the same stopword-filtered term list as the
  scoring, so stopword-heavy queries ("was ist die optik") no longer flip into
  the junk-preserving all-entries fallback.
- **Shared `nodeTitle()` chain (audit #9):** the title fallback chain
  (`cclom:title → cm:title → cm:name → node.name → node.title`) lives once in
  `node-match.ts` and is used by the formatter, reranker scoring, deleted-node
  check, alphabetical sort, and breadcrumbs — page variants titled only in
  `cm:title` are no longer mis-sorted, mis-matched, or dropped as "deleted".
- **Recursive pagination honesty:** `get_collection_contents` with
  `includeSubcollections` silently ignored `skipCount` (while `_queryMeta`
  reported it); it now paginates locally (skip window capped at 400 so a huge
  offset cannot force a full-subtree crawl).
- **REST `lang` validated at the boundary:** `GET /api/wikipedia?lang=…` now
  rejects malformed language codes with 400 instead of relying on the
  wikipedia-api backstop. Static responses send `X-Content-Type-Options:
  nosniff`. Skills ranking tokenizer is Unicode-aware ("Köln", "Übung").
- **Widget a11y:** the browse tree no longer steals focus on theme/locale
  repaints (focus restore is scoped to the user's own toggle interaction);
  widgets stamp the resolved locale onto `<html lang>` at runtime (WCAG 3.1.2).
- **Docs:** README EN+DE now describe the rightmost (proxy-appended)
  `X-Forwarded-For` hop, matching the code; stale comments fixed (server.ts
  registration list, register.ts plan jargon, dead `filters` binding removed);
  CLAUDE.md tool-group list completed; `engines` gains the documented npm floor.

### Added (CI type gate + dispatch tests, 2026-07-17 — audit #5)
- **`npm run typecheck`** (`tsconfig.typecheck.json`): `tsc --noEmit` over
  everything the build project cannot see — `api/` (Vercel entry), `tests/`
  (tsx strips types), and the widget DOM entry points (esbuild does not
  type-check) — wired into CI before the test step. Surfaced and fixed 15
  latent type errors in 6 test files.
- **`src/http-app.ts`:** the self-hosted request handler extracted from
  `http.ts` (which listens on import and was therefore untestable) into a
  `createHttpRequestHandler(options)` factory; `http.ts` stays the thin env +
  listen entry. New `tests/http-app.test.ts` drives the real dispatch over an
  ephemeral-port server: health/OPTIONS/405/404/launcher, 400 invalid JSON,
  413 body cap, 429 rate limit, and a full MCP `initialize` round-trip
  (Accept normalization included). New `tests/api-mcp.test.ts` does the same
  for the Vercel handler (GET health, 405, JSON-only-Accept initialize).
- **Bounded lane resolution (audit #10):** topic-page swimlane resolution runs
  through `mapPool(…, 4)` instead of an unbounded `Promise.all`, capping the
  page×lane upstream fan-out.
- **Test-helper consolidation:** `connectedClient()` (was duplicated in 19
  files) and `toolText()` (2 local copies, one missing the type filter) are
  now shared via `tests/fetchMock.ts`.

### Changed (cleanup + modularization round, 2026-07-16)
- **Reranker split (behavior-preserving):** query expansion — the synonym table,
  stopword set, and `expandQuery` — moved verbatim from `src/reranker.ts` (329 →
  212 lines) into the new `src/query-expand.ts` (91 lines); the reranker keeps
  scoring, RRF merge, and orchestration. `DE_STOPWORDS` is shared (scoring drops
  stopwords too). Verified by the unchanged reranker/search-pipeline suites.
- **Recursive collection walk extracted:** the BFS branch of
  `get_collection_contents` moved out of the tool handler into the named
  `collectRecursiveContents` helper (same file, mirrors the
  `findCollectionsByTreeTraversal` pattern); the handler is a thin dispatcher.
- **Export-surface cleanup (knip-driven, each verified by grep):** 14
  module-internal symbols un-exported (`SKILLS`, `TOPIC_PAGE_PROPS`,
  `WIKI_USER_AGENT`, `NOAUTH_SECURITY_SCHEMES`, REST validation caps, widget
  sub-schemas, `buildDownloadUrl`, `DOWNLOAD_TEXT_CAP_BYTES`, `WIDGET_NAMES`).
  Type-only knip flags were deliberately left (cascade false-positives from the
  esbuild widget entries + the intentional `_queryMeta` contract re-exports).
- **Test gaps closed (audit follow-up):** markdown render wrappers of
  `get_related_content` (Basis line + siblings section), `get_node_breadcrumb`
  (' › ' join + empty-path message), and `get_collection_stats` (sampled-hint)
  are now pinned (`tests/tool-render-wrappers.test.ts`, 3 tests).
- Module maps in README (DE/EN) and `CLAUDE.md` updated for the new
  `query-expand.ts` / `node-match.ts`.

### Fixed (deep-audit remediation 2026-07-16, evening round)
- **H-A — `search_wlo_within_collection` empty for curated collections:** the
  `virtual:primaryparent_nodeid`-scoped search returns nothing for reference
  collections (the common WLO case). The service now falls back to enumerating
  the collection's actual `/children` (bounded to 100) and applies the free-text
  query plus the resolved vocab filters locally (new shared `src/node-match.ts`;
  pagination is local over the filtered set). 3 regression tests.
- **Q-2 — duplicate rows in the collection tree-traversal fallback:** matches are
  now de-duplicated by nodeId at insertion (collections form a DAG, so the same
  node could surface at several levels), keeping rows and `total` honest. Test.
- **Q-3 — `excludeNodeIds` under-filled the direct keyword-collection page:** the
  direct path now over-fetches by the exclusion count (mirroring the
  content-search H1 fix) and falls through to the tree traversal when every
  direct hit was excluded, instead of returning an empty page. `total` now counts
  the kept hits. 2 tests.
- **Docs/security wording:** `.env.example` claimed the client IP comes from the
  "first" X-Forwarded-For hop; the code (correctly) uses the RIGHTMOST,
  proxy-appended hop — the doc now says so. `get_collection_stats`'s description
  claimed "facet aggregations over the collection subtree"; it is a tally over up
  to 100 direct child files (a sample) and now says so.
- **Observability:** `getNodesMetadata` logs a warning when a per-node fetch
  throws instead of silently dropping the node.

### Changed (token efficiency, same round)
- **`search_wlo_all` defaults to `outputFormat: "markdown"`** (was `json`): the
  full bucket envelope always rides in `structuredContent`, so the model-facing
  text no longer duplicates it by default (~40–60 % fewer tokens per default
  call). Explicit `outputFormat: "json"` still returns the envelope in the text
  (back-compat for clients that only read content blocks).
- **Compact JSON everywhere model-facing:** dropped `null, 2` pretty-printing
  from all tool JSON outputs (~15–30 % smaller). `_queryMeta` keeps its documented
  shape — slimming it was evaluated and rejected (external consumers parse it).
- **Grade-number aliases:** `"Klasse 5"` / `"5. Klasse"` (grades 1–13) now resolve
  to their Bildungsstufe in `educationalContext` filters. Test.
- **Apps-SDK:** widget resources now advertise a per-widget description
  (`ui.description` + `openai/widgetDescription`). Test. Topic-page Mode B
  resolves candidate collections' Themenseiten in a bounded pool (≤4 in flight)
  instead of serially; characterization test pins the behaviour.
- **CI hardening:** `permissions: contents: read` and both actions pinned to
  full commit SHAs (verified against the GitHub API).
- **Removed:** the deprecated `getCollectionMetadata` alias (no callers;
  `getNodesMetadata` is the name). Named the reranker blend weights
  (`QUALITY_WEIGHT`/`RRF_WEIGHT`/`APPEARANCE_BONUS_MAX`); documented the
  re-rank-per-page limitation on `skipCount` (with `excludeNodeIds` as the
  robust alternative) and that `search_wlo_all` uses `maxContent`/`maxCollections`.

### Fixed (audit-final remediation 2026-07-16)

- **H1 — silent result cap (correctness):** `search_wlo_content` capped its upstream
  fetch pool at a flat 20 when `excludeNodeIds` was set, so pagination-via-exclusion
  with `maxResults > 20` silently returned ≤ 20 hits. Now over-fetches
  `maxResults + excluded.size` (bounded, never below `maxResults`), mirroring the
  recursive collection branch (`src/tools/content-search.ts`). Regression test added.
- **M2 — duplicate result rows:** recursive `get_collection_contents`
  (`includeSubcollections`) now de-duplicates by `nodeId` across sub-collections, so
  an item referenced in two collections appears once (`src/tools/collections.ts`).
  Regression test added.
- **M3 — masked upstream outage:** `searchPageVariants` now `logUpstreamMiss`-logs a
  non-OK upstream response before degrading to `[]`, so an outage is no longer
  indistinguishable from a genuine "no topic pages" result (`src/topic-page-api.ts`).
- **L4 — prototype-chain lookup:** `universitySubjectLabel` now own-property-guards the
  slug lookup (`Object.hasOwn`), so a `…/hochschulfaechersystematik/toString` URI can
  no longer return `Object.prototype.toString` (`src/vocabs-hochschule.ts`). Test added.
- **L5 — empty labels:** the URI-only fallback in `resolveLabels` now drops
  empty-string URIs (`!!u && …`), so an empty taxonid no longer injects an empty
  discipline label (which the widget tile's `disciplines[0]` would surface)
  (`src/formatter.ts`). Test added.
- **L10 — reranker title source:** relevance scoring now uses the same title fallback
  chain as `formatNode` (`cclom:title → cm:title → cm:name → node.name → node.title`),
  so a node titled only at cm:title / node level no longer scores against an empty
  title (`src/reranker.ts`). Test added.
- **L1 — serverless leak on error:** the Vercel handler closes the per-request
  server/transport in a `finally`, so a throw from `connect`/`handleRequest` no longer
  leaks it on a warm instance (`api/mcp.ts`, mirrors `http.ts`).
- **L8 — widget stuck loading:** the standard `ui/*` host bridge now rejects a
  `tools/call` promise on a JSON-RPC error (via the new pure, unit-tested
  `settleCallResponse`) and times out an unanswered call after 15 s, so a failing or
  silent host no longer leaves the widget spinning forever (`host.ts`, `host-bridge.ts`).
- **L9 — widget origin leak:** outbound widget messages other than the initial
  `ui/initialize` are now held until the host origin is pinned, instead of being
  posted to `'*'` (any framing origin) (`src/apps/widgets/shared/host.ts`).
- **L7 — widget image scheme guard:** the tile's `previewUrl` `<img src>` is now
  `safeHref`-guarded like every href (non-http(s) → icon fallback)
  (`src/apps/widgets/shared/tile.ts`).
- **L11 — vocab alias shadowing:** `discipline="sonstiges"` now resolves to the
  Sonstiges concept (999), not Allgemein/fächerübergreifend (720) which listed it as a
  stray alias; the dead `media education` alias on 400 (Mediendidaktik) is removed —
  it stays on 900 (Medienbildung) (`src/vocabs.ts`). Test added.
- **L16 — non-deterministic duplicate subtree:** `browse_collection_tree` now claims a
  child in the `visited` set at scheduling time, so a collection shared by two parents
  is emitted under exactly one — deterministically — instead of racing to appear twice
  (`src/tools/browse.ts`). Test added.

### Fixed (whole-repo audit 2026-07-16)

- **Launcher DOM-XSS (T1):** the public launcher now scheme-guards result links —
  an untrusted `ccm:wwwurl` (e.g. `javascript:`/`data:`) is rendered as plain text
  instead of a clickable href (`public/launcher.html`, inline `safeUrl` mirroring
  the widgets' `safe-url.ts`); external links also gain `rel="noreferrer"`.
- **Rate-limit bypass (T2):** `clientKey` now takes the RIGHTMOST (proxy-appended)
  `X-Forwarded-For` hop under `TRUST_PROXY`, not the client-spoofable leftmost one
  (`src/rate-limit.ts`) — a client can no longer forge a fresh limiter key per
  request behind an appending reverse proxy.
- **`browse_collection_tree` unbounded recursion (T3):** the tree walk now tracks
  the current level and recurses only while `level < depth` (a closure-constant
  check descended the WHOLE subtree), caps concurrency with `mapPool(…,5)`, and
  guards cycles with a visited set (`src/tools/browse.ts`). Fixes the depth
  semantics and the anonymous amplification-DoS vector.
- **MCP error boundary (T4):** the self-hosted `POST /mcp` branch is wrapped in
  try/catch (generic 500 if headers unsent, server always closed) and a
  process-level `unhandledRejection` handler was added (`src/http.ts`) — an
  edge-case throw no longer crashes the server or hangs the client.
- **Download size cap (T5):** `getNodeDownloadText` streams and caps the anonymous
  file download at 64 KB with a truncation marker (`src/wlo-node.ts`), bounding the
  memory + model-context use of `find_wlo_skills`.
- **Info-disclosure (T7):** the Vercel handler returns a generic `Internal server
  error` and logs the detail server-side, instead of leaking `err.message`
  (`api/mcp.ts`); a wrong HTTP verb on `/mcp` now returns `405 Allow: POST` on the
  self-hosted path too (`src/http.ts`).
- **Bounded upstream fan-out (T8):** `getNodesMetadata` now uses an internal
  order-preserving worker pool, `get_nodes_details` and `get_subject_portals`
  route their fan-outs through `mapPool` instead of raw `Promise.all(Settled)` —
  a single call can no longer open dozens–hundreds of simultaneous upstream
  sockets (`src/wlo-node.ts`, `src/tools/node-details.ts`, `src/tools/browse.ts`).
  `get_nodes_details` also gained the missing `try/catch`/`toolError` wrapper.
- **postMessage hardening (T6):** the standard-bridge widget listener now trusts
  only messages from its host parent frame and pins the outbound `targetOrigin`
  to the host once known, instead of accepting any origin / posting to `'*'`
  (`src/apps/widgets/shared/host.ts`).
- **Slow-body / socket protection (T9):** the self-hosted HTTP server sets
  `requestTimeout`/`headersTimeout` (`src/http.ts`) — bounding a dribbled request
  without cutting off long-lived SSE responses.
- **Per-request disk I/O (T10):** built widget HTML is read + hashed once and
  memoized, not re-read on every stateless request (`src/apps/resources.ts`).
- **Container hardening:** the compose service caps memory/CPU, drops all Linux
  capabilities, forbids privilege escalation, and runs a read-only root filesystem
  (`docker-compose.yml`).
- **Prompt-injection framing (T-INJ):** `find_wlo_skills` frames the untrusted
  uploaded Markdown as curated suggestions to review (not authoritative
  instructions) and documents the write-controlled-collection trust assumption
  (`src/tools/skills.ts`).
- **Observability:** non-OK upstream responses on the graceful-degrade paths are
  now logged (`logUpstreamMiss`) instead of silently returning empty, so an
  outage is distinguishable from "no results" (`src/wlo-config.ts` + call sites).
- **Accessibility:** the browse widget restores keyboard focus to the toggled
  node after a re-render and links each toggle to its region via `aria-controls`
  (`src/apps/widgets/browse/{main,render}.ts`); search `query` inputs are capped
  at 200 chars (`src/tools/content-search.ts`).
- **Launcher scheme-guard now regression-tested:** the self-contained launcher's
  inline `safeUrl()` (which drops `javascript:`/`data:` result URLs) is exercised
  by extracting it from the page in `tests/launcher-safe-url.test.ts`, pinned to
  the widgets' `safeHref` behaviour — closing the one test-debt item (M1) from the
  2026-07-16 re-audit.

### Added
- **University-subject fuzzy lookup (Hochschulfächer Stage 2), model-free.**
  `lookup_wlo_vocabulary` now accepts `vocabulary="universitySubject"` plus a
  free-text `query`; `suggestUniversitySubjects` (`src/vocabs-hochschule.ts`) does a
  per-word Levenshtein match over the 344 bundled Hochschulfächer labels and returns
  a short `{label, uri}` pick-list — a *disambiguation choice* the model resolves,
  never an automatic single-match, so the school↔university input invariant is
  untouched. The `uri` is the real `ccm:taxonid` form (verified against the live
  discipline facet), usable directly as a `discipline` filter. No embedding/AI model
  is loaded and no runtime dependency is added; the `levenshtein` primitive was
  extracted to a shared leaf module `src/text-distance.ts` (reused by
  `vocab-suggest.ts`, no circular import). Tests: `tests/vocabs-hochschule.test.ts`
  (7 unit) + `tests/tools-vocabulary.test.ts` (3 integration).
- REST `GET /api/search` parity with the MCP search tools for generic (non-MCP)
  clients: it now returns `unresolvedFilters` (mistyped vocab filters + "did you
  mean" suggestions) and — with `?includeFacets=1` — `facets` (`{label, count, uri}`
  per bucket), so the facet-driven university-subject flow works over REST too. The
  facet aggregation was extracted into a shared `searchFacets` (`src/services/search.ts`)
  now used by `search_wlo_content`, `search_wlo_all`, and the REST layer (dedup).
  Field projection (`?fields=…`) was also extended to `GET /api/collection`
  (shared `projectItems` in `src/rest/project.ts`).
- University-subject (Hochschulfächersystematik) resolution via facets, conflict-
  free with school subjects. The 344 university concepts are bundled as a
  **display-only** URI→label table (`src/vocabs-hochschule.ts`), consulted by
  `labelFromUri` only for a `discipline` URI that misses the local school table —
  and deliberately **not** wired into `resolveVocab` (input), so a shared label
  like `discipline="Mathematik"` still resolves to the school subject and is never
  ambiguous. `resolveFacetCounts` now carries the concept `uri` per facet bucket
  (`{label, count, uri}`), so a chatbot can read a university subject off a faceted
  search (`includeFacets: true`) and filter by that URI (input accepts raw URIs).
  `QueryMeta.facets` and the `includeFacets` tool descriptions updated accordingly.
- Optional field projection on `GET /api/search` (`?fields=title,url,…`): trims
  each result item in every bucket to the requested keys (`nodeId` always kept),
  cutting the JSON — and thus the tokens an LLM client ingests — without touching
  the MCP tools, widgets, or service layer. Allow-list-validated in
  `src/rest/validate.ts` (`parseFields`), applied by the pure
  `src/rest/project.ts` (`projectEnvelope`). Absent param → full payload
  (back-compat); an all-invalid `fields` → `400` so the caller can self-correct.
- `find_wlo_skills` MCP tool (21 → 22 tools; `src/tools/skills.ts` +
  `findSkills` in `src/services/skills.ts`) — finds WLO "skills" (reusable
  instruction Markdown curated as uploaded files in a WLO collection) matching a
  task and returns their raw instructions to apply. Reuses `listCollectionContents`
  and fetches each match's raw Markdown via the new `getNodeDownloadText`
  (anonymous `eduservlet/download`). `nodeId` defaults to `WLO_SKILLS_COLLECTION_ID`.
  Gives natively-registered MCP clients the same skills capability as the
  launcher/REST path.
- `GET /api/collection` REST endpoint (`src/rest/routes.ts` +
  `listCollectionContents` in `src/services/search.ts`) — lists or searches a WLO
  collection's contents (`{ collectionId, query, total, results }`, each result
  carrying the anonymous `downloadUrl`). Without `q` it lists direct file children
  via `/children` (reliable for reference collections); with `q` it searches
  within. `nodeId` defaults to the new `WLO_SKILLS_COLLECTION_ID` env var. This is
  the prompt launcher's **skills** source: skills live as uploaded Markdown files
  in a WLO collection; their title/description say what each does, and the
  `downloadUrl` serves the raw instruction text.
- Deployment for the self-hosted vServer (Docker):
  - Optional real Server-Sent-Events streaming on `POST /mcp`, gated by `MCP_SSE`
    (`src/mcp-transport.ts`; truthy → `enableJsonResponse:false`). Required by
    ChatGPT developer mode; JSON mode stays the default for back-compat.
  - The Docker image now bundles the built widgets (`dist-widgets/`) and the
    public launcher + skills (`public/`), so widgets render and
    `/launcher.html` + `/api/skills` serve from the container. `MCP_SSE=1` is the
    image default.
  - `docker-compose.yml` (env/ports/restart/healthcheck) with an annotated
    reverse-proxy note — SSE requires `proxy_buffering off;`. A `.dockerignore`
    keeps the build context lean.
  - Submission collateral: `docs/PRIVACY.md` (stateless, read-only, no PII stored)
    and `docs/apps-sdk-submission-checklist.md` (each requirement mapped to its
    implementing artifact + golden demo prompts).
- `docs/apps-sdk-golden-prompts.md` — a developer-mode evaluation set (direct /
  indirect / negative prompts mapped to the expected tool + widget, plus a
  precision-recall log) to dogfood tool selection and confirm the widgets render
  (audit items S4 + the P3.6 render/drill-down gate). Linked from the README
  (DE/EN) and the submission checklist.
- Four optional retrieval tools (17 → 21 tools), each read-only and additive:
  - `lookup_wlo_publishers` (`src/services/publishers.ts`) — the publishers/
    sources (`ccm:oeh_publisher_combined`) with per-publisher content counts via a
    facet aggregation, optionally scoped by query/discipline/educationalContext.
    For discovering valid `publisher` filter values.
  - `get_related_content` (`src/services/related.ts`) — "more like this": reads a
    seed node's disciplines + educational contexts and searches for other material
    with the same profile (seed excluded); optional `includeSiblings` adds the
    primary parent collection's other contents.
  - `get_collection_stats` (`src/services/stats.ts`) — a collection's composition:
    total file/sub-collection counts plus a breakdown of its files by resource
    type/subject/level, tallied over the actual child files (accurate for
    reference collections, where a facet query returns nothing).
  - `get_node_breadcrumb` (`getNodeBreadcrumb` in `src/wlo-api.ts`) — a collection
    node's ancestor path root → node, from the single-call `/parents` chain
    (cycle-guarded, depth-capped). File nodes have no breadcrumb (empty path).
- Apps-SDK foundation (OpenAI Apps SDK / MCP Apps compatibility):
  - A single registration seam `registerWloTool` (`src/apps/register.ts`) that
    attaches an `outputSchema`, `annotations`, and — when a widget is wired
    (Phase 4) — the standard `_meta.ui.resourceUri` (+ the ChatGPT
    `openai/outputTemplate` alias) in ONE place. zod output schemas
    (`src/apps/outputSchemas.ts`) mirror the existing envelopes and become the
    `structuredContent` contract the model (and later the widgets) read.
  - The display tools `search_wlo_all`, `search_wlo_content`,
    `search_wlo_collections`, `get_subject_portals`, `browse_collection_tree`
    and `get_topic_page_content` now return `structuredContent` alongside the
    unchanged text output (back-compat for non-Apps clients). `get_topic_page_content`
    resolves its swimlane payload in both output formats so the structured
    result is always render-ready.
  - Every tool advertises `annotations.readOnlyHint: true` (all WLO tools are
    read-only); `get_wikipedia_summary` also sets `openWorldHint: true`.
  - A server `instructions` block (`src/apps/instructions.ts`) giving cross-tool
    guidance (the `search_wlo_all` fast path vs. deep-dive tools vs. `search`/`fetch`).
- Two knowledge tools implementing the ChatGPT convention (`src/tools/knowledge.ts`):
  - `search` — lightweight hits `{ results: [{ id, title, url }] }` across WLO.
  - `fetch` — one node's full document `{ id, title, text, url, metadata }`.
  Both duplicate their JSON in `content[0].text` (what ChatGPT reads) and in
  `structuredContent`, and reuse the existing services (`searchAll`, node detail).
- Apps-SDK widget suite (rendered by Apps-SDK / MCP Apps hosts from
  `structuredContent`; non-Apps clients are unaffected):
  - A build pipeline (`src/apps/widgets/build.mjs`, esbuild) that bundles each
    widget's vanilla-TS `main.ts` and INLINES it — together with a shared
    `base.css` and the widget's `styles.css` — into one self-contained HTML file
    under `dist-widgets/<name>.html` (no external `<script src>`/`<link>`, as the
    sandboxed iframe requires).
  - `src/apps/resources.ts` registers each built widget as a `ui://` resource
    (MIME `text/html;profile=mcp-app`, content-addressed URI, `_meta.ui.csp`/
    `domain` whitelisting the configured edu-sharing origin) and wires its URI to
    the rendering tool via the seam's `widgetUri`. Missing builds degrade
    gracefully (tools keep working without a widget).
  - **W3** shared OER tile (`widgets/shared/tile.ts`): accessible card (meaningful
    German alt text on real thumbnails, decorative icon fallback, one primary
    link, discipline/level/type chips, license/publisher), reused by W1/W2/W4.
    Every interpolated field is HTML-escaped.
  - **W1** combined search results (`search_wlo_all`): Themenseiten / Sammlungen
    (emphasized) / Inhalte sections of tiles.
  - **W4** topic-page swimlanes (`get_topic_page_content`): per-swimlane heading +
    tile grid + a "more on the topic page" link.
  - **W2** interactive collection browse (`get_subject_portals` /
    `browse_collection_tree`): a keyboard-operable disclosure tree that drills
    deeper via `window.openai.callTool('browse_collection_tree', …)` and persists
    the open path via `setWidgetState`; a pure reducer drives the state.
  - Widgets are theme-aware (light/dark), WCAG 2.2 AA (contrast tokens, focus
    rings, no nested scroll, ≥24px targets), and localized (DE default, EN
    fallback) via a tiny string table honoring `window.openai.locale`.
- Public read-only REST layer (`src/rest/`, served by `http.ts` only — **not**
  the Vercel handler): four `GET` endpoints that are thin wrappers over the
  existing services, for non-MCP AI tools and the prompt launcher.
  - `GET /api/search` (→ `searchAll`, all `include*` flags as query params),
    `GET /api/compendium` (→ `getCompendiumTexts`, `ids`/`nodeId`, ≤25),
    `GET /api/topic-page` (→ `getTopicPageContent` + `resolveTopicPageSwimlanes`),
    `GET /api/wikipedia` (→ `fetchWikipediaSummary`, `404` when no article).
  - `routeRestRequest` is a pure, offline-testable core (returns `{status, json}`
    or `null` for a non-owned path); `handleRestRequest` is the thin `http.ts`
    adapter. Inputs validated server-side (`validate.ts`: query ≤200, nodeId ≤50,
    ≤25 ids, integer clamps, enum `targetGroup`); non-`GET` → `405`; unknown
    `/api` path falls through to `404`; a service error becomes a generic `500`
    (no internal detail leaked). CORS `*` for `GET`; its own per-IP limiter
    `API_RATE_LIMIT_RPM` (default 30/min → `429`).
- Prompt launcher (HTTP mode) — a static, bilingual (DE/EN) page for AI tools
  without MCP, backed by the public REST layer:
  - `public/launcher.html`: a self-contained page (no third-party scripts, fonts,
    or requests) that hands an AI chat the *knowledge* to use the WLO REST API
    itself, rather than sending one canned search. The generated message explains
    the search endpoint (`GET /api/search?q=…` + filters/flags, load JSON raw and
    summarise), the other endpoints, and that ready-made skills are loadable by URL
    (`GET /api/skills` → `GET /api/skills/<id>`). An optional query + Fach/Stufe/Typ
    filters are woven in as a concrete example and drive a "Load raw result" button
    (direct content search). The message can be copied into any chat or opened via a
    deep link in Claude (`claude.ai/new?q=`), ChatGPT (`chatgpt.com/?q=`), or
    Microsoft Copilot (`copilot.microsoft.com/?q=`); Gemini (no native URL prefill)
    opens the app with the message placed on the clipboard. Prefills from `?q=`
    (bookmarklet). WCAG 2.2 AA: labelled fields, keyboard-operable, theme-aware
    (`prefers-color-scheme`), reduced-motion respected.
  - Served by `http.ts` via a new static route (`src/rest/static.ts`:
    `resolveStaticRoute` pure core + `handleStaticRequest` adapter, allow-list only
    → no path traversal). `GET /launcher.html` and `GET /` serve the launcher,
    `GET /bookmarklet.md` the bookmarklet doc; `POST /` remains the MCP endpoint.
  - URL-loadable skills for AI apps (`src/rest/skills.ts`): a registry + raw loader
    behind `GET /api/skills` (catalogue `{ skills: [{ id, name, description, path }] }`)
    and `GET /api/skills/<id>` (raw Markdown, `text/markdown`; `404` for unknown id).
    `<id>` is a stable slug now, intended to become a WLO nodeId later. Two skills
    ship in `public/skills/` (`wlo-search`, `wlo-topic-launcher`). The REST result
    type gained an optional raw-text body so `handleRestRequest` can serve Markdown.
  - `public/bookmarklet.md` (selection → launcher, install docs, DE/EN).
- Three new tools:
  - `get_wikipedia_summary` — a short Wikipedia lead extract (+ link, optional
    thumbnail) for a term, to complement WLO material with encyclopedic context.
    Backed by a dependency-free Wikipedia REST client (`src/wikipedia-api.ts`)
    with opensearch title-resolution fallback, a descriptive User-Agent, the
    shared upstream timeout, and ISO-639 language hardening. `readOnlyHint` +
    `openWorldHint`.
  - `get_compendium_text` — the FULL, untruncated editorial compendium text of
    one or more collections (bulk, ≤25 ids), for when a search result shows only
    the 500-char preview. Backed by `src/services/compendium.ts`.
  - `search_wlo_within_collection` — filtered full-text search scoped to a single
    collection subtree (`virtual:primaryparent_nodeid`), reusing the vocab filter
    builder. Backed by `src/services/search.ts`.
- `search_wlo_all` enrichment flags (all opt-in, default off; each runs in the
  existing bounded/parallel pattern): `skipCount` (content paging),
  `includeCompendium` (gap-fill full compendium for collections/topic pages),
  `includeTextContent` (stored full text per content item, capped 4000),
  `includeWikipedia` (a `wikipedia` summary for the query), and
  `includeTopicPageContent` + `maxPerSwimlane` (resolved swimlane content per
  topic page). The tool body moved into `src/services/search.ts::searchAll`
  (reused by the coming REST layer and widgets); the default-flag envelope is
  unchanged.
- `search_wlo_topic_pages`: optional `includeContent` (+ `maxPerSwimlane`) —
  in JSON mode, attach each topic page's resolved swimlane content in the same
  call (bounded ≤5 parallel).
- `browse_collection_tree`: optional `includeContentPreview` (1–5) — attach the
  first N content items of each sub-collection as a `contentPreview` array
  (bounded pass), a peek inside without a second call.
- `FormattedNode.compendiumText` — the editorial compendium text
  (`ccm:oeh_collection_compendium_text`), a curated prose summary of what a
  collection covers and the most authoritative source for a collection overview
  when present. Carried by the detail tools (`get_node_details` /
  `get_nodes_details`, full text via `-all-`) and — since it is part of
  `DISPLAY_PROPS` — by collection search/list/browse, so a collection result can
  be oriented on without a second call; `markdown` output caps it at 500 chars to
  stay lean, `json` keeps the full field. Absent (undefined) on nodes without the
  property; no extra round-trips.
- Search tools (`search_wlo_content`, `search_wlo_all`): optional `includeFacets`
  — returns facet counts (`learningResourceType` / `discipline` /
  `educationalContext`, resolved to labels) in `_queryMeta.facets`, so callers can
  offer targeted narrowing ("how many videos vs. worksheets?") without
  probe-searches. The facet aggregation runs in parallel with the main search
  (≈0 added latency, verified live: ~130 ms serial). Opt-in; default output
  unchanged.
- `search_wlo_content`: optional `includeTextContent` — enriches each result
  with its stored full text (crawled webpage/PDF, capped) in the same call,
  saving a follow-up `get_node_details`/`get_nodes_details` round-trip when the
  caller needs the text of the top hits. Opt-in (adds one round-trip per result),
  bounded concurrency; the default output is unchanged.
- Search tools (`search_wlo_content`, `search_wlo_all`): a vocab filter that
  cannot be resolved to a URI (e.g. `discipline: "Xyz"`) — previously dropped
  silently — is now reported in `_queryMeta.unresolvedFilters` (`{field, value}`),
  so callers can self-correct (e.g. via `lookup_wlo_vocabulary`) instead of
  silently getting unfiltered results. Omitted when everything resolves.
- `browse_collection_tree`: accepts a `subject` NAME (e.g. "Mathematik" or the
  abbreviation "Mathe") as an alternative to `nodeId` — resolved to its Fachportal
  server-side (tiered exact → prefix → substring match), so callers can drill down
  by subject without a preceding `get_subject_portals` round-trip. `nodeId` still
  works unchanged; an unknown subject returns the list of available Fachportale.
- `get_nodes_details`: optional `includeTextContent` / `includeParents` flags —
  bulk-enrich each node with its stored full text and/or parent collections in a
  single call (bounded concurrency), mirroring `get_node_details`. Opt-in; the
  default metadata-only output is unchanged.
- Offline test suite (`node:test`, `npm test`): vocabulary, formatter, reranker,
  API URL helpers, server registration (MCP in-memory), fetch-mocked search
  pipeline and handler tests, plus rate-limiter, body-reader, and client-IP tests.
- GitHub Actions CI (`.github/workflows/ci.yml`): build + test on Node 20, with a
  gate on shipped high/critical vulnerabilities
  (`npm audit --omit=dev --audit-level=high`).
- Structured JSON logger (`src/logger.ts`) — writes only to stderr (stdio-safe);
  all tool errors are now logged server-side via a central `toolError` helper.
- HTTP-mode hardening: per-IP rate limiting (`RATE_LIMIT_RPM`, default 120/min →
  `429`), request-body size limit (`MAX_BODY_BYTES`, default 1 MB → `413`),
  upstream timeout for every edu-sharing request (`WLO_FETCH_TIMEOUT_MS`, default
  10 s) via a central `wloFetch` wrapper, and `TRUST_PROXY` for correct per-client
  rate limiting behind a reverse proxy.
- Docker `HEALTHCHECK` on `/health`; `engines` field (`node >=20`).
- Documentation set, English-canonical with German copies: `README.md` /
  `README.de.md`, `CONTRIBUTING.md` / `CONTRIBUTING.de.md`, `PERFORMANCE.md` /
  `PERFORMANCE.de.md`.

### Changed
- **M4 — topic-pages god-function split (behavior-preserving):** the ~180-line
  `search_wlo_topic_pages` handler is now a thin pipeline. Mode C's page-variant
  enrichment (`listThemePageVariants`) and the A/B/C mode dispatch
  (`collectThemePages`) plus the `_queryMeta` builder (`buildTopicPagesMeta`) stay
  in `src/tools/topic-pages.ts`; the pure merge/sort and JSON/Markdown rendering
  moved to a new `src/tools/topic-pages-present.ts` (`mergeThemePages`,
  `renderThemePages`) — now unit-tested in isolation (`tests/topic-pages-present.test.ts`,
  8 cases: dedup/merge, alpha+relevance sort, slice, title fallback, both renderers).
  Verified by the existing MCP-level suite (unchanged) plus the new units.
- **Audit-final maintainability (no behavior change):** de-duplicated the
  `workspace://SpacesStore/` stripping helper (three copies →
  one `stripStoreRef` in `src/wlo-node.ts`, re-exported via the `wlo-api` barrel);
  named the node-details full-text caps (`TEXT_CONTENT_CAP` 4000 for JSON/bulk,
  `TEXT_CONTENT_MARKDOWN_CAP` 2000 for the human markdown preview) instead of stray
  literals; documented that the Vercel serverless path (`api/mcp.ts`) needs a
  platform (Vercel Firewall) rate rule since in-memory limiting is ineffective on
  serverless; corrected a misleading relevance-sort comment and the `CLAUDE.md`
  tool count (12 → 22).
- **REST layer split (no behavior change):** `src/rest/routes.ts` grew past the
  ~300-line threshold with the search enrichments above, so the per-endpoint
  handlers moved to `src/rest/handlers.ts` and the shared `RestResult`/`badRequest`
  to `src/rest/result.ts`; `routes.ts` is now just the router + node:http adapter.
  Verified behavior-preserving by the existing REST tests.
- **Launcher AI-picker polish:** dropped the decorative per-chip dot — it rendered
  as a stretched oval in the flex row and carried no information (identical on every
  chip) — and now mark the selected AI with a trailing check. The check is a
  non-colour selection cue (WCAG 1.4.1) on top of the existing border/background/
  text change (`public/launcher.html`).
- Apps-SDK hardening + cross-host portability (from the 2026-07-16 compliance
  audit): widgets now use a portable host bridge (`src/apps/widgets/shared/host.ts`
  + unit-tested `host-bridge.ts`) — `window.openai` under ChatGPT AND the standard
  MCP-Apps `ui/*` postMessage bridge in any other host, so the same widget code is
  portable. The seam emits `_meta.ui.widgetAccessible` (+ `openai/widgetAccessible`)
  for widget-callable tools (`browse_collection_tree`). The widget MIME is
  env-configurable (`WLO_WIDGET_MIME`, default `text/html;profile=mcp-app`). The
  `search`/`fetch` `url` always falls back to the absolute render URL, and the
  server `instructions` block was trimmed to ≤512 chars (fast path first).
- Uniform read-only tool defaults applied once in `src/apps/tool-defaults.ts`
  (`applyReadOnlyToolDefaults` wraps both registration paths — no call-site
  churn): every tool declares its anonymous stance via
  `_meta.securitySchemes: [{ type: 'noauth' }]` (the base-SDK `_meta` mirror the
  host/submission scan reads) and the Apps-SDK-required `destructiveHint:false` /
  `openWorldHint:false` annotations (explicit per-tool values, e.g.
  `get_wikipedia_summary`'s `openWorldHint:true`, are preserved). Widget-callable
  tools now also emit the current standard `_meta.ui.visibility: ["model","app"]`
  (the gate for widget→host `tools/call`) alongside the legacy
  `widgetAccessible` aliases. Verified against the live Apps-SDK docs 2026-07-16.
- Per-tool ChatGPT invocation status strings
  (`_meta["openai/toolInvocation/invoking"|"invoked"]`, ≤64 chars, German) — a
  short label shown while each tool runs / after it finishes. Copy table in
  `src/apps/tool-status.ts`, stamped by name via `applyReadOnlyToolDefaults`; a
  non-ChatGPT host ignores these `openai/*` keys.
- `search_wlo_collections`: the multi-level keyword tree-traversal fallback was
  extracted from the tool handler into the named, independently-tested
  `findCollectionsByTreeTraversal` (`src/tools/collections.ts`); behaviour
  unchanged (the level-1 → level-2 → scored-level-3 caps are preserved).
- `wlo-api.ts` (475 lines) split by responsibility into `wlo-config.ts` (env +
  fetch + shared types + DISPLAY_PROPS), `wlo-search.ts` (search endpoints) and
  `wlo-node.ts` (node endpoints + URL builders); `wlo-api.ts` is now a thin barrel
  re-export so callers still import from `./wlo-api.js` unchanged.
- Prompt launcher (`public/launcher.html`) redesigned around **Boerdi**, the WLO
  owl mascot (self-contained inline SVG, blue theme, theme-aware, WCAG AA): the
  primary flow is now an AI picker (radio chips) plus one **Open** button; the
  targeted-search fields and the instruction preview collapse into `<details>` so
  the default view is simple. The injected instruction now sources skills from
  `GET /api/collection` (each result's `downloadUrl` serves the raw Markdown) and
  points natively-registered clients at the `find_wlo_skills` tool. Still bilingual
  DE/EN, no third-party assets.
- `server.ts` split from a ~1500-line file into responsibility-scoped modules
  under `src/tools/*`; topic-page API extracted to `src/topic-page-api.ts`; the
  HTTP rate limiter and body reader extracted to `src/rate-limit.ts` /
  `src/read-body.ts`. Behavior unchanged.
- `getCollectionMetadata` → `getNodesMetadata` (old name kept as a `@deprecated`
  alias for one release).
- `mapPool` is fault-tolerant: a failed item becomes `null` (logged) and no longer
  aborts the whole batch.
- Dockerfile hardened: runs as the non-root `node` user, base image pinned by digest.
- `@modelcontextprotocol/sdk` updated to ^1.29.0.
- Reranker: stopwords no longer contribute to the relevance score.
- **All code comments translated to English.** German runtime/product strings
  (tool descriptions, output text) intentionally kept German.
- README/docs completely rewritten: all 12 tools documented (including
  `get_topic_page_content`, previously missing), full module tree, complete
  `FormattedNode` schema, all environment variables.

### Fixed
- **Markdown skills / launcher prompt now search instead of only advising:** the
  two prompt-launcher skills (`public/skills/wlo-search.skill.md`,
  `wlo-topic-launcher.skill.md`) and the launcher's `instruction_tpl`
  (`public/launcher.html`, DE + EN) read as API reference docs and carried an
  unresolved `BASE = https://YOUR-WLO-HOST` placeholder, so a chat following them
  described the API and recommended filters but never called `/api/search`. They
  now (a) resolve `{BASE}` self-referentially to "the origin you loaded this skill
  from", and (b) lead with an imperative "issue the request now, don't just
  advise" directive plus a one-line fallback for chats without a fetch tool. The
  target endpoint was verified working (live read-only smoke: "Photosynthese" +
  Biologie → 74 content hits). Guarded by `tests/rest-skills.test.ts` (no
  placeholder host, self-resolving base, act-now directive) and the new
  `tests/launcher-instructions.test.ts`.
- Node IDs are URL-encoded before interpolation into upstream URLs
  (`encodeURIComponent`), preventing path/query manipulation.
- Removed dead code: the unused `ngsearchCollections` export.
- Documented the differing `total` semantics of `search_wlo_all` and recursive
  `get_collection_contents` (field names kept stable).

### Security
- Widget links are now **URL-scheme validated**: a new `safeHref` guard
  (`src/apps/widgets/shared/safe-url.ts`) drops any node-derived URL whose scheme
  is not http(s)/mailto before it becomes an `href`, so a `javascript:`/`data:`
  value in the external, publisher-supplied `ccm:wwwurl` metadata can no longer
  render as a clickable link in the widget iframe (defense-in-depth alongside the
  existing HTML escaping and the widget CSP). Applied to all four href sites
  (tile, topic-page, browse open + leaf links). Audit finding 2026-07-15 F1.
- Fixed the **shipped** transitive vulnerabilities from the SDK dependency tree
  (hono, express, path-to-regexp, qs, fast-uri, …) via `npm audit fix` — the
  production audit is now free of high/critical advisories.
- Remaining `undici` CVEs are confined to the `@vercel/node` **dev** dependency
  and are not shipped (see README "Security & operations").
- `excludeNodeIds` parameter capped at 200 entries.
