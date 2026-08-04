/**
 * topic-page/main.ts – W4 browser entry (bundled+inlined by build.mjs).
 * Shell around the shared tile mount: render the tool output (a
 * SwimlanePayload) into `#wlo-root`, open a card's Einzelansicht on demand, and
 * hand follow-up buttons to the conversation.
 */

import { renderTopicPage } from './render.js';
import { mountTileWidget } from '../shared/mount.js';
import type { SwimlanePayload } from '../shared/types.js';

mountTileWidget((output, locale, state) =>
  renderTopicPage(output as SwimlanePayload | undefined, locale, state));
