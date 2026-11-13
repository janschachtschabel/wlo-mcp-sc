/**
 * metrics.ts – counters in the Prometheus text format, without a dependency.
 *
 * What the process could not say without grepping its own JSON lines: how many
 * requests, tool calls and repository calls there were and how they ended
 * (audit 2026-11-12, B-5). Deliberately small — counters and sum/count pairs,
 * no histograms: the questions are "is it failing" and "which tool", and a
 * bucket layout nobody tuned answers neither.
 *
 * Two rules for whoever adds a metric:
 *
 *   - A label value comes from OUR code (a route class, a tool name, a status
 *     class), never from the caller. A path, a query or a user name as a label
 *     is unbounded memory and a log of who did what.
 *   - It is declared in `METRICS` below. An undeclared name throws in tests
 *     rather than appearing without HELP/TYPE.
 */

type Kind = 'counter' | 'summary';

const METRICS: Record<string, { kind: Kind; help: string }> = {
  wlo_http_requests_total: { kind: 'counter', help: 'Inbound HTTP requests by route class and status ("aborted": the client hung up first).' },
  wlo_tool_calls_total: { kind: 'counter', help: 'MCP tool calls by tool and outcome (ok, error = answered with isError, thrown).' },
  wlo_tool_duration_seconds: { kind: 'summary', help: 'Time spent in tool handlers.' },
  wlo_upstream_requests_total: { kind: 'counter', help: 'Calls to the repository by outcome (status class, error = no answer, cancelled = our caller hung up, shed = not sent, our own limit).' },
};

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

/** Record one duration: a `_sum` / `_count` pair, enough for a mean and a rate. */
export function observe(name: string, labels: Record<string, string>, seconds: number): void {
  declared(name, 'summary');
  add(`${name}_sum`, labels, seconds);
  add(`${name}_count`, labels, 1);
}

/** Everything counted so far, grouped by metric with its HELP and TYPE lines. */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, { kind, help }] of Object.entries(METRICS)) {
    const mine = [...values].filter(([key]) => {
      const base = key.split('{')[0]!;
      return kind === 'counter' ? base === name : base === `${name}_sum` || base === `${name}_count`;
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
