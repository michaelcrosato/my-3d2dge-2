#!/usr/bin/env node
/**
 * Asset pipeline: free Quaternius packs (CC0) -> optimized runtime assets in public/assets.
 *
 *   npm run assets              download missing packs, extract, build (skips up-to-date outputs)
 *   npm run assets -- --force   rebuild everything
 *
 * What it does and why:
 * - Animation libraries (UAL1, UAL2; in-place variants): meshes removed; scale tracks and every
 *   translation track except `pelvis` removed, so characters keep their own bone lengths and
 *   runtime bone scaling (chunky heads/hands) is not overwritten; redundant keys resampled away.
 * - Character parts: base-color textures only, max 512 px (characters render ~48 px tall);
 *   normal / ORM / roughness maps dropped (the toon shading ignores them); triangles simplified to
 *   30-60% with meshoptimizer (tools/lib/simplify.mjs; invisible at pixel-art size).
 * - Heads: cut out of the Superhero full-body meshes by skin weight (Head + neck_01), because the
 *   outfits are meant to be worn with a head only (full bodies clip through the clothes).
 * - public/assets/manifest.json: every clip (duration, loop flag, root-motion speed measured on the
 *   _RM variants) and every model (meshes, materials). Read by the runtime, the sim and agents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { downloadItchStandard } from './lib/itch.mjs';
import { countTriangles, keepFor, simplifyModel } from './lib/simplify.mjs';
import { listZip, readZipEntry } from './lib/unzip.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'quaternius');
const SRC = path.join(CACHE, 'extracted');
const OUT = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
const TEXTURE_MAX = 512;
const log = (...a) => console.error('[assets]', ...a);

const PACKS = {
  ual1: {
    slug: 'universal-animation-library',
    keep: [/Unreal-Godot\/UAL1_Standard(_RM)?\.glb$/, /License\.txt$/],
  },
  ual2: {
    slug: 'universal-animation-library-2',
    keep: [/Unreal-Godot\/UAL2_Standard(_RM)?\.glb$/, /Female Mannequin\/Unreal-Godot\/Mannequin_F\.glb$/],
  },
  ubc: {
    slug: 'universal-base-characters',
    keep: [/Base Characters\/Godot - UE\/[^/]+$/, /Hairstyles\/Rigged to Head Bone\/glTF \(Godot -Unreal\)\/[^/]+$/],
  },
  outfits: {
    slug: 'modular-character-outfits-fantasy',
    keep: [/Exports\/glTF \(Godot-Unreal\)\/Outfits\/[^/]+$/],
  },
};

const UAL1 = 'Universal Animation Library[Standard]/Unreal-Godot';
const UAL2 = 'Universal Animation Library 2[Standard]';
const BASE = 'Universal Base Characters[Standard]/Base Characters/Godot - UE';
const HAIR = 'Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)';
const OUTFITS = 'Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits';

const ANIMS = [
  { id: 'ual1', pack: 'ual1', file: `${UAL1}/UAL1_Standard.glb`, rm: `${UAL1}/UAL1_Standard_RM.glb` },
  { id: 'ual2', pack: 'ual2', file: `${UAL2}/Unreal-Godot/UAL2_Standard.glb`, rm: `${UAL2}/Unreal-Godot/UAL2_Standard_RM.glb` },
];

const MODELS = [
  { id: 'mannequin_m', pack: 'ual1', file: `${UAL1}/UAL1_Standard.glb`, note: 'UAL male mannequin; its bind pose is the animation source pose' },
  { id: 'mannequin_f', pack: 'ual2', file: `${UAL2}/Female Mannequin/Unreal-Godot/Mannequin_F.glb`, note: 'UAL female mannequin' },
  { id: 'head_m', pack: 'ubc', file: `${BASE}/Superhero_Male_FullBody.gltf`, headOnly: true, note: 'male head + eyes + brows (cut from Superhero_Male)' },
  { id: 'head_f', pack: 'ubc', file: `${BASE}/Superhero_Female_FullBody.gltf`, headOnly: true, note: 'female head + eyes + brows (cut from Superhero_Female)' },
  { id: 'outfit_ranger_m', pack: 'outfits', file: `${OUTFITS}/Male_Ranger.gltf`, note: 'hooded ranger, male body parts' },
  { id: 'outfit_ranger_f', pack: 'outfits', file: `${OUTFITS}/Female_Ranger.gltf`, note: 'hooded ranger, female body parts' },
  { id: 'outfit_peasant_m', pack: 'outfits', file: `${OUTFITS}/Male_Peasant.gltf`, note: 'peasant, male body parts' },
  { id: 'outfit_peasant_f', pack: 'outfits', file: `${OUTFITS}/Female_Peasant.gltf`, note: 'peasant, female body parts' },
  { id: 'hair_beard', pack: 'ubc', file: `${HAIR}/Hair_Beard.gltf`, note: 'beard (rigged to Head)' },
  { id: 'hair_buns', pack: 'ubc', file: `${HAIR}/Hair_Buns.gltf`, note: 'hair: buns' },
  { id: 'hair_buzzed', pack: 'ubc', file: `${HAIR}/Hair_Buzzed.gltf`, note: 'hair: buzzed' },
  { id: 'hair_buzzed_f', pack: 'ubc', file: `${HAIR}/Hair_BuzzedFemale.gltf`, note: 'hair: buzzed (female)' },
  { id: 'hair_long', pack: 'ubc', file: `${HAIR}/Hair_Long.gltf`, note: 'hair: long' },
  { id: 'hair_parted', pack: 'ubc', file: `${HAIR}/Hair_SimpleParted.gltf`, note: 'hair: simple parted' },
];

const srcPath = (pack, file) => path.join(SRC, pack, file);
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Reads .glb/.gltf; a .gltf that references a missing file (some packs do) gets a 1x1 placeholder. */
async function readTolerant(io, file) {
  if (file.endsWith('.glb')) return io.read(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resources = {};
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (!item.uri || item.uri.startsWith('data:')) continue;
    const p = path.join(path.dirname(file), decodeURIComponent(item.uri));
    if (fs.existsSync(p)) resources[item.uri] = fs.readFileSync(p);
    else {
      log(`warning: ${path.basename(file)} references missing "${item.uri}", using a 1x1 placeholder`);
      resources[item.uri] = PLACEHOLDER_PNG;
    }
  }
  return io.readJSON({ json, resources });
}

