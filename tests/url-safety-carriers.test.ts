/**
 * url-safety-carriers.test.ts – the literal-host spellings the private-host
 * check missed (audit 2026-11-14, S6). Table-driven: each row is one address a
 * fetching service would follow into the network it sits in, or one that must
 * stay public so the rule cannot be "satisfied" by refusing a whole prefix.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPrivateHost } from '../src/url-safety.js';

const PRIVATE: ReadonlyArray<readonly [host: string, why: string]> = [
  ['2002:7f00:1::', '6to4 carrying 127.0.0.1'],
  ['2002:7f00:0001:0:0:0:0:1', '6to4, written out'],
  ['2002:a00:5::1', '6to4 carrying 10.0.0.5'],
  ['2002:a9fe:a9fe::', '6to4 carrying the metadata address 169.254.169.254'],
  ['2002::', '6to4 carrying 0.0.0.0'],
  ['[2002:c0a8:101::]', '6to4 carrying 192.168.1.1, bracketed as in a URL'],
  ['2001::1', 'Teredo'],
  ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo, a full address'],
  ['::ffff:0:127.0.0.1', 'SIIT, dotted'],
  ['::ffff:0:7f00:1', 'SIIT as new URL() normalises it'],
  ['::ffff:0:a00:5', 'SIIT carrying 10.0.0.5'],
  ['fec0::1', 'site-local'],
  ['feff::1', 'site-local, top of fec0::/10'],
  ['localhost.', 'the fully qualified spelling of localhost'],
  ['foo.localhost.', 'a name under localhost, fully qualified'],
  ['LOCALHOST.', 'case and dot together'],
  ['127.0.0.1.', 'a loopback literal with the root dot'],
];

const PUBLIC: ReadonlyArray<readonly [host: string, why: string]> = [
  ['2002:808:808::', '6to4 carrying 8.8.8.8'],
  ['::ffff:0:808:808', 'SIIT carrying 8.8.8.8'],
  ['2001:db8::1', '2001:db8::/32 is not Teredo'],
  ['2001:4860:4860::8888', 'a public address next to the Teredo prefix'],
  ['2003::1', 'the prefix after 6to4'],
  ['example.org.', 'a public name, fully qualified'],
  ['notlocalhost.', 'a name that merely ends in the word'],
  ['fe00::1', 'below link-local and site-local'],
];

for (const [host, why] of PRIVATE) {
  test(`private: ${host} — ${why}`, () => {
    assert.equal(isPrivateHost(host), true);
  });
}

for (const [host, why] of PUBLIC) {
  test(`public: ${host} — ${why}`, () => {
    assert.equal(isPrivateHost(host), false);
  });
}

test('what a URL hands over is what the table holds', () => {
  // The check is fed `new URL(x).hostname`; pin that the spellings above are the
  // ones that arrive, so the table cannot pass over a form no caller ever sees.
  assert.equal(isPrivateHost(new URL('http://[::ffff:0:127.0.0.1]/').hostname), true);
  assert.equal(isPrivateHost(new URL('http://[2002:7f00:1::]/').hostname), true);
  assert.equal(isPrivateHost(new URL('http://localhost./').hostname), true);
  assert.equal(isPrivateHost(new URL('http://foo.localhost./x').hostname), true);
});
