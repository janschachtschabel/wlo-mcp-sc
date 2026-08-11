/**
 * shared-rule-discipline.test.ts – a rule extracted into a shared module must
 * actually be the only copy.
 *
 * Sibling of `env-parsing-discipline.test.ts`, and it exists for the same reason
 * that one does: every audit round of this project has turned up the same shape
 * — a rule identified, named, solved in one place, and then not carried to the
 * other places it applies to. A unit test of the shared helper proves the helper
 * is right; it says nothing about whether anyone uses it. These scan the SOURCE,
 * which is the only thing that can.
 *
 * Both rules below were found with 6 and 1 violations respectively, in modules
 * written after the shared helper already existed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (file: string) => file.slice(srcDir.length).split('\\').join('/');

/** Every line of `src/**\/*.ts` matching `pattern`, outside `owners`. */
function offenders(pattern: RegExp, owners: string[]): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    const name = rel(file);
    if (owners.includes(name)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (pattern.test(line)) out.push(`${name}:${i + 1}  ${line.trim()}`);
    });
  }
  return out;
}

/**
 * The truncation marker in its bracketed form. Prose uses the bare word
 * ("gekürzt auf X von Y Zeichen" in a tool's output, "gekürzten Auszug" in a
 * tool description), so matching the brackets separates the MARKER from talk
 * about truncation.
 */
const TRUNCATION_MARKER_LITERAL = /\[…?gekürzt\]/;

test('the truncation marker is written in exactly one module', () => {
  // `text-cap.ts` says in its own docstring that it was extracted "when a second
  // caller needed the identical rule — two copies of a truncation marker drift
  // silently". It was then used by 2 of 8 call sites. The other six each carried
  // `x.slice(0, CAP) + '\n[…gekürzt]'`, cutting mid-word where the shared rule
  // cuts at a word boundary, and `wlo-node-text.ts` had already drifted to
  // `'\n\n…[gekürzt]'` — the ellipsis on the other side of the bracket.
  assert.deepEqual(
    offenders(TRUNCATION_MARKER_LITERAL, ['text-cap.ts']),
    [],
    'use capText / TRUNCATION_MARKER from text-cap.ts — a second copy drifts, and the drift is ' +
      'only ever visible to whoever reads the output',
  );
});

/**
 * A hand-rolled "seen this URL already" filter. The rule which copy of a
 * repeated material survives lives in one module, because the two search paths
 * are independent (`search_wlo_content` calls enhancedSearch/ngsearch directly,
 * `searchAll` feeds `search_wlo_all`, `search` and REST) and a second copy would
 * only be noticed when the two disagreed about what a user sees.
 */
