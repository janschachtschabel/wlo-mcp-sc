/**
 * startup-check.ts – what must hold before either entry point does anything.
 *
 * One function for `http.ts` and `stdio.ts`: a rule that exists in two files is
 * changed in one of them.
 */

import { log } from './logger.js';
import { repositoryUrlProblem } from './wlo-config.js';

/**
 * End the process when the repository address is one no request can be sent to
 * — otherwise it shows up as a failure of the first tool call, long after the
 * boot looked fine (audit 2026-11-12, B-6). The log names the variable and the
 * problem, never the value. Under `restart: unless-stopped` this is a restart
 * loop with one error line per start, which is the visible outcome wanted.
 */
export function exitOnUnusableRepositoryUrl(): void {
  const problem = repositoryUrlProblem();
  if (!problem) return;
  log.error('WLO_REPOSITORY_URL cannot be used — not starting', { problem });
  process.exit(1);
}
