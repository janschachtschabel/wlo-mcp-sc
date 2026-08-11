/**
 * tools-curation-gating.test.ts – write tools are visible to everyone and
 * usable by nobody without an identity.
 *
 * The rule CHANGED on 2026-08-05, deliberately and with the user's decision.
 * It used to be "a write tool is absent from `tools/list` when the caller has
 * no identity" — the reasoning being that a model cannot misuse a tool it
 * cannot see. Live that reasoning inverted: a model that never sees a write
 * tool never calls one, so the host is never asked to log the user in, and the
 * connector stays anonymous forever. Hiding the tools is what kept the login
 * from ever starting.
 *
 * What replaces it is the pattern OpenAI's own mixed-auth example uses: the
 * tool is always listed, declares `oauth2`, and refuses on invocation with a
 * challenge that asks the host for a login. The refusal is unchanged and
 * absolute — `tests/curation-auth-challenge.test.ts` proves no upstream request
 * escapes it, and `tools-curation-update.test.ts` proves the message.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient } from './fetchMock.js';
import { CURATION_TOOLS } from './curation-tools.js';

test('every caller sees the same tool list, write tools included', async () => {
  // The suite runs without a configured service account, so this is the
  // anonymous case — the one that used to get 25 tools and no way to log in.
  const client = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const name of CURATION_TOOLS) assert.ok(names.includes(name), `${name} is offered`);
    // 28 read tools + 14 curation tools. `get_url_text` is present because
    // unsafe tools are registered unless the operator disables them — see
    // tests/server-unsafe-disabled.test.ts for that state.
    assert.equal(names.length, 42, 'the read tools plus every curation tool');
  } finally {
    await client.close();
  }
});

test('a write tool does not declare itself callable without authentication', async () => {
  // Read tools declare BOTH schemes — anonymous works, a login works better
  // (they run with the rights of someone who also sees non-public material).
  // A write tool declares only `oauth2`, because claiming `noauth` for a tool
  // that refuses anonymous callers would be a false declaration to the host.
  //
  // Changed 2026-08-05: this used to expect `[{type:'http'}]`, borrowed from
  // OpenAPI. The Apps SDK knows exactly two scheme types — `noauth` and
  // `oauth2` — and an unknown one refuses the WHOLE tool list, which is what
  // made ChatGPT connect anonymously and fail on every login. The rule now also
  // holds for all 38 tools in `tool-security-schemes.test.ts`.
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const write = tools.find(t => t.name === 'wlo_update_content');
    const read = tools.find(t => t.name === 'get_compendium_text');
    assert.ok(write, 'the write tool is present — otherwise this test proves nothing');
    assert.ok(read, 'and a read tool to compare against');
    assert.deepEqual((read._meta as { securitySchemes?: unknown }).securitySchemes,
      [{ type: 'noauth' }, { type: 'oauth2', scopes: ['wlo'] }]);
    assert.deepEqual((write._meta as { securitySchemes?: unknown }).securitySchemes,
      [{ type: 'oauth2', scopes: ['wlo'] }]);
  } finally {
    await client.close();
  }
});
