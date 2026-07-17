---
name: wlo-search
description: Find open educational resources (OER) from WirLernenOnline via the public WLO REST API and summarise them for the user.
---

# WLO Search

Use this skill when the user asks for **teaching or learning materials, worksheets,
videos, or collections** on a school/education topic (e.g. "Materialien zur
Photosynthese", "worksheets on the water cycle"). It calls the WirLernenOnline (WLO)
public REST API and turns the JSON result into a short, source-linked answer.

This skill is **read-only** and needs no authentication.

## When invoked — search first, don't just advise

When this skill is active and the user names a topic, **immediately issue the
search request for that topic and answer from the real results.** Do not stop at
suggesting filters or handing back a URL — the whole point of this skill is to
fetch actual WLO hits and summarise them.

1. Build the request URL (below) for the user's topic.
2. **Call it now** with your web-fetch / browsing / HTTP tool.
3. Summarise the returned hits (title, one-line description, link).

Make **no test or warm-up call**. If the user has not named a topic yet, briefly
explain the options (topic, optionally subject, educational level, resource
type) and ask for the topic first.

If you genuinely cannot fetch a URL (some chats only load links posted by the
user): output the ready-to-open URL and ask the user to paste it into the chat —
after that you can load it. Never reply with only filter suggestions and no
query.

## Base URL

`{BASE}` is **the origin you loaded this skill from** — the same host that served
this instruction (e.g. `/api/skills/wlo-search`). Reuse that exact origin for
every `/api/…` call below; do not substitute or invent a different host.

## How to call

Issue a single HTTP **GET**. Prefer the **path form** — the term rides in the
path, so it survives fetch layers that strip query strings from AI-built URLs
(a stripped request only loses the optional filters, never the search):

```
GET {BASE}/api/search/<query>
GET {BASE}/api/search?q=<query>    (equivalent alias)
```

Send `Accept: application/json`. The only required input is the search term.

### Parameters

| Param                     | Meaning                                              | Default |
|---------------------------|------------------------------------------------------|---------|
| `q` (required)            | Search term, max 200 chars                            | —       |
| `include`                 | Comma list of `content,collections,topicPages`       | all     |
| `discipline`              | Subject label, e.g. `Biologie` (fuzzy-matched)       | —       |
| `educationalContext`      | Level, e.g. `Sekundarstufe II`                       | —       |
| `learningResourceType`    | Material type, e.g. `Video`, `Arbeitsblatt`          | —       |
| `maxContent`              | Individual resources to return (1–25)                | 8       |
| `maxCollections`          | Collections to return (1–25)                         | 5       |
| `includeCompendium=true`  | Add editorial compendium texts to collections        | off     |
| `includeWikipedia=true`   | Add a short Wikipedia summary alongside WLO results  | off     |

Unknown filter labels are **not** an error — the API resolves what it can and ignores
the rest. Query values must be URL-encoded.

### Example

```
GET {BASE}/api/search/Photosynthese?discipline=Biologie&educationalContext=Sekundarstufe%20II
```

## Response shape

```jsonc
{
  "query": "Photosynthese",
  "content":     { "total": 42, "count": 8, "results": [ /* resources */ ] },
  "collections": { "total": 3,  "count": 3, "results": [ /* collections */ ] },
  "topicPages":  { "total": 1,  "count": 1, "results": [ /* topic pages */ ] },
  "wikipedia":   { "title": "…", "extract": "…", "url": "…", "lang": "de" }  // only if includeWikipedia=true
}
```

Each result item carries:

| Field         | Use                                                    |
|---------------|--------------------------------------------------------|
| `title`       | Display title                                          |
| `description` | One-line summary                                       |
| `url`         | Link to the resource (may be empty for some nodes)     |
| `nodeId`      | Stable WLO id (use with the `wlo-topic-launcher` skill) |
| `previewUrl`  | Thumbnail (optional)                                   |
| `topicPageUrl`| Present on `topicPages` items — link to the topic page |

## How to present the result

1. Lead with 3–6 of the strongest `content.results` — title, one-line description,
   and the `url` as a link. Never invent a link; omit it if `url` is empty.
2. If `collections.results` or `topicPages.results` are non-empty, offer them as
   "curated collections / topic pages" for going deeper.
3. If a `wikipedia` summary is present, add it as short background context, clearly
   labelled as Wikipedia (separate from the WLO OER hits).
4. Keep it concise; link out rather than pasting long text.

## Failure handling

- **Empty `query` + a `warnings` array** — your fetch tool stripped the query
  string in transit. Switch to the path form `{BASE}/api/search/<query>`, or
  output the full URL and ask the user to paste it into the chat. Do not treat
  the empty buckets as a real "no results".
- **400** — the term was too long (max 200 chars) or malformed. Ask the user
  for a shorter term; do not blindly retry.
- **429** — rate limit; wait ~60 s and retry once.
- **Empty buckets with your term echoed in `query`** — genuinely nothing found;
  suggest a broader or differently-worded term.

Do **not** retry aggressively; one call per user request is the norm.
