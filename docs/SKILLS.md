# Skills — how to build the collection

> Kurzfassung des Ablaufs (wie ein Skill ausgelöst wird):
> [`SKILL-TRIGGER.md`](./SKILL-TRIGGER.md)

A **skill** is a reusable instruction document (`SKILL.md`) that an AI applies to
a task. In WLO a skill is one `ccm:io` record: its metadata says what the skill
is for, and its **attached file** is the instruction Markdown.

Two MCP tools read them (`search_skill` → `get_skill`, or the single
`get_skill_for_task`; see [TOOLS.md](TOOLS.md)). This document is for whoever
curates the content — what the server needs to find a skill, and why.

## The record

| | |
|---|---|
| Node type | `ccm:io` |
| Content type | `ccm:oeh_extendedType` = `http://w3id.org/openeduhub/vocabs/contentTypes/ai_prompt` |
| Title | `cclom:title` — names what the skill does |
| Description | `cclom:general_description` — **when** to reach for it |
| Keywords | `cclom:general_keyword` — the trigger words |
| Content | the uploaded `SKILL.md` |

**The content type is what makes a record a skill.** `search_skill` sends it as a
search criterion, so a record without it is invisible to the search no matter
where it sits. The full vocabulary URI is required — the bare slug `ai_prompt`
matches nothing (measured 2026-08-08).

> **`propertyFilter=-all-` does NOT return this field.** Only an explicit
> `propertyFilter=ccm:oeh_extendedType` does — measured 2026-08-08 against the
> staging test collection: `-all-` reported the field missing on all 28 records,
> the explicit projection reported `ai_prompt` on all 28. Anyone checking whether
> a record is tagged must ask for the field by name; `-all-` will say no.

**Upload the Markdown as the node's content.** A web-link node (`ccm:wwwurl`)
looks the same in the editor, but its download URL returns the cached HTML of
the linked page instead of the raw Markdown.

Title, description and keywords are also what the ranking reads — title counts
3, keywords 2, description 1. A skill whose trigger words appear only in the
description will lose to one that puts them in `cclom:general_keyword`.

## Why a skill is a record, not a collection

The tempting alternative — one skill = one collection holding its files — costs
the search outright: **`ngsearch` never returns collections.** Measured
2026-08-08 on staging: `contentType=FOLDERS` answers 0 hits and `contentType=ALL`
returns the same 403 431 `ccm:io` records as `FILES`, not one `ccm:map`. A skill
built as a collection would be findable only by walking to it — never by asking
for it. (Three real portals carry no `ccm:oeh_extendedType` either, re-checked
with an explicit projection after the `-all-` caveat above was found.)

Collections *are* searchable — `POST /search/v1/queries/-home-/mds_oeh/collections`
with `contentType=COLLECTIONS` returns `ccm:map` nodes (46 for "Physik") — but
**only by keyword**: every other criterion, `ccm:oeh_extendedType` and
`ccm:taxonid` alike, is refused with 400 `DAOValidationException`, and a facet
over that field comes back empty. So a skill built as a collection could be
matched by its name and by nothing else.

Keeping the skill a `ccm:io` also makes it **referenceable**. One skill can be
placed in several collections (the skills catalogue *and* Physik/Optik) without
being copied, because adding a record to a collection creates a reference to the
one original. That is what makes "skills hang on subject collections" work at all:

```
Skills/Lehrtoolkit/Stunde planen   ← the original
Physik/Optik/…                     ← a reference to the same record
```

Both listings return it, and `search_skill` returns it **once**: entries are
de-duplicated by `ccm:original`, and when both the original and a reference to it
are in range, the original is the one offered. Every result carries `originalId`
next to `nodeId`, and the Markdown listing marks a reference as such.

That distinction matters twice over: only the original may be **written** to
(writes to a reference are discarded silently, with a 200), and only the original
resolves the companion files without a second lookup.

## The collection structure

