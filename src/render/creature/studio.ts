/**
 * A tiny photo studio for one procedural creature: lit like the game, seen through the game
 * camera angle at the game's pixel density, drawn through the pixel pipeline (toon bands,
 * outlines, creases) into a small transparent target. The Workshop preview and the agent forge
 * both use it; the rig is rebuilt only when the design changes.
 */
import * as THREE from 'three';
import { config } from '../../config';
import type { GenomeEdits } from '../../content/procgen/creature';
import { snapToGrid, type IsoBasis } from '../pixelGrid';
import { LAYER, PixelTargets, type PixelPipeline } from '../pixelPipeline';
import { makeRig, poseCreature, type CreatureRig } from './view';

export const PREVIEW_POSES = ['idle', 'walk', 'bite', 'claw', 'slam', 'spit', 'roar', 'hit', 'dead'] as const;
export type PreviewPose = (typeof PREVIEW_POSES)[number];

/** Pose state for a preview pose at normalized time u (0..1). */
export function previewState(pose: PreviewPose, u: number, stride: number) {
  const base = { t: u * 2, phase: 0, speed: 0, state: 'idle' as const, stateTime: 0, deadTime: 0, action: null as { pose: string; u: number } | null };
  switch (pose) {
    case 'idle': return base;
    case 'walk': return { ...base, phase: u * Math.PI * 2, speed: 3 * stride };
    case 'hit': return { ...base, state: 'hit' as const, stateTime: u * 0.3 } as never;
    case 'dead': return { ...base, state: 'dead' as const, deadTime: u * 0.6 } as never;
    default: return { ...base, action: { pose, u } };
  }
}

export interface StudioSubject {
  plan: string;
  seed: number;
  palette: string;
  genome?: GenomeEdits;
  scale?: number;
}

export class CreatureStudio {
  readonly scene = new THREE.Scene();
  private holder = new THREE.Group();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private targets: PixelTargets;
  rig: CreatureRig | null = null;
  private key = '';

  constructor(private renderer: THREE.WebGLRenderer, private pipeline: PixelPipeline, private basis: IsoBasis, readonly size = 128) {
    this.scene.add(new THREE.HemisphereLight(0xc4ccff, 0x3d3446, 1.35));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
    sun.position.set(10, 25, 15);
    this.scene.add(sun);
    this.scene.add(this.holder);
    this.targets = new PixelTargets(size, size);
  }

  /** Rebuilds the rig when the subject changed; returns it. */
  setSubject(s: StudioSubject): CreatureRig {
    const key = JSON.stringify([s.plan, s.seed, s.palette, s.genome ?? null]);
    if (key !== this.key || !this.rig) {
      this.disposeRig();
      this.rig = makeRig(s.plan, s.seed, s.palette, s.genome);
      this.holder.add(this.rig.mesh);
      this.key = key;
    }
    this.holder.scale.setScalar(s.scale ?? 1);
    const ppm = config['render.pixelsPerMeter'];
    const b = this.basis;
    const f = snapToGrid({ x: 0, y: 0.7 * (s.scale ?? 1), z: 0 }, b, ppm);
    this.cam.position.set(f.x - b.forward.x * 40, f.y - b.forward.y * 40, f.z - b.forward.z * 40);
    this.cam.lookAt(f.x, f.y, f.z);
    const half = this.size / 2 / ppm;
    Object.assign(this.cam, { left: -half, right: half, top: half, bottom: -half });
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    return this.rig;
  }

  /** Renders the current subject in a pose, turned `yaw` radians; returns RGBA pixels. */
  render(pose: PreviewPose, u: number, yaw: number): { width: number; height: number; data: Uint8ClampedArray } {
    if (!this.rig) throw new Error('studio has no subject');
    this.holder.rotation.y = yaw;
    poseCreature(this.rig, previewState(pose, u, this.rig.genome.stride) as never);
    this.scene.updateMatrixWorld(true);
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevTarget = r.getRenderTarget();
    r.setClearColor(0x000000, 0);
    try {
      this.pipeline.renderLowRes(this.targets, this.scene, this.cam, [LAYER.MAIN]);
      return this.pipeline.read(this.targets);
    } finally {
      r.setClearColor(prevClear, prevAlpha);
      r.setRenderTarget(prevTarget);
    }
  }

  private disposeRig() {
    if (!this.rig) return;
    this.rig.mesh.removeFromParent();
    this.rig.mesh.geometry.dispose();
    for (const m of [this.rig.mesh.material].flat()) (m as THREE.Material).dispose();
    this.rig = null;
  }

  dispose() {
    this.disposeRig();
    this.targets.dispose();
  }
}
