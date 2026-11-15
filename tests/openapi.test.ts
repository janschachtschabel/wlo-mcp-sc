/**
 * openapi.test.ts – `docs/openapi.yaml` must name the paths the server serves:
 * all of them, and no others — and every `$ref` in it must resolve.
 *
 * The SOURCE is the fact, and the code side is DERIVED from it, not listed
 * here: `scanRoutes` reads `src/http-app.ts` and the `rest/` modules it
 * dispatches to (found through their import lines) for
 *
 *   - comparisons of the path with a literal or a constant (`path === '/x'`,
 *     `pathname === X_PATH`),
 *   - prefix checks (`.startsWith('/x/')`, `.startsWith(X_PREFIX)`),
 *   - the keys of route tables (`'/x': …` and `[X_PATH]: …`).
 *
 * So an `if (path === '/foo')` added to the dispatcher without a line in the
 * document fails here, and so does a path the document keeps after the code
 * dropped it.
 *
 * What this does NOT pin: methods, parameters, status codes, schemas. Those
 * were read from the code by hand.
 *
 * No YAML parser (the project has none and this is no reason to add one): the
 * document keeps every path as a key at exactly two spaces under `paths:`, and
 * every component as a key at four spaces under its section.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveStaticRoute } from '../src/rest/static.js';

const root = new URL('../', import.meta.url);
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

const spec = read('docs/openapi.yaml');

/** The path keys of a document: `  /something:` between `paths:` and the next top-level key. */
function specPaths(document = spec): string[] {
  const start = document.indexOf('\npaths:\n');
  assert.notEqual(start, -1, 'docs/openapi.yaml has no top-level `paths:`');
  const rest = document.slice(start + '\npaths:\n'.length);
  const end = rest.search(/^\S/m);
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^ {2}(\/\S*):\s*$/gm)].map(m => m[1]!);
}

// ── the code side ────────────────────────────────────────────────────────────

const ENTRY = 'src/http-app.ts';

/** `ENTRY` plus every `rest/` module reachable from it through import lines. */
function dispatchSources(): Map<string, string> {
  const sources = new Map<string, string>([[ENTRY, read(ENTRY)]]);
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const inRest = file.startsWith('src/rest/');
    for (const m of sources.get(file)!.matchAll(/from '\.\/((?:rest\/)?[\w-]+)\.js'/g)) {
      const target = inRest ? `src/rest/${m[1]}.ts` : `src/${m[1]}.ts`;
      if (!target.startsWith('src/rest/') || sources.has(target)) continue;
      sources.set(target, read(target));
      queue.push(target);
    }
  }
  return sources;
}

interface Routes { exact: Set<string>; prefixes: Set<string> }

/**
 * Every path one or more source texts dispatch on. A constant is resolved from
 * its declaration (`const X = '/…';`, exported or not) anywhere in `sources`;
 * one compared against the path that does not resolve is a failure of this
 * reader — it must not turn into a check that passes over nothing.
 */
function scanRoutes(sources: Iterable<string>): Routes {
  const texts = [...sources];
  const constants = new Map<string, string>();
  for (const text of texts) {
    for (const m of text.matchAll(/\bconst ([A-Z][A-Z0-9_]*) = '(\/[^']*)';/g)) constants.set(m[1]!, m[2]!);
  }
  const resolve = (name: string): string => {
    const value = constants.get(name);
    assert.ok(value, `the path is compared against ${name}, which is no '/…' string constant — update tests/openapi.test.ts`);
    return value;
  };
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(/\b(?:path|pathname)\s*[!=]==\s*'(\/[^']*)'/g)) exact.add(m[1]!);
    for (const m of text.matchAll(/\b(?:path|pathname)\s*[!=]==\s*([A-Z][A-Z0-9_]*)\b/g)) exact.add(resolve(m[1]!));
    for (const m of text.matchAll(/^\s*'(\/[^']*)'\s*:/gm)) exact.add(m[1]!);
    for (const m of text.matchAll(/^\s*\[([A-Z][A-Z0-9_]*)\]\s*:/gm)) {
      const value = constants.get(m[1]!);
      if (value) exact.add(value);
    }
    for (const m of text.matchAll(/\.startsWith\('(\/[^']*)'\)/g)) prefixes.add(m[1]!);
    for (const m of text.matchAll(/\.startsWith\(([A-Z][A-Z0-9_]*)\)/g)) prefixes.add(resolve(m[1]!));
  }
  return { exact, prefixes };
}

