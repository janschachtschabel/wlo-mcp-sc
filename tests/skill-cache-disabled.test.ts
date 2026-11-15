// MUST stay the first import — see disable-skill-cache-env.ts.
import './disable-skill-cache-env.js';

/**
 * skill-cache-disabled.test.ts – what `WLO_SKILL_CACHE=off` actually turns off.
 *
 * Its own file because `wlo-config` reads the switch once at module load, and
 * `node --test` gives each file its own process.
 *
 * The documented promise is the same in three places (`.env.example`,
 * `docs/SKILLS.md`, and the startup log line in `wlo-config.ts`): no background
 * work, and the collection output carries the free pointer to
 * `get_skill_registry` again. An operator flips this switch because of the cost.
 * A live fallback that kept running would hand them the worst of both — every
 * request paying the ~1.0–1.4 s children listing, and with no tick to drain or
 * expire anything, a queue that fills to its cap and warns forever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatNode } from '../src/formatter.js';
import { ensureRegistries, queueLength, stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { WLO_SKILL_CACHE } from '../src/wlo-config.js';
import { installFetchMock, type MockResult } from './fetchMock.js';

function collNode(id: string, title: string) {
  return formatNode({ ref: { id, repo: '-home-' }, type: 'ccm:map', isDirectory: true,
    properties: { 'cm:name': [title] } });
}

test('precondition: the switch is off in this process', () => {
  assert.equal(WLO_SKILL_CACHE, false);
});

test('the off switch stops the live fallback too, not only the background tick', async () => {
  stopSkillRegistryCache();
  let children = 0;
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) children++;
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  try {
    const nodes = [collNode('coll-1', 'Sammlung Optik')];
    const answered = await ensureRegistries(nodes);

    assert.equal(children, 0, 'no request pays for a cache the operator switched off');
    assert.equal(answered.size, 0, 'and the answer says so, so the pointer line stands');
    assert.equal(nodes[0]!.skillRegistry, undefined);
    assert.equal(queueLength(), 0, 'nothing piles up behind a tick that will never run');
  } finally {
    mock.restore();
    stopSkillRegistryCache();
  }
});
