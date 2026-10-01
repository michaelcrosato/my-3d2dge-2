#!/usr/bin/env node
/**
 * Applies the pixel-art budgets (tools/lib/simplify.mjs: triangles, texture size) to the committed
 * character models in public/assets/models, in place, and records them in the manifest. `npm run assets` applies the
 * same step when it rebuilds models from the source packs.
 *
 *   node tools/simplify-models.mjs            simplify every model that is still over budget
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { countTriangles, keepFor, shrinkTextures, simplifyModel, TEXTURE_MAX } from './lib/simplify.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public', 'assets', 'models');
const MANIFEST = path.join(ROOT, 'public', 'assets', 'manifest.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let before = 0, after = 0;
for (const m of manifest.models) {
  const file = path.join(ROOT, 'public', 'assets', m.file);
  const doc = await io.read(file);
  const t0 = countTriangles(doc);
  before += t0;
  const needsMesh = !m.simplified && keepFor(m.id) < 1;
  const needsTex = (m.textureMax ?? Infinity) > TEXTURE_MAX;
  if (!needsMesh && !needsTex) {
    after += t0;
    continue;
  }
  const size0 = fs.statSync(file).size;
  if (needsMesh) await simplifyModel(doc, m.id);
  if (needsTex) await shrinkTextures(doc);
  const t1 = countTriangles(doc);
  after += t1;
  await io.write(file, doc);
  if (needsMesh) m.simplified = keepFor(m.id);
  m.textureMax = TEXTURE_MAX;
  m.triangles = t1;
  console.error(`${m.id}: ${t0} -> ${t1} triangles, ${(size0 / 1e6).toFixed(2)} -> ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.error(`total: ${before} -> ${after} triangles`);
