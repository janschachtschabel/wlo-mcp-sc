/**
 * env-flags.ts – the spellings of on and off, in ONE place (2026-11-18).
 *
 * Leaf module: no imports, so a pure module (`rest/validate.ts`,
 * `unsafe-tools.ts`) can use it without loading the configuration.
 * No spelling is both, and empty is neither (`tests/bapi-proxy-switch.test.ts`).
 */

/**
 * Affirmative spellings only (1/true/yes/on, any case) — the string `"false"`
 * must never read as on, which is what a loose truthiness check on a non-empty
 * string would do. Used for env flags and query flags alike.
 */
export function isEnabledFlag(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * The STRICT yes, for a switch whose wrong reading is a security gap
 * (`TRUST_PROXY`: trusting `X-Forwarded-For` lets any caller pick its own
 * address). Exactly `1`, `true` or `yes`, any case, nothing around it — no
 * `on`, no padding (pinned since the audit of 2026-11-14).
 */
export function isStrictYes(raw: string | null | undefined): boolean {
  return /^(1|true|yes)$/i.test(raw ?? '');
}

/** The explicit off spellings (0/false/no/off, any case), for a switch that is on — or decided otherwise — unless switched off. */
export function isDisabledFlag(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}
