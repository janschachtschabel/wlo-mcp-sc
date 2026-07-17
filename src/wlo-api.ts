/**
 * wlo-api.ts – Barrel for the WLO / edu-sharing REST client.
 *
 * The client is split by responsibility so each file has one reason to change,
 * while this barrel preserves the public surface — callers keep importing from
 * `./wlo-api.js`:
 *   - `wlo-config.ts` — resolved env config, shared node/response types, the
 *     timeout-enforcing `wloFetch`, `HEADERS`, `DISPLAY_PROPS` + `propertyFilter`.
 *   - `wlo-search.ts` — the search endpoints (`ngsearch`, collection keyword search).
 *   - `wlo-node.ts`   — node endpoints (children/metadata/text/download/breadcrumb)
 *     and the node URL builders.
 */

export * from './wlo-config.js';
export * from './wlo-search.js';
export * from './wlo-node.js';
