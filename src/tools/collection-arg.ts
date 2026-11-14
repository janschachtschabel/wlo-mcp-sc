/**
 * tools/collection-arg.ts – the `collection` argument of the read tools that
 * work on ONE collection: its title instead of its nodeId (Z3, 2026-11-13).
 *
 * Schema fragments, the wrapper that resolves the name before the tool runs,
 * and the two things an answer then carries. The rule itself — exactly one
 * collection with the same title, never a guess — is
 * `services/collection-by-name.ts`.
 */

import { z } from 'zod';

import type { WloToolResult } from '../apps/register.js';
import { formatUnresolvedHint } from '../filter-criteria.js';
import { nodeIdLine, oneLine, quotedTitle } from '../formatter.js';
import {
  resolveCollectionByName,
  type CollectionByName, type CollectionCandidate, type ResolvedCollection,
} from '../services/collection-by-name.js';
import { incompleteNotice } from '../services/collection-search.js';
import { codedErrorResult, toolError } from './shared.js';

/** The input field every one of the five tools declares as `collection`. */
/**
 * In which order sub-collections come back — shared by every tool that lists
 * them, so the two values mean one thing. The default stays `title`: what
 * these tools always answered.
 */
export const collectionOrderParam = z.enum(['title', 'stored']).optional().default('title').describe(
  'Order of the sub-collections on every level. "title" (default): alphabetical. "stored": the order the '
  + 'repository holds — the position an editor set, else the order of creation. Use "stored" where the sequence '
  + 'means something (a curriculum).');

export const collectionNameParam = z.string().max(200).optional().describe(
  'Titel der Sammlung STATT ihrer nodeId, z. B. "Optik". Er muss genau stimmen (Groß-/Kleinschreibung egal, '
  + 'Leerzeichen und Bindestrich gelten als derselbe Trenner; ä/ae, ß/ss und ein fehlender Trenner nur, wenn sonst '
  + 'nichts passt — das wird dann gesagt) — es wird nie geraten. Trägt keine oder mehr als eine Sammlung diesen '
  + 'Titel, oder konnte die Suche das nicht sicher feststellen, kommen statt eines Ergebnisses bis zu fünf '
  + 'Kandidaten mit Pfad (Fehlercode ambiguous_collection, error.reason several|none|unverified). Wird ignoriert, '
  + 'sobald eine nodeId angegeben ist.');

/**
 * The subject that tells namesakes apart. `discipline` where that name is free;
 * `collectionDiscipline` on a tool whose `discipline` already filters the
 * listed CONTENTS — one name must not mean two things in one call.
 */
export const collectionDisciplineParam = (ownName: 'discipline' | 'collectionDiscipline') => z.string().max(200).optional().describe(
  'Nur zusammen mit `collection`: Fach der gesuchten Sammlung (Label oder URI, z. B. "Physik"), um '
  + 'gleichnamige Sammlungen zu unterscheiden. Trägt genau eine gleichnamige dieses Fach, wird sie genommen (die ohne '
  + 'Fachangabe nennt die Antwort); trägt keine es, wird eine ohne Fachangabe NICHT genommen. Ein nicht erkanntes Fach '
  + 'grenzt nichts ein und wird in der Antwort genannt.'
  + (ownName === 'collectionDiscipline' ? ' NICHT der Inhaltsfilter `discipline`.' : ''));

type Note = Extract<CollectionByName, { ok: true }>;
type Miss = Extract<CollectionByName, { ok: false }>;


const disciplineHint = (r: CollectionByName, param: string): string => (r.unresolvedDiscipline
  ? formatUnresolvedHint([{ field: param, ...r.unresolvedDiscipline }]) : '');

/**
 * One collection on one line: everything the SERVER knows first — id, count,
 * subject note — then the path, and the title LAST, quoted. Title and path are
 * repository-supplied: ahead of the rest a title spelled out a path, a count
 * and an id of its own, and a collection called `Mechanik“ (unter Physik) · 305
 * Inhalte · „` read as the subject's own (chatbot team and review, 2026-11-14).
 * Their quote marks are replaced so neither can close the quotes it stands in;
 * the DATA (`candidates`, `resolvedCollection`) keeps the title as it is.
 */
const under = (path: string[] | undefined): string => (path?.length ? ` · unter ${path.map(p => quotedTitle(p, '„?“').slice(1, -1)).join(' › ')}` : '');
const titled = (c: { nodeId: string; title: string }): string => ` — ${quotedTitle(c.title, `„${c.nodeId}“`)}`;

