# Tasks: write support (curation)

Design: `2026-08-01-write-support-design.md` · Research: `2026-07-31-write-support-research.md`
Target repository for all live checks: **staging**.

**A note on this list's form.** Every task names exact files, exact signatures,
and the exact assertions its test must make — no decision is deferred to
implementation. It does **not** paste full implementation bodies: at this size
that would be a worse document, not a better one, and the bodies follow from
the signatures plus the named traps. Where behaviour is genuinely non-obvious
(the traps), the concrete rule is written out.

Standing rules for every task: TDD (failing test first, watched fail, then
green), no `any`, files under ~300 lines, `.js` import extensions, German
user-facing text / English code.

---

## Phase 1 — The shared write pipeline (nothing user-visible yet)

**Step 0: invoke `/better-coding-workflow`** (skills unload — reload before coding)

### Task 1: Write-mode gate
- Create: `src/services/write/credential-gate.ts`
- Test: `tests/write-credential-gate.test.ts`

`writeMode(): 'user' | 'service' | 'none'` derives from `currentCredential()`:
source `user` → `'user'`; source `service` → `'service'` **only when**
`WLO_ALLOW_SERVICE_WRITES` is truthy, else `'none'`; no credential → `'none'`.
`requireWrite()` throws an `Error` whose message names the reason in German.

Test asserts: anonymous → `'none'`; service without the flag → `'none'`; service
with the flag → `'service'`; per-user always → `'user'`; `requireWrite()` throws
exactly in the `'none'` cases and the message mentions anmelden.

### Task 2: Field allow-list
- Create: `src/services/write/fields.ts`
- Test: `tests/write-fields.test.ts`

Exports `WRITABLE_FIELDS: Record<string, FieldSpec>` with the 14 rows from the
design, and `validateField(property, values): { ok: true; values: string[] } |
{ ok: false; reason: string }`.

Rules that must be encoded, not improvised:
- every value is an array, always, even single values;
- `ccm:commonlicense_key` is checked against the valid-key list (`NONE`, `CC_0`,
  `CC0`, `CC_BY`, `CC BY`, `CC_BY_SA`, `CC BY-SA`, `CC_BY_ND`, `CC BY-ND`,
  `CC_BY_NC`, `CC BY-NC`, `CC_BY_NC_SA`, `CC BY-NC-SA`, `CC_BY_NC_ND`,
  `CC BY-NC-ND`, `PDM`, `CUSTOM`, `SCHULFUNK`, `UNTERRICHTS_UND_LEHRMEDIEN`,
  `COPYRIGHT_FREE`, `COPYRIGHT_LICENSE`) — an unknown key is **rejected with the
  value named**, never dropped;
- a CC key without a version defaults the version to `4.0` — **except `CC_0`/`CC0`**
  (corrected during implementation: CC0 exists only as 1.0, so a 4.0 default
  would state something untrue about the licence; it is left without a version
  rather than guessed);
- `ccm:lifecyclecontributer_author` converts `"Dr. Maria Schmidt"` to a VCARD,
  splitting at the **last** space. **Corrected during implementation** to the
  shape the WLO metadata agent actually uploads with — that is the format the
  existing records carry, and it is spec-correct vCard 3.0 (VERSION directly
  after BEGIN, `N` with all five components):
  `BEGIN:VCARD\nVERSION:3.0\nN:Schmidt;Dr. Maria;;;\nFN:Dr. Maria Schmidt\nEND:VCARD`.
  Evidence: `ideendatenbank/.claude/skills/wlo-edu-sharing-upload/SKILL.md`
  (`_transform_author_to_vcard`). The earlier shape in this document was written
  from memory and was wrong;
- `ccm:oeh_collection_compendium_text` carries `route: 'property'`; everything
  else `route: 'mds'`;
- an unknown property is rejected naming it.

Test asserts each of the above, including that `ccm:oeh_lrt_aggregated` is **not**
writable (the repository derives it) and that a made-up licence like
`"Universität Hamburg"` is rejected.

Also added while implementing, for the same reason the licence list exists: the
three vocabulary fields (`ccm:educationalcontext`, `ccm:taxonid`,
`ccm:educationalintendedenduserrole`) resolve labels through the existing
`resolveVocab` **and then check the result is actually in that vocabulary**.
`resolveVocab` passes any `http…` input through unchanged — correct for search,
where a filter that matches nothing is harmless, and wrong for a write.

