/**
 * env.ts – set environment variables for ONE test and put the originals back after it.
 *
 * Node runs `t.after` hooks first-in, first-out, so a helper that registers one
 * restore per call puts back the value from before its LAST call when a test
 * sets the same key twice — and the test leaks it (review 2026-11-18). Here the
 * value from before a key's FIRST change is kept, and restored once.
 */

/** Per test, the values the environment had before its first change. */
const originals = new WeakMap<object, Map<string, string | undefined>>();

export function env(t: { after: (fn: () => void) => void }, values: Record<string, string | undefined>): void {
  let saved = originals.get(t);
  if (!saved) {
    const fresh = new Map<string, string | undefined>();
    originals.set(t, fresh);
    t.after(() => { for (const [k, v] of fresh) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    saved = fresh;
  }
  for (const k of Object.keys(values)) if (!saved.has(k)) saved.set(k, process.env[k]);
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