```
Skills (the configured root — WLO_SKILLS_COLLECTION_ID)
├── Lehrtoolkit            (a skillset)
│   ├── Stunde planen      ← ccm:io, ai_prompt, SKILL.md attached
│   └── Prüfung erstellen
└── WLO-Technik
    └── Themenseiten
```

Two levels: the **root** holds skillset sub-collections, each skillset holds the
skill records. Skills may also sit directly in the root. Entries may be
references (the normal result of adding an existing record to a collection) —
the walk reads references and originals alike.

**Do not nest deeper.** The server reads the root and **two levels below it**,
and at most 30 collections in total. Both bounds exist because a collection id
that points at something else turns a skill lookup into a crawl. Whenever a
sub-collection is left unread — by either bound, or because its listing failed —
the server logs that the listing is incomplete and names the root. A collection
that cannot be read **at all** is an error, not an empty catalogue.

Cost is **two waves** of requests (the root, then every skillset in parallel, 10
at a time). Measured on staging 2026-08-08:

| Shape | Time |
|---|---|
| root + 6 skillsets | 2.0 s |
| root + 12 skillsets | 2.4 s |
| a subject portal (a *wrong* id: 30 collections, 717 records) | 8.1 s |

The last row is what the bounds are for. Before the walk ran its levels in
parallel it was 90.3 s.

### Linking without placing

Putting a skill reference into Physik/Optik makes it visible there — good for
transparency, but it also sits among the teaching material, which is not what it
is. The alternative is to **tag instead of place**: give the skill record the
subject it belongs to (`ccm:taxonid`), and ask for it by search rather than by
membership.

That composes with the content-type filter — measured 2026-08-08:

| Criteria | Hits |
|---|---|
| `ccm:taxonid = discipline/460` (Physik) | 9878 |
| `ccm:oeh_extendedType = …/learning_material` | 403 261 |
| both together | **9877** (the AND works) |
| both + `ngsearchword = Optik` | 318 |

So `extendedType = ai_prompt AND taxonid = Physik` answers "welche Skills gehören
zu Physik" without any collection membership at all, and one skill can carry
several subjects and education levels. The two approaches are not exclusive —
tag every skill, and place a reference only where the visibility is wanted.

`search_skill` and `get_skill_for_task` take **`discipline`** and
**`educationalContext`** for this, as labels ("Physik", "Sekundarstufe I"),
resolved to URIs from the local vocabulary. Repository-wide they are sent as
criteria; scoped to a collection the same resolved URIs are matched against the
listing, because `/children` takes no criteria.

A label that does not resolve is **reported, not swallowed**: an unresolved
filter is dropped from the query, so the result set is wider than asked for and
nothing else would say so. `search_skill(discipline: "Phsyik")` answers
`⚠ Filter "Phsyik" für discipline nicht erkannt und ignoriert. Meintest du:
Physik?` ahead of the listing, and carries `unresolved` in the JSON output.

**Tag with the field, not with a keyword.** `cclom:general_keyword` would also
work as an exact search criterion, but a skill's title is not a usable key, a
cryptic slug does not belong in a field shown to users, and anyone may edit it.

## Skills of one collection

`search_skill` takes a `collectionId` — for **any** collection, not just the
configured root. A subject collection carries its skills as ordinary content, so
one listing answers "welche Skills hängen an Optik?".

`includeSubcollections` decides how far it reads, and its default depends on
where the id came from:

| Call | Reads | Measured (Physik, staging) |
|---|---|---|
| `search_skill(collectionId: …)` | that collection only | **1 request, 0.8 s** |
| `search_skill(collectionId: …, includeSubcollections: true)` | its subtree | **60 requests, 12.9 s** |
| `search_skill()` with a configured root | the root **and** its skillsets | 2 waves, 2.0–2.4 s |