function disposeAnimations(root) {
  for (const a of root.listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
}
const isFresh = (out, ...inputs) =>
  !FORCE && fs.existsSync(out) && inputs.every((i) => fs.statSync(i).mtimeMs <= fs.statSync(out).mtimeMs);

async function ensurePacks() {
  for (const [key, pack] of Object.entries(PACKS)) {
    const zip = path.join(CACHE, `${pack.slug}.zip`);
    if (!fs.existsSync(zip)) {
      const r = await downloadItchStandard({ creator: 'quaternius', slug: pack.slug, outFile: zip, log });
      log(`${pack.slug}: downloaded ${(r.bytes / 1e6).toFixed(1)} MB (${r.upload})`);
    }
    const dir = path.join(SRC, key);
    const stamp = path.join(dir, '.extracted');
    if (fs.existsSync(stamp) && !FORCE) continue;
    const buf = fs.readFileSync(zip);
    let n = 0;
    for (const e of listZip(buf)) {
      if (e.name.endsWith('/') || !pack.keep.some((re) => re.test(e.name))) continue;
      const dest = path.join(dir, e.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, readZipEntry(buf, e));
      n++;
    }
    fs.writeFileSync(stamp, new Date().toISOString());
    log(`${pack.slug}: extracted ${n} files`);
  }
}

/** Keep only triangles whose three vertices are mostly skinned to the given bones. */
function cutToBones(doc, bones, threshold = 0.5) {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const names = skin.listJoints().map((j) => j.getName());
    const keep = new Set(bones.map((b) => names.indexOf(b)).filter((i) => i >= 0));
    for (const prim of mesh.listPrimitives()) {
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      const idx = prim.getIndices();
      if (!J || !W || !idx) continue;
      const count = J.getCount();
      const w = new Float32Array(count);
      const j4 = [];
      const w4 = [];
      for (let v = 0; v < count; v++) {
        J.getElement(v, j4);
        W.getElement(v, w4);
        let s = 0;
        for (let k = 0; k < 4; k++) if (keep.has(j4[k])) s += w4[k];
        w[v] = s;
      }
      const src = idx.getArray();
      const out = [];
      for (let t = 0; t < src.length; t += 3) {
        const a = src[t], b = src[t + 1], c = src[t + 2];
        if (w[a] >= threshold && w[b] >= threshold && w[c] >= threshold) out.push(a, b, c);
      }
      if (out.length === src.length) continue;
      idx.setArray(count > 65535 ? new Uint32Array(out) : new Uint16Array(out));
      compactPrimitive(prim);
    }
  }
}

function simplifyMaterials(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null);
    m.setOcclusionTexture(null);
    m.setMetallicRoughnessTexture(null);
    m.setEmissiveTexture(null);
    m.setMetallicFactor(0);
    m.setRoughnessFactor(1);
  }
}

