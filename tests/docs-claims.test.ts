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

import { connectedClient } from './fetchMock.js';
import { registerSkillTools } from '../src/tools/skills.js';

const root = new URL('../', import.meta.url);

/**
 * Read a document this suite makes claims about.
 *
 * A missing one is a HARD failure and stays one — a document listed here and
 * silently skipped is a check that has stopped running while still reporting
 * green. What changed on 2026-08-18 is only the message: `CLAUDE.md` had never
 * been uploaded to the repository, so CI failed with a bare
 * `ENOENT ... open '/home/runner/work/.../CLAUDE.md'` under a test named "no
 * document states a tool count the server contradicts". Nothing in that pointed
 * at the actual problem, and locally every file was present, so reproducing it
 * took cloning the repository and running the suite against it. The file name
 * and the reason belong in the failure.
 */
const read = (name: string): string => {
  try {
    return readFileSync(fileURLToPath(new URL(name, root)), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    throw new Error(
      `${name} is missing from the repository. This suite checks the claims that document makes `
      + '(tool counts, tool names, parameters), so it must be checked in — not skipped. '
      + 'If it genuinely does not belong in the repository, remove it from the list that names it.',
    );
  }
};

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

// ── Counts ───────────────────────────────────────────────────────────────────

/**
 * A number beside a noun that names what is being counted.
 *
 * Every one of these was wrong somewhere on 2026-08-11, and two of them
 * disagreed inside the SAME file (README.md said "28 read tools" in its opening
 * and "27 MCP read tools" fifty lines later). `llms.txt` solved this by stating
 * no count at all — right for a served file, wrong for a README, where the
 * number is orientation a reader actually wants. So the number stays and the
 * source decides it.
 *
 * The worst one was not stale, it was FALSE: both READMEs told a reader that an
 * anonymous request gets "25" / "27" public tools, when it gets all 42 — the
 * curation tools included, refusing at call time. That is the claim
 * `no overview still claims the write tools are hidden without a login` above
 * exists to forbid, walking past it in the shape of a digit.
 */
const COUNTED_DOCS = [
  'README.md', 'README.de.md', 'docs/TOOLS.md', 'docs/TOOLS-KOMPAKT.md',
  'docs/INTEGRATION.md', 'CLAUDE.md',
];

/**
 * How many tools each skill mode registers, MEASURED rather than assumed.
 *
 * This used to be `names.length - 1` with a comment saying one-tool swaps two
 * tools for one. On 2026-08-16 `get_skill` became unconditional — the swap is
 * now 1:1 and the count is unchanged — and the arithmetic went on producing the
 * old number, so every document kept its stale "41" with the suite green. A
 * count derived from a sentence about the code checks the sentence, not the
 * code; `createMcpServer` reads the mode from the environment at import time,
 * so the delta is taken from the one function the mode actually reaches.
 */
function skillToolsPerMode(): { 'two-tool': number; 'one-tool': number } {
  const count = (mode: 'two-tool' | 'one-tool'): number => {
    const names: string[] = [];
    const probe = {
      tool: (name: string) => { names.push(name); },
    } as unknown as Parameters<typeof registerSkillTools>[0];
    registerSkillTools(probe, { collectionId: '', mode });
    return names.length;
  };
  return { 'two-tool': count('two-tool'), 'one-tool': count('one-tool') };
}

async function realCounts(): Promise<{ total: number; readTools: number; curation: number; oneTool: number }> {
  const client = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    const curation = curationToolNames();
    const perMode = skillToolsPerMode();
    return {
      total: names.length,
      readTools: names.filter(n => !curation.includes(n)).length,
      curation: curation.length,
      oneTool: names.length - perMode['two-tool'] + perMode['one-tool'],
    };
  } finally {
    await client.close();
  }
}