The configured root is declared to be a two-level catalogue and is useless
without its skillsets. A collection the caller names is a topic — a crawl of its
subtree is a cost the caller should have to ask for.

## Configuration

```bash
WLO_SKILLS_COLLECTION_ID=<nodeId of the root collection>   # optional
WLO_SKILL_TOOL_MODE=two-tool                               # or one-tool
```

Without `WLO_SKILLS_COLLECTION_ID` the search runs **repository-wide**, filtered
by the content type alone. That works, and it is the right setting while the
skills live wherever their authors put them. Set the variable once a single
collection is the catalogue: it narrows the search to that subtree.

The collection cannot be expressed as part of the search query —
`virtual:parent_recursive`, which the topic-page query accepts, is refused by
`ngsearch` with 400 `DAOValidationException` on both instances (measured
2026-08-08). Hence the walk.

## Companion files

A skill may need more than its `SKILL.md` — a template, a checklist, an image.
Those are separate `ccm:io` records in the **same workspace folder** as the
skill, each with its own nodeId and its own anonymous download.

**Give every skill its own folder.** That is the one requirement, and it is what
makes the manifest possible:

```
Workspace/SKILLS/lehrtoolkit/stunde-planen/
├── SKILL.md        ← the skill record (ai_prompt, referenced into collections)
├── vorlage.docx
└── ablauf.png
```

`get_skill` then returns the instructions **plus a list of the folder's other
files** — name, nodeId, MIME type, size, and nothing else. Each entry names the
tool that reads it: `get_skill` hands the file back verbatim, which is right for
Markdown and wrong for a DOCX (it would arrive as decoded ZIP), so anything that
is not `text/*` is pointed at `get_wlo_content_text` and its repository extract.
Nothing beyond the `SKILL.md` is downloaded unasked.

The manifest is generated at call time from the folder listing — there is no
catalogue to maintain, and adding a file to the folder is all it takes.

### References inside the SKILL.md

The editor already writes referenced material and follow-up skills into the
document as fenced blocks:

```
::: wlo-material
![Bruchrechnen](…/preview?nodeId=62a37f02-…)
[**Bruchrechnen**](https://editor.mnweg.org/…) — Lizenz: [CC BY-SA 3.0](…)
:::

::: ki-skill
[Elementares Bruchrechnen](…/components/render/11b41221-…)
:::
```

`get_skill` **parses these** and returns them as `references` — kind, title, url,
nodeId — beside the untouched Markdown. The document is handed over exactly as
written; the ids are simply also stated plainly.

That is the whole point of doing it server-side. A node id sits inside a URL
inside a Markdown link inside a fenced block, and pulling it out is an extraction
task with a failure rate. Worse, **which** id belongs to what differs per block:
a material's title link points at its external SOURCE, so its id has to come from
the preview image, while a skill's id is in its title link. Getting that backwards
yields a plausible id for the wrong record.

Two things the parser does not guess: a block with no repository URL (an external
link with no preview — about a third of WLO records have none) is returned with
an empty `nodeId` rather than dropped, and an **unclosed** block is ignored, because
the `SKILL.md` download is byte-capped and half a block is not a reference.

The hyphens in a node id are a non-issue — every tool here already takes UUIDs as
plain JSON strings.

### The alternatives, and why the folder won

There is **no relation property** on a `ccm:io` to point at other records — 65
properties on a real one, not a single relation/association field (measured
2026-08-08). So the tie must come from the tree, from a tag, or from the document
itself:

