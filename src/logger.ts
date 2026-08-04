/**
 * logger.ts – Minimal structured logger.
 *
 * Emits one JSON object per line to **stderr**. stderr (never stdout) is used
 * on purpose: in stdio transport mode stdout carries the MCP JSON-RPC framing,
 * so any log written there would corrupt the protocol. JSON lines are also
 * greppable and ready for log aggregation.
 *
 * No dependency, no configuration — deliberately tiny. If richer logging is
 * ever needed (sampling, transports, redaction), swap this module out.
 */

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const head = { ts: new Date().toISOString(), level, name: 'wlo-mcp', msg };
  let line: string;
  try {
    line = JSON.stringify({ ...head, ...fields });
  } catch (err) {
    // Logging runs in failure paths, so it must never become the failure. A
    // field that cannot be serialised (circular reference, BigInt) costs the
    // fields, not the record — and the reason is written where it is findable.
    line = JSON.stringify({ ...head, logError: err instanceof Error ? err.message : String(err) });
  }
  process.stderr.write(line + '\n');
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
