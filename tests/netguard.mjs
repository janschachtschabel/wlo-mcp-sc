/**
 * netguard.mjs – Enforces the offline guarantee the docs give.
 *
 * README and CONTRIBUTING both promise an "offline suite, no network required".
 * Nothing checked it: a test that forgot its `installFetchMock` reached the live
 * repository and still passed, and the promise only broke for whoever ran the
 * suite on a train. Worse, it can pass FOR THE WRONG REASON — measured
 * 2026-08-03, a validation test wrapped in `try/catch` stayed green over a
 * deleted input cap because the upstream call it should never have made failed,
 * and the catch read that failure as the rejection it was looking for.
 *
 * Loaded via `--import` from scripts/run-tests.mjs, so it sits UNDERNEATH every
 * `installFetchMock` (which captures the then-current fetch and restores it) and
 * only fires on genuinely unmocked calls.
 *
 * Loopback is allowed on purpose: the transport and REST tests boot a real
 * server on 127.0.0.1 and drive it over HTTP, which is local, deterministic and
 * exactly what they are there to cover.
 */

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Unparseable target: not something a test can have meant — treat as external.
  }
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
    return realFetch(input, init);
  }
  throw new Error(
    `netguard: the test suite must not reach the network, but something fetched ${url}. ` +
    'Wrap the call in installFetchMock() from tests/fetchMock.ts.',
  );
};
