// Bundles the game into single HTML files with no build dependencies:
//   dist/index.html     a complete page you can open or host anywhere
//   dist/artifact.html  the same page without the outer <html>/<body> shell,
//                       for publishing as a claude.ai Artifact
// The game's modules share one scope once bundled, so top-level names must be
// unique across files; the build stops if two clash.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importRe = /^import\s+(?:[\s\S]*?)\s+from\s+['"](\.[^'"]+)['"];?[ \t]*$/gm;

const order = [];
const seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(importRe)) visit(resolve(dirname(file), m[1]));
  order.push({ file, src });
}
visit(resolve(root, 'src/main.js'));

const names = new Map();
const parts = order.map(({ file, src }) => {
  const rel = relative(root, file);
  for (const m of src.matchAll(/^(?:export\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (names.has(m[1])) throw new Error(`"${m[1]}" is defined in both ${names.get(m[1])} and ${rel}`);
    names.set(m[1], rel);
  }
  const body = src.replace(importRe, '').replace(/^export\s+(?=function|const|let|class)/gm, '');
  if (/^\s*export\s/m.test(body)) throw new Error(`${rel} has an export form the bundler does not handle`);
  return `// ---- ${rel} ----\n${body.trim()}\n`;
});
const script = `(() => {\n'use strict';\n${parts.join('\n')}\n})();`;

const css = readFileSync(resolve(root, 'src/ui/style.css'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="src/ui/style.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${script}\n</script>`);

const startMark = '<!-- build:artifact-start -->';
const endMark = '<!-- build:artifact-end -->';
const inner = html.slice(html.indexOf(startMark) + startMark.length, html.indexOf(endMark));
const scriptTag = html.slice(html.indexOf('<script>'), html.lastIndexOf('</script>') + 9);
const artifact = `${inner.replace('</head>\n<body>\n', '\n').trim()}\n${scriptTag}\n`;

mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/index.html'), html.replace(startMark + '\n', '').replace(endMark + '\n', ''));
writeFileSync(resolve(root, 'dist/artifact.html'), artifact);
console.log(`Bundled ${order.length} modules: dist/index.html (${Math.round(html.length / 1024)} KB), dist/artifact.html`);
