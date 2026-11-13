/**
 * scripts/measure-resources.mjs – what the server needs in memory and CPU.
 *
 * `npm run measure:resources` (after `npm run build`). REPORTS; writes nothing,
 * neither here nor in the repository. Two legs, because no single one answers
 * the sizing question (chatbot feedback 2026-11-13, D11):
 *
 *   1. The running server (`dist/http.js`, anonymous): resident memory and CPU
 *      idle, after a round of read tools, and during a burst of searches — read
 *      off its own `/metrics` on the internal port.
 *   2. The two stores that hold caller data in memory, filled to their bounds
 *      in a process of their own: the upload slots (filled until the store
 *      itself refuses — its bound is not repeated here) and the full texts of
 *      unfinished plans (`FULLTEXT_HOLD_MAX`, 64 MiB).
 *      Driving them through the network needs a personal login and real
 *      records; what they COST does not depend on how the bytes arrived.
 *
 * The first leg sends read-only, anonymous calls to the configured repository.
 *
 * A call that came back as a JSON-RPC error or as a tool result with
 * `isError` is PRINTED as failed, never timed as a success: a refused search
 * is fast, and its time says nothing about a search.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const MB = 1024 * 1024;
const mb = (bytes) => `${(bytes / MB).toFixed(0)} MB`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// ── leg 2: the stores, in THIS process ───────────────────────────────────────

/** One store filled to its bound, in a process that does nothing else — so the baseline is clean. */
async function storeLeg(mode) {
  const gc = globalThis.gc;
  if (!gc) throw new Error('run with --expose-gc');
  const settle = async () => { gc(); await sleep(300); gc(); return process.memoryUsage(); };
  const { UploadSlots } = await import('../dist/services/write/upload-slot.js');
  const { FULLTEXT_HOLD_MAX } = await import('../dist/services/write/fulltext-plan.js');
  const base = await settle();
  const held = [];
  let bytes = 0;
  let files = 0;
  let lastSize = 0;
  let maxFile = 0;

  if (mode === 'upload') {
    const slots = new UploadSlots();
    held.push(slots);
    // Files of the largest size the store takes, one identity each, until it
    // REFUSES — then half the size, until nothing of a megabyte fits. The bound
    // is the store's own; this script does not know it. A refused body is
    // destroyed: left unread it stays in memory and is counted as the store's
    // (the first version of this loop measured +1317 MB that way).
    let size = slots.maxBytes;
    for (let i = 0; size >= MB && i < 200; i++) {
      const body = Readable.from([Buffer.alloc(size, 0x61)]);
      const out = await slots.put(`id-${i}`, body, 'file.pdf', size);
      if (!out.ok) { body.destroy(); size = Math.floor(size / 2); continue; }
      bytes += size;
      files += 1;
      lastSize = size;
    }
    maxFile = slots.maxBytes;
  } else {
    // Full texts are JavaScript STRINGS, and they arrive through JSON.parse —
    // flat, not concatenated. V8 keeps a string of Latin-1 characters at one
    // byte per character and any other at two: one „ or – in a text doubles it.
    const per = 2 * MB;
    const filler = mode === 'wide' ? '–' : 'e';
    for (let i = 0; i < Math.floor(FULLTEXT_HOLD_MAX / per); i++) {
      const body = Buffer.alloc(per - 8, 0x65);
      const text = JSON.parse(JSON.stringify(`${filler}${body.toString('latin1')}`));
      held.push(text);
      bytes += Buffer.byteLength(text, 'utf8');
    }
  }
  const full = await settle();
  return { mode, bytes, rss: full.rss - base.rss, heapAndExternal: (full.heapUsed + full.external) - (base.heapUsed + base.external), kept: held.length, files, lastSize, maxFile };
}

const storeMode = process.argv.find((a) => a.startsWith('--stores='))?.slice('--stores='.length);
if (storeMode) {
  console.log(JSON.stringify(await storeLeg(storeMode)));
  process.exit(0);
}

// ── leg 1: the running server ────────────────────────────────────────────────

