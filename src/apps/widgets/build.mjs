/**
 * build.mjs – Apps-SDK widget build pipeline.
 *
 * Each widget is a subdirectory with a `main.ts` entry point. For each, esbuild
 * bundles `main.ts` (and its imported render/tile/state modules) into a single
 * IIFE, which — together with the shared `base.css` and the widget's own
 * `styles.css` — is INLINED into one self-contained HTML file under
 * `dist-widgets/<name>.html`. Inlining is mandatory: an external `<script src>`
 * or `<link href>` fails to load inside the sandboxed Apps-SDK iframe.
 *
 * The `.js`→`.ts` resolver bridges the project's NodeNext `.js`-extension
 * imports (required by tsc) to the on-disk `.ts` sources for esbuild.
 */

import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const widgetsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(widgetsDir, '..', '..', '..');
const outDir = join(repoRoot, 'dist-widgets');
const sharedBaseCss = join(widgetsDir, 'shared', 'base.css');

/** Resolve NodeNext-style `./x.js` relative imports to their `.ts` source. */
const jsToTsResolver = {
  name: 'js-to-ts',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.\.?\// }, args => {
      if (!args.path.endsWith('.js')) return undefined;
      const candidate = resolve(dirname(args.importer), `${args.path.slice(0, -3)}.ts`);
      return existsSync(candidate) ? { path: candidate } : undefined;
    });
  },
};

async function listWidgets() {
  const entries = await readdir(widgetsDir, { withFileTypes: true });
  const widgets = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'shared') continue;
    if (existsSync(join(widgetsDir, e.name, 'main.ts'))) widgets.push(e.name);
  }
  return widgets;
}

async function readCssIfPresent(path) {
  return existsSync(path) ? readFile(path, 'utf8') : '';
}

function htmlShell(css, js) {
  return (
    '<!doctype html>\n' +
    '<html lang="de">\n<head>\n<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    `<style>${css}</style>\n</head>\n<body>\n<div id="wlo-root"></div>\n` +
    `<script>${js}</script>\n</body>\n</html>\n`
  );
}

async function buildWidget(name) {
  const result = await build({
    entryPoints: [join(widgetsDir, name, 'main.ts')],
    bundle: true,
    format: 'iife',
    minify: true,
    platform: 'browser',
    target: 'es2020',
    write: false,
    plugins: [jsToTsResolver],
    logLevel: 'silent',
  });
  const js = result.outputFiles[0].text;
  const css = `${await readCssIfPresent(sharedBaseCss)}\n${await readCssIfPresent(join(widgetsDir, name, 'styles.css'))}`;
  await writeFile(join(outDir, `${name}.html`), htmlShell(css, js), 'utf8');
  return { name, bytes: js.length };
}

async function main() {
  const widgets = await listWidgets();
  if (widgets.length === 0) {
    console.log('[build:widgets] no widgets yet — skipping');
    return;
  }
  await mkdir(outDir, { recursive: true });
  const built = await Promise.all(widgets.map(buildWidget));
  for (const b of built) {
    console.log(`[build:widgets] ${b.name}.html (${(b.bytes / 1024).toFixed(1)} kB JS inlined)`);
  }
}

main().catch(err => {
  console.error('[build:widgets] failed:', err);
  process.exit(1);
});
