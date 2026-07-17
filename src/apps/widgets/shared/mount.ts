/**
 * shared/mount.ts – common bootstrap for the "render the tool output into
 * #wlo-root and repaint on host updates" widgets (search-results, topic-page).
 * Extracted from their byte-identical main.ts files; the browse widget keeps
 * its own entry (it additionally manages tree state + focus).
 *
 * Also stamps the resolved locale onto <html lang> on every paint: the shell
 * is emitted with lang="de" at build time, but the body copy follows the
 * host's locale (WCAG 3.1.2).
 */

import type { Locale } from './strings.js';
import { resolveLocale } from './strings.js';
import { createHost } from './host.js';

export function mountSimpleWidget(render: (output: unknown, locale: Locale) => string): void {
  const host = createHost();
  const paint = (): void => {
    const root = document.getElementById('wlo-root');
    if (!root) return;
    const locale = resolveLocale(host.locale());
    document.documentElement.lang = locale;
    root.innerHTML = render(host.toolOutput(), locale);
  };
  paint();
  host.onUpdate(paint);
}
