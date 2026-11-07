/**
 * services/failure-code.ts – an upstream failure as a CODE, never the
 * repository's own text (BOERDi wishlist rule, E6: English identifiers).
 *
 * Shared by every bundling answer that names its missing parts
 * (`get_collection_overview`, `count_wlo_content_matches`), so the same failure
 * reads the same everywhere.
 */

import { isUpstreamTimeout } from './write/timeouts.js';

export type FailureCode = 'timeout' | 'forbidden' | 'upstream_error';

export function failureCode(err: unknown): FailureCode {
  if (isUpstreamTimeout(err)) return 'timeout';
  return /\b40[13]\b/.test(err instanceof Error ? err.message : String(err)) ? 'forbidden' : 'upstream_error';
}
