import { test } from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/logger.js';

test('log.warn emits one JSON line to stderr with level/name/msg/fields', () => {
  const real = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: any) => { captured.push(String(chunk)); return true; }) as any;
  try {
    log.warn('something failed', { itemId: 42 });
  } finally {
    process.stderr.write = real;
  }
  assert.equal(captured.length, 1);
  const line = captured[0];
  assert.ok(line.endsWith('\n'), 'should be newline-terminated');
  const obj = JSON.parse(line);
  assert.equal(obj.level, 'warn');
  assert.equal(obj.name, 'wlo-mcp');
  assert.equal(obj.msg, 'something failed');
  assert.equal(obj.itemId, 42);
  assert.equal(typeof obj.ts, 'string');
});

test('logger writes only to stderr, never stdout (reserved for MCP stdio framing)', () => {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let stdoutCalls = 0;
  const errLines: string[] = [];
  process.stdout.write = (() => { stdoutCalls++; return true; }) as any;
  process.stderr.write = ((c: any) => { errLines.push(String(c)); return true; }) as any;
  try {
    log.info('listening');
    log.error('boom', { code: 'E1' });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  assert.equal(stdoutCalls, 0, 'logger must not write to stdout');
  assert.equal(errLines.length, 2);
  assert.equal(JSON.parse(errLines[0]).level, 'info');
  assert.equal(JSON.parse(errLines[1]).level, 'error');
  assert.equal(JSON.parse(errLines[1]).code, 'E1');
});
