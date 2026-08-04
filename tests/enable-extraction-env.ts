/**
 * Enables the text-extraction service for a test file.
 *
 * `WLO_TEXT_EXTRACTION_URL` has no default — unset disables the external path
 * (see `resolveExtractionUrl`), which is correct for a deployment but leaves the
 * fallback leg of `getContentText` untestable. `wlo-config` resolves the value
 * once at module load, so this MUST be the FIRST import in any file that
 * exercises that leg. ESM evaluates imports in source order, so placing it above
 * the others is enough — and if a reorder ever breaks it, the fallback tests go
 * red rather than silently passing against a disabled service.
 *
 * `node --test` runs each test file in its own process, so this does not leak
 * into files that deliberately test the disabled state.
 */
process.env['WLO_TEXT_EXTRACTION_URL'] = 'https://text-extraction.staging.openeduhub.net';
