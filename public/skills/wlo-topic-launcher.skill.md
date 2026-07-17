---
name: wlo-topic-launcher
description: Guide a learner into a WirLernenOnline topic page (structured entry point) and its background texts, and build one-click AI launcher deep links.
---

# WLO Topic Launcher

Use this skill when the user wants a **structured entry point into a subject** —
a guided "topic page" (Themenseite) with grouped materials — rather than a flat list
of hits, or when they ask for **background/compendium text** on a topic. It is the
deep-dive companion to the `wlo-search` skill: `wlo-search` finds things,
`wlo-topic-launcher` goes *into* one topic and orients the learner.

Read-only, no authentication.

## When invoked — act, don't just advise

When this skill is active, **actually call the endpoints below** for the user's
topic and answer from the real payloads — do not stop at describing the steps or
handing back a URL. If you genuinely cannot fetch a URL (some chats only load
links posted by the user, or strip query strings from AI-built URLs): output the
ready-to-open URL and ask the user to paste it into the chat — after that you
can load it.

## Base URL

`{BASE}` is **the origin you loaded this skill from** — the same host that served
this instruction (e.g. `/api/skills/wlo-topic-launcher`). Reuse that exact origin
for every `/api/…` call below; do not substitute or invent a different host.

## 1. Find the topic page

A topic page is a collection with a page configuration. Find candidates with the
combined search, restricted to the topic-page bucket:

```
GET {BASE}/api/search/<topic>?include=topicPages
```

(The path form survives fetch layers that strip query strings from AI-built
URLs — a stripped request only loses the `include` narrowing, not the search.)

Each `topicPages.results` item has a `nodeId` (the collection id) and a
`topicPageUrl`. Pick the most relevant and keep its `nodeId`.

## 2. Resolve the topic page's structure

```
GET {BASE}/api/topic-page?collectionId=<nodeId>
```

Optional parameters:

| Param            | Meaning                                          | Default |
|------------------|--------------------------------------------------|---------|
| `targetGroup`    | `teacher` \| `learner` \| `general`              | general |
| `maxPerSwimlane` | Items shown per section (1–10)                   | 3       |

Response (a "swimlane payload"):

```jsonc
{
  "variantTitle": "Photosynthese",
  "topicPageUrl": "https://…",
  "swimlaneCount": 4,
  "swimlanes": [
    { "heading": "Einführung", "items": [ { "title": "…", "url": "…", "nodeId": "…" } ] },
    { "heading": "Vertiefung",  "items": [ /* … */ ] }
  ]
}
```

Present it as a **guided path**: walk the swimlanes top to bottom (each `heading`
is a step), listing a couple of items per step with their links, and finish with a
link to the full `topicPageUrl`.

An empty `swimlanes` array means no variant was found — fall back to `wlo-search`.

## 3. (Optional) Background / compendium text

For an editorial explanation of a collection or topic page:

```
GET {BASE}/api/compendium?ids=<nodeId1,nodeId2>
```

Returns `{ "entries": [ { "nodeId", "title", "compendiumText" } ] }`. A
`compendiumText` of `null` simply means none is stored — skip it silently.

For encyclopaedic background, `GET {BASE}/api/wikipedia?q=<topic>&lang=de` returns
`{ "title", "extract", "url", "lang" }`, or **404** when there is no article.

## 4. Build a one-click AI launcher deep link (optional)

To hand the user a link that re-opens this query inside another AI chat, wrap a
prompt that instructs the AI to call the REST API, then URL-encode it into a target:

```
Claude:  https://claude.ai/new?q=<encoded prompt>
ChatGPT: https://chat.openai.com/?q=<encoded prompt>
Gemini:  https://gemini.google.com/app?q=<encoded prompt>
```

Example prompt to encode:

> Finde die passende WLO-Themenseite zu „<topic>". Rufe dazu
> `{BASE}/api/search/<topic>?include=topicPages` ab und fasse die Schritte der
> Themenseite mit Links zusammen.

The hosted [`/launcher.html`](../launcher.html) page builds exactly these
links interactively — point non-technical users there instead of hand-crafting.

## Failure handling

- **400 on a correctly built URL** — your fetch tool has probably stripped the
  query string (`/api/topic-page` needs `collectionId` as a query parameter).
  Output the full URL and ask the user to paste it into the chat, then load it.
- **400 otherwise** — missing `collectionId`/`variantId`, or an invalid
  `targetGroup`. Re-derive the `nodeId` from step 1.
- **404** (wikipedia) — no article; continue without it.
- **429** — rate limit; wait ~60 s and retry once.