const INLINE_URL_DEDUPE = /\bseen\w*\.(has|add)\(\s*\w+\.url\b/;

test('collapsing repeated URLs happens only in result-dedupe.ts', () => {
  assert.deepEqual(
    offenders(INLINE_URL_DEDUPE, ['result-dedupe.ts']),
    [],
    'use dedupeByUrl from result-dedupe.ts — it also carries WHY the first hit wins rather than the newest',
  );
});

/**
 * `res.json()` outside the one module that guards it. `res.ok` says the server
 * answered, not that the body is JSON: a proxy maintenance page and a captive
 * portal both arrive as 200 with something `res.json()` throws on.
 */
const RAW_RESPONSE_JSON = /\bres(ponse)?\.json\(\)/;

test('an upstream response body is parsed only through readJson', () => {
  // `read-json.ts` documents itself as the place "every client goes through",
  // and `CLAUDE.md` repeats the claim. `auth/identity.ts` did not: it parsed the
  // identity probe directly, so a non-JSON body surfaced as "identity check
  // failed: Unexpected token <" instead of the named "upstream response was not
  // valid JSON" with the status beside it.
  assert.deepEqual(
    offenders(RAW_RESPONSE_JSON, ['read-json.ts']),
    [],
    'use readJson(res, context) — it decides what a non-JSON body means and logs which call it was',
  );
});

/**
 * A runtime write to disk. The server deliberately stores nothing, which is why
 * the container can run `read_only: true` with one writable volume for the
 * access registry alone.
 */
const WRITES_TO_DISK = /\b(writeFile|writeFileSync|appendFile|createWriteStream|mkdir|mkdirSync|rename|renameSync|unlink|rmdir)\s*\(/;

test('the access registry is the only module that writes to disk at runtime', () => {
  // The architecture's strongest property is that a breach finds nothing at
  // rest. `access-registry.ts` is the single, deliberate exception — it holds
  // access IDS, never a credential (pinned in access-registry.test.ts). A
  // second writer would quietly need a second writable mount, and the
  // `read_only` hardening would be relaxed to accommodate it rather than
  // questioned.
  assert.deepEqual(
    offenders(WRITES_TO_DISK, ['auth/access-registry.ts']),
    [],
    'the server stores nothing at rest — if a new module genuinely needs disk, change the design first',
  );
});

/** An import reaching up into the MCP tool layer from a module below it. */
const IMPORTS_TOOLS = /from '\.\.\/tools\//;

test('services and the REST layer do not import from the tool layer', () => {
  // Same shape as the two rules above, one level up: `mapPool` and
  // `buildFilterCriteria` sat in `tools/shared.ts` because the MCP tools were
  // the first callers, and four services plus the REST layer then imported them
  // from there. Neither has anything to do with MCP — one is a concurrency
  // primitive, the other vocabulary label→URI resolution — so both moved to leaf
  // modules (`concurrency.ts`, `filter-criteria.ts`) that any layer may use.
  //
  // The direction is the point: `tools/` composes what is below it, so a
  // service that depends on it makes the lower layer untestable without the
  // upper one and invites a genuine cycle. `server.ts` importing from `tools/`
  // is correct — it is the composition root, above them both.
  const offending = sourceFiles(srcDir)
    .filter(f => rel(f).startsWith('services/') || rel(f).startsWith('rest/'))
    .flatMap(file => readFileSync(file, 'utf8').split('\n')
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => IMPORTS_TOOLS.test(line))
      .map(({ line, i }) => `${rel(file)}:${i + 1}  ${line.trim()}`));
  assert.deepEqual(
    offending,
    [],
    'move the shared thing to a leaf module instead — a lower layer must not depend on tools/',
  );
});

/**
 * A call to the authority check. `checkIdentity()` is the rule the sentence
 * "a 200 is not proof of a login" hangs on: at this API an absent credential
 * still answers 200, with the guest authority in the body.
 */
const AUTHORITY_CHECK = /\bcheckIdentity\(/;

test('the authority check has one caller per purpose, not a copy per endpoint', () => {
  // Three endpoints now perform the identical step — `/auth/issue`,
  // `/oauth/authorize` and `/auth/revoke-all` all have to prove the login inside
  // an access block before they act on it. Each was written by MOVING the check
  // rather than copying it, ending in `auth/access-verify.ts`, because a copy is
  // exactly where the authority reading gets replaced by `res.ok`.
  //
  // What that costs differs per endpoint, and the revocation side is the worse
  // one: our public key is published so browsers can encrypt, so anyone can
  // build a block naming any user, and a removal that trusted the name in it
  // would end a stranger's accesses on a guessed username.
  //
  // `tools/auth.ts` is the other legitimate caller: it reports the current
  // identity to the user and gates nothing.
  assert.deepEqual(
    offenders(AUTHORITY_CHECK, ['auth/identity.ts', 'auth/access-verify.ts', 'tools/auth.ts']),
    [],
    'go through verifyBlockLogin in auth/access-verify.ts — it is where the authority rule lives',
  );
});

/**
 * The other half of the same rule, and the one a file listing cannot show: both
 * modules that act on a block must actually GO through the shared check. An
 * `access-revoke.ts` that decoded a block itself would pass the test above —
 * it calls no `checkIdentity` — while removing accesses for an unproven name.
 */
test('acting on an access block always goes through the shared verification', () => {
  const offending = ['auth/access-issue.ts', 'auth/access-revoke.ts'].filter(
    name => !/\bverifyBlockLogin\(/.test(readFileSync(join(srcDir, name), 'utf8')),
  );
  assert.deepEqual(offending, [],
    'call verifyBlockLogin — decoding a block without proving its login is the whole hazard');
});

/** A direct registration call — the thing a curation tool must NOT do. */
const DIRECT_REGISTRATION = /registerWloTool\s*\(/;

test('every curation tool is registered through the seam that gates it', () => {
  // `registerCurationTool` (tools/curation-shared.ts) does two things no
  // curation tool may be without: it stamps the `oauth2` declaration, and it
  // refuses the call when the caller may not write, answering with the OAuth
  // challenge that makes the host offer a login.
  //
  // Since 2026-08-05 these tools are listed for EVERY caller, so that gate is
  // the only thing standing between an anonymous request and the write
  // pipeline. A tool registered past it would be visible, callable, and
  // ungated — the one failure this whole arrangement must not have.
  const offending = sourceFiles(srcDir)
    .map(rel)
    .filter(name => /^tools\/curation-/.test(name) && name !== 'tools/curation-shared.ts')
    .filter(name => DIRECT_REGISTRATION.test(readFileSync(join(srcDir, name), 'utf8')));
  assert.deepEqual(offending, [],
    'use registerCurationTool from tools/curation-shared.ts — it is where the write gate lives');
});

/** Building the catalogue field by hand instead of through `toRegistrySummary`. */
const INLINE_REGISTRY_SUMMARY = /\.skillRegistry\s*=\s*\{/;

test('the catalogue a node carries is built in exactly one place', () => {
  // Four writers produce this field — `enrichSkillRegistry`, and in the cache
  // the live fallback, the background tick and the corpus seed. Three of them
  // carried their own copy of the same eight lines until 2026-08-11, which is
  // the shape this file exists for: the copies drift on the field that is set
  // least often. Here that is `truncated`, the disclosure that the catalogue is
  // SHORTER than the registry declares — and a missing disclosure is the one
  // kind of defect a reader cannot notice.
  assert.deepEqual(
    offenders(INLINE_REGISTRY_SUMMARY, []),
    [],
    'use toRegistrySummary from services/skill-registry.ts — its return type is FormattedNode\'s own '
      + 'field, so the shape is checked rather than re-declared',
  );
});

test('the skill-registry cache is started only by the transports', () => {
  // A background timer that fires on module load would hit the network in every
  // test — `tests/netguard.mjs` would (rightly) fail the run — and would start
  // fetching in any process that merely imports a service. The two entry points
  // are the only place a long-lived process is actually being set up.
  const found = offenders(/startSkillRegistryCache\s*\(/, ['services/skill-registry-cache.ts']);
  const files = [...new Set(found.map(f => f.split(':')[0]))].sort();
  assert.deepEqual(files, ['http.ts', 'stdio.ts'],
    `only the transports may start the cache — got ${JSON.stringify(files)}`);
});

test('a page variant is projected onto its fields in exactly one place', () => {
  // `variantName` is set nowhere but the projection and declared nowhere but the
  // type, and both live in the owner — so any other occurrence is a second copy.
  //
  // Two independent routes reach a variant (a collection's page_config_ref down
  // to the folder's children, and the page_variant index walked back up), and
  // each carried its own copy of the same seven property reads. They drifted on
  // the one field of the seven that needs a RULE rather than a read:
  // `variantTitle` ran through `displayTitleOrEmpty` on one route and raw on the
  // other, so the index route returned the technical `PAGE_VARIANT_<uuid>`
  // string that the field is documented to keep off a screen. It stayed
  // invisible because `pickThemePageTitle` checks again downstream — the
  // promise was broken one consumer short of a visible bug.
  //
  // What must NOT move into the projection: `topicPageUrl`, `collectionId`,
  // `collectionName`, `isDefault`. Those are facts about the page, and the two
  // routes genuinely learn them from different places.
  assert.deepEqual(
    offenders(/variantName:/, ['topic-page-variant.ts']),
    [],
    'use variantFields from topic-page-variant.ts — a variant must not describe itself '
      + 'differently depending on which search mode found it',
  );
});

test('every path that renders collections attaches what the cache knows', () => {
  // The catalogue is free once the cache is warm, so there is no cost to weigh
  // and no reason for a path to opt out. What there IS reason to fear is drift:
  // a new collection-rendering tool that silently carries no catalogue, which
  // reads to a model as "this collection has no approved skills". The expected
  // files are named so that adding one has to be a deliberate edit here.
  //
  // `tools/browse.ts` is deliberately NOT on this list. It renders its own
  // line-oriented formats — a compact two-level outline, and a portal list with
  // its own field set — neither of which carries a registry line. Attaching
  // there would put the field into `structuredContent` while the text dropped
  // it, which is the "an envelope field is not a disclosure if the renderer
  // discards it" failure this project has already paid for twice. Rendering it
  // would mean a second copy of `registryLines`. Out until browse needs it.
  const found = offenders(/ensureRegistries\s*\(/, ['services/skill-registry-cache.ts']);
  const files = [...new Set(found.map(f => f.split(':')[0]))].sort();
  assert.deepEqual(files, ['services/search.ts', 'tools/collections.ts', 'tools/node-relations.ts'],
    `collection-rendering paths must attach the cache — got ${JSON.stringify(files)}`);
});
