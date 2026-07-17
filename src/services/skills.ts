/**
 * services/skills.ts – Find WLO "skills" and return their instructions.
 *
 * A skill is a reusable instruction document (Markdown) curated as an uploaded
 * file in a WLO collection. `findSkills` reuses `listCollectionContents` (the
 * same `/children` primitive the `/api/collection` REST endpoint uses — reliable
 * for reference collections), ranks the entries against an optional task query
 * (local match on title + description, since a skills collection is small and
 * curated), and — by default — fetches each match's raw Markdown via its
 * anonymous `downloadUrl` so the caller can apply it. Shared by the
 * `find_wlo_skills` MCP tool and (potentially) the REST/launcher path.
 */

import { getNodeDownloadText } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { mapPool } from '../tools/shared.js';
import { listCollectionContents } from './search.js';

export interface Skill {
  nodeId: string;
  title: string;
  description: string;
  url: string;
  downloadUrl: string;
  /** Raw instruction Markdown, present when includeContent (default) and fetchable. */
  content?: string;
}

export interface FindSkillsOptions {
  collectionId: string;
  query?: string;
  maxResults?: number;
  includeContent?: boolean;
}

/** Upper bound on the catalogue we scan before ranking/capping (skills collections are small). */
const CATALOGUE_MAX = 50;

/** Count how many query terms appear in a node's title + description. */
function scoreNode(node: FormattedNode, terms: string[]): number {
  const hay = `${node.title} ${node.description}`.toLowerCase();
  return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
}

function toSkill(n: FormattedNode): Skill {
  return { nodeId: n.nodeId, title: n.title, description: n.description, url: n.url, downloadUrl: n.downloadUrl };
}

export async function findSkills(opts: FindSkillsOptions): Promise<Skill[]> {
  const listed = await listCollectionContents(opts.collectionId, CATALOGUE_MAX);
  let nodes = listed.results;

  const query = (opts.query ?? '').trim();
  if (query) {
    // Unicode-aware split: \W treats ä/ö/ü/ß as separators, so "Köln" would
    // produce no usable term and the ranking would silently do nothing.
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
    if (terms.length) {
      // Stable sort by descending relevance — best-matching skills first. A small
      // curated collection is not hard-filtered, so the model always sees the
      // available options with the most relevant on top.
      nodes = [...nodes].sort((a, b) => scoreNode(b, terms) - scoreNode(a, terms));
    }
  }

  const top = nodes.slice(0, opts.maxResults ?? 5).map(toSkill);

  if (opts.includeContent !== false) {
    const contents = await mapPool(top, 5, (s) => getNodeDownloadText(s.nodeId));
    top.forEach((s, i) => {
      const md = contents[i];
      if (md != null) s.content = md;
    });
  }

  return top;
}
