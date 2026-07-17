/**
 * topic-page/main.ts – W4 browser entry (bundled+inlined by build.mjs).
 * Thin shell around the shared mount: render the tool output (a
 * SwimlanePayload) into `#wlo-root`, repaint on host updates.
 */

import { renderTopicPage } from './render.js';
import { mountSimpleWidget } from '../shared/mount.js';
import type { SwimlanePayload } from '../shared/types.js';

mountSimpleWidget((output, locale) => renderTopicPage(output as SwimlanePayload | undefined, locale));
