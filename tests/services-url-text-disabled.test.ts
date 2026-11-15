/**
 * services-url-text-disabled.test.ts – What `get_url_text` answers when no
 * extraction service is configured.
 *
 * Its own file on purpose: `wlo-config` resolves WLO_TEXT_EXTRACTION_URL once at
 * module load, and `node --test` gives each file its own process, so the
 * disabled state cannot be expressed in the file that needs it enabled.
 *
 * Why this reason exists at all: folding it into `extraction_failed` would
 * report a MISSING SETTING as a fact about the page. This codebase has been
 * bitten by that shape before — a wrong service password once made every search
 * answer "0 hits" with no error, turning a configuration fault into an apparent
 * statement about the world.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getUrlText } from '../src/services/url-text.js';

test('an unconfigured extraction service says so, instead of blaming the page', async () => {
  assert.equal(process.env['WLO_TEXT_EXTRACTION_URL'], undefined, 'precondition: no service configured');

  let fetched = false;
  const r = await getUrlText('https://example.com/artikel', 'browser', 8000, {
    extract: async () => { fetched = true; return 'x'.repeat(5000); },
    lookup: async () => [{ address: '93.184.216.34' }],
  });

  assert.equal(r.reason, 'service_disabled');
  assert.equal(fetched, false, 'nothing to ask, so nothing is asked');
});
