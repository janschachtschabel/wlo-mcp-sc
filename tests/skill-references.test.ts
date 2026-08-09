import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSkillReferences } from '../src/services/skill-references.js';

// The fixtures below are the editor's real output shape: a `::: <kind>` fence,
// the block body, a closing `:::`.

const MATERIAL = `::: wlo-material
![Bruchrechnen](https://repository.staging.openeduhub.net/edu-sharing/preview?nodeId=62a37f02-e385-4d05-af0b-9621f42eb0f7)
[**Bruchrechnen**](https://editor.mnweg.org/mnw/sammlung/bruchrechnen-m-10) — Lizenz: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/deed.de)
:::`;

const SKILL = `::: ki-skill
[Elementares Bruchrechnen](https://repository.staging.openeduhub.net/edu-sharing/components/render/11b41221-e325-4fb2-9c2d-54b0e8c70af2)
:::`;

test('a wlo-material block yields the nodeId from the preview URL, the title, and the source link', () => {
  const [ref, ...rest] = parseSkillReferences(MATERIAL);
  assert.equal(rest.length, 0);
  assert.equal(ref!.kind, 'wlo-material');
  assert.equal(ref!.nodeId, '62a37f02-e385-4d05-af0b-9621f42eb0f7');
  assert.equal(ref!.title, 'Bruchrechnen', 'the ** of the bold link text is not part of the title');
  assert.equal(ref!.url, 'https://editor.mnweg.org/mnw/sammlung/bruchrechnen-m-10',
    'the title link points at the source, not at the repository');
});

test('a ki-skill block yields the nodeId from the render URL', () => {
  const [ref] = parseSkillReferences(SKILL);
  assert.equal(ref!.kind, 'ki-skill');
  assert.equal(ref!.nodeId, '11b41221-e325-4fb2-9c2d-54b0e8c70af2');
  assert.equal(ref!.title, 'Elementares Bruchrechnen');
});

test('the license link is not mistaken for the material', () => {
  const [ref] = parseSkillReferences(MATERIAL);
  assert.ok(!/creativecommons/.test(ref!.url), 'the FIRST non-image link is the title link');
});

test('an uploaded file takes its nodeId from the download link', () => {
  const md = `::: wlo-material
[**Arbeitsblatt**](https://repository.staging.openeduhub.net/edu-sharing/eduservlet/download?nodeId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)
:::`;
  assert.equal(parseSkillReferences(md)[0]?.nodeId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

test('a block without any repository URL still reports the reference, with no nodeId', () => {
  // About a third of WLO records have no preview, and an externally linked one
  // then carries no node id anywhere in the block. Dropping it would hide a
  // reference the author put there on purpose.
  const md = `::: wlo-material
[**Nur ein Link**](https://example.org/material) — Lizenz: [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.de)
:::`;
  const [ref] = parseSkillReferences(md);
  assert.equal(ref!.title, 'Nur ein Link');
  assert.equal(ref!.nodeId, '');
});

test('several blocks are returned in document order, prose between them ignored', () => {
  const md = `# Stunde planen\n\nZuerst das Material:\n\n${MATERIAL}\n\nDann der Folge-Skill:\n\n${SKILL}\n\nFertig.`;
  assert.deepEqual(parseSkillReferences(md).map(r => r.kind), ['wlo-material', 'ki-skill']);
});

test('an unclosed block is not parsed', () => {
  // A truncated download (the SKILL.md is byte-capped) can cut a block in half.
  // Half a block is not a reference — emitting one would invent a nodeId that
  // the author may not have finished writing.
  const md = `::: wlo-material\n![x](https://repo/preview?nodeId=62a37f02-e385-4d05-af0b-9621f42eb0f7)`;
  assert.deepEqual(parseSkillReferences(md), []);
});

test('an unknown fence kind is ignored', () => {
  assert.deepEqual(parseSkillReferences('::: warning\n[X](https://example.org)\n:::'), []);
});

test('markdown without blocks yields nothing', () => {
  assert.deepEqual(parseSkillReferences('# Nur Text\n\nEin [Link](https://example.org).'), []);
});
