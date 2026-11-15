/**
 * write-prepared-request.test.ts – the request we hand to somebody else.
 *
 * In the embedded setup the browser performs the write with the visitor's own
 * session, and this server only says WHAT to send. That makes the descriptor a
 * trust boundary in a way an internal URL never was: whatever comes out of here
 * is what a foreign page will execute with the user's rights.
 *
 * Hence the one rule pinned hardest below — a prepared request may only ever
 * address the configured repository. The prefix trap (`/edu-sharing-evil`
 * starting with `/edu-sharing`) is in here because a plain `startsWith` passes
 * it, and that mistake would turn the executor into a general-purpose relay.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toRepositoryPath } from '../src/services/write/prepared-request.js';

const REPO = 'https://repo.example/edu-sharing';

test('an address inside the repository becomes an origin-relative path', () => {
  assert.equal(
    toRepositoryPath(`${REPO}/rest/collection/v1/collections/-home-/abc/children`, REPO),
    '/edu-sharing/rest/collection/v1/collections/-home-/abc/children',
  );
});

test('the query string survives', () => {
  assert.equal(
    toRepositoryPath(`${REPO}/rest/node/v1/nodes/-home-/x?versionComment=a%20b`, REPO),
    '/edu-sharing/rest/node/v1/nodes/-home-/x?versionComment=a%20b',
  );
});

test('percent-encoding is carried through unchanged', () => {
  // Node ids reach us encoded; re-encoding or decoding here would address a
  // different record than the one the preview showed.
  assert.equal(
    toRepositoryPath(`${REPO}/rest/collection/v1/collections/-home-/a%2Fb/references/c%3Ad`, REPO),
    '/edu-sharing/rest/collection/v1/collections/-home-/a%2Fb/references/c%3Ad',
  );
});

test('the repository root itself is a valid path', () => {
  assert.equal(toRepositoryPath(REPO, REPO), '/edu-sharing');
});

test('another host is refused', () => {
  assert.throws(() => toRepositoryPath('https://evil.example/edu-sharing/rest/x', REPO), /repository/i);
});

test('another port on the same host is refused', () => {
  assert.throws(() => toRepositoryPath('https://repo.example:8443/edu-sharing/rest/x', REPO), /repository/i);
});

test('http against an https repository is refused', () => {
  assert.throws(() => toRepositoryPath('http://repo.example/edu-sharing/rest/x', REPO), /repository/i);
});

test('a path beside the repository is refused', () => {
  assert.throws(() => toRepositoryPath('https://repo.example/other/rest/x', REPO), /repository/i);
});

test('a path that merely starts with the repository prefix is refused', () => {
  // The trap: `/edu-sharing-evil` passes `startsWith('/edu-sharing')`.
  assert.throws(() => toRepositoryPath('https://repo.example/edu-sharing-evil/rest/x', REPO), /repository/i);
});

test('something that is not an absolute address is refused', () => {
  assert.throws(() => toRepositoryPath('/edu-sharing/rest/x', REPO), /absolute/i);
});
