/**
 * unsafe-tools.ts – The operator's off-switch for tools declared unsafe.
 *
 * A tool declares itself unsafe in its own definition (`WloToolDef.unsafe`)
 * together with the reason; this module holds the operator's answer to that
 * declaration. Unsafe tools are registered BY DEFAULT — the decision of
 * 2026-08-03 — so this is a disable list, not an enable list, and the startup
 * warning in `apps/register.ts` is what keeps a default-on unsafe tool from
 * being invisible to whoever inherits the deployment.
 *
 * Leaf module: no project imports, so the rule is testable without a server.
 */

/** Values that mean "every unsafe tool", rather than naming one. */
const ALL_TOKENS = new Set(['all', '1', 'true', 'yes', 'on']);

/** The pure parse, exported so it can be tested independently of `process.env`. */
export function parseDisableList(raw: string | undefined): { all: boolean; names: ReadonlySet<string> } {
  const entries = (raw ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  // An "all" token anywhere wins: read as an intent rather than as a list,
  // "get_url_text, all" plainly says everything.
  if (entries.some(e => ALL_TOKENS.has(e))) return { all: true, names: new Set() };
  return { all: false, names: new Set(entries) };
}

const disabled = parseDisableList(process.env['WLO_DISABLE_UNSAFE_TOOLS']);

/** True when the operator switched this unsafe tool off. */
export function isUnsafeToolDisabled(name: string): boolean {
  return disabled.all || disabled.names.has(name.toLowerCase());
}
