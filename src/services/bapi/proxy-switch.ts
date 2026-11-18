/**
 * services/bapi/proxy-switch.ts – whether the b-api flow tools are on (2026-11-18).
 *
 * `WLO_BAPI_VIA_REPOSITORY` is the operator's word and always wins: `1` on
 * (without asking anything), `0` off. Unset, empty or `auto`, the HTTP server
 * asks the repository at start whether its b-api proxy answers
 * (`probeBapiProxy`) and registers the tools only when it does. Any other value
 * is off, with a warning — a typo must not switch on a writing surface.
 *
 * `present` and `absent` (only the measured 404) are kept for the life of the
 * process — a repository that gains the proxy needs a restart, or `1`. No
 * verdict keeps the tools off and asks again, 30 s, then doubling up to every
 * 10 min. `createMcpServer()` runs per HTTP request and reads the state each
 * time, so an answer that lands later counts from the next `tools/list` on.
 *
 * stdio never asks: it has no personal login, and the flow tools refuse every
 * call without one — in stdio `auto` is off, `1` registers them as before.
 * The detection is started ONLY from `http.ts`, never at import — a probe on
 * load would hit the network in every test (guarded in
 * `tests/shared-rule-discipline.test.ts`).
 */

import { isDisabledFlag, isEnabledFlag } from '../../env-flags.js';
import { log } from '../../logger.js';
import { droppedFlowNames, probeBapiProxy, type ProxyProbe } from './jobs.js';

export type BapiSwitch = 'on' | 'off' | 'auto';

/** The operator's switch, parsed. `unrecognised`: a value that is neither on, off nor auto (read as off). */
export function bapiSwitch(raw: string | undefined = process.env['WLO_BAPI_VIA_REPOSITORY']): { mode: BapiSwitch; unrecognised?: true } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'auto') return { mode: 'auto' };
  if (isEnabledFlag(v)) return { mode: 'on' };
  if (isDisabledFlag(v)) return { mode: 'off' };
  return { mode: 'off', unrecognised: true };
}

/** `pending` until the first probe answered (and for good where nobody asks: stdio). */
export type BapiProxyDetection = 'pending' | ProxyProbe;

let detected: BapiProxyDetection = 'pending';
let first: Promise<BapiProxyDetection> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped by the test reset: a probe from an earlier generation writes nothing. */
let generation = 0;

export function bapiProxyDetection(): BapiProxyDetection {
  return detected;
}

/** Are the flow tools on? Read on every `createMcpServer()`. */
export function bapiViaRepositoryEnabled(): boolean {
  const { mode } = bapiSwitch();
  return mode === 'auto' ? detected === 'present' : mode === 'on';
}

const RETRY_FIRST_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

/** How long to wait before asking again after the `attempt`-th answer without a verdict (0-based). */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(attempt, 20));
}

async function detect(attempt: number, gen: number): Promise<BapiProxyDetection> {
  const { result, status } = await probeBapiProxy();
  if (gen !== generation) return detected;
  if (result !== 'unknown') {
    detected = result;
    log.info(result === 'present'
      ? 'b-api flow tools on: the repository answers on its b-api proxy'
      : 'b-api flow tools off: the repository answers 404 on the b-api proxy path (WLO_BAPI_VIA_REPOSITORY=1 switches them on anyway)',
    { status });
    return detected;
  }
  detected = 'unknown';
  const wait = retryDelayMs(attempt);
  log.warn('b-api flow tools off for now: no verdict from the repository on its b-api proxy; asking again '
    + '(WLO_BAPI_VIA_REPOSITORY=1 or 0 decides without asking)',
    { ...(status ? { status } : {}), retryInMs: wait });
  retryTimer = setTimeout(() => { retryTimer = null; void detect(attempt + 1, gen); }, wait);
  retryTimer.unref?.();
  return detected;
}

/**
 * Say at start what is wrong with the two settings: a switch that is neither
 * on, off nor auto, and flow names that are no `namespace/id` (dropped). Its
 * own function because stdio, which never starts the detection, says it too.
 * Answers what it warned about.
 */
export function warnOnBapiSettings(): Array<'switch' | 'flows'> {
  const warned: Array<'switch' | 'flows'> = [];
  if (bapiSwitch().unrecognised) {
    log.warn('WLO_BAPI_VIA_REPOSITORY is neither 1, 0 nor auto — the b-api flow tools stay off');
    warned.push('switch');
  }
  const dropped = droppedFlowNames();
  if (dropped > 0) {
    log.warn('WLO_BAPI_FLOWS has entries that are empty or no flow name (namespace/id) — they are dropped', { dropped });
    warned.push('flows');
  }
  return warned;
}

/**
 * Start the detection (once) and answer the first probe's result. With the
 * switch set it asks nothing and says in the log what the operator decided.
 */
export function startBapiProxyDetection(): Promise<BapiProxyDetection> {
  if (first) return first;
  const warned = warnOnBapiSettings();
  const sw = bapiSwitch();
  if (sw.mode !== 'auto') {
    if (!warned.includes('switch')) log.info('b-api flow tools set by WLO_BAPI_VIA_REPOSITORY', { mode: sw.mode });
    first = Promise.resolve(detected);
    return first;
  }
  first = detect(0, generation);
  return first;
}

export function resetBapiProxyDetectionForTest(state: BapiProxyDetection = 'pending'): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  first = null;
  generation++;
  detected = state;
}