/** Our own server on loopback: an answer that takes this long is no answer. */
const LOCAL_TIMEOUT_MS = 5_000;
/** One tool call. Far above the slowest measured (15.5 s cold) — a hang must end, not a slow search. */
const CALL_TIMEOUT_MS = 120_000;

async function scrape(port) {
  const text = await (await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS) })).text();
  const value = (name) => Number(new RegExp(`^${name} (\\S+)$`, 'm').exec(text)?.[1] ?? NaN);
  return {
    rss: value('process_resident_memory_bytes'),
    heap: value('nodejs_heap_size_used_bytes'),
    external: value('nodejs_external_memory_bytes'),
    cpu: value('process_cpu_user_seconds_total') + value('process_cpu_system_seconds_total'),
  };
}

/**
 * Why a `tools/call` answer is NOT a success, or null when it is one. The body
 * is JSON, or one SSE frame (`data: {...}`) when the server runs with MCP_SSE.
 */
function failureOf(status, body) {
  if (status !== 200) return `HTTP ${status}`;
  const frame = body.trimStart().startsWith('{')
    ? body
    : body.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice('data:'.length).trim()).pop();
  let message;
  try { message = JSON.parse(frame ?? ''); } catch { return 'the answer is not JSON-RPC'; }
  if (message?.error) return `JSON-RPC error ${message.error.code ?? ''}: ${String(message.error.message ?? '').slice(0, 120)}`;
  if (!message?.result) return 'the answer carries no result';
  if (message.result.isError) {
    const text = message.result.content?.find?.((c) => c?.type === 'text')?.text ?? '';
    return `tool error: ${String(text).replace(/\s+/g, ' ').slice(0, 120)}`;
  }
  return null;
}

