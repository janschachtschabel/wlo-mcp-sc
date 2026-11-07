/**
 * tools/auth.ts – wlo_auth_status: which rights is this server calling with?
 *
 * Always registered, because "no authentication at all" is a legitimate answer
 * and the question is worth answering in every deployment. It reports the
 * resolved MODE, and — separately — whether that mode actually WORKS. Those are
 * two different facts and are reported as two fields: credentials that the
 * repository rejects leave the server configured but unable to answer anything
 * (every upstream call is 401), which nothing in a normal reply reveals.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { currentCredential } from '../auth/credential.js';
import { registerWloTool } from '../apps/register.js';
import { readAuthStatus } from '../auth/auth-status.js';
import { toolError } from './shared.js';

/** The rung of the credential chain a call currently resolves to. */
export const authStatusSchema = z.object({
  /** `anonymous` = public data only; `service` = one shared account for everyone. */
  mode: z.enum(['anonymous', 'service', 'user']),
  /** Whether the repository actually recognises us as that identity. */
  authenticated: z.boolean(),
  /** Configured identity (never the secret); absent in anonymous mode. */
  configuredAs: z.string().optional(),
  /** What edu-sharing reports back — `esguest` when we are nobody. */
  authority: z.string().nullable(),
  displayName: z.string().optional(),
  /** How the identity reached this server (plan 2026-11-07, S4). */
  credential: z.enum(['none', 'basic', 'access-block', 'ticket', 'service']),
  /** When this server stops accepting the block (ISO) — ticket and widget blocks only (R1). */
  expiresAt: z.string().optional(),
});

export function registerAuthTools(server: McpServer): void {
  registerWloTool(server, {
    name: 'wlo_auth_status',
    title: 'WLO Anmeldestatus',
    description: `Sag, mit welchen Rechten dieser MCP-Server gerade auf WLO zugreift. Nutze dies, wenn die Nutzerin fragt, ob sie angemeldet ist, warum sie bestimmte Inhalte (nicht) sieht, oder bevor du erklärst, dass etwas nicht zugänglich ist.
"mode": "anonymous" = nur öffentliche Daten (Standard); "service" = ein fest konfiguriertes Dienstkonto, dieselben Rechte für alle Nutzenden; "user" = die Rechte der angemeldeten Person.
WICHTIG: "authenticated" ist eine EIGENE Aussage. Ist mode="service" oder "user", aber authenticated=false, dann lehnt WLO die hinterlegten Zugangsdaten ab. Dann schlagen ALLE Abfragen fehl — es kommen nicht etwa nur öffentliche Inhalte, sondern gar keine. Das ist ein Konfigurationsfehler; nenne ihn, statt zu sagen, es gebe zum Thema nichts.`,
    inputSchema: {},
    outputSchema: authStatusSchema,
    annotations: { readOnlyHint: true },
    handler: async () => {
      try {
        const cred = currentCredential();
        // The same function `GET /auth/status` answers with, so the tool and the
        // endpoint cannot disagree about a login.
        const payload = await readAuthStatus(cred);
        const { mode } = payload;
        const label = payload.configuredAs ?? '';

        const text = !cred
          ? 'Zugriff ohne Anmeldung: es werden ausschließlich öffentlich sichtbare WLO-Inhalte gelesen.'
          : payload.authenticated
            ? `Angemeldet als „${payload.displayName || payload.authority}“ (${mode === 'service' ? 'gemeinsames Dienstkonto' : 'persönliches Konto'}). Die Ergebnisse folgen den Rechten dieses Kontos.`
            : `Es sind Zugangsdaten für „${label}“ hinterlegt, aber WLO akzeptiert sie nicht (${payload.authority ?? 'abgelehnt oder Repository nicht erreichbar'}). Solange das so ist, schlagen alle Abfragen fehl — es kommen nicht nur weniger Inhalte, sondern keine. Bitte die Zugangsdaten prüfen; ohne hinterlegte Zugangsdaten liest der Server wieder öffentliche Inhalte.`;

        return { content: [{ type: 'text' as const, text }], structuredContent: payload };
      } catch (err) {
        return toolError('Fehler beim Ermitteln des Anmeldestatus', err);
      }
    },
  });
}
