/**
 * logger.ts – Minimal structured logger.
 *
 * Emits one JSON object per line. The field names are the ones the service
 * guide (Team 6) asks every service for — `timestamp`, `level`, `service`,
 * `message`, and `trace_id` / `span_id` when the caller named a trace — so one
 * query works across services (chatbot feedback 2026-11-13, D8).
 *
 * WHERE the line goes depends on the transport, and the default is the safe
 * one: **stderr**. Under stdio, stdout carries the MCP JSON-RPC framing, and a
 * log line there corrupts the protocol. Only the HTTP entry point moves the log
 * to stdout (`logger-stdout.ts`, its first import), where a container platform
 * expects it.
 *
 * `LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default `info`) drops
 * everything below it. No line is written at `debug` today; the name is
 * accepted so a deployment template need not special-case this service.
 *
 * No dependency — deliberately tiny. If richer logging is ever needed
 * (sampling, transports, redaction), swap this module out.
 */

import { currentRequestId, currentTraceFields } from './request-id.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type Level = Exclude<LogLevel, 'debug'>;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** A level name as an operator writes it, or null when it is none — the caller says so, nothing is guessed. */
export function logLevelFrom(raw: string | undefined): LogLevel | null {
  const name = (raw ?? '').trim().toLowerCase();
  return name in RANK ? (name as LogLevel) : null;
}

const fromEnv = (): LogLevel => logLevelFrom(process.env['LOG_LEVEL']) ?? 'info';

let threshold = RANK[fromEnv()];
let sink: 'stderr' | 'stdout' = 'stderr';

/** Send every line to stdout. For the HTTP entry point ONLY — under stdio that is the protocol channel. */
export function logToStdout(): void {
  sink = 'stdout';
}

export function setLogLevel(level: LogLevel): void {
  threshold = RANK[level];
}

export function resetLoggerForTest(): void {
  sink = 'stderr';
  threshold = RANK[fromEnv()];
}

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (RANK[level] < threshold) return;
  const head = { timestamp: new Date().toISOString(), level, service: 'wlo-mcp', message };
  // Which request caused this line (audit 2026-11-12, B-5). AFTER the fields, so
  // none of them can overwrite it; absent at startup, in timers and under stdio.
  const req = currentRequestId();
  const tail = req ? { req, ...currentTraceFields() } : {};
  let line: string;
  try {
    line = JSON.stringify({ ...head, ...fields, ...tail });
  } catch (err) {
    // Logging runs in failure paths, so it must never become the failure. A
    // field that cannot be serialised (circular reference, BigInt) costs the
    // fields, not the record — and the reason is written where it is findable.
    line = JSON.stringify({ ...head, logError: err instanceof Error ? err.message : String(err), ...tail });
  }
  (sink === 'stdout' ? process.stdout : process.stderr).write(line + '\n');
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
