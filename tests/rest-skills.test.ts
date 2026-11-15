import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listSkills, loadSkillMarkdown } from '../src/rest/skills.js';
import { routeRestRequest, handleRestRequest } from '../src/rest/routes.js';

// ── registry + loader ────────────────────────────────────────────────────────

test('listSkills returns the available skills with stable ids', () => {
  const skills = listSkills();
  assert.ok(skills.length >= 2);
  const ids = skills.map(s => s.id);
  assert.ok(ids.includes('wlo-search'));
  assert.ok(ids.includes('wlo-topic-launcher'));
  for (const s of skills) {
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.description, 'string');
  }
});

test('loadSkillMarkdown returns the raw markdown for a known id', async () => {
  const md = await loadSkillMarkdown('wlo-search');
  assert.ok(md);
  assert.match(md, /\/api\/search/); // the skill documents the REST endpoint
});

test('loadSkillMarkdown returns null for an unknown id', async () => {
  assert.equal(await loadSkillMarkdown('does-not-exist'), null);
});

// ── routing: GET /api/skills (list) + GET /api/skills/<id> (raw) ──────────────

test('routeRestRequest GET /api/skills returns the skill list as JSON', async () => {
  const r = await routeRestRequest('GET', '/api/skills');
  assert.equal(r?.status, 200);
  const skills = (r?.json as { skills: { id: string; path: string }[] }).skills;
  assert.ok(Array.isArray(skills));
  assert.ok(skills.some(s => s.id === 'wlo-search' && s.path === '/api/skills/wlo-search'));
});

test('routeRestRequest GET /api/skills/<id> returns raw markdown', async () => {
  const r = await routeRestRequest('GET', '/api/skills/wlo-search');
  assert.equal(r?.status, 200);
  assert.match(r?.contentType ?? '', /markdown/);
  assert.match(r?.raw ?? '', /# WLO Search/);
});

test('routeRestRequest GET /api/skills/<unknown> is a 404', async () => {
  const r = await routeRestRequest('GET', '/api/skills/nope');
  assert.equal(r?.status, 404);
});

// ── skill instructions must make the model ACT, not just describe ─────────────
// Regression guard for the report "content search only recommended filters and
// never queried the API": the skill markdown (a) must not carry an unresolved
// base-URL placeholder the chat cannot resolve to a real host, (b) must tell the
// chat the base URL is the origin it loaded the skill from, and (c) must direct
// it to actually perform the request rather than describe it.

test('wlo-search skill has no unresolved base-URL placeholder', async () => {
  const md = await loadSkillMarkdown('wlo-search');
  assert.ok(md);
  assert.doesNotMatch(md, /YOUR-WLO-HOST/,
    'a placeholder host blocks the chat from building a real request URL');
});

test('wlo-search skill resolves its base URL self-referentially', async () => {
  const md = await loadSkillMarkdown('wlo-search');
  assert.ok(md);
  assert.match(md, /loaded this skill from/i,
    'BASE must be the origin the chat fetched the skill from, not a placeholder');
});

test('wlo-search skill directs the model to perform the search, not just advise', async () => {
  const md = await loadSkillMarkdown('wlo-search');
  assert.ok(md);
  assert.match(md, /When invoked/i);
  assert.match(md, /immediately issue/i);
});

test('wlo-topic-launcher skill resolves its base URL self-referentially', async () => {
  const md = await loadSkillMarkdown('wlo-topic-launcher');
  assert.ok(md);
  assert.doesNotMatch(md, /YOUR-WLO-HOST/);
  assert.match(md, /loaded this skill from/i);
});

test('routeRestRequest POST /api/skills is a 405', async () => {
  const r = await routeRestRequest('POST', '/api/skills');
  assert.equal(r?.status, 405);
});

// Live-diagnosed 2026-07-17: AI fetch layers strip query strings from
// model-built URLs. Both skills instruct REST calls, so both must lead with the
// stripping-proof path form and teach the stripped-query recovery.
test('both skills teach the path-form search and the stripped-query recovery', async () => {
  for (const id of ['wlo-search', 'wlo-topic-launcher']) {
    const r = await routeRestRequest('GET', `/api/skills/${id}`);
    assert.equal(r?.status, 200, `${id} loads`);
    const md = String(r!.raw ?? '');
    assert.match(md, /\/api\/search\//, `${id}: path form present`);
    assert.match(md, /strip/i, `${id}: names the stripped-query cause`);
    assert.match(md, /paste/i, `${id}: teaches the paste-back recovery`);
    assert.match(md, /paste the JSON/i, `${id}: teaches the JSON-paste last resort (search-only chats)`);
    assert.match(md, /format=html/, `${id}: teaches the HTML view for reader-only chats`);
  }
});

test('handleRestRequest writes raw markdown (not JSON) for a skill body', async () => {
  const rec: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { rec.status = status; rec.headers = headers; },
    end(body?: string) { rec.body = body; },
  };
  const handled = await handleRestRequest({ method: 'GET', url: '/api/skills/wlo-search' }, res);
  assert.equal(handled, true);
  assert.equal(rec.status, 200);
  assert.match(rec.headers?.['Content-Type'] ?? '', /markdown/);
  assert.match(rec.body ?? '', /# WLO Search/);
});
