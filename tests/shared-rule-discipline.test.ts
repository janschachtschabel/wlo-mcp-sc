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
import ts from 'typescript';

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
// ANY receiver (audit 2026-11-14, T4): the first version named `res` and
// `response` and so passed `r.json()`, `upstream.json()` and
// `(await wloFetch(u)).json()`. No module here has a `.json()` of its own that
// is not a Response's, so the call itself is the thing to match.
const RAW_RESPONSE_JSON = /\.\s*json\s*\(\s*\)/;

test('an upstream response body is parsed only through readJson', () => {
  for (const slipped of ['const b = await r.json();', 'return (await wloFetch(u)).json()', 'await upstream . json( )', 'res.json()']) {
    assert.ok(RAW_RESPONSE_JSON.test(slipped), `the guard sees: ${slipped}`);
  }
  assert.ok(!RAW_RESPONSE_JSON.test('const b = await readJson(res, "x"); JSON.stringify(json)'));
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
// Widened 2026-11-14 (T4): `copyFile`, `rm`, `appendFileSync`, `cp`, `truncateSync`,
// links and temp directories were missing (the bare words `truncate` and `link`
// are left out: a widget shortens text with one, prose says the other) — and `open(path, 'w')`, which is
// matched by its FLAG, because `open(` alone is also how a block is opened.
const WRITES_TO_DISK = new RegExp(
  '\\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|mkdtemp|mkdtempSync'
  + '|rename|renameSync|unlink|unlinkSync|rmdir|rmdirSync|rm|rmSync|copyFile|copyFileSync|cp|cpSync'
  + '|truncateSync|symlink|symlinkSync|linkSync|writeSync|writevSync)\\s*\\('
  + '|\\bopen(Sync)?\\s*\\([^)]*,\\s*[\'"`][wa]',
);

test('the access registry is the only module that writes to disk at runtime', () => {
  for (const slipped of ["const fh = await open(path, 'w');", "openSync(p, 'a+')", 'await copyFile(a, b);', 'await rm(dir, { recursive: true });',
    "appendFileSync(p, 'x')", 'await cp(a, b)', 'rmSync(p)', 'await writeFile(p, s)', 'truncateSync(p)']) {
    assert.ok(WRITES_TO_DISK.test(slipped), `the guard sees: ${slipped}`);
  }
  for (const harmless of ["await open(path, 'r')", 'open(privateKey, wrapped, iv, body)', 'confirm(token)', 'readFileSync(p)']) {
    assert.equal(WRITES_TO_DISK.test(harmless), false, `not a write: ${harmless}`);
  }
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
// Any depth, either quote, and the dynamic form (audit 2026-11-14, T4):
// `'../tools/'` alone passed `'../../tools/…'` from `services/write/` — the
// directory with the most files — and an `await import(…)`.
const IMPORTS_TOOLS = /(?:\bfrom|\bimport\s*\()\s*['"`](?:\.\.\/)+tools\//;

test('services and the REST layer do not import from the tool layer', () => {
  for (const slipped of ["import { x } from '../../tools/shared.js';", 'import { x } from "../tools/shared.js";',
    "const m = await import('../tools/shared.js');", "} from '../tools/collections.js';"]) {
    assert.ok(IMPORTS_TOOLS.test(slipped), `the guard sees: ${slipped}`);
  }
  assert.ok(!IMPORTS_TOOLS.test("import { x } from '../unsafe-tools.js'; // see ../tools/ for the callers"));
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
  // `auth/auth-status.ts` is the other legitimate caller: it REPORTS the
  // current identity and gates nothing. Both `wlo_auth_status` and
  // `GET /auth/status` go through it (plan 2026-11-07, S4) — it was
  // `tools/auth.ts` until the status got a second surface.
  assert.deepEqual(
    offenders(AUTHORITY_CHECK, ['auth/identity.ts', 'auth/access-verify.ts', 'auth/auth-status.ts']),
    [],
    'go through verifyBlockLogin in auth/access-verify.ts — it is where the authority rule lives',
  );
});

test('the repository\'s b-api proxy is called in ONE module, behind its path list and the personal-login check', () => {
  // `{repository}/rest/bapi/**` acts with the person's own repository login on
  // the b-api: a second caller would bypass `isJobPath` (four paths of the job
  // surface) and the rule "never the shared account, never nobody"
  // (`services/bapi/jobs.ts`, plan 2026-11-17).
  // Any spelling of the path segment `/bapi` — `/rest/bapi`, `${BASE_URL}/bapi${p}`, `BASE_URL + '/bapi'` —
  // but not the module folder (`services/bapi/`, `./bapi/`, `../bapi/`) nor a name like `bapi-flows`.
  assert.deepEqual(offenders(/(?<!services|\.)\/bapi(?![-\w])/, ['services/bapi/jobs.ts']), [],
    'call the repository\'s b-api proxy through services/bapi/jobs.ts only');
});

test('an address a CLIENT names is read only where its key was checked', () => {
  // `forwardedClientKey` reads X-Forwarded-For past the hop our own proxy wrote —
  // text anyone can send. It is safe only for a caller that proved, by its key,
  // that it is the forwarder; `http-app.ts` hands its answer to `forwarderBudget`,
  // which yields nothing without a known key. A second caller that used it as the
  // client's address would let anyone choose their own limiter bucket.
  assert.deepEqual(offenders(/\bforwardedClientKey\(/, ['rate-limit.ts', 'http-app.ts']), [],
    'only http-app.ts, beside forwarderBudget, may read a forwarded address');
  // Inside the two owners as well: ONE call in http-app.ts, and it is the
  // address argument of forwarderBudget; in rate-limit.ts only the definition.
  const app = readFileSync(join(srcDir, 'http-app.ts'), 'utf8').replace(/\s+/g, ' ');
  assert.equal(app.match(/\bforwardedClientKey\(/g)?.length, 1, 'one call in http-app.ts');
  assert.match(app, /forwarderBudget\([^;()]*(?:\([^;()]*\)[^;()]*)*?forwardedClientKey\(/,
    'and there only as the address forwarderBudget weighs against the key');
  const lib = readFileSync(join(srcDir, 'rate-limit.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.deepEqual(lib.match(/[^\n]*\bforwardedClientKey\(/g)?.map(l => l.trim()),
    ['export function forwardedClientKey('], 'rate-limit.ts only defines it');
  // The header of our own (`X-WLO-Client-Address`) the same way: its constant is
  // defined in client-budget.ts and used once, as forwardedClientKey's first
  // argument; its literal nowhere else.
  assert.deepEqual(offenders(/\bCLIENT_ADDRESS_HEADER\b|['"]x-wlo-client-address['"]/i, ['client-budget.ts', 'http-app.ts']), [],
    'the client-named address header is read only in http-app.ts');
  assert.equal(app.match(/\bCLIENT_ADDRESS_HEADER\b/g)?.length, 2, 'imported once, read once');
  assert.match(app, /forwardedClientKey\(req\.headers\[CLIENT_ADDRESS_HEADER\]/, 'and read only as forwardedClientKey\'s first argument');
  // …and lazily: forwarderBudget calls it only behind a known key, so for anyone
  // else the header is not even parsed (review 2026-11-15).
  assert.match(app, /\(\) => forwardedClientKey\(/, 'passed as a thunk, read only behind a key');
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

test('a title is chosen in ONE place — no module writes the fallback chain out itself', () => {
  // `node-match.ts` holds the two chains (record: cclom:title first; collection:
  // cm:title first) and the reason for each. Five hand-written ones in the write
  // path differed, and two skipped `cm:title` — the carrier this repository
  // fills on collections — so a preview named a collection by its technical
  // `cm:name` (audit 2026-11-12, A-7).
  // A CHAIN: one title field, the operator, and the next title field with no comma or
  // semicolon between — over a line break too. A list of fields to search in is not one.
  const chain = /(cclom:title|cm:title|cm:name)'\]\?\.\[0\]\s*(\?\?|\|\|)\s*[^,;]{0,60}?(cclom:title|cm:title|cm:name)'\]\?\.\[0\]/;
  const offending = sourceFiles(srcDir)
    .map(rel)
    .filter(name => name !== 'node-match.ts')
    .filter(name => chain.test(readFileSync(join(srcDir, name), 'utf8')));
  assert.deepEqual(offending, [], 'use nodeTitle / titleFromProperties / collectionTitleFromProperties (node-match.ts)');
});

test('every tool is registered through the one seam — no tool module calls the SDK itself', () => {
  // `registerWloTool` (apps/register.ts) is where the operator's switch for
  // unsafe tools hangs, and where anything added for ALL tools has to go. Twelve
  // read tools called `server.tool(` directly and went past it (audit
  // 2026-11-12, A-2); `registerReadTool` is the same short form through the seam.
  //
  // ANY receiver and any spelling: `server.tool(` alone let `s.tool(`,
  // `server['registerTool'](`, a destructured method or a call split over two
  // lines through. Comments are removed first, so prose may name the calls.
  const direct = /\.\s*(tool|registerTool)\s*\(|\[\s*['"`](tool|registerTool)['"`]\s*\]|\{[^}]*\b(tool|registerTool)\b[^}]*\}\s*=/;
  const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const offending = sourceFiles(srcDir)
    .map(rel)
    .filter(name => name.startsWith('tools/'))
    .filter(name => direct.test(withoutComments(readFileSync(join(srcDir, name), 'utf8'))));
  assert.deepEqual(offending, [], 'use registerWloTool / registerReadTool / registerCurationTool');
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

test('what a collection IS is decided in one place, never by the node type alone', () => {
  // `ccm:map` is the repository's general container — a workspace folder, a
  // page-config folder and the personal area report it too (measured
  // 2026-11-12). A curation tool that reads the type as "is a collection" sends
  // a folder to the collection endpoint under a preview promising its contents
  // survive. `isCollectionNode` (node-kind.ts) asks the aspect; the tools go
  // through `wrongKind` (tools/curation-shared.ts).
  //
  // The literal OR the constant that holds it (audit 2026-11-14, T4):
  // `node.type === CONTAINER_TYPE` is the same comparison and passed.
  const literal = /['"`]ccm:(map|io)['"`]|(?:[=!]==?\s*(?:CONTAINER_TYPE|CONTENT_TYPE)\b)|(?:\b(?:CONTAINER_TYPE|CONTENT_TYPE)\s*[=!]==?)/;
  for (const slipped of ["if (node.type === 'ccm:map') {", 'if (node.type === CONTAINER_TYPE) {', 'return CONTENT_TYPE !== node.type;', 'x.type == `ccm:io`']) {
    assert.ok(literal.test(slipped), `the guard sees: ${slipped}`);
  }
  assert.ok(!literal.test("import { CONTAINER_TYPE, CONTENT_TYPE } from '../node-kind.js';"), 'an import compares nothing');
  // Lines that may name the type, each with its reason. Matched by their text,
  // so a line that is edited has to be looked at again.
  const allowed: Record<string, string[]> = {
    // After `wrongKind` has DECIDED: these two only pick the sentence that says
    // which tool fits instead, from the code it returned and the type it saw.
    'tools/curation-delete.ts': [
      "if (code === 'is_a_folder' || (code === 'not_a_collection' && type === CONTAINER_TYPE)) {",
      "return code === 'not_a_collection' && type === CONTENT_TYPE ? ' Zum Löschen eines Datensatzes: wlo_delete_content.' : '';",
    ],
  };
  const offending = sourceFiles(srcDir)
    .map(rel)
    .filter(name => /^tools\/curation-/.test(name) || /^services\/write\//.test(name) || name === 'services/collection-overview.ts')
    // The one place that CREATES a record names its type; it compares nothing.
    .filter(name => name !== 'services/write/nodes-lifecycle.ts')
    .flatMap(name => readFileSync(join(srcDir, name), 'utf8').split('\n')
      .filter(line => literal.test(line) && !/^\s*(\/\/|\*)/.test(line))
      .filter(line => !(allowed[name] ?? []).includes(line.trim()))
      .map(line => `${name}: ${line.trim()}`));
  assert.deepEqual(offending, [], 'use isCollectionNode / isContentNode / wrongKind instead of comparing the node type');
});

/** Building the catalogue field by hand instead of through `toRegistrySummary`. */
// The assignment AND the literal form (audit 2026-11-14, T4): `{ ...node,
// skillRegistry: { nodeId, … } }` builds the same field and passed.
const INLINE_REGISTRY_SUMMARY = /\bskillRegistry\s*[:=]\s*\{/;

test('the catalogue a node carries is built in exactly one place', () => {
  for (const slipped of ['node.skillRegistry = { nodeId, title };', 'return { ...node, skillRegistry: { nodeId, title } };']) {
    assert.ok(INLINE_REGISTRY_SUMMARY.test(slipped), `the guard sees: ${slipped}`);
  }
  assert.ok(!INLINE_REGISTRY_SUMMARY.test('node.skillRegistry = toRegistrySummary(registry); skillRegistry: z.object({})'));
  // Four writers produce this field — `refreshRegistries`, and in the cache
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

/**
 * A hand-written "these are only descriptions" sentence. Matches the distinctive
 * clause rather than the whole note, so a copy that shortened or re-punctuated it
 * is still caught.
 */
const INLINE_DESCRIPTIONS_ONLY = /die Anleitungen selbst stehen nicht darin/;

test('the "catalogue is not the instruction" note is written in exactly one module', () => {
  // Three surfaces hand out a skill catalogue — a collection's registry lines in
  // a search result, `get_skill_registry`, `search_skill` — and two of them
  // already carried their own closing pointer ("Lade die passende Anleitung mit
  // get_skill und der nodeId"), written twice and identical by luck rather than
  // by construction, while the third had none at all. That is the drift shape:
  // the copies agree until one is improved.
  assert.deepEqual(
    offenders(INLINE_DESCRIPTIONS_ONLY, ['registry-render.ts']),
    [],
    'use DESCRIPTIONS_ONLY_NOTE from registry-render.ts — it sits beside registrySummaryLines, which decides '
      + 'the tier the note is true for (a head line shows no skill nodeId, so it promises no load)',
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

/**
 * Every call or `new` that runs when `file` is imported: anything in a
 * top-level statement that is not inside a function. Function, import, type
 * and interface declarations hold nothing that runs.
 */
function callsOnImport(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      found.push(node.getText(sf).split('\n')[0]!.slice(0, 80));
    }
    ts.forEachChild(node, visit);
  };
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isImportDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
      || ts.isInterfaceDeclaration(stmt)) continue;
    visit(stmt);
  }
  return found;
}

test('the on and off spellings of a switch are read in env-flags.ts only', () => {
  // A regex of its own drifted: three switches took `1|true|yes` and not `on`,
  // which every other switch takes (review 2026-11-19).
  // Any order, a capturing or a non-capturing group, a regex or a list of spellings.
  const word = '(?:1|0|true|false|yes|no|on|off)';
  const inRegex = new RegExp(`\\^\\((?:\\?:)?\\s*${word}\\s*\\|\\s*${word}\\b`);
  const inList = new RegExp(`\\[\\s*'${word}'\\s*,\\s*'${word}'[^\\]]*\\]\\.includes\\(`);
  assert.deepEqual([...offenders(inRegex, ['env-flags.ts']), ...offenders(inList, ['env-flags.ts'])], [],
    'read a switch with isEnabledFlag / isDisabledFlag / isStrictYes (src/env-flags.ts)');
});

test('every planned tool lets its key CONTINUE the stored plan (replay: false)', () => {
  // With replay on, presenting the confirmation key again returns the first answer marked `replayed` — the
  // stored plan is never continued, and an item left `pending` after a 5xx is never looked at again on that
  // path (review 2026-11-20: wlo_delete_own_content had forgotten it).
  const tools = join(srcDir, 'tools');
  // `curation-plan.ts` DEFINES runPlannedCall; every other file that calls it is a planned tool.
  const missing = readdirSync(tools).filter(f => f.endsWith('.ts') && f !== 'curation-plan.ts').filter(f => {
    // Comments stripped: a `replay: false` in a comment sets nothing.
    const text = readFileSync(join(tools, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return /\brunPlannedCall\s*</.test(text) && !/\breplay:\s*false\b/.test(text);
  });
  assert.deepEqual(missing, [], 'a tool that runs a plan sets replay: false in registerCurationTool');
});

test('env-flags.ts imports nothing, and the pure modules that use it import nothing else', () => {
  // The flag spellings once pulled the whole configuration (env reads, log lines at load) into the pure
  // `rest/validate.ts` (review 2026-11-18). They live in an import-free leaf so that cannot happen again.
  const importsOf = (file: string): string[] =>
    [...readFileSync(join(srcDir, file), 'utf8').matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)]
      .map(m => m[1] ?? m[2] ?? m[3] ?? '');
  assert.deepEqual(importsOf('env-flags.ts'), [], 'env-flags.ts must import nothing');
  assert.deepEqual(importsOf('unsafe-tools.ts'), ['./env-flags.js'], 'unsafe-tools.ts is a leaf: env-flags only');
  assert.deepEqual(importsOf('rest/validate.ts'), ['../env-flags.js'], 'rest/validate.ts is pure: env-flags only');
});

test('the b-api proxy detection is started only by the HTTP entry point, and probes only through it', () => {
  // Same reason as the skill cache: a probe on import would hit the network in
  // every test and in any process that merely imports a service. stdio has no
  // personal login, so it never asks (the tools would refuse every call there).
  const found = offenders(/startBapiProxyDetection\s*\(/, ['services/bapi/proxy-switch.ts']);
  const files = [...new Set(found.map(f => f.split(':')[0]))].sort();
  assert.deepEqual(files, ['http.ts'], `only http.ts may start the detection — got ${JSON.stringify(files)}`);
  // The anonymous probe is asked by the detection alone — never per request, never at import.
  const probes = offenders(/\bprobeBapiProxy\s*\(/, ['services/bapi/jobs.ts']);
  const probeFiles = [...new Set(probes.map(f => f.split(':')[0]))].sort();
  assert.deepEqual(probeFiles, ['services/bapi/proxy-switch.ts'],
    `only proxy-switch.ts may call probeBapiProxy — got ${JSON.stringify(probeFiles)}`);
  // Nor does the module start itself: nothing in it may RUN on import. Read from the syntax tree, not by
  // lines — a call inside a top-level `if {}` block, an IIFE or through an alias runs on import just the same.
  assert.deepEqual(callsOnImport(join(srcDir, 'services/bapi/proxy-switch.ts')), [],
    'proxy-switch.ts must not start the detection at import');
  // stdio never asks, but still says a wrong setting.
  assert.match(readFileSync(join(srcDir, 'stdio.ts'), 'utf8'), /^warnOnBapiSettings\(\);/m,
    'stdio.ts must say a wrong b-api setting at start');
});

test('the HTTP entry point wires the ticket limiter, not just the password one', () => {
  // `ticketAbuseLimiter` is OPTIONAL on `HttpAppOptions`, and absence falls back
  // to `authAbuseLimiter` — deliberately the tighter budget, so forgetting it
  // over-refuses instead of running unbounded. That makes forgetting it SILENT:
  // `/auth/ticket` quietly drops from 200 distinct tickets per address to 10,
  // and the eleventh signed-in person behind a school's NAT is refused. Nothing
  // else notices, because `http.ts` starts listening on import and no test can
  // import it — the same structural blind spot that let raw `parseInt` survive
  // the addition of `resolvePositiveInt` (see env-parsing-discipline.test.ts).
  //
  // So the wiring is checked in the SOURCE, the only place it is visible.
  // Audited 2026-08-13: deleting the line left all 1853 tests green.
  //
  // Since 2026-11-14 the options are built in `http-options.ts`, which a test
  // CAN import (`tests/http-options.test.ts` checks the limiter's behaviour and
  // that `http.ts` passes the built options on whole). This scan stays as the
  // statement of where the wiring lives.
  const found = offenders(/ticketAbuseLimiter/, ['http-app.ts', 'rest/auth-pages.ts']);
  const files = [...new Set(found.map(f => f.split(':')[0]))].sort();
  assert.deepEqual(files, ['http-options.ts'],
    `http-options.ts must hand the ticket limiter to the handler — got ${JSON.stringify(files)}`);
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
  // `tools/browse.ts` is still NOT on this list, and the reason has changed.
  // It used to be "browse renders no registry line at all"; since 2026-08-15 it
  // renders the head line, but through `cachedRegistriesFor` — cache only, no
  // live fallback — because a portal list covers thirty collections and a tree
  // fifty, and first contact would charge a children listing for each. That is
  // the crawl the cache exists to prevent. `ensureRegistries` is the right call
  // where the set is bounded by what a caller asked to see.
  const found = offenders(/ensureRegistries\s*\(/, ['services/skill-registry-cache.ts']);
  const files = [...new Set(found.map(f => f.split(':')[0]))].sort();
  assert.deepEqual(files,
    // `services/node-details.ts` since 2026-11-13: the single-record read moved out of the
    // tool's handler into the service (audit A-1/A-5); the tool keeps the call for `nodeIds`.
    ['services/node-details.ts', 'services/search.ts', 'tools/collections.ts', 'tools/node-details.ts', 'tools/node-relations.ts'],
    `collection-rendering paths must attach the cache — got ${JSON.stringify(files)}`);
});

test('the collection a tool was CALLED ON is answered from one place', () => {
  // Four tools are about a collection that never appears in their own results,
  // and each renders its answer differently — a content block here, a record
  // line there. What must not differ is the rule: which id is asked
  // (`get_topic_page_content` must use the COLLECTION, not the variant), and
  // that every negative — no registry, unreadable, unknown id, cache off —
  // renders nothing rather than a claim. `subjectRegistryText` in
  // `tools/shared.ts` holds both; a second copy would state one of them wrong.
  const found = offenders(/ensureRegistryFor\s*\(/, ['services/skill-registry-cache.ts']);
  const files = [...new Set(found.map(f => f.split(':')[0]))].sort();
  // `services/collection-overview.ts` (2026-11-06, BOERDi item 1) is the one
  // deliberate second caller: it answers in STRUCTURED data, which the text
  // helper cannot give, and holds both rules — it asks the collection id after
  // resolving a reference, and an unanswered lookup becomes `not_checked`,
  // never "no skills" (tests/tools-collection-overview.test.ts pins that).
  assert.deepEqual(files, ['services/collection-overview.ts', 'tools/shared.ts'],
    `only these may ask for a single collection's registry — got ${JSON.stringify(files)}`);
});

test('a collection search asks BOTH backends, and only one module knows that', () => {
  // Measured 2026-08-11: the mds query cannot return the collection `9e7ae956`
  // ("Optik") for any search word, while the REST collection search returns it
  // every time — and the REST endpoint in turn reads no compendium text. So
  // "search collections" means asking two backends, and a call site that reaches
  // for one leg directly answers a narrower question than it looks like it does.
  //
  // Named files rather than a bare emptiness check, so that adding a fourth
  // caller has to be a deliberate edit here — the same reason the registry guard
  // above names its three.
  // `(Result)?`: the legs exist only in their `…Result` form since 2026-11-13,
  // and the pattern without it matched no call at all any more.
  const raw = /searchCollectionsBy(Keyword|Name)(Result)?\s*\(/;
  const found = offenders(raw, ['wlo-search.ts', 'services/collection-search.ts']);
  assert.deepEqual(
    found, [],
    'use searchCollectionsResult from services/collection-search.ts — one leg alone is a '
      + `different question: ${JSON.stringify(found)}`,
  );
});

/**
 * The modules that may write. `originalId` is read all over the READ paths for
 * perfectly good reasons (usage lookups, skill identity), so a repo-wide ban
 * would be wrong; the rule is about who decides where a write GOES.
 */
const writePathFile = (name: string): boolean =>
  name.startsWith('services/write/') || /^tools\/curation-[a-z-]+\.ts$/.test(name);

function writePathOffenders(pattern: RegExp, owners: string[]): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    const name = rel(file);
    if (!writePathFile(name) || owners.includes(name)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (pattern.test(line)) out.push(`${name}:${i + 1}  ${line.trim()}`);
    });
  }
  return out;
}

test('the write path works out its target in one place', () => {
  // Measured 2026-08-16 (F1/F2): a metadata write aimed at a collection
  // reference is STORED on the reference, never reaches the original, and the
  // reference stops inheriting from then on. `verifyWrite` cannot catch it — it
  // re-reads the same node and finds what it just wrote.
  //
  // Which field answers "is this a reference" is the part that must not be
  // re-derived per caller: the DTO's `originalId` is absent on an original,
  // while the `ccm:original` PROPERTY points at the record itself (F6), so a
  // second implementation reaching for the property without a self-comparison
  // reports every record as a reference to itself.
  //
  // `collections.ts` is the other owner and resolves the OPPOSITE direction —
  // material id → the reference filed in a given collection — which is what
  // removing something from a collection needs.
  assert.deepEqual(
    writePathOffenders(/originalId|ccm:original/, [
      'services/write/nodes.ts',
      'services/write/collections.ts',
    ]),
    [],
    'use resolveWriteTarget from services/write/nodes.ts',
  );
});

test('a curation tool writes where the confirmed change set says', () => {
  // The token binds to the ChangeSet, so `cs.nodeId` IS the node the user
  // approved. Passing anything else — the raw parameter above all — writes to a
  // node that was never previewed, which is the redirection hole in reverse:
  // the preview says "the original will change" and the write goes to the
  // reference anyway.
  //
  // `services/write/` is deliberately out of scope: `nodes-lifecycle.ts` and
  // `collections.ts` write fields onto a record they have just CREATED, where
  // there is no change set and the id cannot be a reference.
  const calls = writePathOffenders(/\bupdateNodeMetadata\s*\(/, [
    'services/write/nodes.ts',
    'services/write/nodes-lifecycle.ts',
    'services/write/collections.ts',
  ]);
  const wrong = calls.filter(line => !/updateNodeMetadata\(\s*cs\.nodeId\b/.test(line));
  assert.deepEqual(wrong, [], 'pass cs.nodeId — the change set names the approved target');
  assert.ok(calls.length >= 3, `expected the curation write sites to be found, got ${calls.length}`);
});

test('a rendered nodeId line goes through nodeIdLine, never built by hand', () => {
  // `nodeIdLine` says "nodeId: X (Verknüpfung; Original: Y)" when the record is a
  // collection reference. A tool that renders line-oriented text by hand does not
  // get that for free, and two of them did not have it: `get_node_details` — the
  // tool a reference id from a collection listing is most likely handed to — and
  // the Fachportal listing. Both carried `originalId` in `structuredContent`
  // while the text they rendered said nothing, which is the split the field was
  // introduced to close.
  //
  // `skill-registry.ts` is the one legitimate hand-built line: a RegistryEntry
  // comes from a `:::` block in a document, not from a node read, so there is no
  // `originalId` to state and claiming one would need a fetch per entry.
  //
  // Scope, stated so nobody reads more into a green run: this matches the
  // template-literal form of the STANDALONE line, which is the form every such
  // line in this codebase uses. Built by concatenation it would slip through, and
  // the inline `(nodeId: X)` inside a list item is deliberately not matched —
  // those render entries that carry no `originalId` (parent collections, registry
  // entries, companion files).
  const found = offenders(/`nodeId: \$\{/, [
    'text-line.ts',
    'tools/skill-registry.ts',
  ]);
  assert.deepEqual(found, [], `nodeId-Zeile von Hand gebaut statt über nodeIdLine:\n${found.join('\n')}`);
});

test('a redirected change set is diffed against the node it will WRITE', () => {
  // Resolving the target is only half the rule. The change set also carries a
  // BASELINE, and it has to come from the same node: while a reference still
  // inherits, its properties equal the original's and nothing looks wrong — they
  // diverge exactly once the reference has been written to directly (F2), which
  // is the state older versions of these tools produced.
  //
  // Diffing against the reference while writing to the original then costs three
  // ways at once: a field counts as unchanged because the REFERENCE already
  // shows the wanted value (the original never gets it, and the tool reports
  // success), the preview shows the reference's value as "before", and a merged
  // field — keywords — merges into the reference's list and writes that OVER the
  // original's, dropping whatever only the original had.
  //
  // `readWriteBaseline` returns the target and the baseline together, which is
  // why the guard is "used it" rather than "did the right thing with it":
  // `resolveWriteTarget` hands back a target with no baseline, and the only one
  // in reach at that point is the requested node's.
  //
  // Reach, so a green run is not read as more than it is: the second check
  // scans for `node.properties` up to the first `)`, which is the shape the
  // defect had. Wrapped in parentheses it would slip through, and nothing here
  // notices a baseline that is right while a SENTENCE beside it still names the
  // requested node — that one is covered per tool
  // (`tools-curation-suggestions.test.ts` pins the title/id pair).
  //
  // Since 2026-11-14 (T4) the guard looks at EVERY curation tool that writes
  // metadata (`updateNodeMetadata(`), not only at files that already contain
  // `buildChangeSet(target.targetId` — a new tool written
  // `buildChangeSet(nodeId, …, node.properties, desired)` contained no such
  // text and was never inspected. It reads the ARGUMENTS of each call.

  /** The top-level arguments of every `fn(…)` call in `text`. */
  const callArguments = (text: string, fn: string): string[][] => {
    const out: string[][] = [];
    for (const m of text.matchAll(new RegExp(`\\b${fn}\\(`, 'g'))) {
      const args: string[] = [];
      let depth = 1;
      let quote = '';
      let start = m.index + m[0].length;
      let i = start;
      for (; i < text.length && depth > 0; i++) {
        const ch = text[i]!;
        if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
        if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === ',' && depth === 1) { args.push(text.slice(start, i).trim()); start = i + 1; }
      }
      args.push(text.slice(start, i - 1).trim());
      out.push(args);
    }
    return out;
  };
  const isEmptyObject = (arg: string | undefined) => arg === undefined || /^\{\s*\}$/.test(arg);
  const check = (name: string, text: string): string[] => {
    if (!/\bupdateNodeMetadata\(/.test(text)) return [];
    const found: string[] = [];
    if (!text.includes('readWriteBaseline(')) {
      found.push(`${name}: schreibt Metadaten, holt die Baseline aber nicht über readWriteBaseline`);
    }
    for (const [target, , baseline, desired] of callArguments(text, 'buildChangeSet')) {
      // A change set with no fields (a deletion, a submission, a declined
      // proposal) or with no baseline (a record about to be created) diffs nothing.
      if (isEmptyObject(desired) || isEmptyObject(baseline)) continue;
      if (target !== 'target.targetId') {
        found.push(`${name}: buildChangeSet(${target}, …) schreibt Felder, aber nicht auf target.targetId`);
      }
      if (/\bnode\.properties\b/.test(baseline ?? '')) {
        found.push(`${name}: Baseline kommt vom ANGEFRAGTEN Knoten statt vom Ziel`);
      }
    }
    return found;
  };
  // The scanner itself, fed the shapes it must catch and the ones it must leave.
  const WRITE = 'await updateNodeMetadata(cs.nodeId, desiredFromChangeSet(cs), { commit: false });';
  assert.equal(check('x', `const cs = buildChangeSet(nodeId, 'content', node.properties ?? {}, desired, { added });\n${WRITE}`).length, 3,
    'no baseline read, the requested id as target, the requested node as baseline');
  assert.equal(check('x', `await readWriteBaseline(node, nodeId);\nbuildChangeSet(target.targetId, 'content', node.properties, desired);\n${WRITE}`).length, 1);
  assert.equal(check('x', `await readWriteBaseline(node, nodeId);\nbuildChangeSet(nodeId, 'content', before, { [p]: (a, b) });\n${WRITE}`).length, 1);
  assert.deepEqual(check('x', `await readWriteBaseline(node, nodeId);\nbuildChangeSet(target.targetId, 'content', before, desired, { a: 1 });\n`
    + `buildChangeSet(nodeId, 'content', node.properties ?? {}, {}, { destructive: true });\n`
    + `buildChangeSet(title, 'content', {}, collected.desired);\n${WRITE}`), [], 'a fieldless change set and a new record are not diffs');
  assert.deepEqual(check('x', "buildChangeSet(nodeId, 'collection', node.properties ?? {}, desired);"), [], 'not a metadata writer');

  const wrong: string[] = [];
  let inspected = 0;
  for (const file of sourceFiles(srcDir)) {
    const name = rel(file);
    if (!/^tools\/curation-[a-z-]+\.ts$/.test(name)) continue;
    const text = readFileSync(file, 'utf8');
    if (/\bupdateNodeMetadata\(/.test(text)) inspected++;
    wrong.push(...check(name, text));
  }
  assert.ok(inspected >= 3, `the guard must find the metadata tools it is for — inspected ${inspected}`);
  assert.deepEqual(wrong, [], `Baseline und Schreibziel müssen derselbe Knoten sein:\n${wrong.join('\n')}`);
});

test('a metadata write or proposal goes through the collection field mapping', () => {
  // The metadata tools are open for collections, and a collection keeps title
  // and description in cm:* (measured 2026-11-13: `cclom:title` there is stored
  // as a second field nobody reads, and reads back as a success). Whoever reads
  // a write baseline for metadata therefore maps through `collection-fields.ts`.
  // The compendium tool is exempt: it writes one named property of a collection.
  const exempt = ['services/write/nodes.ts', 'tools/curation-compendium.ts'];
  const wrong: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    const name = rel(file);
    if (exempt.includes(name)) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes('readWriteBaseline(')) continue;
    // One mapping per baseline at least: a file with two write paths and one mapping must not pass.
    const baselines = text.split('readWriteBaseline(').length - 1;
    const mappings = text.split('desiredOn(').length + text.split('propertyOn(').length - 2;
    if (mappings < baselines) wrong.push(name);
  }
  assert.deepEqual(wrong, [], `Schreibt Metadaten ohne die Sammlungs-Zuordnung (collection-fields.ts): ${wrong.join(', ')}`);
});

test('a log line that names a person goes through log-privacy', () => {
  // User decision 2026-11-13: the log carries no address, account name or
  // search term in the clear by default. The rule is only as good as its last
  // call site, so the field names a person hides behind are pinned: inside a
  // log call they take their value from `logAddress` / `logAccount` / `logTerm`.
  // The list GROWS with each finding — `subject`, `title` and a path ending in
  // the term were found by review, not by the first version of this test.
  const WHO: Record<string, string> = {
    ip: 'logAddress', address: 'logAddress', remote: 'logAddress',
    label: 'logAccount', user: 'logAccount', username: 'logAccount', account: 'logAccount',
    // Audit 2026-11-14 (S7): the boot line named the service account and the
    // authority the repository reported, the registration line a caller-chosen
    // client name — each under a name this list did not know.
    configuredAs: 'logAccount', authority: 'logAccount', login: 'logAccount', owner: 'logAccount',
    clientName: 'logTerm', client_name: 'logTerm',
    query: 'logTerm', q: 'logTerm', term: 'logTerm', searchTerm: 'logTerm', subject: 'logTerm', title: 'logTerm',
  };
  /** Every `log.x(…)` call in a source text, cut at its BALANCED closing parenthesis — strings and all. */
  const calls = (text: string): string[] => {
    const out: string[] = [];
    for (const m of text.matchAll(/\blog\.(?:info|warn|error)\(/g)) {
      let depth = 1;
      let quote = '';
      let i = m.index + m[0].length;
      for (; i < text.length && depth > 0; i++) {
        const ch = text[i]!;
        if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
        if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      out.push(text.slice(m.index, i));
    }
    return out;
  };
  const check = (name: string, text: string): string[] => {
    const wrong: string[] = [];
    for (const body of calls(text)) {
      // The message is a literal: a template that embeds a value has no field name to pin.
      if (/^log\.\w+\(\s*`[^`]*\$\{/.test(body)) wrong.push(`${name}: Wert in der Meldung — ${body.slice(0, 70)}`);
      for (const [field, fn] of Object.entries(WHO)) {
        // Shorthand `{ ip }` / `{ query, … }`, or `ip: <anything but the function>`.
        if (new RegExp(`[{,]\\s*${field}\\s*[,}]`).test(body)) wrong.push(`${name}: ${field} (Kurzform)`);
        for (const v of body.matchAll(new RegExp(`[{,\\s]${field}:\\s*([^,}\\n]+)`, 'g'))) {
          if (!v[1]!.trim().startsWith(`${fn}(`)) wrong.push(`${name}: ${field} ← ${v[1]!.trim().slice(0, 40)}`);
        }
      }
    }
    return wrong;
  };
  // The scanner itself: each of these is a line that slipped past an earlier version.
  assert.ok(check('x', "log.warn('a; b', { ip: deps.ip });").length >= 1, 'a semicolon in the message');
  assert.ok(check('x', "log.warn('a', { subject: params.subject });").length >= 1);
  assert.ok(check('x', "log.warn('a', { title, lang });").length >= 1);
  assert.ok(check('x', 'log.warn(`blocked ${ip}`);').length >= 1);
  assert.ok(check('x', "log.info('verified', { configuredAs: cred.label, authority: id.authority });").length >= 2);
  assert.ok(check('x', "log.info('oauth client registered', { clientName: name, redirectUris: 1 });").length >= 1);
  assert.equal(check('x', "log.info('v', { configuredAs: logAccount(cred.label), clientName: logTerm(name) });").length, 0);
  assert.equal(check('x', "log.warn('a', { ip: logAddress(ip), query: logTerm(q), n: 1 });").length, 0);

  const wrong: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    const name = rel(file);
    if (name === 'log-privacy.ts') continue;
    wrong.push(...check(name, readFileSync(file, 'utf8')));
  }
  assert.deepEqual(wrong, [], `Im Log steht eine Person im Klartext:\n${wrong.join('\n')}`);
});

test('every write that can carry ccm:wwwurl keeps the larger timeout', () => {
  // Measured 2026-08-17: setting `ccm:wwwurl` makes the repository render a
  // preview of the page while the write is in flight — 8.8 s warm, 46.5 s cold
  // for a real site. It is slow WHEREVER it happens: creating with the URL took
  // 8.8 s, creating without it 0.5 s and setting the URL afterwards 7.8 s. So the
  // budget follows the property, not the endpoint, and both writers need it —
  // `wlo_update_content` changing a source URL goes through the metadata path.
  //
  // A source-level guard because the behaviour cannot be tested at the seam:
  // `wloFetch` attaches its own signal when the caller supplies none, so by the
  // time a fetch mock sees the request both paths look identical.
  const sites: Array<[file: string, needle: RegExp]> = [
    ['services/write/nodes-lifecycle.ts', /signal:\s*AbortSignal\.timeout\(writeTimeoutMs\(body\)\)/],
    ['services/write/nodes.ts', /signal:\s*AbortSignal\.timeout\(writeTimeoutMs\(properties\)\)/],
  ];
  const missing = sites
    .filter(([file, needle]) => !needle.test(readFileSync(join(srcDir, file), 'utf8')))
    .map(([file]) => file);
  assert.deepEqual(missing, [],
    'ohne writeTimeoutMs läuft ein URL-Schreibvorgang wieder gegen das gewöhnliche Limit');
});
test('what a context NAME means, and what "narrowed" means, are each defined once', () => {
  // Six surfaces take a context name — `get_skill_registry` plus the five
  // collection tools — and every one of them can get the same two rules wrong:
  // how a name is normalised before it is compared (case, surrounding space,
  // repeated space, the reserved "all"), and what a narrowed answer carries
  // (the context's own skills PLUS the ones that apply always, and the document
  // slice that goes with them).
  //
  // The second rule is the one that rots quietly: a copy that forgets the
  // always-applicable skills answers with a SHORTER approval list and looks
  // entirely plausible doing it.
  const defined = (name: string) => new RegExp(`(export )?(async )?function ${name}\\b|const ${name}\\s*=`);

  assert.deepEqual(
    offenders(defined('resolveContext'), ['services/registry-contexts.ts']), [],
    'resolveContext is defined in services/registry-contexts.ts and nowhere else',
  );
  assert.deepEqual(
    offenders(defined('narrowRegistry'), ['services/skill-registry.ts']), [],
    'narrowRegistry is defined in services/skill-registry.ts and nowhere else',
  );
});
