/**
 * mcp-transport.ts – Streamable HTTP transport options for the MCP endpoint.
 *
 * The server is stateless (a fresh server + transport per request), so
 * `sessionIdGenerator` is always undefined. The one deployment knob is the
 * response mode:
 *  - default (JSON mode): reply with a single JSON body — maximal client
 *    compatibility (curl, simple IDE integrations), used for local/dev and the
 *    stateless Vercel path.
 *  - `MCP_SSE` truthy: real Server-Sent-Events streaming — required by ChatGPT
 *    developer mode on the self-hosted vServer. Behind a reverse proxy, response
 *    buffering MUST be disabled (see docker-compose.yml / README) or the stream
 *    never reaches the client.
 *
 * Kept pure and side-effect-free (unlike `http.ts`, which starts a listener on
 * import) so the flag logic is unit-testable offline.
 */

/** Options passed to `new StreamableHTTPServerTransport(...)` on the MCP path. */
export interface StreamableHttpOptions {
  /** Always undefined: the server is stateless, one instance per request. */
  sessionIdGenerator: undefined;
  /** true = single JSON body; false = real SSE stream (MCP_SSE). */
  enableJsonResponse: boolean;
}

/** Truthy env flags — mirrors the `TRUST_PROXY` convention in `http.ts`. */
function isTruthy(raw: string | undefined): boolean {
  return /^(1|true|yes)$/i.test((raw ?? '').trim());
}

/**
 * Build the Streamable HTTP transport options from the environment. `MCP_SSE`
 * truthy switches from single-JSON responses to real SSE streaming; unset keeps
 * the back-compatible JSON mode.
 */
export function streamableHttpOptions(
  env: NodeJS.ProcessEnv = process.env,
): StreamableHttpOptions {
  return {
    sessionIdGenerator: undefined,
    enableJsonResponse: !isTruthy(env['MCP_SSE']),
  };
}
