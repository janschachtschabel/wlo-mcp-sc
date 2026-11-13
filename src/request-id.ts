/**
 * request-id.ts – one id per inbound request, on every log line it causes.
 *
 * A search fans out into a dozen upstream calls and two requests interleave, so
 * a log without this answers "what happened" and never "what happened to THAT
 * request" (audit 2026-11-12, B-5). The id is also answered as `X-Request-Id`,
 * which turns "it failed at 14:02" into a line that can be found.
 *
 * Its own store, apart from `request-scope.ts`: that one says whether anybody
 * still WAITS, and a write deliberately leaves it (`detachedFromRequest`). The
 * id must survive exactly there — the write is the part worth tracing.
 *
 * A leaf module (node built-ins only): the logger imports it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/**
 * What a caller sent to follow its request across services (chatbot feedback
 * 2026-11-13, W5): its own trace id, and the B3 headers of a tracing system.
 * Read, validated, logged and handed on to the repository — never invented:
 * a trace this server started would be a second trace, not theirs.
 */
export interface TraceContext {
  /** `x-client-trace-id`. */
  clientTraceId?: string;
  /** B3: the trace the caller is in, the caller's own span, and its sampling decision. */
  b3?: { traceId: string; spanId: string; sampled?: string };
}

interface Scope { id: string; trace: TraceContext }

const store = new AsyncLocalStorage<Scope>();

/** A plain token. Anything else in a caller's header is somebody writing into our log. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;
const SAFE_TRACE = /^[A-Za-z0-9._:-]{1,128}$/;
const HEX_TRACE = /^(?:[0-9a-f]{16}|[0-9a-f]{32})$/;
const HEX_SPAN = /^[0-9a-f]{16}$/;

type Header = string | string[] | undefined;
const one = (h: Header): string => (typeof h === 'string' ? h.trim() : '');

/**
 * The trace context of a request, from its headers. B3 is read in both
 * spellings — the single `b3: traceid-spanid[-sampled[-parent]]` and the four
 * `X-B3-*` — and only when it is well-formed hex: these values go into every
 * log line and on to the repository.
 */
export function traceFrom(headers: Record<string, Header>): TraceContext {
  const trace: TraceContext = {};
  const client = one(headers['x-client-trace-id']);
  if (SAFE_TRACE.test(client)) trace.clientTraceId = client;

  const single = one(headers['b3']).toLowerCase().split('-');
  const traceId = (single.length >= 2 ? single[0]! : one(headers['x-b3-traceid']).toLowerCase());
  const spanId = (single.length >= 2 ? single[1]! : one(headers['x-b3-spanid']).toLowerCase());
  const sampled = single.length >= 3 ? single[2]! : one(headers['x-b3-sampled']);
  if (HEX_TRACE.test(traceId) && HEX_SPAN.test(spanId)) {
    trace.b3 = { traceId, spanId, ...(/^[01d]$/.test(sampled) ? { sampled } : {}) };
  }
  return trace;
}

/**
 * The headers to hand on with a call that continues this request: the caller's
 * trace id unchanged, and B3 as a CHILD span — same trace, a fresh span id, the
 * caller's span as its parent.
 */
export function outgoingTraceHeaders(): Record<string, string> {
  const trace = store.getStore()?.trace;
  if (!trace) return {};
  const out: Record<string, string> = {};
  if (trace.clientTraceId) out['x-client-trace-id'] = trace.clientTraceId;
  if (trace.b3) {
    out['X-B3-TraceId'] = trace.b3.traceId;
    out['X-B3-ParentSpanId'] = trace.b3.spanId;
    out['X-B3-SpanId'] = randomBytes(8).toString('hex');
    if (trace.b3.sampled) out['X-B3-Sampled'] = trace.b3.sampled;
  }
  return out;
}

/** What the logger adds to a line: the trace the request belongs to, when the caller named one. */
export function currentTraceFields(): Record<string, string> {
  const trace = store.getStore()?.trace;
  if (!trace) return {};
  return {
    ...(trace.b3 ? { trace_id: trace.b3.traceId, span_id: trace.b3.spanId } : {}),
    ...(trace.clientTraceId ? { client_trace_id: trace.clientTraceId } : {}),
  };
}

/**
 * The id for a request: the caller's own `X-Request-Id` when it is a plain
 * token (a chatbot backend can then follow its call through our log), a fresh
 * one otherwise. Never trusted for anything — it is a label.
 */
export function requestIdFrom(header: string | string[] | undefined): string {
  return typeof header === 'string' && SAFE_ID.test(header) ? header : randomBytes(8).toString('hex');
}

export function runWithRequestId<T>(id: string, fn: () => T, trace: TraceContext = {}): T {
  return store.run({ id, trace }, fn);
}

/** The id of the request this code runs for — undefined at startup, in timers and under stdio. */
export function currentRequestId(): string | undefined {
  return store.getStore()?.id;
}