| Mechanism | How | For | Against |
|---|---|---|---|
| **Own workspace folder** *(built)* | siblings of the `SKILL.md` | mirrors what an author sees; every file individually referenceable, downloadable, versioned; nothing to maintain | needs folder discipline — a shared folder returns its whole content; the folder is invisible in the collection UI; deleting a skill leaves its files behind |
| **Child-IOs / Serienobjekte** (`ccm:childio`) | physical children of the skill record | the bundle is intrinsic — no discipline to keep; travels with the reference into any collection; dies with the skill; write permission hangs on the skill, not on a folder | **no folders and no paths** (`assets/…` impossible); a child cannot be referenced into a collection on its own; a less common path, so less trodden in this repository |
| **Bundle keyword** (`cclom:general_keyword`) | every file carries `skill:<slug>` | one search returns the bundle, no tree at all; survives moving files anywhere; measured to work as an exact criterion (17 hits vs 820 for the same word as full text) | the tie is a *convention* nothing enforces — a typo silently unbundles a file, and the match is literal (a stray leading space is a different keyword) |
| **Manifest inside the `SKILL.md`** *(built — the `:::` blocks above)* | the editor writes the reference into the document | zero infrastructure, and the editor already produces it; the author states exactly what belongs and why; carries a title, so the model can choose without loading anything | authored, so it goes stale — a moved or replaced record breaks it with nothing to notice; covers what the author linked, not what happens to lie in the folder |

Two of these are now built and they answer different questions: the **folder**
says what physically belongs to this skill, the **`:::` blocks** say what the
author deliberately points at — including records that live nowhere near it.
`get_skill` returns both.

Child-IOs remain the better answer if folder discipline turns out to be
unrealistic: they are the only option where the bundle cannot drift apart. Two
things to check before choosing them — whether the count is limited (six is
suspected, unverified here) and whether the editorial UI makes them workable.
The bundle keyword is not recommended: a skill's title cannot serve as one, and a
cryptic id does not belong in a field that is shown to users and that anyone may
edit.

How it resolves, measured against staging 2026-08-08:

| Starting from | Chain | Cost |
|---|---|---|
| the original | `virtual:primaryparent_nodeid` → `/children` | 1 extra call |
| a reference (from a collection) | `ccm:original` → `/metadata` → `virtual:primaryparent_nodeid` → `/children` | 2 extra calls |

**A reference's own `virtual:primaryparent_nodeid` is the collection**, not the
folder — so the original is resolved first. `ccm:original` must be in the
projection for that; it is.

The cost depends entirely on folder size:

| Folder | Listing |
|---|---|
| a skill folder (1–2 files) | **0.2–0.4 s** |
| a harvest folder (484 files) | 1.7 s |
| a harvest folder (3744 files) | 6.9 s |
| a harvest folder (680 files) | 20.6 s once |

