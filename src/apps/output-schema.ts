/**
 * apps/output-schema.ts – what a tool ADVERTISES as its `outputSchema`: its
 * success shape OR a coded error (review 2026-11-13).
 *
 * WHY: the SDK client (1.32.2, `client/index.js` `callTool`) validates
 * `structuredContent` against the advertised schema whenever it is PRESENT —
 * also on an `isError` result. Every coded error of this server carries
 * `structuredContent.error` (a chatbot reads `.code`, `.retryAfter`,
 * `.candidates` there), so under a success-only schema `callTool` threw
 * `-32602` and the client saw neither code nor message.
 *
 * What changes is the PUBLISHED JSON Schema alone. The server keeps validating
 * a success answer against the tool's own zod schema, and skips an `isError`
 * one, exactly as before (`server/mcp.js` `validateToolOutput`).
 */

import { z } from 'zod';

/**
 * `{ error: { code, message, … } }`. Open on both levels on purpose: an error
 * carries more beside the code (`retryAfter`, `candidates`, `outcomeOpen`), and
 * a rejected login adds `error` to whatever the tool had built
 * (`tool-defaults.ts`).
 */
export const ERROR_RESULT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
} as const;

type JsonSchema = Record<string, unknown>;

/**
 * The schema to REGISTER for a tool whose success shape is `success`.
 *
 * It parses exactly like `success` (same definition), and it is still an object
 * schema — the SDK publishes nothing for anything else (`normalizeObjectSchema`),
 * and the specification requires `type: "object"` at the top. Only its JSON
 * Schema differs: `{ type: 'object', anyOf: [success, error] }`.
 *
 * This rests on zod INTERNALS (`clone(_zod.def)`, the `_zod.toJSONSchema`
 * hook), not on its public API. A zod release that drops or renames the hook
 * raises nothing: the success-only schema is silently published again. The
 * tripwire is `tests/output-schema-errors.test.ts`, which walks every tool's
 * advertised schema and requires it to accept a coded error.
 */
export function withErrorBranch(success: z.ZodTypeAny): z.ZodTypeAny {
  if (success._zod.def.type !== 'object') return success;
  // A copy WITHOUT a parent link: the converter follows that link, and here it
  // would lead to a schema the override below keeps out of its sight.
  const published = success.clone(success._zod.def);
  published._zod.toJSONSchema = () => {
    // Same target and direction as the SDK's own conversion for `tools/list`.
    const { $schema: _dialect, definitions, ...body } = z.toJSONSchema(success, { target: 'draft-7', io: 'output' }) as JsonSchema;
    // A reference to the document root would now mean "success or error".
    if (JSON.stringify(body).includes('"$ref":"#"')) {
      throw new Error('output schema refers to its own root — give the recursive part a schema of its own');
    }
    return {
      type: 'object',
      anyOf: [body, ERROR_RESULT_JSON_SCHEMA],
      // `#/definitions/…` references are resolved from the root.
      ...(definitions ? { definitions } : {}),
    };
  };
  return published;
}
