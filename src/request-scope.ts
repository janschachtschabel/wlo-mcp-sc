/**
 * request-scope.ts – whether anybody is still waiting for the work in hand.
 *
 * One inbound request fans out into many upstream calls (a search with the OER
 * filter: about 25). When the client hangs up, those calls used to run to their
 * end, and the ones not yet started were still started — work for an answer
 * that has nowhere to go (audit 2026-11-12, P-1 and P-3). The inbound request's
 * abort signal is therefore carried in an `AsyncLocalStorage`, and `wloFetch`
 * honours it.
 *
 * NOT for writes. An abort hits the RESPONSE, not the work: the repository
 * finishes a mutation it has received, and what an aborted write loses is our
 * read-back and the stored result a re-presented key replays. So everything
 * that changes data runs `detachedFromRequest` — once a write has begun, it and
 * its verification run to their end whether or not the caller is still there.
 *
 * A leaf module: `wlo-fetch.ts`, `http-app.ts` and the tool layer all need it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Scope markers beside a request's signal: work that writes, and a read several callers share. */
const DETACHED = Symbol('detached');
const SHARED = Symbol('shared');

const scope = new AsyncLocalStorage<AbortSignal | typeof DETACHED | typeof SHARED>();

/**
 * Why work for a request was stopped: its client is gone. A class of its own so
 * the places that LOG a failure can tell it from one — a hang-up is ordinary,
 * and a traversal of a hundred collections must not write a hundred warnings
 * and an error for it. Deliberately not named `AbortError`, and its message
 * says neither "abort" nor "timeout": `isUpstreamTimeout` reads both, and a
 * hang-up is not an open outcome of anything.
 */
export class ClientGoneError extends Error {
  override name = 'ClientGoneError';
  constructor() { super('the client closed the connection'); }
}

/** Whether `err` is the hang-up of the request's own client. */
export function isClientGone(err: unknown): boolean {
  return err instanceof ClientGoneError;
}

/** Run `fn` on behalf of an inbound request; `signal` aborts when its client is gone. */
export function runWithRequestSignal<T>(signal: AbortSignal, fn: () => T): T {
  return scope.run(signal, fn);
}

let detached = 0;

/**
 * Run `fn` so that it survives the caller hanging up. For anything that writes.
 *
 * Counted while it runs: detached work has, by definition, nobody waiting on a
 * connection for it, so a shutdown that looked at connections would exit in the
 * middle of it (`shutdown.ts`).
 */
export function detachedFromRequest<T>(fn: () => T): T {
  detached++;
  let result: T;
  try {
    result = scope.run(DETACHED, fn);
  } catch (err) {
    detached--;
    throw err;
  }
  if (result instanceof Promise) {
    const done = (): void => { detached--; };
    result.then(done, done);
  } else {
    detached--;
  }
  return result;
}

/**
 * Run `fn` outside any request scope WITHOUT counting it as work in hand: for
 * shared background reads (a cache lookup several callers wait on). One caller
 * hanging up must not fail the others — but a shutdown need not wait for it.
 */
export function sharedAcrossRequests<T>(fn: () => T): T {
  return scope.run(SHARED, fn);
}

/** How much detached work is running right now. */
export function detachedWorkInFlight(): number {
  return detached;
}

/** The signal of the request this code runs for, if it has one and is bound to it. */
export function currentRequestSignal(): AbortSignal | undefined {
  const store = scope.getStore();
  return store instanceof AbortSignal ? store : undefined;
}

/**
 * Whether the code running now is detached WORK — a write. The upstream gate
 * asks: a write is never turned away from its queue (`upstream-gate.ts`).
 */
export function isDetachedWork(): boolean {
  return scope.getStore() === DETACHED;
}
