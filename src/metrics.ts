/**
 * metrics.ts – counters in the Prometheus text format, without a dependency.
 *
 * What the process could not say without grepping its own JSON lines: how many
 * requests, tool calls and repository calls there were and how they ended
 * (audit 2026-11-12, B-5). Counters, and histograms for durations: the service
 * guide's alarm rules ask for quantiles, and a mean cannot tell "every call a
 * little slow" from "one call in twenty at the timeout" (D9, 2026-11-13).
 *
 * Two rules for whoever adds a metric:
 *
 *   - A label value comes from OUR code (a route class, a tool name, a status
 *     class), never from the caller. A path, a query or a user name as a label
 *     is unbounded memory and a log of who did what.
 *   - It is declared in `METRICS` below. An undeclared name throws in tests
 *     rather than appearing without HELP/TYPE.
 */

type Kind = 'counter' | 'histogram';

/**
 * ONE bucket layout for every duration, in seconds. Sized by what was measured
 * here, not by a default: reads answer in well under a second, a search fans
 * out to a few seconds, a `ccm:wwwurl` write takes up to 46 s and has a 60 s
 * budget. Past 60 s only `+Inf` counts — a held SSE stream, a plan slice.
 */
export const DURATION_BUCKETS_S = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60] as const;

const METRICS: Record<string, { kind: Kind; help: string }> = {
  wlo_http_requests_total: { kind: 'counter', help: 'Inbound HTTP requests by route class and status ("aborted": the client hung up first).' },
  wlo_tool_calls_total: { kind: 'counter', help: 'MCP tool calls by tool and outcome (ok, error = answered with isError, thrown).' },
  wlo_http_request_duration_seconds: { kind: 'histogram', help: 'Time from accepting a request to the end of its response, by route class (a held SSE stream counts in full).' },
  wlo_tool_duration_seconds: { kind: 'histogram', help: 'Time spent in tool handlers.' },
  wlo_upstream_requests_total: { kind: 'counter', help: 'Calls to the repository by outcome (status class, error = no answer, cancelled = our caller hung up, shed = not sent, our own limit).' },
  wlo_upstream_duration_seconds: { kind: 'histogram', help: 'Time until the repository answered (headers received), by outcome. Calls that were not sent are not timed.' },
  wlo_tool_errors_total: { kind: 'counter', help: 'MCP tool calls answered with isError, by tool and error code (a code outside the known set counts as "other", an error without one as "uncoded").' },
  wlo_upstream_gate_wait_seconds: { kind: 'histogram', help: 'Time a repository call waited for a slot at our own limit, by outcome (granted, shed = not sent). Calls that got a slot at once are not timed.' },
  wlo_rate_limited_total: { kind: 'counter', help: 'Requests refused by one of our own limiters, by limiter.' },
};

/**
 * The error codes that may appear as a label value. An ALLOW list, because the
 * code is read from a tool's answer and the rule above wants label values from
 * our code: every entry is a literal a tool or the write pipeline answers with
 * (`services/failure-code.ts` and the curation refusals). A code missing here
 * still counts — as `other` — so forgetting one costs detail, never memory.
 */
export const TOOL_ERROR_CODES: ReadonlySet<string> = new Set([
  // services/failure-code.ts — every read tool's `toolError`
  'timeout', 'forbidden', 'not_found', 'upstream_busy', 'upstream_error',
  // input and login
  'invalid_input', 'invalid_url', 'unresolved_filter', 'ambiguous_collection', 'too_many', 'too_large',
  'login_required', 'login_rejected', 'rate_limited', 'upstream_unreachable', 'internal_error',
  // the two-step confirmation and plans
  'confirm_mismatch', 'confirm_unknown', 'confirm_expired', 'plan_expired', 'plan_mismatch',
  // refusals before a write
  'refused', 'exists', 'duplicate', 'no_change', 'nothing_to_change', 'not_a_collection', 'not_a_record',
  'is_a_folder', 'is_a_collection', 'is_original', 'link_record', 'would_replace_file', 'not_visible',
  'not_checked', 'unreadable', 'unreadable_original', 'text_unreadable', 'changed_since_preview',
  'not_in_collection', 'access_denied', 'node_not_found', 'unsupported_type',
  // outcomes after a write
  'unverified', 'not_stored', 'not_removed', 'suggestion_not_marked', 'proposal_not_marked',
  'no_pending_proposal', 'already_submitted', 'already_proposed', 'already_decided',
]);

/**
 * The `code` label for a tool result: null for a success, otherwise the
 * answer's `structuredContent.error.code` when it is a known one, `other` for
 * any other string and `uncoded` when the error names none.
 */
export function toolErrorCode(result: unknown): string | null {
  const r = result as { isError?: unknown; structuredContent?: { error?: { code?: unknown } | null } | null } | null | undefined;
  if (r?.isError !== true) return null;
  const error = r.structuredContent?.error;
  const code = typeof error === 'object' && error !== null ? error.code : undefined;
  if (typeof code !== 'string' || !code) return 'uncoded';
  return TOOL_ERROR_CODES.has(code) ? code : 'other';
}

/** Count a tool result that is an error, by tool and code. A success counts nothing. */
export function countToolError(tool: string, result: unknown): void {
  const code = toolErrorCode(result);
  if (code !== null) count('wlo_tool_errors_total', { tool, code });
}

const values = new Map<string, number>();

/** Backslash, quote and newline — the three characters the format escapes in a label value. */
const escapeLabel = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

function series(name: string, labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

function add(name: string, labels: Record<string, string>, by: number): void {
  const key = series(name, labels);
  values.set(key, (values.get(key) ?? 0) + by);
}

function declared(name: string, kind: Kind): void {
  if (METRICS[name]?.kind !== kind) throw new Error(`metrics: "${name}" is not declared as a ${kind}`);
}

/** Count one event. */
export function count(name: string, labels: Record<string, string> = {}): void {
  declared(name, 'counter');
  add(name, labels, 1);
}

/** Record one duration: every bucket it fits into (cumulative), plus `_sum` and `_count`. */
export function observe(name: string, labels: Record<string, string>, seconds: number): void {
  declared(name, 'histogram');
  // `le` LAST and every bucket touched, also with 0: the series then exist from
  // the first observation on, in the order they are rendered.
  for (const le of DURATION_BUCKETS_S) add(`${name}_bucket`, { ...labels, le: String(le) }, seconds <= le ? 1 : 0);
  add(`${name}_bucket`, { ...labels, le: '+Inf' }, 1);
  add(`${name}_sum`, labels, seconds);
  add(`${name}_count`, labels, 1);
}

/** Everything counted so far, grouped by metric with its HELP and TYPE lines. */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, { kind, help }] of Object.entries(METRICS)) {
    const mine = [...values].filter(([key]) => {
      const base = key.split('{')[0]!;
      return kind === 'counter' ? base === name : base === `${name}_bucket` || base === `${name}_sum` || base === `${name}_count`;
    });
    if (!mine.length) continue;
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${kind}`);
    for (const [key, value] of mine) lines.push(`${key} ${value}`);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function resetMetricsForTest(): void {
  values.clear();
}