async function call(port, name, args) {
  const started = Date.now();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const body = await res.text();
    return { name, status: res.status, ms: Date.now() - started, failure: failureOf(res.status, body) };
  } catch (err) {
    return { name, status: 0, ms: Date.now() - started, failure: `no answer: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const READS = [
  ['search_wlo_all', { query: 'Optik' }],
  ['search_wlo_content', { query: 'Bruchrechnung', license: 'OER' }],
  ['search_wlo_collections', { query: 'Mathematik' }],
  ['get_subject_portals', {}],
  ['search_wlo_topic_pages', { query: 'Physik' }],
  ['lookup_wlo_vocabulary', { vocabulary: 'discipline' }],
  ['get_wikipedia_summary', { query: 'Photosynthese' }],
  ['search_skill', { query: 'Unterricht planen' }],
];

const port = await freePort();
const internalPort = await freePort();
// Anonymous: the measurement must not depend on, or act with, anybody's login.
const env = { ...process.env, PORT: String(port), INTERNAL_PORT: String(internalPort), RATE_LIMIT_RPM: '0', LOG_LEVEL: 'error' };
for (const k of ['WLO_SERVICE_USER', 'WLO_SERVICE_PASSWORD', 'WLO_AUTH_PRIVATE_KEY', 'METRICS_TOKEN']) delete env[k];
// Every process this script starts — none may outlive it, however it ends.
const children = new Set();
const track = (p) => { children.add(p); p.once('exit', () => children.delete(p)); return p; };
const killAll = () => { for (const p of children) p.kill('SIGTERM'); };
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { killAll(); process.exit(130); });
}

const child = track(spawn(process.execPath, ['dist/http.js'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] }));
let childProblem = null;
child.once('error', (err) => { childProblem = `the server could not be started: ${err.message}`; });
child.once('exit', (code, signal) => { childProblem ??= `the server exited (code ${code}, signal ${signal})`; });
let peak = 0;
let sampling = true;
try {
  for (let i = 0; ; i++) {
    if (childProblem) throw new Error(childProblem);
    try { if ((await fetch(`http://127.0.0.1:${internalPort}/health`, { signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS) })).ok) break; } catch { /* not up yet */ }
    if (i > 100) throw new Error('the server did not start');
    await sleep(200);
  }
  const sampler = (async () => { while (sampling) { try { peak = Math.max(peak, (await scrape(internalPort)).rss); } catch { /* stopping */ } await sleep(250); } })();

  await sleep(10_000);
  const idle = await scrape(internalPort);

  const timings = [];
  for (const [name, args] of READS) timings.push(await call(port, name, args));
  await sleep(2_000);
  const warm = await scrape(internalPort);

  // A burst: ten searches at once, three times — what ten people do in one second.
  const burstStart = await scrape(internalPort);
  // The peak of the BURST, not of everything before it: start again from here.
  // It stays a 250 ms sample of RSS — a spike between two samples is not seen.
  peak = burstStart.rss;
  const t0 = Date.now();
  const burst = [];
  for (let round = 0; round < 3; round++) {
    burst.push(...await Promise.all(Array.from({ length: 10 }, (_, i) => call(port, 'search_wlo_all', { query: ['Optik', 'Mechanik', 'Zellen', 'Lyrik', 'Brüche'][i % 5] }))));
  }
  const burstFailures = burst.filter((c) => c.failure);
  const burstSeconds = (Date.now() - t0) / 1000;
  const burstEnd = await scrape(internalPort);
  sampling = false;
  await sampler;

  const store = (mode) => new Promise((resolve, reject) => {
    const p = track(spawn(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), `--stores=${mode}`], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }));
    let out = '';
    p.once('error', reject);
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`store leg ${mode} exited ${code}`))));
  });
  const upload = await store('upload');
  const latin = await store('latin');
  const wide = await store('wide');

  console.log('\nRunning server (anonymous, reads against the configured repository)');
  console.log(`  idle, 10 s after start        RSS ${mb(idle.rss)}  heap ${mb(idle.heap)}  external ${mb(idle.external)}`);
  console.log(`  after one round of 8 reads    RSS ${mb(warm.rss)}  heap ${mb(warm.heap)}`);
  console.log(`  highest during 3 × 10 searches  RSS ${mb(peak)}  (sampled every 250 ms from the burst's start — not a high-water mark)`);
  if (burstFailures.length > 0) {
    console.log(`  !! ${burstFailures.length} of ${burst.length} burst calls FAILED — the burst figures do not describe ${burst.length} searches. First: ${burstFailures[0].failure}`);
  }
  console.log(`  CPU during the burst          ${((burstEnd.cpu - burstStart.cpu) / burstSeconds).toFixed(2)} cores over ${burstSeconds.toFixed(1)} s`);
  console.log(`  CPU idle (first 10 s incl. start)  ${idle.cpu.toFixed(2)} s`);
  console.log('  one call each:');
  for (const t of timings) {
    console.log(t.failure
      ? `    ${t.name.padEnd(26)} FAILED after ${t.ms} ms — ${t.failure} (not a timing)`
      : `    ${t.name.padEnd(26)} ${String(t.ms).padStart(6)} ms  HTTP ${t.status}`);
  }
  console.log('\nStores at their bounds (each in a process of its own, after GC)');
  const line = (label, m) => console.log(`  ${label.padEnd(44)} ${mb(m.bytes).padStart(7)} held   +${mb(m.rss)} RSS   +${mb(m.heapAndExternal)} heap+external`);
  line(`upload slots (${upload.files} files until the store refused)`, upload);
  line('full texts, Latin-1 characters only', latin);
  line('full texts, each with ONE character beyond', wide);
  // The upload store was measured to cost its content plus the size of the file
  // stored LAST; the last file of this filling is whatever still fitted, so the
  // worst case adds what a largest file in that place would have cost more.
  const uploadWorst = upload.rss + (upload.maxFile - upload.lastSize);
  console.log(`\nWorst case together: ${mb(peak + uploadWorst + wide.rss)} = burst sample ${mb(peak)} + upload store ${mb(uploadWorst)} `
    + `(measured +${mb(upload.rss)}, plus ${mb(upload.maxFile - upload.lastSize)}: the largest allowed file, ${mb(upload.maxFile)}, `
    + `minus the last one stored, ${mb(upload.lastSize)}) + full texts at two bytes per character ${mb(wide.rss)} `
    + '— before request bodies in flight.');
} catch (err) {
  console.error(`measure-resources: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  sampling = false;
  killAll();
}
