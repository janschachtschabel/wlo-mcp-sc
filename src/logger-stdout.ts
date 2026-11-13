/**
 * logger-stdout.ts – move the log to stdout, as a side effect of being imported.
 *
 * The FIRST import of `http.ts` and of nothing else. Modules write log lines
 * while they load (a disabled feature, an unsafe tool being registered), and
 * imports are evaluated in order — so this has to run before any of them, which
 * a call further down `http.ts` would not. `stdio.ts` must never import it:
 * there stdout is the MCP protocol channel (`tests/logger.test.ts` pins both).
 */

import { logToStdout } from './logger.js';

logToStdout();