/**
 * The two directions, as lists of what is wrong.
 *
 * A documented path with a `{parameter}` is served when the text before the
 * brace is a prefix the code checks; a prefix of the code is documented when at
 * least one documented path lies under it (several prefixes are CORS and
 * metric classes — `/auth`, `/api/` — not routes of their own).
 */
function comparePaths(code: Routes, documented: readonly string[]): { missing: string[]; invented: string[] } {
  const missing = [
    ...[...code.exact].filter(p => !documented.includes(p)),
    ...[...code.prefixes].filter(prefix => !documented.some(p => p.startsWith(prefix))).map(p => `${p}…`),
  ];
  const invented = documented.filter((p) => {
    const brace = p.indexOf('{');
    return brace === -1 ? !code.exact.has(p) : !code.prefixes.has(p.slice(0, brace));
  });
  return { missing, invented };
}

const codeRoutes = (): Routes => scanRoutes(dispatchSources().values());

test('openapi: info.version is the package version', () => {
  const version = /^info:\n(?: {2}.*\n)*? {2}version: (\S+)$/m.exec(spec)?.[1];
  assert.ok(version, 'docs/openapi.yaml has no info.version');
  assert.equal(version, (JSON.parse(read('package.json')) as { version: string }).version);
});

test('openapi: the path list is read from the document, and each path once', () => {
  const paths = specPaths();
  assert.ok(paths.length > 20, `only ${paths.length} paths were read — the document's layout changed`);
  assert.equal(new Set(paths).size, paths.length, 'a path appears twice');
});

test('openapi: the scanner reads the dispatcher and the modules behind it', () => {
  const sources = dispatchSources();
  for (const file of ['src/rest/routes.ts', 'src/rest/handlers.ts', 'src/rest/auth-pages.ts', 'src/rest/oauth-pages.ts',
    'src/rest/static.ts', 'src/rest/upload-route.ts']) {
    assert.ok(sources.has(file), `${file} is no longer reached from ${ENTRY} — its routes would go unchecked`);
  }
  const { exact, prefixes } = scanRoutes(sources.values());
  // One of each kind of evidence, so a regex that stopped matching is noticed.
  assert.ok(exact.has('/mcp'), 'literal comparison');
  assert.ok(exact.has('/ready'), 'comparison with an imported constant');
  assert.ok(exact.has('/api/compendium'), 'route-table key');
  assert.ok(exact.has('/oauth/token'), 'computed route-table key');
  assert.ok(prefixes.has('/api/search/'), 'prefix constant');
  assert.ok(exact.size > 25, `only ${exact.size} exact paths were found`);
});

test('openapi: the scanner finds each form of path check in a synthetic source', () => {
  const found = scanRoutes([[
    "export const A_PATH = '/a';",
    "const B_PREFIX = '/b/';",
    "const TABLE: Record<string, number> = {",
    "  '/c': 1,",
    "  [A_PATH]: 2,",
    "};",
    "if (req.method === 'GET' && path === '/d') return;",
    "if (parsed.pathname !== A_PATH) return false;",
    "if (path.startsWith(B_PREFIX) || path.startsWith('/e/')) return;",
    "if (contentType.startsWith('text/html')) return;",
  ].join('\n')]);
  assert.deepEqual([...found.exact].sort(), ['/a', '/c', '/d']);
  assert.deepEqual([...found.prefixes].sort(), ['/b/', '/e/']);
  assert.throws(() => scanRoutes(["if (path === UNKNOWN_PATH) return;"]), /UNKNOWN_PATH/);
});