function candidateLine(c: CollectionCandidate): string {
  const count = c.contentsCount === undefined ? '' : ` · ${c.contentsCount} Inhalte`;
  const subject = c.disciplineUnknown ? ' · Fach unbekannt' : '';
  return oneLine(`- ${nodeIdLine(c.nodeId)}${count}${subject}${under(c.path)}${titled(c)}`);
}

/** Which collection the name was taken for — the first thing the answer says. */
function resolvedLines(note: Note, param: string): string {
  const c = note.collection;
  return [
    oneLine(`Sammlung: ${c.nodeId}${under(c.path)}${titled(c)}`),
    // A loose match is a different word often enough that the reader must know.
    c.matched === 'loose' ? LOOSE_MATCH_NOTE : '',
    // Taken for its subject; the namesakes that carry none are not hidden.
    ...(c.alsoFound?.length ? [
      c.alsoFoundTotal ? `${ALSO_FOUND_NOTE.slice(0, -1)} — ${c.alsoFound.length} von ${c.alsoFoundTotal}:` : ALSO_FOUND_NOTE,
      ...c.alsoFound.map(candidateLine),
    ] : []),
    disciplineHint(note, param),
  ].filter(Boolean).join('\n');
}

const ALSO_FOUND_NOTE = 'Auch gefunden, Fach unbekannt (nicht gewählt — die Sammlung oben trägt das genannte Fach):';

const LOOSE_MATCH_NOTE = 'Der Titel stimmt nur in abweichender Schreibweise überein (ä/ae, ß/ss oder Trenner) — bitte prüfen, ob diese Sammlung gemeint ist.';

/** A full search window: the index may hold a namesake nobody looked at. */
const WINDOW_FULL_NOTICE = 'Die Suche hat mehr Treffer, als geprüft wurden — ob es weitere Sammlungen mit diesem Titel gibt, ist offen. Bitte die nodeId angeben.';

function resolvedField(note: Note): ResolvedCollection & { unresolvedDiscipline?: Note['unresolvedDiscipline'] } {
  return { ...note.collection, ...(note.unresolvedDiscipline ? { unresolvedDiscipline: note.unresolvedDiscipline } : {}) };
}