> **Retracted 2026-08-01 (Phase 2).** A note here claimed
> `ccm:lifecyclecontributer_author` needs the `cm:author` aspect or the value is
> silently discarded. That came from the sibling project's *documentation* and
> contradicts our own *measurement*: the research doc §"Aspects" records that the
> field wrote fine with no `cm:author` aspect, because `ccm:io` already carries
> `cclom:lifecycle`, and concludes explicitly "do not build it as a hard gate;
> let the read-back decide". No aspect step in Task 6 or 12. The read-back
> remains the mechanism that catches a drop, whatever its cause.

### Task 3: ChangeSet and its rendering
- Create: `src/services/write/change-set.ts`
- Test: `tests/write-change-set.test.ts`

`buildChangeSet(nodeId, kind, before: NodeProps, desired: Record<string,string[]>): ChangeSet`
drops fields whose value is unchanged, and `renderChangeSet(cs): string` produces
German lines `Titel: „alt" → „neu"`, `Schlagwörter: + Bruchrechnung`, and for a
delete `Löscht: <Titel> (nodeId)`.

Test asserts: unchanged fields do not appear; a new field renders with `(leer)`
as the before value; the rendering contains no control characters (it goes to
the model — reuse `sanitizeText`).

### Task 4: Confirmation tokens
- Create: `src/services/write/confirm.ts`
- Test: `tests/write-confirm.test.ts`

`mintToken(cs)` returns an opaque string bound to a SHA-256 of the ChangeSet.
`consumeToken(token, cs)` returns `'ok' | 'unknown' | 'expired' | 'mismatch'`
and is **single use**. TTL 10 minutes, clock injected for testability.

Test asserts: a fresh token is `'ok'` once and `'unknown'` the second time; a
token minted for change A against change B is `'mismatch'`; past the TTL it is
`'expired'`. The mismatch case is the security-relevant one — it is what stops a
preview of a harmless edit from authorising a different one.

### Task 5: Read-back verification
- Create: `src/services/write/verify.ts`
- Test: `tests/write-verify.test.ts`

`verifyWrite(nodeId, cs)` re-reads `…/metadata?propertyFilter=-all-` and returns
per property `stored` (matches `after`), `dropped` (still `before`, or absent),
or `changed` (something else entirely — e.g. the repository derived a value).

Test asserts, with a faked upstream: a field the mock silently ignores comes back
`dropped`; a matching field `stored`; a field the server rewrote `changed`; and
`allStored` is false whenever any field is not `stored`.

---

## Phase 2 — First end-to-end slice: edit an existing record

**Step 0: invoke `/better-coding-workflow`**

### Task 6: Node metadata update service
- Create: `src/services/write/nodes.ts` (update only in this phase)
- Test: `tests/write-nodes-update.test.ts`

`updateNodeMetadata(nodeId, desired, opts: { commit: boolean })`:
route `mds` fields through `PUT …/metadata?obeyMds=false` while drafting, or
`POST …/metadata?versionComment=…&obeyMds=false` when `commit` is true; route
`property` fields through `POST …/property?property=…` with body `["value"]`.
On a bulk failure, retry field-by-field and collect per-field status.

Test asserts: `obeyMds=false` is on the request (without it non-widget fields
vanish — measured); `commit: false` uses `PUT` and `commit: true` uses `POST`
with a non-empty `versionComment`; a bulk 400 triggers the per-field fallback
and the failing field is named in the result.

### Task 7: The update tool, two-step
- Create: `src/tools/curation-content.ts`
- Test: `tests/tools-curation-update.test.ts`

`wlo_update_content` — params `nodeId`, the allow-listed fields, optional
`confirmToken`, optional `commit`. Without a token: read current values, build
the ChangeSet, return the rendered preview plus the token, **write nothing**.
With a valid token: write, verify, and report per field what landed.

