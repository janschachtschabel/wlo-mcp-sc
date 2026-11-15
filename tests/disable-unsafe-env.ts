/**
 * Switches off every tool declared unsafe, for a test file.
 *
 * `unsafe-tools.ts` resolves `WLO_DISABLE_UNSAFE_TOOLS` once at module load, so
 * this MUST be the FIRST import in any file that exercises the disabled state —
 * ESM evaluates imports in source order, and a plain assignment in the module
 * body would run after `createMcpServer` has already been pulled in.
 *
 * `node --test` runs each test file in its own process, so this does not leak
 * into the files that expect the tools to be present.
 */
process.env['WLO_DISABLE_UNSAFE_TOOLS'] = 'all';
