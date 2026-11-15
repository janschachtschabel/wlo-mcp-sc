/**
 * startup-check.ts – what must hold before either entry point does anything.
 *
 * One function for `http.ts` and `stdio.ts`: a rule that exists in two files is
 * changed in one of them.
 */

import { log, logLevelFrom } from './logger.js';
import { WLO_REPOSITORY_URL, addressForLog, repositoryUrlProblem } from './wlo-config.js';

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

/**
 * A `LOG_LEVEL` that names no level is ignored — and said, once: an operator
 * who wrote `LOG_LEVEL=warning` otherwise keeps getting every info line and has
 * nothing pointing at why. The value is not echoed; the accepted names are.
 */
export function warnOnUnknownLogLevel(): void {
  const raw = process.env['LOG_LEVEL'];
  if (!raw?.trim() || logLevelFrom(raw)) return;
  log.warn('LOG_LEVEL is not a known level — using info', { accepted: ['debug', 'info', 'warn', 'error'] });
}

/**
 * No `WLO_REPOSITORY_URL`: the built-in default applies, and the start SAYS so.
 *
 * Removing the default was considered (chatbot team, 2026-11-13: a forgotten
 * variable must not point somewhere silently) and not done: this server has no
 * other source for the address — it runs without the B-API — and deployments
 * that set no variable at all (a compose file started from a URL, a local
 * stdio client) would stop starting. What the concern is about is the SILENCE,
 * so that is what goes: one warning per start, naming the repository in use.
 */
export function warnOnDefaultRepository(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['WLO_REPOSITORY_URL']?.trim()) return false;
  log.warn('WLO_REPOSITORY_URL is not set — using the built-in default. Set it to name the repository this server is for.',
    { repository: addressForLog(WLO_REPOSITORY_URL) });
  return true;
}
