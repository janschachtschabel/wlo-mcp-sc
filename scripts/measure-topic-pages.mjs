#!/usr/bin/env node
/**
 * measure-topic-pages.mjs — wall-clock baseline for the Themenseiten tools.
 *
 * Replays the exact argument sets from the client latency report (2026-07-27)
 * against a running MCP server and prints one row per call, so a change can be
 * proven with numbers instead of predicted from a cost model.
 *
 *   node scripts/measure-topic-pages.mjs                       # localhost:3000
 *   node scripts/measure-topic-pages.mjs https://host/mcp
 *   node scripts/measure-topic-pages.mjs https://host/mcp --json > after.json
 *
 * Calls run SEQUENTIALLY on purpose: parallel runs contend for the same
 * upstream and would measure the contention, not the tool. Each row reports
 * the response size too, because a fast call returning nothing is not a win.
 */

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--')) ?? 'http://localhost:3000/mcp';
const asJson = args.includes('--json');

/** The report's reproduction set, plus the two fast references it compared against. */
const CASES = [
  { tool: 'search_wlo_topic_pages', args: { maxResults: 20 } },
  { tool: 'search_wlo_topic_pages', args: { maxResults: 10 } },
  { tool: 'search_wlo_topic_pages', args: { maxResults: 5 } },
  { tool: 'search_wlo_topic_pages', args: { maxResults: 20, educationalContext: 'Sekundarstufe I' } },
  { tool: 'search_wlo_topic_pages', args: { maxResults: 10, educationalContext: 'Sekundarstufe I' } },
  { tool: 'search_wlo_topic_pages', args: { query: 'Photosynthese', maxResults: 10 } },
  { tool: 'get_topic_page_content', args: { query: 'Nachhaltigkeit', maxPerSwimlane: 3 } },
];

/** The client sends these on every call; keep them so the numbers are comparable. */
const COMMON = { mergeVariants: true, outputFormat: 'json' };

/** Streamable HTTP answers either a JSON body or an SSE stream — accept both. */
async function readResult(res) {
  const body = await res.text();
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return JSON.parse(body);
  }
  const payloads = body
    .split('\n')
    .filter(l => l.startsWith('data:'))
    .map(l => l.slice(5).trim())
    .filter(Boolean);
  if (payloads.length === 0) throw new Error('empty SSE stream');
  return JSON.parse(payloads[payloads.length - 1]);
}

async function callTool(tool, toolArgs, id) {
  const started = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: tool, arguments: { ...COMMON, ...toolArgs } },
    }),
  });
  const parsed = await readResult(res);
  const ms = Math.round(performance.now() - started);

  if (parsed.error) return { ms, chars: 0, error: parsed.error.message ?? 'JSON-RPC error' };
  const text = (parsed.result?.content ?? [])
    .filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text)
    .join('');
  return { ms, chars: text.length, isError: parsed.result?.isError === true };
}

const rows = [];
let id = 1;
for (const c of CASES) {
  const label = `${c.tool} ${JSON.stringify(c.args)}`;
  try {
    const r = await callTool(c.tool, c.args, id++);
    rows.push({ ...c, ...r });
    if (!asJson) {
      const note = r.error ? `  ERROR: ${r.error}` : r.isError ? '  (tool reported an error)' : '';
      console.log(`${String(r.ms).padStart(6)} ms  ${String(r.chars).padStart(6)} chars  ${label}${note}`);
    }
  } catch (err) {
    rows.push({ ...c, ms: -1, chars: 0, error: String(err?.message ?? err) });
    if (!asJson) console.log(`${'   n/a'}      ${'     0'} chars  ${label}  ERROR: ${err?.message ?? err}`);
  }
}

if (asJson) {
  console.log(JSON.stringify({ url, rows }, null, 2));
} else {
  const ok = rows.filter(r => r.ms >= 0 && !r.error);
  const total = ok.reduce((s, r) => s + r.ms, 0);
  console.log(`\n${ok.length}/${rows.length} calls succeeded · total ${total} ms · slowest ${Math.max(0, ...ok.map(r => r.ms))} ms`);
  console.log(`target: ${url}`);
}
