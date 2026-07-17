/**
 * tools/collection-stats.ts – get_collection_stats:
 * a quick composition profile of a collection (file/sub-collection counts plus a
 * facet breakdown of its files by type/subject/level).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getCollectionStats } from '../services/stats.js';
import { toolError } from './shared.js';

const BREAKDOWN_LABELS: Record<string, string> = {
  learningResourceType: 'Ressourcentyp',
  discipline: 'Fach',
  educationalContext: 'Bildungsstufe',
};

export function registerCollectionStatsTool(server: McpServer): void {
  server.tool(
    'get_collection_stats',
    `Verschaffe dir einen Überblick, WORAUS eine WLO-Sammlung besteht — wie viele Dateien (Inhalte) und Unter-Sammlungen, plus Aufschlüsselung der Dateien nach Materialtyp, Fach und Bildungsstufe. Nutze dies für einen schnellen Überblick vor dem Stöbern.
Die Aufschlüsselung zählt über bis zu 100 DIREKTE Kind-Dateien (Stichprobe, nicht der ganze Unterbaum); die Ausgabe weist darauf hin, wenn die Sammlung größer ist.`,
    {
      nodeId: z.string().describe('Collection node ID to profile.'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const stats = await getCollectionStats(params.nodeId);

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(stats) }] };
        }

        const lines: string[] = [
          `# Sammlungs-Statistik: ${stats.title || stats.nodeId}`,
          `- Inhalte (Dateien): ${stats.fileCount}`,
          `- Unter-Sammlungen: ${stats.subCollectionCount}`,
        ];
        // The breakdown is tallied over a sample of the files; say so when the
        // sample is smaller than the total so the counts aren't over-read.
        const sampled = stats.fileCount > stats.sampledFiles
          ? ` (Aufschlüsselung aus ${stats.sampledFiles} von ${stats.fileCount} Inhalten)`
          : '';
        if (sampled) lines.push(`- Hinweis:${sampled}`);
        for (const [key, buckets] of Object.entries(stats.breakdown)) {
          if (!buckets.length) continue;
          lines.push('', `## ${BREAKDOWN_LABELS[key] ?? key}`);
          for (const b of buckets) lines.push(`- ${b.label}: ${b.count}`);
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf der Sammlungs-Statistik', err);
      }
    },
  );
}
