/**
 * tools/curation-reply.ts – the shapes a curation tool answers in.
 *
 * Split out of `curation-shared.ts` (audit 2026-11-12, A-5), which had grown to
 * three jobs: registering and gating a tool, the preview/confirm conversation,
 * and reporting what landed. These few functions are what all three stand on,
 * so they are a leaf: nothing here imports another curation module.
 */

import { codedErrorResult } from './shared.js';
import type { WloToolResult } from '../apps/register.js';

export function textResult(text: string, isError = false): WloToolResult {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

/**
 * A plain German refusal. It carries the generic code `refused`, so EVERY
 * curation refusal has `structuredContent.error` — a chatbot that reads only
 * `structuredContent` otherwise sees nothing but `isError`. Where a program can
 * do something specific with the case, use `codedError` with its own code.
 */
export function errorText(text: string): WloToolResult {
  return codedError('refused', text);
}

/**
 * A refusal a PROGRAM can act on: the same text, plus `structuredContent.error`
 * with a code (BOERDi rule "errors as codes", English identifiers per E6). The
 * chatbot reads only `structuredContent`; a refusal without a code made it
 * match German sentences.
 */
export function codedError(code: string, text: string, extra: Record<string, unknown> = {}): WloToolResult {
  return codedErrorResult(code, text, extra);
}

/** A plain reply that reports something done. */
export function plainText(text: string): WloToolResult {
  return textResult(text);
}

/**
 * Put a line in front of an existing reply without losing its error flag.
 * Used to report the new record's id above the per-field outcome.
 */
export function prependText(result: WloToolResult, line: string): WloToolResult {
  return { ...result, content: [{ type: 'text' as const, text: line }, ...result.content] };
}
