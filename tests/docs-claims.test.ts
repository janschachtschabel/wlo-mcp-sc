/**
 * docs-claims.test.ts – documents that make a claim about the server must not
 * outlive the claim.
 *
 * Three files say publicly what this server does: the privacy policy an operator
 * publishes, the checklist an app-store reviewer reads, and `llms.txt`, which is
 * SERVED to AI fetchers at `/llms.txt`. Write support landed in 2026-08 and all
 * three still described a read-only, unauthenticated proxy — a privacy policy
 * that omits "accepts and forwards credentials" and "writes to the repository",
 * and a submission checklist that told the reviewer "no write tools" while the
 * server registered thirteen.
 *
 * Nothing catches that: the code was right, the prose was stale, and no test
 * connected them. This one does, in the direction that matters — the SOURCE is
 * the fact and the documents have to agree with it. It deliberately checks
 * claims, not wording: a rewrite is free, a false claim is not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

/** Curation tool names as the source actually registers them. */
function curationToolNames(): string[] {
  const dir = fileURLToPath(new URL('src/tools/', root));
  const names: string[] = [];
  for (const file of readdirSync(dir).filter(f => f.startsWith('curation-') && f.endsWith('.ts'))) {
    const src = readFileSync(`${dir}${file}`, 'utf8');
    for (const m of src.matchAll(/name: '(wlo_[a-z_]+)'/g)) names.push(m[1]!);
  }
  return [...new Set(names)];
}

test('the server really does register write tools — the premise of this file', () => {
  // If this ever fails legitimately (write support removed), the claims below
  // become true again and this whole file should go with the feature.
  assert.ok(curationToolNames().length > 0, 'no curation tools found — has the source moved?');
});

// ── The privacy policy ───────────────────────────────────────────────────────

/**
 * Claims that were literally in the published policy and are false while
 * curation tools exist. Anchored loosely enough to survive rewording, tightly
 * enough not to fire on an honest sentence — "no user accounts **of its own**"
 * and "read-only tools" are both fine and must stay matchable.
 */
const FALSE_PRIVACY_CLAIMS: ReadonlyArray<[RegExp, string]> = [
  [/\bno authentication\b/i, 'the server accepts and forwards an Authorization header'],
  [/never writes/i, 'the curation tools write to the repository'],
  [/all tools and REST endpoints are \*{0,2}read-only/i, 'the MCP tool list includes write tools'],
  [/no write\/?(mutation)? tools exist/i, 'thirteen of them exist'],
  [/it has none\b/i, 'said of credentials — the server does receive them'],
];

test('the privacy policy claims nothing the source contradicts', () => {
  const policy = read('docs/PRIVACY.md');
  for (const [pattern, why] of FALSE_PRIVACY_CLAIMS) {
    assert.doesNotMatch(policy, pattern, `docs/PRIVACY.md: ${why}`);
  }
});

test('the privacy policy names what it now has to disclose', () => {
  const policy = read('docs/PRIVACY.md');
  // Each of these is a processing activity or a recipient that exists only
  // because of a configurable capability. Naming them is the point of the file.
  const mustMention: ReadonlyArray<[string, string]> = [
    ['Authorization', 'the credential a user\'s host may send'],
    ['WLO_TEXT_EXTRACTION_URL', 'a third-party recipient of URLs'],
    ['WLO_ALLOW_SERVICE_WRITES', 'the gate on writes under the shared account'],
    ['X-Forwarded-For', 'how the rate-limit key is derived'],
  ];
  for (const [needle, why] of mustMention) {
    assert.ok(policy.includes(needle), `docs/PRIVACY.md must mention ${needle} — ${why}`);
  }
});

test('the privacy policy describes the rightmost forwarded hop, not the first', () => {
  // `clientKey` takes the hop the trusted proxy appended; the leftmost value is
  // client-supplied and spoofable. The policy used to say "first".
  const policy = read('docs/PRIVACY.md');
  assert.match(policy, /rightmost/i);
  assert.doesNotMatch(policy, /the \*{0,2}first\*{0,2} `?X-Forwarded-For`? hop/i);
});

// ── The submission checklist ─────────────────────────────────────────────────

test('the submission checklist does not tell a reviewer there are no write tools', () => {
  const checklist = read('docs/apps-sdk-submission-checklist.md');
  assert.doesNotMatch(checklist, /no write tools/i,
    'the reviewer can see thirteen of them in tools/list with a login');
  assert.doesNotMatch(checklist, /read-only, no PII stored/i,
    'the parenthetical summarised the policy as read-only');
});

// ── llms.txt (served at /llms.txt) ───────────────────────────────────────────

test('llms.txt states no tool count that can go stale', () => {
  // It said "22 read-only tools" long after there were 25. A number that has to
  // be maintained by hand in a served file is a number that will be wrong; the
  // fix is to not state one.
  const llms = read('public/llms.txt');
  assert.doesNotMatch(llms, /\b\d+\s+read-only tools\b/i,
    'drop the count rather than maintain it — tools/list is authoritative');
});

// ── The tool overviews ───────────────────────────────────────────────────────

/**
 * Every user-facing document that describes WHEN a tool is visible.
 *
 * The rule changed on 2026-08-05 — the curation tools are listed for every
 * caller and refuse at call time — and three documents said the opposite in
 * three different phrasings. A reader who believes the old sentence concludes
 * "the login is broken" when they see thirteen tools they cannot use, which is
 * the exact opposite of what they should conclude.
 */
const OVERVIEW_DOCS = ['README.md', 'README.de.md', 'docs/TOOLS.md'];

test('no overview still claims the write tools are hidden without a login', () => {
  for (const doc of OVERVIEW_DOCS) {
    const body = read(doc);
    // Narrow on purpose, and it took a second attempt to get right: "sichtbar,
    // aber nur mit Anmeldung BENUTZBAR" is exactly the true sentence these docs
    // now carry, and a first version of this test forbade it. What may not be
    // said is that the tools are ABSENT — so the patterns below all require the
    // visibility word to be the thing being conditioned.
    for (const [pattern, why] of [
      [/nur (mit|bei)[^.\n]{0,40}sichtbar/i, 'they are visible to everyone'],
      [/curation tools[^.\n]{0,40}appear (only )?(with|when)/i, 'they are always listed'],
      [/registered only (for|when)[^.\n]{0,30}(identity|login)/i, 'registration is unconditional'],
    ] as ReadonlyArray<[RegExp, string]>) {
      assert.doesNotMatch(body, pattern, `${doc}: ${why}`);
    }
  }
});

test('the auth document exists and names the rules it is there to protect', () => {
  // AUTH.md is the one place a maintainer looks before changing the login. If a
  // rule is missing from it, the next change undoes it without noticing.
  const auth = read('docs/AUTH.md');
  const mustMention: ReadonlyArray<[string, string]> = [
    ['WLO_AUTH_PRIVATE_KEY', 'the switch that turns the whole feature on'],
    ['allow-list', 'the direction the registry fails in'],
    ['PKCE', 'the proof at the token endpoint'],
    ['application/json', 'the CSRF defence on the password-carrying endpoints'],
    ['esguest', 'why a 200 is not proof of a login'],
    ['refresh_token', 'stated as absent, so nobody adds one'],
  ];
  for (const [needle, why] of mustMention) {
    assert.ok(auth.includes(needle), `docs/AUTH.md must mention ${needle} — ${why}`);
  }
});
