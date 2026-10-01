/**
 * Asset forge: render and inspect procedural assets without a level. Agents (and the in-game
 * Workshop) use these to preview creatures from any plan / seed / palette in every pose and
 * direction, inspect their rigs, and render item icons, so a generated asset can be looked at
 * and judged before it ever appears in a dungeon.
 */
import * as THREE from 'three';
import { config } from '../config';
import { generateGenome, type CreatureGenome } from '../content/procgen/creature';
import type { Game } from '../game';
import { makeRig, poseCreature, type CreatureRig } from '../render/creature/view';
import { snapToGrid } from '../render/pixelGrid';
import { LAYER, PixelTargets } from '../render/pixelPipeline';
import { grid, type Img } from './capture';

export const PREVIEW_POSES = ['idle', 'walk', 'bite', 'claw', 'slam', 'spit', 'roar', 'hit', 'dead'] as const;
export type PreviewPose = (typeof PREVIEW_POSES)[number];

/** Pose-state for a preview pose at normalized time u (0..1). */
function previewState(pose: PreviewPose, u: number, stride: number) {
  const base = { t: u * 2, phase: 0, speed: 0, state: 'idle' as const, stateTime: 0, deadTime: 0, action: null as { pose: string; u: number } | null };
  switch (pose) {
    case 'idle': return base;
    case 'walk': return { ...base, phase: u * Math.PI * 2, speed: 3 * stride };
    case 'hit': return { ...base, state: 'hit' as const, stateTime: u * 0.3 } as never;
    case 'dead': return { ...base, state: 'dead' as const, deadTime: u * 0.6 } as never;
    default: return { ...base, action: { pose, u } };
  }
}

export interface CreatureSheetOptions {
  plan: string;
  seed: number;
  palette: string;
  poses?: PreviewPose[];
  directions?: number;
  frames?: number;
  cell?: number;
  /** Visual scale (monster size). */
  scale?: number;
}

/**
 * Sprite sheet of a procedural creature: rows = pose x direction, columns = frames. Rendered
 * with the game's camera angle, pixel density, toon lighting and outlines.
 */
export function renderCreatureSheet(game: Game, o: CreatureSheetOptions) {
  const poses = o.poses ?? ['idle', 'walk', 'bite', 'dead'];
  const dirs = o.directions ?? 2;
  const frames = o.frames ?? 6;
  const cell = o.cell ?? 96;
  const ppm = config['render.pixelsPerMeter'];
  const studio = new THREE.Scene();
  studio.add(new THREE.HemisphereLight(0xc4ccff, 0x3d3446, 1.35));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  sun.position.set(10, 25, 15);
  studio.add(sun);
  const rig = makeRig(o.plan, o.seed, o.palette);
  const holder = new THREE.Group();
  holder.add(rig.mesh);
  holder.scale.setScalar(o.scale ?? 1);
  studio.add(holder);
  const b = game.stage.basis;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const f = snapToGrid({ x: 0, y: 0.7 * (o.scale ?? 1), z: 0 }, b, ppm);
  cam.position.set(f.x - b.forward.x * 40, f.y - b.forward.y * 40, f.z - b.forward.z * 40);
  cam.lookAt(f.x, f.y, f.z);
  const half = cell / 2 / ppm;
  Object.assign(cam, { left: -half, right: half, top: half, bottom: -half });
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const targets = new PixelTargets(cell, cell);
  const r = game.renderer;
  const prevClear = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  r.setClearColor(0x000000, 0);
  const cells: Img[] = [];
  const rows: Array<{ pose: string; dir: number }> = [];
  try {
    for (const pose of poses)
      for (let d = 0; d < dirs; d++) {
        holder.rotation.y = (d / dirs) * Math.PI * 2 + Math.PI * 0.75;
        rows.push({ pose, dir: d });
        for (let k = 0; k < frames; k++) {
          poseCreature(rig, previewState(pose, k / Math.max(1, frames - 1), rig.genome.stride) as never);
          studio.updateMatrixWorld(true);
          game.pipeline.renderLowRes(targets, studio, cam, [LAYER.MAIN]);
          cells.push(game.pipeline.read(targets));
        }
      }
  } finally {
    r.setClearColor(prevClear, prevAlpha);
    targets.dispose();
    rig.mesh.geometry.dispose();
  }
  return { sheet: grid(cells, frames, 0, [0, 0, 0, 0]), rows, frames, cell, info: rigInfo(rig) };
}

export function rigInfo(rig: CreatureRig) {
  const g: CreatureGenome = rig.genome;
  return {
    plan: g.plan, seed: g.seed, ...rig.info,
    legs: rig.legs.length, arms: rig.arms.length, tail: rig.tail.length, neck: rig.neck.length, wings: rig.wings.length, tentacles: rig.tentacles.length,
    height: Math.round(rig.height * 100) / 100, length: Math.round(g.length * 100) / 100, head: g.head.shape, eyes: g.head.eyes, horns: g.horns.count, pattern: g.pattern,
  };
}

export function genome(plan: string, seed: number) {
  return generateGenome(plan, seed);
}
