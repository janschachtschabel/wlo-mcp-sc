import { test } from 'node:test';
import assert from 'node:assert/strict';

import { streamableHttpOptions } from '../src/mcp-transport.js';

test('defaults to JSON response mode when MCP_SSE is unset', () => {
  const opts = streamableHttpOptions({});
  assert.equal(opts.enableJsonResponse, true);
  assert.equal(opts.sessionIdGenerator, undefined);
});

test('MCP_SSE truthy switches to real SSE streaming (enableJsonResponse false)', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes']) {
    assert.equal(
      streamableHttpOptions({ MCP_SSE: v }).enableJsonResponse,
      false,
      `MCP_SSE=${v} should enable SSE streaming`,
    );
  }
});

test('MCP_SSE falsy keeps the default JSON response mode', () => {
  for (const v of ['', '0', 'off', 'no', 'false']) {
    assert.equal(
      streamableHttpOptions({ MCP_SSE: v }).enableJsonResponse,
      true,
      `MCP_SSE=${v} should keep JSON mode`,
    );
  }
});
