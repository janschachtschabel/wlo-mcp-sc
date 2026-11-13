/**
 * shutdown.ts – what a stop signal does to the HTTP server.
 *
 * Without a handler Node, running as PID 1 in a container, IGNORES SIGTERM: the
 * kernel applies no default action to PID 1. Every `docker stop` — every deploy
 * — then waits out the grace period and ends in SIGKILL, cutting whatever is in
 * flight (audit 2026-11-12, B-1). For a confirmed write that is the worst
 * moment: the repository finishes the work and the caller never hears of it.
 *
 * On the first signal the server stops accepting connections and lets the WORK
 * in hand finish; then it closes what is left and exits `0`. Work that outlasts
 * `graceMs` is cut and the exit is `1`. A second signal ends the wait at once.
 *
 * It counts work, not connections, and the difference is the review of this
 * package (measured on node:http): a connection that never sent a request, or
 * half a header, is not "idle" to `closeIdleConnections` and held the exit for
 * the whole grace period, ending in a forced exit although nothing was cut —
 * and a client that hung up mid-request left no connection at all, so the exit
 * came while its write was still running. Work is: a request handler that has
 * not returned, a response not yet flushed, and anything running detached from
 * its request (`request-scope.ts` — the writes).
 *
 * Nothing else needs flushing: the access registry is written inside the
 * request that changes it and awaited before that request answers; the cache
 * and readiness timers hold no state worth saving. What IS lost with the
 * process is its memory — confirmation keys, stored results, plans.
 *
 * `proc` and `exit` are parameters so this is testable without signalling the
 * test runner. `http.ts` is the only caller.
 */

import type { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http';

import { log } from './logger.js';
import { detachedWorkInFlight } from './request-scope.js';

/**
 * How long work in hand may take to finish. The drain ends as soon as nothing
 * is running, so this costs time only when something really is: it is sized for
 * the slowest legitimate calls — a write that sets `ccm:wwwurl` (budget 60 s,
 * 46 s measured cold) and one slice of a plan (40 s plus its last wave) — which
 * are exactly the calls that must not be cut. The container's
 * `stop_grace_period` must be LONGER, or Docker kills the process while it is
 * still waiting (docker-compose.yml).
 */
export const SHUTDOWN_GRACE_MS = 70_000;

/** How often the drain looks whether the work is done. */
const DRAIN_POLL_MS = 100;

interface SignalSource {
  on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/** Counts the requests a listener is still working on — handler not returned, or answer not flushed. */
export interface RequestTracker {
  listener: RequestListener;
  active(): number;
}

/**
 * Wrap the server's request listener so the drain can ask how much work is in
 * hand. A request counts until its handler has returned AND its response has
 * left (or its connection is gone): a handler that returned has called
 * `res.end`, but the bytes may still be on their way.
 */
export function trackRequests(
  handler: (req: IncomingMessage, res: ServerResponse) => unknown,
): RequestTracker {
  let active = 0;
  return {
    active: () => active,
    listener: (req, res) => {
      active++;
      const answered = new Promise<void>(resolve => { res.once('close', resolve); });
      const handled = (async () => handler(req, res))().catch((err: unknown) => {
        log.error('request handler failed', { error: err instanceof Error ? err.message : String(err) });
      });
      void Promise.all([handled, answered]).then(() => { active--; });
    },
  };
}

export interface ShutdownOptions {
  server: Server;
  /** The tracker whose `listener` the server was created with. */
  requests: RequestTracker;
  graceMs?: number;
  /** `process`, or a stand-in. */
  proc?: SignalSource;
  /** `process.exit`, or a stand-in. Called exactly once. */
  exit?: (code: number) => void;
}

export function installGracefulShutdown(opts: ShutdownOptions): void {
  const { server, requests } = opts;
  const graceMs = opts.graceMs ?? SHUTDOWN_GRACE_MS;
  const proc: SignalSource = opts.proc ?? process;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const workInHand = (): number => requests.active() + detachedWorkInFlight();

  let stopping = false;
  let exited = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  /** Close whatever is still connected and leave. `cut` = work was still running. */
  const finish = (cut: boolean, why: string): void => {
    if (exited) return;
    exited = true;
    clearInterval(poll);
    clearTimeout(deadline);
    if (cut) log.warn('shutdown forced — work in hand was cut', { why, requests: requests.active(), detached: detachedWorkInFlight() });
    else log.info('shutdown complete', { why });
    server.closeAllConnections();
    exit(cut ? 1 : 0);
  };

  const onSignal = (signal: string) => (): void => {
    if (stopping) { finish(workInHand() > 0, `second signal (${signal})`); return; }
    stopping = true;
    log.info('shutdown requested — finishing work in hand', { signal, graceMs, requests: requests.active() });

    // Stops accepting. Not waited for: its callback fires when the last
    // CONNECTION ends, which is neither necessary nor sufficient for the work
    // being done (see the file header). Before `listen` it reports an error,
    // which changes nothing — there is no work then, and the check below ends it.
    server.close();

    const check = (): void => {
      if (workInHand() === 0) finish(false, 'nothing left in hand');
      // Kept-alive sockets between requests carry nothing; closing them early
      // tells their clients to reconnect elsewhere.
      else server.closeIdleConnections();
    };
    poll = setInterval(check, DRAIN_POLL_MS);
    deadline = setTimeout(() => finish(workInHand() > 0, `grace period of ${graceMs} ms elapsed`), graceMs);
    check();
  };

  proc.on('SIGTERM', onSignal('SIGTERM'));
  proc.on('SIGINT', onSignal('SIGINT'));
}
