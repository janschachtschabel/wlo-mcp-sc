/**
 * Types for `access-block.js`, which is plain browser ESM (the page loads it
 * unchanged) but is imported by `tests/access-block-browser.test.ts` to prove
 * the browser and the server agree on the wire format.
 */

/**
 * Encrypt one WLO login into an access block.
 *
 * @param user WLO user name
 * @param secret WLO password — encrypted here; it never leaves the browser in clear
 * @param spkiPem the server's public key, as served by `/auth/public-key`
 * @returns the `wlo2.…` block to paste into the connector settings
 * @throws Error with German text when the key is missing or unusable
 */
export function encodeAccessBlock(user: string, secret: string, spkiPem: string): Promise<string>;
