/**
 * tools/curation-replay.ts – the tool seam of the safe retry (plan 2026-11-07,
 * S3; the store and its rules are `services/write/confirm-replay.ts`).
 *
 * `registerCurationTool` asks here before a call carrying a `confirmToken`
 * reaches its handler: a key already redeemed by the same identity with the
 * same arguments answers with the first call's result, marked `replayed`, or —
 * while that call still works — with `inProgress`. Everything else runs the
 * handler inside a replay context, so the confirm path can mark the redemption
 * and the result is kept for the next presentation.
 */

import type { WloToolResult } from '../apps/register.js';
import { log } from '../logger.js';
import { currentIdentity } from '../services/write/confirm.js';
import {
  argsHash, completeReplay, lookupReplay, redeemedInCall, type ReplayLookup, withReplayContext,
} from '../services/write/confirm-replay.js';
import { codedErrorResult } from './shared.js';

const REPLAYED_NOTICE = 'Dieser Bestätigungsschlüssel wurde schon eingelöst — hier die Antwort von damals. '
  + 'Es wurde nichts erneut geschrieben.';
/** A prepared request is executed by the PAGE, so "nothing written" would be the wrong comfort. */
const REPLAYED_PREPARED_NOTICE = 'Dieser Bestätigungsschlüssel wurde schon eingelöst — hier dieselbe vorbereitete '
  + 'Anfrage wie beim ersten Mal. Sie nur ausführen, wenn sie noch nicht ausgeführt wurde.';
const KEY_SPENT = 'Der Bestätigungsschlüssel ist damit verbraucht — derselbe Aufruf bekäme nur diese Antwort noch '
  + 'einmal.';
/**
 * `outcomeOpen: true`: a new preview over a write that DID land is how a
 * duplicate is made (chatbot feedback, finding 4). It says "may", never "is
 * open": the report above it often states exactly what landed, and a sentence
 * calling that unknown contradicts it (review 2026-11-07).
 */
const LOOK_FIRST = 'Es kann bereits etwas geschrieben sein — vor einem neuen Versuch in WLO nachsehen, was schon '
  + 'angekommen ist, sonst entsteht womöglich eine Dublette. Erst danach den Aufruf ohne confirmToken senden und die '
  + 'neue Vorschau bestätigen.';
const NOTHING_WRITTEN = 'Es wurde nichts geschrieben. Für einen neuen Versuch den Aufruf ohne confirmToken senden '
  + 'und die neue Vorschau bestätigen.';

/** The first call's answer again, marked so a program and a person can tell. */
function replayed(result: unknown): WloToolResult {
  const r = result as WloToolResult;
  const prepared = Boolean((r.structuredContent as Record<string, unknown> | undefined)?.['preparedRequest']);
  return {
    ...r,
    // First block: some clients hand the model only block 0 (measured 2026-08-19).
    content: [{ type: 'text' as const, text: prepared ? REPLAYED_PREPARED_NOTICE : REPLAYED_NOTICE },
      ...(r.content ?? [])],
    structuredContent: { ...(r.structuredContent ?? {}), replayed: true },
  };
}

/**
 * An ERROR answered after the key was redeemed: the same call can only ever
 * replay it, so it must not invite one. `retryAfter` goes (it would say "send
 * this again in N s"), `requiresNewPreview` comes (review 2026-11-07: a busy
 * duplicate check after redemption was kept as "upstream_busy, retry in 10 s"
 * for half an hour).
 *
 * `requiresNewPreview` says only that THIS key is spent — never whether
 * anything was written. That is `outcomeOpen`, and it is now on EVERY error
 * after redemption (chatbot feedback 2026-11-07, finding 4): a client that read
 * `requiresNewPreview` as "nothing happened" previewed again over a
 * `not_visible`/`unverified` write and created a duplicate. `true` unless the
 * handler said `false` itself — past redemption the write may have run, and
 * only the code that knows it did not may say so. An error with no code at
 * all gets `unverified`, so a program never meets an error it cannot branch on.
 */
function keySpent(result: WloToolResult): WloToolResult {
  const sc = (result.structuredContent ?? {}) as Record<string, unknown>;
  const { retryAfter: _dropped, ...error } = (sc['error'] ?? {}) as Record<string, unknown>;
  void _dropped;
  const outcomeOpen = error['outcomeOpen'] !== false;
  return {
    ...result,
    content: [...(result.content ?? []),
      { type: 'text' as const, text: `${KEY_SPENT} ${outcomeOpen ? LOOK_FIRST : NOTHING_WRITTEN}` }],
    structuredContent: {
      ...sc,
      error: { code: 'unverified', ...error, outcomeOpen, requiresNewPreview: true },
    },
  };
}

/** Not an error: the work is happening, and asking again shortly gets its answer. */
function inProgress(): WloToolResult {
  return {
    content: [{ type: 'text' as const, text: 'Dieser Bestätigungsschlüssel wird gerade ausgeführt. Bitte denselben '
      + 'Aufruf gleich noch einmal senden — dann kommt das Ergebnis, ohne dass erneut geschrieben wird.' }],
    structuredContent: { inProgress: true },
  };
}

const MISMATCH_TEXT = 'Dieser Bestätigungsschlüssel wurde schon für andere Angaben eingelöst. Es wurde nichts '
  + 'geschrieben. Für eine neue Änderung bitte den Aufruf ohne confirmToken wiederholen und die Vorschau bestätigen.';

/** The answer a replay lookup stands for, or null when there is nothing to replay. */
export function replayAnswer(found: ReplayLookup): WloToolResult | null {
  switch (found.kind) {
    case 'done': return replayed(found.result);
    case 'running': return inProgress();
    case 'mismatch': return codedErrorResult('confirm_mismatch', MISMATCH_TEXT);
    default: return null;
  }
}

/**
 * Run a curation handler with replay: an earlier redemption of this key answers
 * at once; otherwise the handler runs in a replay context and its result is
 * kept if — and only if — it redeemed the key.
 */
export async function runWithReplay(
  token: string, args: Record<string, unknown>, run: () => Promise<WloToolResult>,
): Promise<WloToolResult> {
  const earlier = replayAnswer(lookupReplay(token, currentIdentity(), argsHash(args)));
  if (earlier) return earlier;
  return withReplayContext(token, args, async () => {
    let result: WloToolResult;
    try {
      const raw = await run();
      result = redeemedInCall() && raw.isError ? keySpent(raw) : raw;
    } catch (err) {
      // Before redemption nothing was written and nothing is kept: the throw
      // goes on and a retry reaches the tool again.
      if (!redeemedInCall()) throw err;
      // After it the write may have happened. Dropping the entry would answer
      // the retry `confirm_unknown` "nichts geschrieben" (review 2026-11-07), so
      // the open outcome is answered — now and on every retry.
      log.error('confirmed write threw after its key was redeemed', {
        error: err instanceof Error ? err.message : String(err),
      });
      result = keySpent(codedErrorResult('upstream_error',
        'Der Aufruf brach nach der Bestätigung ab. Ob die Änderung geschrieben wurde, ist offen — bitte in WLO '
          + 'nachsehen, bevor sie wiederholt wird.', { outcomeOpen: true }));
    }
    completeReplay(result);
    return result;
  });
}
