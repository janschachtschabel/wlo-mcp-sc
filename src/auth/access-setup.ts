/**
 * auth/access-setup.ts – is the access-block feature on, and with what?
 *
 * Pure and parameterised rather than reading `process.env` itself, because the
 * only production caller is `http.ts`, which starts listening on import and so
 * cannot be imported by a test. That is precisely how raw `parseInt` calls once
 * survived in that file; the decision therefore lives here, and the entry point
 * only passes the environment in.
 *
 * Two ways of being off, distinguishable in the log and identical in effect:
 * nothing configured — the ordinary deployment — and misconfigured. There is no
 * half-enabled state, because one would mean the pages issue blocks the header
 * path then refuses.
 */

import { log } from '../logger.js';
import { loadAuthKeys } from './access-token.js';
import { openRegistry } from './access-registry.js';
import type { AccessSupport } from './credential.js';

export interface AccessSetupEnv {
  /** `WLO_AUTH_PRIVATE_KEY` — absent means the feature is simply not in use. */
  key?: string;
  /** `WLO_AUTH_PRIVATE_KEY_PREVIOUS` — the rotation window. */
  previousKey?: string;
  /** `WLO_AUTH_REGISTRY_PATH` — the allow-list file. */
  registryPath: string;
}

/**
 * Build the support object, or null when the feature is off.
 *
 * Order matters: the key is checked FIRST, so a deployment that does not use
 * access blocks never opens — or creates — a registry file it has no use for.
 */
export async function resolveAccessSupport(env: AccessSetupEnv): Promise<AccessSupport | null> {
  const keys = loadAuthKeys({ current: env.key, previous: env.previousKey });
  if (!keys) {
    if ((env.key ?? '').trim()) {
      log.error('access blocks stay OFF — the configured key material is unusable');
    }
    return null;
  }

  const registry = await openRegistry(env.registryPath);
  if (!registry) {
    // openRegistry already logged which file and why. Repeating the reason here
    // would drift; naming the CONSEQUENCE does not.
    log.error('access blocks stay OFF — the registry could not be trusted', { path: env.registryPath });
    return null;
  }

  log.info('access blocks are enabled', {
    registry: env.registryPath,
    rotationWindow: keys.privateKeys.length > 1,
  });
  return { keys, registry };
}