/** The refusal: the tool did NOT run, and here is what to choose from. */
function ambiguousResult(name: string, miss: Miss, param: string, json: boolean, subjectGiven: boolean): WloToolResult {
  const asked = oneLine(name.trim());
  const head = miss.reason === 'several'
    // The narrowing parameter is offered only where it was not used already.
    ? `Mehrere Sammlungen tragen den Titel „${asked}“ — es wurde keine ausgewählt. Bitte eine per nodeId angeben${subjectGiven ? '' : ` oder mit \`${param}\` eingrenzen`}:`
    : miss.disciplineUnverified
      // Found, and not taken for another reason: it carries no subject at all.
      ? `Eine Sammlung mit dem Titel „${asked}“ wurde gefunden, trägt aber keine Fachangabe — ob sie zum genannten Fach gehört, ließ sich nicht prüfen, und sie wurde nicht übernommen. Bitte die nodeId angeben:`
    : miss.reason === 'unverified'
      // Found, and deliberately not taken: "the only one" is not a finding of a search that did not see everything.
      ? `Eine Sammlung mit dem Titel „${asked}“ wurde gefunden, aber nicht übernommen — die Suche war unvollständig, es kann weitere gleichnamige geben. Bitte die nodeId angeben:`
      : miss.candidates.length
      ? `Keine Sammlung trägt genau den Titel „${asked}“ — es wurde nicht geraten. Die nächsten Treffer der Sammlungssuche, bitte eine per nodeId angeben:`
      : `Keine Sammlung trägt genau den Titel „${asked}“, und die Sammlungssuche fand auch nichts Ähnliches.`;
  const notices = [
    // Not "no such collection" over an index that did not answer.
    ...(miss.unreachable ? [incompleteNotice('Sammlungen', miss.candidates.length === 0)] : []),
    ...(miss.windowFull ? [WINDOW_FULL_NOTICE] : []),
    disciplineHint(miss, param),
  ];
  const text = [head, ...miss.candidates.map(candidateLine), ...notices].filter(Boolean).join('\n');
  const result = codedErrorResult('ambiguous_collection', text, {
    // Which of the three cases the one code stands for — the value the sentence
    // above was chosen by, so a program need not read the wording.
    reason: miss.reason,
    candidates: miss.candidates,
    ...(miss.disciplineUnverified ? { disciplineUnverified: true } : {}),
    ...(miss.incomplete ? { incomplete: true } : {}),
    ...(miss.windowFull ? { windowFull: true } : {}),
    ...(miss.unresolvedDiscipline ? { unresolvedDiscipline: miss.unresolvedDiscipline } : {}),
  });
  // JSON mode keeps a parseable first block, like every other answer there —
  // and there `message` is the sentence WITHOUT the candidate lines: they are
  // in `candidates` and in the text block already, and a third copy inside the
  // JSON cost about 3.4 kB per refusal (chatbot team, measured 2026-11-14).
  if (json) {
    result.structuredContent.error['message'] = [head, ...notices].filter(Boolean).join('\n');
    result.content.unshift({ type: 'text' as const, text: JSON.stringify(result.structuredContent) });
  }
  return result;
}

/** The tool's own answer, with the chosen collection said first and carried as `resolvedCollection`. */
function withResolved(result: WloToolResult, note: Note, param: string, json: boolean): WloToolResult {
  const lines = resolvedLines(note, param);
  const field = resolvedField(note);
  const [first, ...rest] = result.content;
  let content: WloToolResult['content'];
  if (!json || !first) {
    content = first ? [{ ...first, text: `${lines}\n\n${first.text}` }, ...rest] : [{ type: 'text' as const, text: lines }];
  } else {
    // Block 0 IS the payload there: the field goes into it, the sentence after it.
    let payload: unknown;
    try { payload = JSON.parse(first.text); } catch { payload = undefined; }
    const merged = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? [{ ...first, text: JSON.stringify({ resolvedCollection: field, ...payload }) }]
      : [first];
    content = [...merged, { type: 'text' as const, text: lines }, ...rest];
  }
  const structured = result.structuredContent;
  return {
    ...result,
    content,
    ...(structured && typeof structured === 'object'
      ? { structuredContent: { ...(structured as Record<string, unknown>), resolvedCollection: field } }
      : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = any;

interface CollectionArgOptions {
  /** The parameter the resolved nodeId is written to. */
  idParam: string;
  /** An id was given — the name is then ignored and nothing is looked up. Default: `idParam` is set. */
  hasId?: (params: Params) => boolean;
  /** The name of this tool's narrowing parameter. */
  disciplineParam: 'discipline' | 'collectionDiscipline';
  /** A fallback for the subject when the parameter is not set (browse: `subject`). */
  disciplineFallback?: (params: Params) => string | undefined;
  /** Answered when neither an id nor a name came — only for tools whose id used to be required. */
  missing?: string;
}

/**
 * Wrap a handler so it may be called with `collection` instead of an id.
 *
 * With an id — or without a name — the handler runs exactly as before: no
 * lookup, no extra field. Only a name WITHOUT an id is resolved, and an
 * unresolved one ends the call here.
 */
export function withCollectionByName(
  opts: CollectionArgOptions,
  handler: (params: Params, extra: unknown) => Promise<WloToolResult>,
): (params: Params, extra: unknown) => Promise<WloToolResult> {
  // A blank id is no id: it must not reach the handler as a nodeId.
  const hasId = opts.hasId ?? ((p: Params) => Boolean(typeof p[opts.idParam] === 'string' ? p[opts.idParam].trim() : p[opts.idParam]));
  return async (params, extra) => {
    const name = typeof params.collection === 'string' ? params.collection.trim() : '';
    if (hasId(params) || !name) {
      if (opts.missing && !hasId(params)) return codedErrorResult('invalid_input', opts.missing);
      return handler(params, extra);
    }
    const json = params.outputFormat === 'json';
    let resolution: CollectionByName;
    const subject: unknown = params[opts.disciplineParam] ?? opts.disciplineFallback?.(params);
    try {
      resolution = await resolveCollectionByName(name, typeof subject === 'string' ? subject : undefined);
    } catch (err) {
      // The handler's own catch is not around this read; same shape, though.
      return toolError('Fehler beim Auflösen der Sammlung', err);
    }
    if (!resolution.ok) {
      // "Given" means it narrowed: an unresolved subject narrowed nothing.
      const subjectGiven = typeof subject === 'string' && subject.trim() !== '' && !resolution.unresolvedDiscipline;
      return ambiguousResult(name, resolution, opts.disciplineParam, json, subjectGiven);
    }
    const result = await handler({ ...params, [opts.idParam]: resolution.collection.nodeId }, extra);
    return withResolved(result, resolution, opts.disciplineParam, json);
  };
}