async function measureRootMotion(io, file) {
  const doc = await io.read(file);
  const out = {};
  for (const a of doc.getRoot().listAnimations()) {
    const ch = a.listChannels().find((c) => c.getTargetPath() === 'translation' && c.getTargetNode()?.getName() === 'root');
    if (!ch) continue;
    const input = ch.getSampler().getInput();
    const output = ch.getSampler().getOutput();
    const n = input.getCount();
    const dur = input.getScalar(n - 1) - input.getScalar(0);
    const p0 = output.getElement(0, []);
    const p1 = output.getElement(n - 1, []);
    const dx = p1[0] - p0[0];
    const dz = p1[2] - p0[2];
    out[a.getName()] = { dx: +dx.toFixed(3), dz: +dz.toFixed(3), speed: dur > 0 ? +(Math.hypot(dx, dz) / dur).toFixed(3) : 0 };
  }
  return out;
}

async function buildAnimLibrary(io, spec) {
  const out = path.join(OUT, 'anims', `${spec.id}.glb`);
  const input = srcPath(spec.pack, spec.file);
  const doc = await io.read(input);
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  let removed = 0;
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const p = ch.getTargetPath();
      const name = ch.getTargetNode()?.getName();
      if (p === 'scale' || (p === 'translation' && name !== 'pelvis')) {
        const sampler = ch.getSampler();
        ch.dispose();
        removed++;
        if (sampler && !sampler.listParents().some((x) => x.propertyType === 'AnimationChannel')) sampler.dispose();
      }
    }
  }
  await doc.transform(resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }), dedup());
  const clips = root.listAnimations().map((a) => ({
    name: a.getName(),
    duration: +Math.max(...a.listSamplers().map((s) => s.getInput().getMax([])[0])).toFixed(4),
  }));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!isFresh(out, input)) {
    await io.write(out, doc);
    log(`anims/${spec.id}.glb: ${clips.length} clips, ${removed} channels stripped, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
  }
  const rootMotion = spec.rm ? await measureRootMotion(io, srcPath(spec.pack, spec.rm)) : {};
  return clips.map((c) => ({
    ...c,
    lib: spec.id,
    file: `anims/${spec.id}.glb`,
    loop: /_Loop$|Idle$/.test(c.name),
    rootSpeed: rootMotion[c.name]?.speed ?? 0,
  }));
}

async function buildModel(io, spec) {
  const out = path.join(OUT, 'models', `${spec.id}.glb`);
  const input = srcPath(spec.pack, spec.file);
  const doc = await readTolerant(io, input);
  const root = doc.getRoot();
  disposeAnimations(root);
  if (spec.headOnly) cutToBones(doc, ['Head', 'neck_01']);
  simplifyMaterials(doc);
  // Characters render ~48 art pixels tall: keep a fraction of the triangles (tools/lib/simplify.mjs).
  await simplifyModel(doc, spec.id);
  await doc.transform(
    prune({ keepLeaves: true }),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'png', resize: [TEXTURE_MAX, TEXTURE_MAX] }),
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!isFresh(out, input)) {
    await io.write(out, doc);
    log(`models/${spec.id}.glb: ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
  }
  return {
    id: spec.id,
    file: `models/${spec.id}.glb`,
    note: spec.note,
    meshes: root.listMeshes().map((m) => m.getName()),
    materials: root.listMaterials().map((m) => m.getName()),
    joints: root.listSkins()[0]?.listJoints().length ?? 0,
    simplified: keepFor(spec.id) < 1 ? keepFor(spec.id) : undefined,
    triangles: countTriangles(doc),
  };
}

async function main() {
  await ensurePacks();
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const clips = [];
  for (const spec of ANIMS) clips.push(...(await buildAnimLibrary(io, spec)));
  const models = [];
  for (const spec of MODELS) models.push(await buildModel(io, spec));
  fs.copyFileSync(path.join(SRC, 'ual1', 'Universal Animation Library[Standard]', 'License.txt'), path.join(OUT, 'LICENSE-quaternius.txt'));
  const manifest = {
    generatedBy: 'tools/build-assets.mjs (npm run assets)',
    license: 'CC0 1.0 public domain, models and animations by Quaternius (quaternius.com). See LICENSE-quaternius.txt.',
    animationSourceModel: 'mannequin_m',
    notes: [
      'All models share the 65-joint UE5-style skeleton names; rest poses differ slightly, so the runtime retargets rotations by rest-pose deltas (src/render/retarget.ts).',
      'Clips are in-place: translation only on pelvis, no scale tracks. rootSpeed (m/s) is measured from the root-motion variants and used to match stride to movement speed.',
    ],
    clips,
    models,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  log(`manifest.json: ${clips.length} clips, ${models.length} models`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
