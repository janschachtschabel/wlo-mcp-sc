/**
 * source-bytes-discipline.test.ts – a control character in the source is
 * written as an escape, never as the byte itself.
 *
 * Found 2026-08-12 with five violations across two test files, both of them
 * authored while every gate was green: a test needs a control character as
 * DATA (does `isWellFormedTicket` refuse a NUL? does the follow-up prompt strip
 * `\u001b`?) and the obvious way to write one is to put it there. It parses, it
 * runs, it asserts the right thing — and it quietly changes what the file IS.
 *
 * The consequence is not cosmetic and not hypothetical, both measured on the
 * day this was written:
 *
 *   - **git calls the file binary.** `git diff --numstat` reports `-  -` for
 *     `tests/ticket-exchange.test.ts`; a review sees "Binary files differ"
 *     instead of a diff, and so does GitHub. A test file nobody can read the
 *     diff of is a test file nobody reviews.
 *   - **ripgrep skips it.** Searching the tree answers "binary file matches"
 *     and prints nothing — so the file is invisible to exactly the grep-based
 *     checking this project leans on everywhere else.
 *
 * Strictly it is the NUL that triggers git's heuristic; `0x1b` and `0x1f` do
 * not. They are in scope anyway because they are the same authoring mistake
 * with the same invisibility, and separating them would only teach the reader
 * that some raw control bytes are fine.
 *
 * Nothing else catches this. Lint passed, `tsc` passed, and all 1852 tests
 * passed with the five bytes in place — a byte that is legal in a string
 * literal is legal to every tool that reads the file as text. This one reads
 * it as BYTES, which is the only way to see it.
 *
 * The fix is always the same and always behaviour-preserving: write `\u0000`
 * instead of the NUL byte. The runtime value is identical; only the file
 * changes, back into text.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Directories we author. Everything else is generated or vendored. */
const SCANNED_DIRS = ['src', 'tests', 'scripts', 'docs', 'public', '.github'];

/**
 * Extensions read as text. Deliberately a list rather than "not an image":
 * a new binary asset under `public/` must not start failing this test, and an
 * unlisted text format is a smaller loss than a false positive nobody can fix.
 */
const TEXT_EXTENSIONS = ['.ts', '.mjs', '.js', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.txt'];

/**
 * Text files with no extension to match on — the gap the first version left.
 *
 * A fixed extension list is the safe direction for BINARY assets and the wrong
 * one for text that simply has no suffix, and the miss was not theoretical: of
 * the ten files out of scope on 2026-08-13, three were read mechanically.
 * `.env.example` is picked apart line by line with regexes by
 * `deploy-env-passthrough.test.ts` and copied to `.env` by every operator
 * following `docker-compose.yml`; `public/llms.txt` and `public/robots.txt` are
 * SERVED, the first of them to models. A control byte in any of them is exactly
 * the defect this file exists for, and none of them would have been looked at.
 *
 * `.env` is deliberately absent and must stay absent: it is not source, it is a
 * local file holding the operator's password, and this guard has no business
 * opening it.
 */
const TEXT_FILENAMES = [
  'Dockerfile', 'LICENSE', '.dockerignore', '.gitignore', '.env.example', 'probe.env.example',
];

/** Generated, huge, and not ours to fix. */
const SKIPPED_FILES = ['package-lock.json'];

const SKIPPED_DIRS = ['node_modules', 'dist', 'dist-widgets', 'coverage', '.git'];

/**
 * The scope rule, in ONE place: the tree walk and the root-level sweep both ask
 * this. They each carried their own copy of the extension test, which was one
 * rule in two spellings — survivable until the rule grew a second half, at which
 * point a name added to one list and not the other is a silent hole.
 */
function isTextFile(entry: string): boolean {
  if (SKIPPED_FILES.includes(entry)) return false;
  return TEXT_EXTENSIONS.some(e => entry.endsWith(e)) || TEXT_FILENAMES.includes(entry);
}

function textFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...textFiles(full));
    else if (isTextFile(entry)) out.push(full);
  }
  return out;
}

/** Tab, LF and CR are how text is written; every other C0 byte, and DEL, is not. */
function isRawControl(byte: number): boolean {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) return false;
  return byte < 0x20 || byte === 0x7f;
}

const rel = (file: string) => file.slice(root.length).split('\\').join('/');

test('no source file carries a raw control character', () => {
  const files = [
    ...SCANNED_DIRS.flatMap(d => textFiles(join(root, d))),
    // Root-level docs and config, without descending into the whole tree.
    ...readdirSync(root)
      .filter(isTextFile)
      .map(e => join(root, e))
      .filter(f => statSync(f).isFile()),
  ];

  // Guards the guard: a walk that silently found nothing would pass forever.
  assert.ok(files.length > 100, `only ${files.length} files scanned — has the tree moved?`);

  // And guards its REACH. The count above rises and falls with the tree, so it
  // cannot notice a whole class of file dropping out of scope. These four are
  // named because each is text that something reads mechanically, and none of
  // them carries a listed extension: `.env.example` is parsed line by line by
  // `deploy-env-passthrough.test.ts` AND copied to `.env` by operators,
  // `public/llms.txt` is served to models, and `Dockerfile` builds the image.
  const scanned = new Set(files.map(rel));
  const mustCover = ['.env.example', 'public/llms.txt', 'public/robots.txt', 'Dockerfile'];
  assert.deepEqual(
    mustCover.filter(f => !scanned.has(f)),
    [],
    'these are machine-read text files and must be in scope — extend TEXT_EXTENSIONS/TEXT_FILENAMES',
  );

  const offenders: string[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (isRawControl(byte)) {
        offenders.push(`${rel(file)}@${i}  0x${byte.toString(16).padStart(2, '0')}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'raw control bytes in the source — write them as \\uXXXX escapes instead '
      + '(identical at runtime; keeps the file text for git, GitHub and ripgrep)',
  );
});
