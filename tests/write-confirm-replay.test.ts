/**
 * write-confirm-replay.test.ts – a redeemed confirmation key answers again with
 * the SAME result (plan 2026-11-07, S3).
 *
 * The chatbot loses an answer to a network error or its own deadline and sends
 * the very same call again. Before, that second call met a consumed key and got
 * `confirm_unknown` — "go and look in WLO". Now the first result is kept,
 * bound to the identity and to the call's ARGUMENTS (not the change set: after
 * the first write the preview reads the new state and differs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  argsHash, completeReplay, lookupReplay, markRedeemed, REPLAY_TTL_MS, withReplayContext,
} from '../src/services/write/confirm-replay.js';

const ARGS = { title: 'Optik', confirmToken: 't-1' };

test('argsHash ignores key order and sees every value', () => {
  assert.equal(argsHash({ a: 1, b: [1, { y: 2, x: 1 }] }), argsHash({ b: [1, { x: 1, y: 2 }], a: 1 }));
  assert.notEqual(argsHash({ a: 1 }), argsHash({ a: 2 }));
});

test('nothing is kept unless the key was actually redeemed inside the call', async () => {
  await withReplayContext('t-0', ARGS, async () => { completeReplay({ ok: 1 }); });
  assert.deepEqual(lookupReplay('t-0', 'maria', argsHash(ARGS), 0), { kind: 'none' },
    'a call that never redeemed its key leaves nothing — its retry must reach the handler');
});

test('redeemed → running while the call works, done with its result afterwards', async () => {
  const now = 1_000;
  await withReplayContext('t-1', ARGS, async () => {
    markRedeemed('t-1', 'maria', now);
    assert.deepEqual(lookupReplay('t-1', 'maria', argsHash(ARGS), now), { kind: 'running' });
    completeReplay({ answer: 'A' });
  });
  assert.deepEqual(lookupReplay('t-1', 'maria', argsHash(ARGS), now), { kind: 'done', result: { answer: 'A' } });
});

test('other arguments → mismatch; another identity → none; after the TTL → none', async () => {
  const now = 2_000;
  await withReplayContext('t-2', ARGS, async () => { markRedeemed('t-2', 'maria', now); completeReplay({ answer: 'B' }); });
  assert.deepEqual(lookupReplay('t-2', 'maria', argsHash({ ...ARGS, title: 'Akustik' }), now), { kind: 'mismatch' });
  assert.deepEqual(lookupReplay('t-2', 'otto', argsHash(ARGS), now), { kind: 'none' },
    'an answer is never handed to someone else');
  assert.deepEqual(lookupReplay('t-2', 'maria', argsHash(ARGS), now + REPLAY_TTL_MS + 1), { kind: 'none' });
  assert.equal(REPLAY_TTL_MS, 30 * 60 * 1000);
});

test('a redemption outside any call context records nothing', () => {
  markRedeemed('t-3', 'maria', 0);
  assert.deepEqual(lookupReplay('t-3', 'maria', argsHash(ARGS), 0), { kind: 'none' });
});

test('two calls racing past the seam: the second meets the redeemed key as replay, not unknown', async () => {
  // Both calls pass `registerCurationTool` before either redeems; only the
  // confirm path can tell the second that the key is being used by the first.
  const { buildChangeSet } = await import('../src/services/write/change-set.js');
  const { consumeToken, mintToken } = await import('../src/services/write/confirm.js');
  const cs = buildChangeSet('n-race', 'content', { 'cclom:title': ['a'] }, { 'cclom:title': ['b'] });
  const token = mintToken(cs);
  const args = { title: 'b', confirmToken: token };
  await withReplayContext(token, args, async () => { assert.equal(consumeToken(token, cs), 'ok'); });
  await withReplayContext(token, args, async () => { assert.equal(consumeToken(token, cs), 'replay'); });
  await withReplayContext(token, { ...args, title: 'c' }, async () => {
    assert.equal(consumeToken(token, cs), 'replay', 'other arguments still meet a used key; the seam answers mismatch');
  });
  assert.equal(consumeToken(token, cs), 'unknown', 'outside any call nothing is replayed');
});

test('replayAnswer maps the four lookups to the answers the seam gives', async () => {
  const { replayAnswer } = await import('../src/tools/curation-replay.js');
  assert.equal(replayAnswer({ kind: 'none' }), null);
  assert.deepEqual(replayAnswer({ kind: 'running' })?.structuredContent, { inProgress: true });
  assert.equal(replayAnswer({ kind: 'running' })?.isError, undefined, 'in progress is not an error');
  assert.equal((replayAnswer({ kind: 'mismatch' })?.structuredContent as { error: { code: string } }).error.code,
    'confirm_mismatch');
  const done = replayAnswer({ kind: 'done', result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { nodeId: 'x' } } });
  assert.deepEqual(done?.structuredContent, { nodeId: 'x', replayed: true });
  assert.match((done?.content[0] as { text: string }).text, /schon eingelöst/);
});

// ── review 2026-11-07 (S1–S7) ───────────────────────────────────────────────

test('a busy identity cannot push another person’s replay out', async () => {
  const now = 2_000_000;
  const mine = { title: 'meins', confirmToken: 'mine' };
  await withReplayContext('mine', mine, async () => { markRedeemed('mine', 'person', now); completeReplay({ a: 1 }); });
  for (let i = 0; i < 700; i++) {
    const args = { n: i, confirmToken: `busy-${i}` };
    await withReplayContext(`busy-${i}`, args, async () => { markRedeemed(`busy-${i}`, 'service', now); completeReplay({ i }); });
  }
  assert.deepEqual(lookupReplay('mine', 'person', argsHash(mine), now), { kind: 'done', result: { a: 1 } });
});

test('a call that throws AFTER redeeming answers with an OPEN outcome, and its retry replays that', async () => {
  const { runWithReplay } = await import('../src/tools/curation-replay.js');
  const { currentIdentity } = await import('../src/services/write/confirm.js');
  const args = { title: 'Wurf', confirmToken: 't-throw' };
  const first = await runWithReplay('t-throw', args, async () => {
    markRedeemed('t-throw', currentIdentity());
    throw new Error('nach dem Schreiben kaputt');
  });
  const error = (first.structuredContent as { error: Record<string, unknown> }).error;
  assert.equal(first.isError, true);
  assert.equal(error['outcomeOpen'], true, 'it may have written — never "nothing written"');
  assert.equal(error['requiresNewPreview'], true);
  const again = await runWithReplay('t-throw', args, async () => { throw new Error('must not run again'); });
  assert.equal((again.structuredContent as Record<string, unknown>)['replayed'], true);
});

test('an error answered AFTER redemption tells the client the key is spent — no retryAfter for the same call', async () => {
  const { runWithReplay } = await import('../src/tools/curation-replay.js');
  const { currentIdentity } = await import('../src/services/write/confirm.js');
  const args = { title: 'Voll', confirmToken: 't-busy' };
  const first = await runWithReplay('t-busy', args, async () => {
    markRedeemed('t-busy', currentIdentity());
    return { content: [{ type: 'text' as const, text: 'busy' }], isError: true,
      structuredContent: { error: { code: 'upstream_busy', retryAfter: 10, message: 'busy' } } };
  });
  const error = (first.structuredContent as { error: Record<string, unknown> }).error;
  assert.equal(error['code'], 'upstream_busy', 'the cause stays named');
  assert.equal(error['retryAfter'], undefined, 'the same call would only replay this answer');
  assert.equal(error['requiresNewPreview'], true);
  assert.match(first.content.map(b => (b as { text: string }).text).join(' '), /ohne confirmToken/);
});

test('a replayed PREPARED request says it is the same request, not that nothing was written', async () => {
  const { replayAnswer } = await import('../src/tools/curation-replay.js');
  const done = replayAnswer({ kind: 'done', result: { content: [], structuredContent: { preparedRequest: { method: 'PUT' } } } });
  assert.match((done?.content[0] as { text: string }).text, /nur ausführen, wenn/);
});
