/**
 * tools/skill-registry-task.ts – the `task` answer of `get_skill_registry`
 * (BOERDi wishlist item 10, decision E2, 2026-11-06).
 *
 * The team's two conditions shape it: the answer carries the chosen skill's
 * INSTRUCTION (otherwise it stays two calls), and it says "none fits" in so many
 * words when none does. Three rules on top:
 *
 * - An instruction comes along only for a CONFIDENT choice
 *   (`rankEntriesForTask`). Measured on the real Optik registry, plain ranking
 *   picked the wrong skill in 2 of 4 natural phrasings, and a wrong instruction
 *   is what a chatbot then follows. Uncertain → `ambiguous`: the candidates,
 *   ranked, and the model — which understands meaning — picks one.
 * - A confident pick that cannot be read is reported as such. There is no
 *   falling back to the next candidate: that one was not confident, so loading
 *   it would hand over exactly the uncertain instruction the rule keeps out.
 * - An approved skill whose record could not be read sits in `unresolved`, not
 *   in `entries` (staging, 2026-08: one of three Optik skills answered 403). It
 *   is a candidate all the same, ranked on its title — leaving it out answered
 *   "none fits" over a skill that fits by name. It is never loaded.
 *
 * Everything the server says comes BEFORE the skill's own document, which
 * `renderSkill` keeps last — the same order every skill surface holds.
 */

import { getSkill, type SkillDocument } from '../services/skills.js';
import { rankEntriesForTask } from '../services/skill-for-task.js';
import type { ContextInstruction, RegistryEntry, SkillRegistry } from '../services/skill-registry.js';
import { DESCRIPTIONS_ONLY_NOTE, oneLine } from '../formatter.js';
import { sanitizeText } from '../text-sanitize.js';
import { renderSkill } from './skills.js';
import { instructionBlock } from './shared.js';

export interface TaskAnswer {
  /** Server-built lines, in front of the skill document (markdown). */
  head: string[];
  /** The rendered skill, when one was loaded (markdown). */
  skillText?: string;
  /** For the JSON branch. */
  json: {
    query: string;
    match: 'found' | 'ambiguous' | 'none' | 'unreadable';
    chosen?: { nodeId: string; title: string };
    /** Ranked, best first: the other fitting skills (found) or the candidates to pick from (ambiguous). */
    candidates: Array<{ nodeId: string; title: string; readable: boolean }>;
    unmatched: string[];
    /** The editors' instructions for this collection (and context) — they bind the skill's use too. */
    instructions: ContextInstruction[];
    skill?: SkillDocument;
  };
}

export async function answerTask(
  view: SkillRegistry, task: string, instructions: readonly ContextInstruction[] = [],
): Promise<TaskAnswer> {
  const editorial = instructionBlock(instructions);
  const shown = sanitizeText(task);
  const unresolved = view.unresolved.filter(u => u.nodeId);
  const unreachable = new Set(unresolved.map(u => u.nodeId));
  const { fitting, confident, unmatched } = rankEntriesForTask([...view.entries, ...unresolved], task);
  const total = view.entries.length + unresolved.length;
  const ref = (e: RegistryEntry) => ({ nodeId: e.nodeId, title: e.title, readable: !unreachable.has(e.nodeId) });
  const listLine = (label: string, list: RegistryEntry[]) => list.length
    ? [oneLine(`${label}: ${list.map(e => `${e.title} (nodeId: ${e.nodeId}${unreachable.has(e.nodeId) ? ', nicht abrufbar' : ''})`).join(' · ')}`),
      `  ${DESCRIPTIONS_ONLY_NOTE}`]
    : [];
  const unmatchedLine = unmatched.length ? [oneLine(`Kein freigegebener Skill nennt: ${unmatched.join(', ')}.`)] : [];

  if (!fitting.length) {
    return {
      head: [oneLine(`Keiner der ${total} freigegebenen Skills passt zu „${shown}“.`), ...unmatchedLine,
        oneLine('Der Katalog steht unten — vielleicht passt einer unter anderem Namen.')],
      json: { query: task, match: 'none', candidates: [], unmatched, instructions: [...instructions] },
    };
  }
  if (!confident) {
    return {
      head: [oneLine(`Zu „${shown}“ passt keiner der ${total} freigegebenen Skills eindeutig — `
        + 'die Wörter der Aufgabe unterscheiden sie nicht genug. Wähle einen und lade ihn mit get_skill.'),
      ...listLine('In Frage kommen, nach Übereinstimmung', fitting), ...unmatchedLine],
      json: { query: task, match: 'ambiguous', candidates: fitting.map(ref), unmatched, instructions: [...instructions] },
    };
  }

  const others = fitting.filter(e => e !== confident);
  const skill = unreachable.has(confident.nodeId) ? null : await getSkill(confident.nodeId);
  if (!skill?.content) {
    return {
      head: [oneLine(`Zu „${shown}“ passt der freigegebene Skill „${confident.title}“ (nodeId: ${confident.nodeId}), `
        + (skill?.contentRefused === 'too_large'
          ? 'seine Datei ist aber zu groß für eine Anleitung und wurde nicht geladen (eine Anleitung wird nie gekürzt).'
          : skill?.contentRefused === 'not_text'
            ? 'der Datensatz ist aber keine Textdatei und wurde nicht geladen.'
            : 'er ist aber nicht abrufbar.')), ...listLine('Ebenfalls in Frage, weniger eindeutig', others), ...unmatchedLine],
      json: { query: task, match: 'unreadable', chosen: { nodeId: confident.nodeId, title: confident.title },
        ...(skill?.contentRefused ? { refused: skill.contentRefused } : {}),
        candidates: others.map(ref), unmatched, instructions: [...instructions] },
    };
  }
  return {
    head: [oneLine(`Für „${shown}“ passt aus den ${total} freigegebenen Skills: ${confident.title} `
      + `(nodeId: ${confident.nodeId}). Die Anleitung steht unten.`),
    ...listLine('Ebenfalls in Frage, weniger eindeutig', others), ...unmatchedLine,
    oneLine('Den ganzen Katalog liefert get_skill_registry ohne task.'),
    // Server-framed and AHEAD of the skill's own document, like every other
    // surface that carries the editors' words.
    ...(editorial.length ? ['', ...editorial] : [])],
    skillText: renderSkill(skill),
    json: { query: task, match: 'found', chosen: { nodeId: confident.nodeId, title: confident.title },
      candidates: others.map(ref), unmatched, instructions: [...instructions], skill },
  };
}
