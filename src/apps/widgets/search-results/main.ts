/**
 * search-results/main.ts – W1 browser entry (bundled+inlined by build.mjs).
 * Thin shell around the shared mount: render the tool output (a
 * SearchAllPayload) into `#wlo-root`, repaint on host updates.
 */

import { renderSearchResults } from './render.js';
import { mountSimpleWidget } from '../shared/mount.js';
import type { SearchAllPayload } from '../shared/types.js';

mountSimpleWidget((output, locale) => renderSearchResults(output as SearchAllPayload | undefined, locale));
