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
 * Read, validated, logged and handed on to the repository. A caller's trace is
 * never replaced — a second trace beside theirs would split what they follow.
 * Only a request that names NO B3 trace gets one started here
 * (`traceForRequest`), so every log line of every request carries `trace_id`.
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

  // The single header wins only when its ids are well-formed; a `b3` that says
  // nothing usable must not hide the caller's `X-B3-*` beside it.
  const single = one(headers['b3']).toLowerCase().split('-');
  const usable = single.length >= 2 && HEX_TRACE.test(single[0]!) && HEX_SPAN.test(single[1]!);
  const traceId = usable ? single[0]! : one(headers['x-b3-traceid']).toLowerCase();
  const spanId = usable ? single[1]! : one(headers['x-b3-spanid']).toLowerCase();
  if (HEX_TRACE.test(traceId) && HEX_SPAN.test(spanId)) {
    const sampled = samplingFrom(headers);
    trace.b3 = { traceId, spanId, ...(sampled ? { sampled } : {}) };
  }
  return trace;
}

/**
 * The caller's sampling decision, wherever it stands: `0` / `1` / `d` in the
 * single header (alone — `b3: 0` — or as its third part), `X-B3-Flags: 1`
 * (debug, the multi-header spelling of `d`), or `X-B3-Sampled`. Each candidate
 * is checked on its own, so an unusable one does not hide the next.
 */
function samplingFrom(headers: Record<string, Header>): string | undefined {
  const single = one(headers['b3']).toLowerCase().split('-');
  const candidates = [
    single.length === 1 ? single[0]! : single[2] ?? '',
    one(headers['x-b3-flags']) === '1' ? 'd' : '',
    one(headers['x-b3-sampled']),
  ];
  return candidates.find(c => /^[01d]$/.test(c));
}

/**
 * The trace context a request runs under: the caller's B3 trace when it sent a
 * well-formed one, otherwise a trace started here (platform guide, logging and
 * tracing: "read the B3 headers, hand them on, otherwise create a trace id").
 * No sampling decision is made here; one the caller sent WITHOUT ids (`b3: 0`,
 * or `X-B3-Sampled` alone — B3's "do not trace this") is carried into the
 * started trace, so it reaches the repository.
 *
 * In the log, `span_id` is then this server's root span; for a caller's trace
 * it is the caller's span (the parent of what is handed on).
 */
export function traceForRequest(headers: Record<string, Header>): TraceContext {
  const trace = traceFrom(headers);
  if (!trace.b3) {
    const sampled = samplingFrom(headers);
    trace.b3 = {
      traceId: randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      ...(sampled ? { sampled } : {}),
    };
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
    // Debug is a flag in the multi-header form, not a value of `X-B3-Sampled`.
    if (trace.b3.sampled === 'd') out['X-B3-Flags'] = '1';
    else if (trace.b3.sampled) out['X-B3-Sampled'] = trace.b3.sampled;
  }
  return out;
}

/** What the logger adds to a line: the trace the request belongs to — the caller's, or the one started for it. */
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
