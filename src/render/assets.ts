/** Loads the manifest, models and clip libraries built by `npm run assets`, and retargets clips on demand. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ClipTable } from '../sim/sim';
import { restPoseOf, retargetClip, type RestPose } from './retarget';

export interface ClipInfo {
  name: string;
  lib: string;
  file: string;
  duration: number;
  loop: boolean;
  rootSpeed: number;
}

export interface ModelInfo {
  id: string;
  file: string;
  note: string;
  meshes: string[];
  materials: string[];
  joints: number;
}

export interface Manifest {
  animationSourceModel: string;
  notes: string[];
  clips: ClipInfo[];
  models: ModelInfo[];
}

export function clipTable(manifest: Manifest): ClipTable {
  return Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));
}

export function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  if (!found) throw new Error('model has no skinned mesh');
  return found;
}

export class AssetLibrary {
  manifest!: Manifest;
  /** Runtime GLBs are packed losslessly (meshopt buffers, WebP textures; tools/lib/pack.mjs). */
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private models = new Map<string, Promise<GLTF>>();
  private loaded = new Map<string, GLTF>();
  private raw = new Map<string, THREE.AnimationClip>();
  private sourceRest!: RestPose;
  private retargeted = new Map<string, THREE.AnimationClip>();

  constructor(readonly base = '/assets/') {}

  private url(file: string): string {
    const embedded = (window as Window & { embeddedAssets?: Record<string, string> }).embeddedAssets;
    if (embedded) {
      if (!embedded[file]) throw new Error(`Missing embedded asset: ${file}`);
      return embedded[file];
    }
    return this.base + file;
  }

  async init(preloadModels: string[]) {
    this.manifest = await (await fetch(this.url('manifest.json'))).json();
    const libs = [...new Set(this.manifest.clips.map((c) => c.file))];
    await Promise.all([
      ...libs.map(async (file) => {
        const gltf = await this.loader.loadAsync(this.url(file));
        for (const clip of gltf.animations) this.raw.set(clip.name, clip);
      }),
      ...[this.manifest.animationSourceModel, ...preloadModels].map((id) => this.loadModel(id)),
    ]);
    this.sourceRest = restPoseOf(firstSkinnedMesh(this.model(this.manifest.animationSourceModel).scene).skeleton);
  }

  loadModel(id: string): Promise<GLTF> {
    let p = this.models.get(id);
    if (!p) {
      const info = this.manifest.models.find((m) => m.id === id);
      if (!info) throw new Error(`unknown model "${id}". Known: ${this.manifest.models.map((m) => m.id).join(', ')}`);
      p = this.loader.loadAsync(this.url(info.file)).then((g) => {
        this.loaded.set(id, g);
        return g;
      });
      this.models.set(id, p);
    }
    return p;
  }

  model(id: string): GLTF {
    const g = this.loaded.get(id);
    if (!g) throw new Error(`model "${id}" not loaded yet`);
    return g;
  }

  hasClip(name: string) {
    return this.raw.has(name);
  }

  /** Clip retargeted onto a skeleton; cached per (rest pose key, clip). */
  clip(name: string, restKey: string, rest: RestPose): THREE.AnimationClip {
    const key = `${restKey}|${name}`;
    let c = this.retargeted.get(key);
    if (!c) {
      const raw = this.raw.get(name);
      if (!raw) throw new Error(`unknown clip "${name}"`);
      c = retargetClip(raw, this.sourceRest, rest);
      this.retargeted.set(key, c);
    }
    return c;
  }
}
