/**
 * check-host-compat.mjs – does a model host take this server's tool list?
 *
 *   node --import tsx scripts/dump-tools.ts > tools.json
 *   node scripts/check-host-compat.mjs tools.json [https://<public server>/mcp]
 *
 * Three things, each printed as one line:
 *  - static: the documented limits both OpenAI and Anthropic put on a tool
 *    (name pattern, description length, an object schema without a top-level
 *    anyOf/oneOf/allOf as INPUT, an object schema as output);
 *  - OpenAI function calling: every tool sent as a function, on the chat and
 *    the responses API (needs OPENAI_API_KEY; the prompt is a fixed sentence);
 *  - OpenAI's hosted MCP client against a PUBLIC server URL, when one is given
 *    — the only check that exercises `outputSchema` as a host reads it.
 *
 * It reports and changes nothing. No Anthropic call: there is no key here; the
 * Claude clients use the SDK client the offline suite already runs against.
 */

import fs from 'node:fs';
const tools = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const key = process.env.OPENAI_API_KEY;
const deployed = process.argv[3];
if (!key) { console.error('OPENAI_API_KEY is not set — only the static check runs.'); }

// ── static: the documented limits of both hosts ──
const bad = [];
for (const t of tools) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) bad.push([t.name, 'name']);
  if ((t.description ?? '').length > 1024) bad.push([t.name, 'description>1024: ' + t.description.length]);
  const s = t.inputSchema;
  if (s.type !== 'object') bad.push([t.name, 'input type']);
  for (const k of ['anyOf', 'oneOf', 'allOf']) if (s[k]) bad.push([t.name, 'input top-level ' + k]);
  if (t.outputSchema && t.outputSchema.type !== 'object') bad.push([t.name, 'output type']);
}
console.log('static:', tools.length, 'tools,', bad.length, 'violations', JSON.stringify(bad));
console.log('total tool JSON bytes:', JSON.stringify(tools).length);

async function post(path, body) {
  const r = await fetch('https://api.openai.com/v1/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
const prompt = 'Suche drei Arbeitsblaetter zur Optik fuer die Sekundarstufe I.';

if (!key) process.exit(bad.length ? 1 : 0);

// A: chat completions, all tools as functions
for (const model of ['gpt-4o-mini', 'gpt-5-mini']) {
  const fn = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const { status, j } = await post('chat/completions', { model, messages: [{ role: 'user', content: prompt }], tools: fn });
  const calls = j.choices?.[0]?.message?.tool_calls?.map(c => c.function.name + ' ' + c.function.arguments);
  console.log('A chat', model, status, calls ?? j.error?.message, 'prompt_tokens', j.usage?.prompt_tokens);
}
// B: responses API, function tools
{
  const fn = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
  const { status, j } = await post('responses', { model: 'gpt-5-mini', input: prompt, tools: fn });
  console.log('B responses', status, j.output?.filter(o => o.type === 'function_call').map(o => o.name + ' ' + o.arguments) ?? j.error?.message);
}
// C: hosted MCP against a public URL
if (deployed) {
  const { status, j } = await post('responses', {
    model: 'gpt-5-mini', input: prompt,
    tools: [{ type: 'mcp', server_label: 'wlo', server_url: deployed, require_approval: 'never' }],
  });
  const out = j.output ?? [];
  console.log('C hosted mcp', status, j.error?.message ?? '',
    out.map(o => o.type + (o.type === 'mcp_list_tools' ? ':' + o.tools?.length + (o.error ? ' ERR ' + JSON.stringify(o.error) : '') : o.type === 'mcp_call' ? ':' + o.name + (o.error ? ' ERR ' + JSON.stringify(o.error).slice(0, 300) : ' ok ' + String(o.output).length) : '')).join(' | '));
}