Test asserts: a call without a token performs **zero** upstream write requests
(assert on the mock's recorded calls, not on the text); the reply contains the
token and the German diff; a call with the token writes exactly once per route;
a `dropped` field is reported as not saved with a reason, and the tool does not
claim success.

### Task 8: Registration and mode gating
- Modify: `src/server.ts`, `src/http-app.ts`, `src/tools/curation-content.ts`
- Test: extend `tests/auth-public-surface.test.ts`, `tests/tools-list.test.ts`

`createMcpServer()` takes the resolved write mode; curation tools register only
when it is not `'none'`. `http-app.ts` already resolves the credential before
`createMcpServer()` (line 107 vs 164) — pass it through. Each write tool
additionally calls `requireWrite()` at call time, because a cached tool list can
lie.

Test asserts: anonymous `tools/list` contains no `wlo_update_content`; per-user
does; and a direct call in anonymous mode fails with the German reason even when
the tool is invoked anyway.

---

## Phase 3 — Vocabulary for authoring

**Step 0: invoke `/better-coding-workflow`**

### Task 9: The `new_lrt` vocabulary
- Create: `src/vocabs-lrt.ts`
- Test: `tests/vocabs-lrt.test.ts`

Generate from `https://vocabs.openeduhub.de/…/new_lrt/index.json`: 220 concepts,
label + aliases → URI, plus `AGGREGATION: Record<string,string>` from the
published `broadMatch`/`relatedMatch`/`exactMatch` targets (214 entries), and
`UNMAPPED: string[]` (the 6 with no target).

Test asserts: 220 concepts; every `AGGREGATION` value is a `new_lrt_aggregated`
URI; the 6 unmapped are exactly `Material`, `Dokumente und textbasierte Inhalte`,
`Anleitung`, `Weiteres Material`, `Unterrichtsplanung`, `Lehr- und Lernmaterial`;
resolving `"Arbeitsblatt"` yields a URI.

### Task 10: Wire LRT into the field layer
- Modify: `src/services/write/fields.ts`
- Test: extend `tests/write-fields.test.ts`

`ccm:oeh_lrt` accepts labels and resolves them; unresolvable labels are rejected
with the label named and up to five suggestions. When a chosen concept is in
`UNMAPPED`, the validation result carries a note the tool surfaces: this material
will not appear under aggregated content-type facets.

Test asserts: a label resolves; an unknown label is rejected with suggestions;
`"Unterrichtsplanung"` resolves **and** carries the note.

---

## Phase 4 — Create and submit

**Step 0: invoke `/better-coding-workflow`**

### Task 11: Duplicate check
- Modify: `src/services/write/nodes.ts`
- Test: `tests/write-nodes-duplicate.test.ts`

`findByUrl(url)` runs `ngsearch` on `ccm:wwwurl` and compares
**case-insensitively** against each hit's actual URL — the API-side check of
"any hits at all" is too loose.

Test asserts: an exact match is found; a match differing only in case is found;
an unrelated hit in the result set is **not** treated as a duplicate.

### Task 12: Create
- Modify: `src/services/write/nodes.ts`, `src/tools/curation-content.ts`
- Test: `tests/write-nodes-create.test.ts`

`createContentNode(input)`: duplicate check → `POST …/children?type=ccm:io&renameIfExists=true&versionComment=…`
with the small body (`ccm:linktype: ["USER_GENERATED"]`, description, keywords,
`ccm:wwwurl`, language) → **then** the metadata step for the title and the rest.
Parent: `-userhome-` in user mode, `WLO_INBOX_ID` in service mode.

Test asserts: the create body contains **no** `cclom:title` (measured: the
repository overwrites it from the URL, so it must come in the metadata step);
`ccm:linktype` is present; a duplicate aborts before any create call; the parent
differs by mode.

### Task 13: Submit for review
- Modify: `src/tools/curation-content.ts`
- Test: `tests/tools-curation-submit.test.ts`

`wlo_submit_content` — `PUT …/workflow` with
`{receiver:[{authorityName:'GROUP_ORG_WLO-Uploadmanager'}], status:'200_tocheck', comment}`.
Two-step confirmed like every mutation. Never called automatically by create.

Test asserts: creating does not touch `/workflow`; submitting without a token
only previews; the receiver group and status are exactly as above.

---

## Phase 5 — Collections, compendium, delete

**Step 0: invoke `/better-coding-workflow`**

### Task 14: Collection service
- Create: `src/services/write/collections.ts`
- Test: `tests/write-collections.test.ts`

Create (`POST /collection/v1/collections/-home-/{parent}/children`, parent
`-root-` for level 0, type `EDITORIAL`), rename, add reference
(`PUT …/references/{node}`, no body), remove reference, delete collection.

Test asserts: adding a reference sends **no** body; removing a reference targets
the reference endpoint and not the node endpoint (the reference-vs-original trap).

### Task 15: Collection tools
- Create: `src/tools/curation-collections.ts`
- Test: `tests/tools-curation-collections.test.ts`

Two-step for every mutation. Adding and removing content are separate tools with
wording that cannot be confused with deleting the material itself.

### Task 16: Compendium text
- Create: `src/services/write/compendium.ts`, extend `src/tools/curation-compendium.ts`
- Test: `tests/write-compendium.test.ts`

Writes via `POST …/property?property=ccm:oeh_collection_compendium_text` with
body `["<markdown>"]`; `null` deletes. **Never** `PUT /metadata` — measured, the
property is not in the MDS and would be silently discarded.

Test asserts: the property route is used; a read-back mismatch is reported as
not saved; deleting sends `null`.

### Task 17: Delete
- Modify: `src/tools/curation-content.ts`, `src/tools/curation-collections.ts`
- Test: `tests/tools-curation-delete.test.ts`

`DELETE …?recycle=true`, always explicit. The preview names the title and the id.
The reply states plainly that the deletion may not be undoable — it must **not**
promise a restore, because the archive search could not demonstrate one.

Test asserts: `recycle=true` is on the request; no delete happens without a
token; the reply contains no promise of restorability.

---

## Phase 6 — Suggestions — **DONE 2026-08-01** (was blocked; the probe unblocked it)

**Step 0: invoke `/better-coding-workflow`**

### Task 18: Live probe before any code — **DONE 2026-08-01, probe succeeded**

Run against staging with the `WLO-Upload` account on three throwaway nodes,
created and deleted by the probe. Full record in the research doc, §8.

All three write paths answer `200` and do what they say: `POST` stores with
`status: PENDING`, `PATCH …?status=ACCEPTED` really flips the status (confirmed
by read-back). **The blocking condition is lifted.**

Two measured facts change what Phase 6 must build:

1. **`POST` returns an array, `GET` returns a map keyed by `propertyId`.** Code
   that reads the GET as an array reports "no suggestions" for a node that has
   them.
2. **Accepting does NOT apply the value to the node.** After `ACCEPTED`, the
   property was still absent. `/suggestions/v1` is a staging area for proposals
   plus a record of the decision — applying it is still our job, through
   `updateNodeMetadata` with the usual read-back.

### Task 19: Design increment before the tools (NEW — the probe made it necessary)

The original plan reserved this phase without specifying tools, deliberately,
because the probe's outcome would decide their shape. It has, and the shape is
now: propose → show → decide → **apply**. That fourth step is not in the
suggestions API, so a tool that stops at `PATCH` would report a recorded opinion
as a changed record.

**Decided by the user, 2026-08-01:**

1. **Accepting applies the value in the same call.** So it is an ordinary
   two-step confirmed mutation: the preview shows the proposal AND the value it
   would write, one token, then `PATCH` + `updateNodeMetadata` + read-back.
   The report must separate the two outcomes — the `PATCH` can succeed while the
   write is discarded, and "accepted" would then read as "applied".
2. **Anyone with write rights may accept**, in practice whoever started the
   exchange. That is the boundary `requireWrite()` and the repository's own
   permissions already draw; no extra check is built.
3. **Only `type=AI`.** Everything that reaches this tool was proposed by a
   model, and labelling it `USER_PROPOSAL` would misstate the provenance the
   editorial team reads.

**On "human-checked becomes human" — settled by the API, not by preference.**
The live OpenAPI (staging, read 2026-08-01) shows:

```
POST  /suggestions/v1/{repo}/{node} → repository*, node*, type*, version*
PATCH /suggestions/v1/{repo}/{node} → repository*, node*, id, status
```

`PATCH` carries no `type`. The type is fixed at creation and cannot be changed
afterwards — only `status` can. So the two fields divide the labour exactly as
the user's rule wants:

- `type: AI` records **who wrote the proposal** — permanently the model.
- `status: ACCEPTED` records **that a human checked and approved it** — which is
  precisely what our two-step confirmation is.

The human approval is therefore already captured, in the field built for it.
Flipping the type would not add the approval; it would erase the fact that a
model authored the text, which is the provenance the editorial team relies on.

**One more ordering decision, made here rather than in code.** Accepting does
two things upstream: it marks the suggestion `ACCEPTED` and it writes the value.
Either can fail alone, so the order is a real choice:

- `PATCH` first → a failed write leaves a suggestion that *claims* to be applied.
  The next curator reads "angenommen" and believes the record carries the value.
- **Write first** → a failed `PATCH` leaves the value in the record and the
  suggestion on `PENDING`. The record is right; only the bookkeeping lags, and
  re-deciding is cheap.

The second failure is the harmless one, so: **apply and read back FIRST, mark
`ACCEPTED` only once the read-back confirms the value landed.** A dropped write
must never produce an `ACCEPTED` suggestion.

### Task 20: Extract the shared field surface — **DONE**
- Create: `src/tools/curation-fields.ts`
- Modify: `src/tools/curation-content.ts` (import instead of declare)

`CONTENT_FIELDS` (param → property) and `FIELD_SCHEMA` (the 13 zod parameters)
move out unchanged. The suggestion tools need the same surface, and a second
copy is how a field gets added to one tool and forgotten in the other.
Behaviour-preserving: no test changes, the existing suite is the regression
check.

### Task 21: Suggestions service — **DONE**
- Create: `src/services/write/suggestions.ts`
- Test: `tests/write-suggestions.test.ts`

```ts
createSuggestions(nodeId, drafts: SuggestionDraft[]): Promise<CreateOutcome>
listSuggestions(nodeId, status?): Promise<Suggestion[]>      // throws when unreadable
setSuggestionStatus(nodeId, id, status): Promise<string|null> // null = ok
```

- `POST …/suggestions/v1/-home-/{node}?type=AI&version=wlo-mcp`, body = **array**
  of `{propertyId, value, description, confidence?}`.
- `GET` is parsed through one helper that accepts all three measured shapes —
  bare array, `{suggestions: []}`, and `{suggestions: {propertyId: [...]}}`.
  This is the trap from §8 of the research doc; it bit the probe itself.
- `PATCH …?id={id}&status={status}`.
- `type` is `AI`, always, and is not a parameter — see Task 19.

Test asserts: the POST body is an array and the query carries `type=AI`; a GET
answering with the **map** shape yields the suggestions (an array-only reader
would return none); PATCH puts id and status on the query; an unreadable GET
throws rather than answering "keine Vorschläge".

### Task 22: The three suggestion tools — **DONE**

**Split during implementation.** The single file reached 333 lines, past the
threshold, and its two halves have different reasons to change: storing opinions
versus changing records. `curation-suggestions.ts` keeps propose + list;
`wlo_decide_suggestion` — the only one that touches a node — moved to
`curation-decide.ts`. `recordTitle` / `fieldLabel` / `plainText` went to
`curation-shared.ts`; the first had been duplicated from `curation-content.ts`.

- Create: `src/tools/curation-suggestions.ts`, `src/tools/curation-decide.ts`
- Modify: `src/server.ts` (register in the write-mode block)
- Test: `tests/tools-curation-suggestions.test.ts`

| Tool | What it does |
|---|---|
| `wlo_suggest_metadata` | Stores per-field proposals with a rationale. Two-step: it writes to the repository, so it follows the same rule as every other mutation. |
| `wlo_list_suggestions` | Shows the open proposals for a node with their ids. No token — it changes nothing. |
| `wlo_decide_suggestion` | Accept (apply + mark) or decline (mark only). Two-step. |

Accepting validates the proposed value through `validateField` **before** the
preview: a suggestion is model-written text and may name a property we must not
write. `ccm:oeh_lrt_aggregated` is refused by the allow-list, unchanged.

Test asserts: all three absent in anonymous mode; no upstream write without a
token; on accept the metadata write happens **before** the PATCH; a write that
read back as dropped produces **no** `ACCEPTED` PATCH and a report that says the
proposal is still open; declining writes no metadata; an invalid proposed value
is refused naming the value, with declining offered as the way out.

---

## Verification plan

Per task: its own test, red before green. Per phase: the full suite plus
`npx tsc -p tsconfig.typecheck.json --noEmit` and `npm run build`.

Acceptance criteria for the whole plan:
1. No write tool appears in an anonymous `tools/list`, and calling one anyway fails.
2. No mutation happens without a valid, matching, unexpired token — asserted on
   recorded upstream calls, not on reply text.
3. Every mutation reports per field whether the value actually landed; a silently
   dropped field is never reported as saved.
4. Deleting states that it may be irreversible and promises no restore.
5. An invalid licence key is rejected naming the value.
6. `ccm:oeh_lrt_aggregated` is never written by us.

Regression: the existing 626 tests must stay green — especially
`auth-public-surface`, `auth-sse-integration` and `tool-triggers` (new tool
descriptions can shift the trigger tests).
