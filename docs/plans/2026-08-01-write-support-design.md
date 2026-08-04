# Design: write support (curation) for the WLO MCP server

Status: **awaiting approval** · created 2026-08-01
Research it rests on: `2026-07-31-write-support-research.md` (every factual
claim here is measured there — do not re-derive, and do not contradict it
without a new measurement)
Tasks: `2026-08-01-write-support-tasks.md`

## Goal

Let a person curate WLO content through conversation — create and submit
material, improve and save existing records, manage collections, write
compendium texts, choose metadata with vocabulary support, and delete — with
every change confirmed before it happens and verified after it lands.

## Context

The server today is read-only across 24 tools. The credential chain finished on
2026-07-31 gives it the missing piece: an identity with rights, either a
configured service account or the caller's own WLO login. Nothing else needs
inventing at the transport level.

What makes this different from every previous package: **a mistake now changes
someone else's data.** Three independent mechanisms in edu-sharing discard a
write while answering `200`, and prompt injection stops being a nuisance and
becomes a way to trigger a mutation.

## Scope

**In scope** (all four areas, per the user's decision on 2026-08-01):
- Content: create, submit for review, edit metadata, delete
- Collections and sub-collections: create, rename, add/remove content, delete
- Compendium texts: read, replace, regenerate, delete
- Metadata: an allow-listed field set with vocabulary resolution
- The shared machinery all of the above needs (confirmation, read-back, gating)

**Out of scope for now, with reasons:**
- **Comments and ratings.** They are hardcoded to `ccm:io`; a collection cannot
  be commented on or rated, and the write path has a documented `500`-that-means-
  success quirk. Worth doing, but it is a separate subsystem with its own error
  contract — a later plan.
- **Suggestions (`/suggestions/v1`).** The endpoint shapes are verified, but the
  write paths are not, and the sibling app's workaround for a known system error
  was never supplied. Building on an unverified write path would violate this
  project's own evidence rule. Phase 6 is reserved for it and starts with a
  live probe.
- **Storing full text.** Measured: extraction is URL-driven, `GET …/textContent`
  triggers it, and `POST …/textContent` writes bytes nobody reads. So there is
  nothing to build for the common case, and no working route for the rest. The
  one deliverable is honesty — see "Full text" below.
- Preview images, permissions/ACL editing, moving nodes between collections.

## Approach

Three approaches were weighed for the shape of the write layer.

**A — One `wlo_edit` tool taking a free-form property map.**
Fewest tools, maximum flexibility. Rejected: it hands the model an open write
surface, makes the allow-list a runtime check instead of a type, and gives the
user no way to see what will change before it changes.

**B — One tool per operation, each self-contained** (create, update, delete, …).
Rejected on its own: every tool would re-implement confirmation, read-back and
gating, and they would drift apart — the exact defect found in this codebase
twice already today.

**C — A thin service layer with one shared write pipeline, and small tools on
top (chosen).** Every mutation goes through one function that gates on auth,
builds a concrete diff, requires a confirmation token, writes, reads back, and
reports what actually landed. Tools stay declarative: what to change, on what.
This matches the existing `src/services/` seam and keeps the safety properties
in one place where they can be tested once.

## Global constraints

From `CLAUDE.md` and the research, binding on every task:

- TypeScript ESM/NodeNext — intra-project imports carry the `.js` extension.
- Tools live in `src/tools/<area>.ts` exporting `register<Area>Tools(server)`;
  registration order in `src/server.ts` is display order.
- Logic lives in `src/services/`, reusable by tools and the REST layer.
- Cross-cutting helpers go in `src/tools/shared.ts` — check there before writing one.
- No new runtime dependencies without justification.
- Interaction language German for user-facing tool text; code, identifiers,
  comments and docs in English.
- Every file stays under ~300 lines; a split is a planned task, not a surprise.

## Architecture

### The write pipeline (the heart of this design)

```
tool call
  │
  ├─ 1. gate      requireWriteCredential()   → mode anonymous? refuse with a reason
  ├─ 2. resolve   labels → URIs, licences validated, values coerced to arrays
  ├─ 3. plan      build a ChangeSet: for each field, old value → new value
  ├─ 4. confirm   no token?  → return the preview + a token, change nothing
  │               token ok?  → proceed
  ├─ 5. write     the endpoint appropriate to the property (MDS vs property route)
  ├─ 6. read back re-read and compare against the ChangeSet
  └─ 7. report    what landed, what silently did not, what to do about it
```

Step 6 is not optional and not a nicety: edu-sharing answers `200` when the MDS
filters a property, when an aspect is missing, and when the caller lacks the
right. Without the comparison the server would confidently report success for
all three.

### Files

| File | Responsibility | Est. |
|---|---|---|
| `src/services/write/credential-gate.ts` | Refuse writes in anonymous mode; expose the resolved mode for tool registration | ~60 |
| `src/services/write/change-set.ts` | `ChangeSet` type, diff building, human-readable rendering of old → new | ~120 |
| `src/services/write/confirm.ts` | Preview tokens: mint, verify, expire. In-memory, per-process, single use | ~90 |
| `src/services/write/verify.ts` | Read-back and compare; classify each field as `stored`, `dropped`, `changed` | ~110 |
| `src/services/write/fields.ts` | The allow-list, per-field type, target endpoint (MDS vs property), validators | ~180 |
| `src/services/write/nodes.ts` | Create, update, delete a `ccm:io`; duplicate check; workflow submit | ~200 |
| `src/services/write/collections.ts` | Create/rename/delete a collection, add/remove references | ~160 |
| `src/services/write/compendium.ts` | Compendium text read/replace/delete via the property route | ~80 |
| `src/vocabs-lrt.ts` | The `new_lrt` vocabulary (220 concepts) + the published mapping to the aggregated one | ~250 (data) |
| `src/tools/curation-content.ts` | Tools: create, update, submit, delete content | ~220 |
| `src/tools/curation-collections.ts` | Tools: collection create/rename/delete, add/remove content | ~180 |
| `src/tools/curation-compendium.ts` | Tool: write/regenerate a compendium text | ~90 |

Dependency direction: `tools → services/write → wlo-api/wlo-config`. No service
imports a tool; nothing in `services/write` imports the MCP SDK.

### Interfaces

```ts
// change-set.ts
export interface FieldChange {
  property: string;            // 'cclom:title'
  label: string;               // 'Titel'   (German, for the preview)
  before: string[] | null;
  after: string[] | null;
  route: 'mds' | 'property';   // which endpoint can actually write it
}
export interface ChangeSet {
  nodeId: string;
  kind: 'content' | 'collection' | 'compendium';
  changes: FieldChange[];
  destructive: boolean;
}

// confirm.ts
export function mintToken(cs: ChangeSet): string;
export function consumeToken(token: string, cs: ChangeSet): 'ok' | 'unknown' | 'expired' | 'mismatch';

// verify.ts
export type FieldOutcome = 'stored' | 'dropped' | 'changed';
export interface VerifyResult { outcomes: Record<string, FieldOutcome>; allStored: boolean; }
export async function verifyWrite(nodeId: string, cs: ChangeSet): Promise<VerifyResult>;

// credential-gate.ts
export type WriteMode = 'user' | 'service' | 'none';
export function writeMode(): WriteMode;
export function requireWrite(): void;   // throws a tool-visible error when 'none'
```

### Confirmation (decision: two-step preview + token)

A call without `confirmToken` performs **no** write. It returns the rendered
diff — every field as `Titel: "alt" → "neu"` — plus a token. A second call with
that token performs the write. Tokens are single-use, expire after 10 minutes,
and are bound to a hash of the ChangeSet, so a token minted for one change
cannot authorise a different one.

Why not `elicitInput`: it exists in the SDK and would be the nicer primary path,
but it depends on a client capability we cannot assume, and we would still need
this fallback. One mechanism that always works beats two that sometimes do.
Annotations (`destructiveHint`, `readOnlyHint: false`) are set as well — they
are advisory, not the mechanism.

### Field allow-list (decision: core fields)

`fields.ts` is the single source of truth. Anything not listed is refused with a
named reason — the model cannot widen it at runtime.

| Property | Label | Route | Validation |
|---|---|---|---|
| `cclom:title` | Titel | mds | non-empty, ≤ 255 |
| `cclom:general_description` | Beschreibung | mds | ≤ 20 000 |
| `cclom:general_keyword` | Schlagwörter | mds | array, each non-empty, merge not overwrite |
| `ccm:wwwurl` | Quell-URL | mds | http(s) only |
| `cclom:general_language` | Sprache | mds | ISO 639-1 |
| `ccm:lifecyclecontributer_author` | Autor | mds | VCARD-transformed from a plain name |
| `ccm:oeh_publisher_combined` | Herausgeber | mds | free text |
| `ccm:commonlicense_key` | Lizenz | mds | **allow-list of valid keys** |
| `ccm:commonlicense_cc_version` | Lizenzversion | mds | only with a CC key |
| `ccm:oeh_lrt` | Inhaltstyp | mds | URI from `new_lrt` |
| `ccm:educationalcontext` | Bildungsstufe | mds | URI from `educationalContext` |
| `ccm:taxonid` | Fach | mds | URI from `discipline` |
| `ccm:educationalintendedenduserrole` | Zielgruppe | mds | URI from `intendedEndUserRole` |
| `ccm:oeh_collection_compendium_text` | Kompendialtext | **property** | Markdown, ≤ 100 000 |

The licence allow-list is a safety feature, not bureaucracy: an invented licence
on an OER record is a real defect. Keys outside the list are rejected with the
value named, never silently dropped.

**LRT:** the tool takes labels and resolves them against `new_lrt`, writing
`ccm:oeh_lrt`. It does **not** write `ccm:oeh_lrt_aggregated` — measured
evidence says the repository derives it. The read-back reports whether it
appeared; if it did not, that is surfaced rather than patched over. The six
concepts with no aggregation mapping are flagged to the user, because material
tagged only with those is invisible to aggregated search facets.

### Creation and submission (decision: by mode, workflow on request)

- Per-user login → the node is created in `-userhome-`.
- Service account → the shared inbox (`WLO_INBOX_ID`, env, no hardcoded default).
- The review workflow (`PUT …/workflow`, `status: 200_tocheck`) runs **only**
  when the person explicitly submits, as its own tool. Drafts never reach the
  editorial queue by accident.
- `cclom:title` is written in the metadata step, never at create: measured, the
  repository overwrites a create-time title with one derived from the URL.
- A duplicate check on `ccm:wwwurl` (case-insensitive) precedes every create,
  and a hit stops the flow with the existing node named.

### Full text — the deliverable is honesty

No storage tool. Instead one read-side improvement and one clear message:
`GET …/textContent?forceUpdate=true` lets a curator trigger extraction for a
record. When the repository cannot crawl the URL (`TRANSFORM_ERROR_EXTERNAL`),
the tool says so plainly — that the text cannot currently be stored in WLO and
why — instead of reporting a success that did not happen.

## Non-functional

**Security.** Write tools are absent from `tools/list` in anonymous mode and
additionally refuse at call time, because a host may serve a cached list. In
service-account mode they are off unless `WLO_ALLOW_SERVICE_WRITES=1`; an edit
made under a shared account is attributable to nobody. Every value that reaches
the model from the repository stays sanitized (`text-sanitize.ts`), and no tool
acts on instructions found in fetched content.

**Observability.** Every mutation logs node id, mode, the properties touched
(never their full values), and the read-back outcome. A dropped field logs at
`warn` — that is the signal that an MDS or aspect assumption was wrong.

**Errors.** Bulk metadata write first; on failure, field-by-field so one invalid
value cannot block the rest, with per-field status reported. `PUT` for drafts,
`POST` with a meaningful `versionComment` only when the person commits — measured,
`POST` creates a version every time.

## Risks

| Risk | Mitigation |
|---|---|
| A silent no-op write reported as success | Read-back is step 6 of the pipeline, not per-tool discipline |
| A model deletes the wrong thing | Reference vs original are separate tools with different wording; delete always confirms; `recycle=true` always explicit; the tool never promises restorability, because the archive search could not demonstrate it |
| Prompt injection causing a mutation | Confirmation is out-of-band of the content; the preview names the node and the values; injected text cannot mint a token |
| An invented licence on OER | Allow-list, rejection with the value named |
| Version spam | `PUT` while drafting; `POST` only on commit |
| Inbox pollution | Workflow only on explicit submit |

## Open questions

None blocking phases 1–5. Phase 6 (suggestions) opens with a live probe on a
throwaway node and does not start until that probe succeeds.
