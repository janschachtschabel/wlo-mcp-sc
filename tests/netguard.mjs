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
 *
 * The throw alone is not enough (audit 2026-11-14, T2): server code CATCHES a
 * failed fetch as an upstream failure, so a swallowed violation left the test
 * green — a recording variant counted seven such hits to the staging host. Every
 * violation is therefore also RECORDED, and a process that had one exits
 * non-zero with the list. The test runner gives each file its own process, so
 * the file that reached out is the file that fails.
 */

const realFetch = globalThis.fetch;

/** Every non-loopback target something tried to fetch in this process. */
const violations = [];

process.on('exit', (code) => {
  if (violations.length === 0) return;
  process.stderr.write(
    `\nnetguard: ${violations.length} unmocked network call(s) in this test file — `
    + 'the throw was swallowed by the code under test, so the tests may be green for the wrong reason:\n'
    + violations.map(v => `  ${v}`).join('\n') + '\n',
  );
  if (code === 0) process.exitCode = 1;
});

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
  violations.push(`${init?.method ?? 'GET'} ${url}`);
  throw new Error(
    `netguard: the test suite must not reach the network, but something fetched ${url}. ` +
    'Wrap the call in installFetchMock() from tests/fetchMock.ts.',
  );
};
