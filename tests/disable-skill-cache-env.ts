/**
 * Switches the background skill-registry cache off, for a test file.
 *
 * `wlo-config.ts` resolves `WLO_SKILL_CACHE` once at module load, so this MUST
 * be the FIRST import in any file that exercises the off state — ESM evaluates
 * imports in source order, and an assignment in the module body would run after
 * the config has already been read.
 *
 * `node --test` runs each test file in its own process, so this does not leak
 * into the files that expect the cache on.
 */
process.env['WLO_SKILL_CACHE'] = 'off';