test('no document states a tool count the server contradicts', async () => {
  const { total, readTools, curation, oneTool } = await realCounts();

  const claims: ReadonlyArray<[RegExp, number, string]> = [
    [/(\d+)\s+(?:MCP\s+)?read tools/gi, readTools, 'read tools'],
    [/(\d+)\s+lesende(?:n)?(?:\s+(?:MCP-Tools|Werkzeuge))?\b/gi, readTools, 'lesende Werkzeuge'],
    [/(\d+)\s+kuratierende(?:n)?(?:\s+(?:MCP-Tools|Werkzeuge))?\b/gi, curation, 'kuratierende Werkzeuge'],
    // The same count in a heading, written the other way round. `docs/TOOLS.md`
    // carried "Lesende MCP-Tools (27)" and "Kuratierende MCP-Tools (13)" while
    // the prose above it said 42 — a section heading is exactly where a reader
    // looks for the number, and exactly where nobody looks when updating one.
    [/Lesende MCP-Tools \((\d+)\)/g, readTools, 'read tools (heading)'],
    [/Kuratierende MCP-Tools \((\d+)\)/g, curation, 'curation tools (heading)'],
    // The compact overview's own spellings.
    [/^## Lesend \((\d+)\)/gm, readTools, 'read tools (compact heading)'],
    [/^## Kuratierend \((\d+)\)/gm, curation, 'curation tools (compact heading)'],
    [/\*\*(\d+) lesend\*\*/g, readTools, 'read tools (compact intro)'],
    [/\*\*(\d+) kuratierend\*\*/g, curation, 'curation tools (compact intro)'],
    [/dann (\d+) Werkzeuge/g, oneTool, 'one-tool mode drops exactly one tool'],
    [/registers all (\d+) tools/gi, total, 'the factory registers every tool'],
    // The anonymous listing is the WHOLE list — this is a claim about
    // visibility, not a headcount, which is why a wrong number here is a lie
    // rather than a typo.
    [/(?:same )?(\d+)\s+(?:public tools|öffentlichen Werkzeuge)/gi, total, 'anonymous callers see every tool'],
    [/(\d+) Tools —[^\n]*get_skill_for_task/gi, oneTool, 'one-tool mode drops exactly one tool'],
  ];

  const wrong: string[] = [];
  for (const doc of COUNTED_DOCS) {
    const body = read(doc);
    for (const [pattern, expected, what] of claims) {
      for (const m of body.matchAll(pattern)) {
        if (Number(m[1]) !== expected) {
          wrong.push(`${doc}: "${m[0].trim()}" — ${what} is ${expected}`);
        }
      }
    }
  }
  assert.deepEqual(wrong, [], 'the source is the fact; these numbers are not');
});

/**
 * A registered tool that no user-facing overview names.
 *
 * `get_skill_registry` shipped on 2026-08-10 and neither README mentioned it —
 * `docs/TOOLS.md` had it, so the reference was complete while the two documents
 * people actually open were not. A tool nobody reads about is a tool nobody
 * asks for, which is the same failure as not shipping it.
 *
 * Checked against BOTH READMEs together rather than each alone: they are
 * translations of one another, so a name missing from one is a translation gap,
 * and a name missing from both is a documentation gap. `docs/TOOLS.md` is the
 * reference and must carry every one on its own.
 */
test('every registered tool is named in the tool reference and in both READMEs', async () => {
  const client = await connectedClient();
  let names: string[];
  try {
    names = (await client.listTools()).tools.map(t => t.name);
  } finally {
    await client.close();
  }

  // Both files claim completeness — the reference in full, the compact list as
  // "alle 42 Werkzeuge auf einen Blick". A claim of completeness is the one kind
  // of document where a missing row is a defect rather than an omission.
  for (const doc of ['docs/TOOLS.md', 'docs/TOOLS-KOMPAKT.md']) {
    const body = read(doc);
    const missing = names.filter(n => !new RegExp(String.raw`\b${n}\b`).test(body));
    assert.deepEqual(missing, [], `${doc} claims to list every tool`);
  }

  for (const doc of ['README.md', 'README.de.md']) {
    const body = read(doc);
    const missing = names.filter(n => !new RegExp(String.raw`\b${n}\b`).test(body));
    assert.deepEqual(missing, [], `${doc} does not name these tools`);
  }
});

/**
 * A document that still calls a skill a prompt.
 *
 * Skills moved from `ai_prompt` to `ai_skill` on 2026-08-12. The filter that
 * finds them was migrated with a constant, and the tool descriptions are guarded
 * by `tests/tools-skills.test.ts` — the DOCUMENTS were migrated by hand and two
 * were missed. A reader who learns "a skill is a KI-Prompt" then searches the
 * repository for a term it no longer indexes; nothing fails loudly when they do.
 *
 * Scoped to the four overview documents, which describe TOOLS. The editorial
 * guides (`docs/SKILLS.md`, `docs/SKILL-TRIGGER.md`) and the changelog describe
 * the VOCABULARY, where the old term is still the right word for the one thing
 * that kept it: the registry document. This guard must not push them into
 * calling a registry something it is not.
 */
test('no overview still calls a skill a KI-Prompt', () => {
  const wrong: string[] = [];
  for (const doc of ['README.md', 'README.de.md', 'docs/TOOLS.md', 'docs/TOOLS-KOMPAKT.md']) {
    read(doc).split('\n').forEach((line, i) => {
      const m = line.match(/\b(?:KI-Prompts?|AI prompts?)\b/i);
      if (m) wrong.push(`${doc}:${i + 1}: "${m[0]}" — a skill carries ai_skill since 2026-08-12`);
    });
  }
  assert.deepEqual(wrong, [], 'these lines teach a vocabulary term the repository dropped');
});

/**
 * A parameter the READMEs document that the tool does not take.
 *
 * `search_wlo_collections` was documented with `userRole?` (it has no such
 * parameter — `search_wlo_content` does, and the entries sit next to each other)
 * and `get_node_collections` with `maxResults?`, which it never had. A model
 * reading either sends an argument the schema rejects, and the tool call fails
 * for a reason the documentation caused.
 *
 * The rule is drawn along the documents' OWN convention: an optional parameter
 * is written `name?` in backticks, while enum values and type names are written
 * without the question mark. That makes the check exact — it found these two and
 * nothing else across 28 tool entries in two languages.
 */
test('the READMEs document no parameter the schema does not have', async () => {
  const client = await connectedClient();
  let schemas: Map<string, Set<string>>;
  try {
    schemas = new Map((await client.listTools()).tools.map(t => [
      t.name,
      new Set(Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})),
    ]));
  } finally {
    await client.close();
  }

  const wrong: string[] = [];
  for (const doc of ['README.md', 'README.de.md']) {
    const body = read(doc);
    // `**12. \`tool_name\`** — …` up to the blank line that ends the entry.
    // `\r?` is not decoration: these files are CRLF, and a first version with a
    // bare `\n\n` matched ZERO entries and passed by checking nothing — which is
    // worse than the defect it was written to catch.
    const entries = [...body.matchAll(/\*\*\d+\.\s+`([a-z_]+)`\*\*([\s\S]{0,900}?)(?=\r?\n\r?\n)/g)];
    assert.ok(entries.length > 20, `${doc}: only ${entries.length} tool entries parsed — the scan is broken`);
    for (const entry of entries) {
      const [, tool, blob] = entry;
      const params = schemas.get(tool!);
      if (!params) continue;
      for (const p of blob!.matchAll(/`([a-zA-Z][a-zA-Z0-9_]*)\?`/g)) {
        if (!params.has(p[1]!)) wrong.push(`${doc}: ${tool} has no parameter \`${p[1]}\``);
      }
    }
  }
  assert.deepEqual(wrong, [], 'a documented parameter that does not exist makes the tool call fail');
});
