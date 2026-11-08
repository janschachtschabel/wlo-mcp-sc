/**
 * tools/curation-fulltext-input.ts – the input of one full text, validated the
 * same way for `wlo_attach_fulltext` (W1) and every item of
 * `wlo_attach_fulltexts` (W2): source URL and language follow the rules of the
 * record fields of the same meaning (`validateField`), never a second copy.
 */

import { z } from 'zod';

import { validateField } from '../services/write/fields.js';
import { FULLTEXT_SOURCES, type FulltextInput } from '../services/write/fulltext.js';

export const SOURCE_SCHEMA = z.enum(FULLTEXT_SOURCES as unknown as ['binary', 'website', 'manual'])
  .describe('binary = aus der Datei gewonnen, website = von einer Webseite, manual = von Hand.');

export type ParsedInput = { ok: true; input: FulltextInput } | { ok: false; reason: string };

export function parseFulltextInput(params: Record<string, unknown>, replace: boolean): ParsedInput {
  // Whitespace alone is no full text — with `replace` it would blank an existing one (review W1).
  if (!String(params['markdown'] ?? '').trim()) return { ok: false, reason: 'Der Volltext ist leer.' };
  const checked = (property: string, raw: unknown) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return { ok: true as const, value: undefined };
    const v = validateField(property, value);
    return v.ok ? { ok: true as const, value: v.values[0] } : { ok: false as const, reason: v.reason };
  };
  const url = checked('ccm:wwwurl', params['sourceUrl']);
  if (!url.ok) return { ok: false, reason: url.reason };
  const lang = checked('cclom:general_language', params['language']);
  if (!lang.ok) return { ok: false, reason: lang.reason };
  return { ok: true, input: {
    nodeId: String(params['nodeId']).trim(),
    markdown: String(params['markdown']),
    source: params['source'] as FulltextInput['source'],
    ...(url.value ? { sourceUrl: url.value } : {}),
    ...(lang.value ? { language: lang.value } : {}),
    replace,
  } };
}