One of six measured workspace folders refused anonymous access outright. Both
cases are handled: a folder holding more than 25 files is reported as a **count**
instead of a file list (it is somebody's inbox, not a bundle), and a folder that
cannot be read at all costs nothing — the instructions come back regardless.
`includeFiles: false` skips the lookup entirely.

---

## The skill registry of a content collection

The other direction on the same question. `search_skill` answers "which skills
exist"; a registry answers **"which skills are approved for THIS collection"** —
and the answer is written by the editorial team, as a document that lives in the
collection.

`get_skill_registry(collectionId)` reads it and returns the catalogue (title,
nodeId, description, keywords per skill) plus the registry's own prose. The
instructions themselves are not included: the model picks from the catalogue and
calls `get_skill` with the nodeId, exactly as after a search.

### How to create one

A registry **is a skill record**. Same content type, same attached Markdown file,
same `:::` blocks. Nothing new has to be configured:

1. Upload a Markdown file into the collection as an ordinary content record.
2. Set its content type to **`ai_prompt`** — the same one every skill carries.
3. **Name the file `SKILL_REGISTRY.md`**, or put `SKILL REGISTRY` in the title.
4. List the approved skills as `::: ki-skill` blocks (below).

Step 3 is not decoration. Measured on staging 2026-08-10: **all 28** skill
records are named `SKILL.md`, because that is what the upload produces. Two
`ai_prompt` documents in one collection are therefore indistinguishable without
it — the server picks the lowest nodeId and **says in its answer** that it had to
choose, which is a warning, not a feature.

### What the document looks like

```markdown
# Skills für die Sammlung Optik

Diese Skills sind für die Arbeit mit dieser Sammlung freigegeben. Der
Kompendialtext-Skill gilt nur für die Oberstufe; für die Mittelstufe bitte
den Fragen-Skill verwenden.

::: ki-skill
[Fragen generieren](https://repository.staging.openeduhub.net/edu-sharing/components/render/12c04f9c-20b5-4461-804f-9c20b5346128)
:::

::: ki-skill
[Kompendialtext schreiben](https://repository.staging.openeduhub.net/edu-sharing/components/render/ccdcae49-d4db-4e4a-9cae-49d4db6e4a25)
:::
```

The prose around the blocks is carried over unchanged — that is where usage
notes belong ("only for the upper grades", "run this one first"). The server
renders its own catalogue **before** the document, because after it a
server-built section could not be told apart from one the document forged.

Rules the reader should know:

- Only `::: ki-skill` blocks become catalogue entries. A `::: wlo-material`
  block is teaching material and is ignored here.
- The link must carry a **node id** (`/components/render/<uuid>` or
  `?nodeId=<uuid>`). A block without one is reported as unresolvable rather than
  dropped — the same for a skill that was deleted or is not readable.
- At most **30** entries per registry; more are reported as capped, not silently
  cut.

### How a model finds out a registry exists

Not by a lookup. Measured on staging 2026-08-10, checking every returned
collection adds **~1.0-1.4 s** to a search — and the cost is the children
listing, which is paid whether or not a registry is there. Neither of the two
collections in that run had one, and it still cost 1.4 s.

So the signal is **text, and text is free** — but a line written without reading
anything may not claim anything either. One sentence per answer (not per
collection) says the three things it can honestly say:

> Hinweis: Ob eine Sammlung eigene Arbeitsanleitungen („Skills") freigegeben hat,
> ist hier nicht geprüft — viele führen keine. `get_skill_registry` mit ihrer
> nodeId beantwortet es, und lohnt sich, wenn es um das Vorgehen MIT einer
> Sammlung geht („wie arbeite ich damit", „was ist hier vorgesehen") statt um
> ihre Inhalte.

The answer is UNKNOWN, HOW to get it, and WHEN it is worth a round-trip. The
third part carries the most weight: without an occasion, a hint that fires on
every collection listing is learned as decoration and ignored. The first part
matters because an earlier draft said "Skills für diese Sammlung", which asserts
that skills exist over data nobody fetched — and today that would be wrong for
essentially every collection.

The lookup then happens once, for the one collection the model is actually
working with, instead of for all five.

That is the COLD case. Once a collection has been seen, a background cache
already holds its catalogue and every result carries it at no cost — the lookup
happened minutes ago, off the request path, and it read the same children
listing the live path reads. The search index is only used to decide WHERE
looking is worth starting; an approval list never rests on it.

**`includeSkillRegistry: true`** on `search_wlo_all` / `search_wlo_collections`
forces the live lookup instead of the remembered one, which matters right after
a registry is created or edited. `WLO_SKILL_CACHE=off` switches off the
background work **and** the per-request live fallback, and the answers go back
to carrying the free pointer above — an operator who flips that switch does it
for the cost, and a fallback that kept running would charge every request the
full children listing while no tick existed to expire anything.

**One thing "no registry" does not always mean.** The scan reads the first 50
file children. Over a collection with more than that — staging has several, e.g.
"Museen" with 169 — a registry can simply sit past the cap, so the read is
remembered (re-reading the same page answers nothing) but does **not** count as
checked, and the answer keeps its pointer line. A definite "this collection has
none" is only ever made over a listing that was seen in full.

A deployment that has moved entirely to this process can also drop the
repository-wide search with `WLO_DISABLE_SKILL_SEARCH=1`. `get_skill` always
stays: it is what the registry's node ids are for.
