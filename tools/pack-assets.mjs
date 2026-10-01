#!/usr/bin/env node
/**
 * Packs the committed runtime GLBs in public/assets (models and animation libraries) in place:
 * meshopt-coded buffers and lossless WebP textures (tools/lib/pack.mjs). Lossless, so renders stay
 * pixel-identical. `npm run assets` applies the same step when it rebuilds from the source packs.
 *
 *   node tools/pack-assets.mjs            pack every file that is not packed yet
 */
import fs from 'node:fs';
import path from 'node:path';
import { isPacked, packDocument, packIO } from './lib/pack.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = path.join(ROOT, 'public', 'assets', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const io = await packIO();
const files = [...new Set([...manifest.models.map((m) => m.file), ...(manifest.libraries ?? []).map((l) => l.file)])];
for (const f of fs.readdirSync(path.join(ROOT, 'public', 'assets', 'anims'))) if (f.endsWith('.glb')) files.push(`anims/${f}`);
let before = 0, after = 0;
for (const rel of [...new Set(files)]) {
  const file = path.join(ROOT, 'public', 'assets', rel);
  const doc = await io.read(file);
  const size0 = fs.statSync(file).size;
  before += size0;
  if (isPacked(doc)) {
    after += size0;
    continue;
  }
  await packDocument(doc);
  await io.write(file, doc);
  const size1 = fs.statSync(file).size;
  after += size1;
  console.error(`${rel}: ${(size0 / 1e6).toFixed(2)} -> ${(size1 / 1e6).toFixed(2)} MB`);
}
console.error(`total: ${(before / 1e6).toFixed(2)} -> ${(after / 1e6).toFixed(2)} MB`);
