import { build } from 'vite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'public/assets/manifest.json'), 'utf8'));
const files = new Set(['manifest.json', ...manifest.models.map(m => m.file), ...manifest.clips.map(c => c.file)]);
const assets = {};
for (const file of files) {
  const bytes = await readFile(path.join(root, 'public/assets', file));
  const mime = file.endsWith('.json') ? 'application/json' : 'model/gltf-binary';
  assets[file] = `data:${mime};base64,${bytes.toString('base64')}`;
}
const result = await build({
  root, configFile: false, publicDir: false,
  define: { 'import.meta.env.BASE_URL': JSON.stringify('./') },
  build: {
    target: 'es2022', write: false, minify: true,
    lib: { entry: path.join(root, 'src/main.ts'), name: 'PixelEngine', formats: ['iife'] },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
if (outputs.length !== 1 || outputs[0].type !== 'chunk') throw new Error('Expected one self-contained JavaScript bundle');
const code = `window.embeddedAssets=${JSON.stringify(assets)};\n${outputs[0].code}`.replace(/<\/script/gi, '<\\/script');
const template = await readFile(path.join(root, 'index.html'), 'utf8');
const html = template.replace('<script type="module" src="/src/main.ts"></script>', () => `<script>${code}</script>`);
await mkdir(path.join(root, 'standalone'), { recursive: true });
const dest = path.join(root, 'standalone/3dpixel2d.html');
await writeFile(dest, html);
console.log(`Created ${dest} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB); all models, animation, JavaScript and physics embedded.`);
