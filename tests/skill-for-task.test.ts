/**
 * skill-for-task.test.ts – when may `get_skill_registry` + `task` hand over an
 * instruction? (BOERDi item 10, measured on the real Optik registry 2026-11-06).
 *
 * Pure lexical ranking picked the WRONG skill in 2 of 4 natural phrasings, both
 * with full confidence: "Wie vollständig ist diese Sammlung?" matched only the
 * word "Sammlung" — carried by all four entries, scores 0.51/0.48/0.46 — and
 * chose the gatekeeper. A wrong instruction is worse than "pick one yourself",
 * so an instruction comes along only when the evidence discriminates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rankEntriesForTask } from '../src/services/skill-for-task.js';
import type { RegistryEntry } from '../src/services/skill-registry.js';

// The four entries of the staging Optik registry, as measured.
const OPTIK: RegistryEntry[] = [
  { nodeId: 'fuellstand', title: 'Füllstand und Abdeckung der Sammlung bestimmen',
    description: 'Prüft die Sammlung basierend auf dem kompendialen Text und gibt den Füllstand und die Abdeckung der Sammlung zurück.' },
  { nodeId: 'sprache', title: 'Sprachliche Qualität bestimmen',
    description: 'Der Skill bestimmt die sprachliche Qualität eines textuellen Materials.' },
  { nodeId: 'gatekeeper', title: 'Gatekeeper für Sammlungen', description: 'Der Skill prüft die Passung von Inhalten zu Sammlungen.' },
  { nodeId: 'passend', title: 'Passende Inhalte für eine Sammlung finden' },
];

test('a word every entry carries is no evidence: no confident choice, the candidates are named', () => {
  const r = rankEntriesForTask(OPTIK, 'Wie vollständig ist diese Sammlung?');
  assert.equal(r.confident, null, 'nothing is loaded on a near-tie over a common word');
  assert.ok(r.fitting.length >= 2, 'the candidates still come back, ranked');
});

test('a discriminating word with a clear lead is a confident choice', () => {
  const r = rankEntriesForTask(OPTIK, 'Füllstand der Sammlung bestimmen');
  assert.equal(r.confident?.nodeId, 'fuellstand');
});

test('no shared word at all is "none", not "ambiguous"', () => {
  const r = rankEntriesForTask(OPTIK, 'Gedichtinterpretation Goethe');
  assert.deepEqual(r.fitting, []);
  assert.equal(r.confident, null);
});

test('one approved skill and one matching word: that skill', () => {
  const r = rankEntriesForTask([OPTIK[1]!], 'sprachliche Qualität');
  assert.equal(r.confident?.nodeId, 'sprache');
});
