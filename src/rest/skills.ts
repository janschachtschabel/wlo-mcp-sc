/**
 * rest/skills.ts – Registry + raw loader for the AI-app "skills".
 *
 * A skill is a self-contained Markdown instruction file that tells an AI chat how
 * to use the WLO REST API for one job. The prompt launcher hands a chat the
 * *knowledge* (base URL + endpoints) and points it at these skills, which the chat
 * then loads by URL: `GET /api/skills` (list, each with an `id`) →
 * `GET /api/skills/<id>` (the raw Markdown).
 *
 * `id` is a stable slug today; it is intended to become a WLO nodeId later (the
 * loader keys on the id, so the URL contract survives that change). The id is only
 * ever looked up in the closed `SKILLS` list — the served file path is a constant
 * from the registry, never derived from the request → no directory traversal.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillMeta {
  /** Stable id used in the URL (`/api/skills/<id>`). A slug now, a nodeId later. */
  id: string;
  name: string;
  description: string;
  /** File under `public/skills/` — a registry constant, never from the request. */
  file: string;
}

const SKILLS: SkillMeta[] = [
  {
    id: 'wlo-search',
    name: 'WLO Search',
    description:
      'Find open educational resources (OER) from WirLernenOnline via the public WLO REST API and summarise them for the user.',
    file: 'wlo-search.skill.md',
  },
  {
    id: 'wlo-topic-launcher',
    name: 'WLO Topic Launcher',
    description:
      'Guide a learner into a WirLernenOnline topic page (structured entry point) and its background texts.',
    file: 'wlo-topic-launcher.skill.md',
  },
];

export interface SkillListEntry {
  id: string;
  name: string;
  description: string;
  /** Relative path to fetch the raw Markdown; resolve against the API base. */
  path: string;
}

/** The public skill catalogue (no file paths leak). */
export function listSkills(): SkillListEntry[] {
  return SKILLS.map(({ id, name, description }) => ({
    id,
    name,
    description,
    path: `/api/skills/${id}`,
  }));
}

// `public/skills/` sits at the repo root, two levels up whether this runs compiled
// (`dist/rest/skills.js`) or via tsx (`src/rest/skills.ts`).
const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'skills');

/** Load a skill's raw Markdown by id, or `null` for an unknown/unreadable id. */
export async function loadSkillMarkdown(id: string): Promise<string | null> {
  const meta = SKILLS.find(s => s.id === id);
  if (!meta) return null;
  try {
    return await readFile(join(skillsDir, meta.file), 'utf8');
  } catch {
    return null;
  }
}