test('openapi: every route the code dispatches is in the document', () => {
  const { missing } = comparePaths(codeRoutes(), specPaths());
  assert.deepEqual(missing, [], `served by the code but absent from docs/openapi.yaml: ${missing.join(', ')}`);
});

test('openapi: the document names no path the code does not serve', () => {
  const { invented } = comparePaths(codeRoutes(), specPaths());
  assert.deepEqual(invented, [], `in docs/openapi.yaml but not dispatched by the code: ${invented.join(', ')}`);
});

test('openapi: a new inline route in http-app.ts that the document lacks is caught', () => {
  // The REAL sources plus one line, in a copy: what a route added tomorrow looks like.
  const sources = dispatchSources();
  const withNew = new Map(sources);
  withNew.set(ENTRY, `${sources.get(ENTRY)!}\nif (path === '/foo') { res.end(); return; }\nif (path.startsWith('/bar/')) return;\n`);
  const { missing } = comparePaths(scanRoutes(withNew.values()), specPaths());
  assert.deepEqual(missing, ['/foo', '/bar/…']);
  // And the other direction: a documented path nothing dispatches.
  const { invented } = comparePaths(codeRoutes(), [...specPaths(), '/ghost', '/ghost/{id}']);
  assert.deepEqual(invented, ['/ghost', '/ghost/{id}']);
});

test('openapi: the static paths read from the source are the ones the router serves', () => {
  // Guards the text reader against a table key that is no route at all.
  const keys = [...read('src/rest/static.ts').matchAll(/^\s*'(\/[^']*)'\s*:/gm)].map(m => m[1]!);
  assert.ok(keys.length > 5, `only ${keys.length} static paths were read`);
  for (const path of keys) {
    assert.equal(resolveStaticRoute('GET', path)?.status, 200, `${path} is not served`);
  }
});

// ── references ───────────────────────────────────────────────────────────────

/** Every local `$ref` of a document that points at nothing, as `#/…` strings. */
function danglingRefs(document: string): string[] {
  const start = document.indexOf('\ncomponents:\n');
  assert.notEqual(start, -1, 'docs/openapi.yaml has no top-level `components:`');
  const components = document.slice(start + '\ncomponents:\n'.length);
  // `section → names`: a section is a key at two spaces, a component one at four.
  const defined = new Set<string>();
  let section = '';
  for (const line of components.split('\n')) {
    const s = /^ {2}([A-Za-z]+):\s*$/.exec(line);
    if (s) { section = s[1]!; continue; }
    const n = /^ {4}([A-Za-z0-9_.-]+):/.exec(line);
    if (n && section) defined.add(`#/components/${section}/${n[1]}`);
  }
  const refs = [...document.matchAll(/\$ref:\s*'(#[^']*)'/g)].map(m => m[1]!);
  // A `$ref` this pattern cannot read (unquoted, double-quoted) would go unchecked.
  assert.equal(refs.length, (document.match(/\$ref:/g) ?? []).length,
    'a $ref is not written as $ref: \'#/…\' — the reference check would skip it');
  return [...new Set(refs.filter(r => !defined.has(r)))];
}

test('openapi: every $ref resolves to a component the document defines', () => {
  assert.ok((spec.match(/\$ref:/g) ?? []).length > 100, 'the document lost its references — the layout changed');
  assert.deepEqual(danglingRefs(spec), []);
});

test('openapi: a $ref to an undefined component is reported', () => {
  const broken = spec.replace("$ref: '#/components/responses/ServerMetadata'", "$ref: '#/components/responses/ServerMetadataX'");
  assert.notEqual(broken, spec);
  assert.deepEqual(danglingRefs(broken), ['#/components/responses/ServerMetadataX']);
  // The right name under the wrong section is dangling too.
  assert.deepEqual(danglingRefs(spec.replace("'#/components/headers/RetryAfter'", "'#/components/schemas/RetryAfter'")),
    ['#/components/schemas/RetryAfter']);
});
