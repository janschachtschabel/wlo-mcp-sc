/**
 * metrics-codes.test.ts – what the metrics say about HOW a tool call failed,
 * how long a call waited at the upstream gate, and how full the bounded stores
 * are.
 *
 * The rule under test is the module's own: a label value comes from OUR code.
 * An error code is text a tool put into its answer — a fixed set today, but
 * nothing stops a future tool from building one out of a caller's input, so
 * the label is an allow-list and everything else is `other`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { ServerResponse } from 'node:http';

import {
  TOOL_ERROR_CODES, countToolError, observe, count, renderMetrics, resetMetricsForTest, toolErrorCode,
} from '../src/metrics.js';
import { writeMetrics } from '../src/rest/metrics-route.js';
import type { FailureCode } from '../src/services/failure-code.js';

const errorResult = (code: unknown) => ({ isError: true, structuredContent: { error: { code, message: 'x' } } });

test('toolErrorCode: a known code is itself, an unknown one is "other"', () => {
  assert.equal(toolErrorCode(errorResult('upstream_busy')), 'upstream_busy');
  assert.equal(toolErrorCode(errorResult('confirm_expired')), 'confirm_expired');
  assert.equal(toolErrorCode(errorResult('made_up_by_a_caller')), 'other');
  assert.equal(toolErrorCode(errorResult('x"} 1\nwlo_fake_total 9')), 'other', 'never a caller-shaped string as a label');
});

test('toolErrorCode: an error without a usable code is "uncoded", a success is nothing', () => {
  assert.equal(toolErrorCode({ isError: true }), 'uncoded');
  assert.equal(toolErrorCode(errorResult(42)), 'uncoded');
  assert.equal(toolErrorCode({ isError: true, structuredContent: { error: 'text' } }), 'uncoded');
  assert.equal(toolErrorCode({ content: [] }), null);
  assert.equal(toolErrorCode({ isError: false, structuredContent: { error: { code: 'timeout' } } }), null);
  assert.equal(toolErrorCode(undefined), null);
});

test('every failure code the read tools answer with is a label of its own', () => {
  // Typed against the union: a code added to `FailureCode` fails to compile
  // here until it is listed, instead of silently counting as "other".
  const all: Record<FailureCode, true> = {
    timeout: true, forbidden: true, not_found: true, upstream_busy: true, upstream_error: true,
  };
  for (const code of Object.keys(all)) assert.ok(TOOL_ERROR_CODES.has(code), code);
});

test('countToolError counts by tool and code — and nothing for a success', () => {
  resetMetricsForTest();
  countToolError('search_wlo_all', errorResult('timeout'));
  countToolError('search_wlo_all', errorResult('timeout'));
  countToolError('search_wlo_all', errorResult('who knows'));
  countToolError('search_wlo_all', { content: [] });
  const text = renderMetrics();
  assert.match(text, /# TYPE wlo_tool_errors_total counter/);
  assert.match(text, /wlo_tool_errors_total\{tool="search_wlo_all",code="timeout"\} 2/);
  assert.match(text, /wlo_tool_errors_total\{tool="search_wlo_all",code="other"\} 1/);
  assert.equal(text.match(/^wlo_tool_errors_total/gm)?.length, 2);
});

test('the gate wait and the limiter refusals are declared metrics', () => {
  resetMetricsForTest();
  observe('wlo_upstream_gate_wait_seconds', { outcome: 'granted' }, 0.2);
  count('wlo_rate_limited_total', { limiter: 'mcp' });
  const text = renderMetrics();
  assert.match(text, /# TYPE wlo_upstream_gate_wait_seconds histogram/);
  assert.match(text, /wlo_upstream_gate_wait_seconds_bucket\{outcome="granted",le="0\.25"\} 1/);
  assert.match(text, /wlo_rate_limited_total\{limiter="mcp"\} 1/);
});

function scrape(): string {
  let body = '';
  const res = new PassThrough() as unknown as ServerResponse & { writeHead: unknown };
  (res as unknown as { writeHead: () => void }).writeHead = () => {};
  (res as unknown as { end: (text: string) => void }).end = (text: string) => { body = text; };
  writeMetrics(res);
  return body;
}

test('the bounded stores report their size at scrape time, as gauges', () => {
  const text = scrape();
  for (const name of ['wlo_skill_registry_cache_entries', 'wlo_fulltext_held_bytes']) {
    assert.match(text, new RegExp(`# TYPE ${name} gauge`), name);
    assert.match(text, new RegExp(`^${name} \\d+$`, 'm'), `${name} carries a number and no label`);
  }
});

test('every gauge line has HELP and TYPE, and no name is rendered twice', () => {
  const text = scrape();
  const typed = [...text.matchAll(/^# TYPE (\S+) /gm)].map(m => m[1]!);
  assert.equal(new Set(typed).size, typed.length, 'a metric declared twice is rejected by a scraper');
  const helped = new Set([...text.matchAll(/^# HELP (\S+) /gm)].map(m => m[1]!));
  for (const name of typed) assert.ok(helped.has(name), `${name} has no HELP`);
});
