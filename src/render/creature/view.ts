/**
 * A procedural creature on screen: builds the rig from its genome and palette, then poses it
 * procedurally every sprite tick from sim state. There are no keyframes anywhere:
 *
 * - gait: legs swing and lift on per-plan phase patterns (trot, tripod, wave, alternating), the
 *   body bobs and rolls, the spine waves for serpents and centipedes, blobs hop and squash;
 * - actions: the skill's `pose` hint (bite, claw, slam, spit, charge, roar, cast, leap, burst)
 *   shapes the timeline progress into neck thrusts, jaw snaps, rearing slams and swells;
 * - reactions: flinches, frozen holds and a collapsing death roll.
 */
import * as THREE from 'three';
import { config } from '../../config';
import { PALETTES } from '../../content/monsters';
import { generateGenome, type GenomeEdits } from '../../content/procgen/creature';
import { skill as skillDef } from '../../content/skills';
import type { Sim } from '../../sim/sim';
import type { Character, Look } from '../../sim/types';
import { glowMaterial, toonMaterial, writesNormals } from '../materials';
import { LAYER } from '../pixelPipeline';
import { buildCreature, type CreatureRig } from './build';

export type { CreatureRig };

const shadowMaterial = writesNormals(
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  'fx',
);
const shadowGeometry = new THREE.CircleGeometry(0.36, 20);
const auraGeometry = new THREE.RingGeometry(0.42, 0.56, 24);

const TINT_EMISSIVE: Record<string, [number, number, number]> = {
  none: [0, 0, 0], frozen: [0.25, 0.45, 0.7], chilled: [0.05, 0.15, 0.3], burning: [0.5, 0.15, 0], shocked: [0.45, 0.4, 0.05],
  poisoned: [0.08, 0.3, 0.02], shielded: [0.5, 0.45, 0.2], empowered: [0.3, 0.1, 0.4],
};

/** Creates a creature rig for a plan/preset name, seed and palette id (agent tools reuse this). */
export function makeRig(plan: string, seed: number, paletteId: string, edits?: GenomeEdits): CreatureRig {
  const pal = PALETTES[paletteId] ?? PALETTES.bone;
  const genome = generateGenome(plan, seed, edits);
  const rig = buildCreature(genome, pal);
  const body = toonMaterial(0xffffff, null, true);
  const glow = glowMaterial(pal.glow);
  rig.mesh.material = [body, glow];
  rig.mesh.castShadow = false;
  rig.mesh.receiveShadow = true;
  return rig;
}

export interface CreaturePoseState {
  /** Seconds (drives breathing, sway). */
  t: number;
  /** Gait phase in radians. */
  phase: number;
  /** Ground speed m/s. */
  speed: number;
  state: Character['state'];
  stateTime: number;
  deadTime: number;
  action: { pose: string; u: number } | null;
}

export class CreatureView {
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  readonly rig: CreatureRig;
  private body: THREE.MeshToonMaterial;
  private lastFlash = -1;
  private lastTint = 'none';
  private phase = 0;
  private lastTick = -1;
  private lastPos = new THREE.Vector3(NaN, 0, 0);

  constructor(readonly id: string, readonly preset: string, readonly look: Look, scale: number) {
    const plan = look.plan ?? preset.replace('creature:', '') ?? 'wolf';
    this.rig = makeRig(plan || 'wolf', look.seed ?? 1, look.palette ?? 'bone', look.genome);
    this.body = (this.rig.mesh.material as THREE.Material[])[0] as THREE.MeshToonMaterial;
    this.root.name = `creature:${id}`;
    this.root.add(this.rig.mesh);
    this.root.scale.setScalar(scale);
    this.shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.layers.set(LAYER.FX);
    this.shadow.name = `shadow:${id}`;
    if (look.aura) {
      const aura = new THREE.Mesh(auraGeometry, writesNormals(new THREE.MeshBasicMaterial({ color: look.aura, transparent: true, opacity: 0.7, depthWrite: false }), 'fx'));
      aura.layers.set(LAYER.FX);
      this.shadow.add(aura);
    }
  }

  applyProportions() {
    // Creatures have their own proportions; nothing to do.
  }

  /** Reads sim state and poses the rig (on sprite ticks in pixel mode). */
  animate(ch: Character, sim: Sim, pixel: boolean) {
    this.root.scale.setScalar(ch.scale);
    // Gait phase advances with distance travelled.
    const p = ch.pos;
    if (!Number.isNaN(this.lastPos.x)) {
      const d = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      if (d < 2) this.phase += (d / Math.max(0.2, this.rig.genome.stride * ch.scale)) * Math.PI * 2;
    }
    this.lastPos.set(p.x, p.y, p.z);
    const stepped = pixel && config['anim.stepped'];
    if (stepped && ch.sprite.tick === this.lastTick) return;
    this.lastTick = ch.sprite.tick;
    const t = sim.frame / 60;
    let action: CreaturePoseState['action'] = null;
    if (ch.action) {
      const s = skillDef(ch.action.skill);
      action = { pose: s.pose ?? (s.tags.includes('spell') ? 'cast' : 'bite'), u: Math.min(1, ch.action.t) };
    }
    poseCreature(this.rig, { t, phase: this.phase, speed: ch.speed / Math.max(0.5, ch.scale), state: ch.state, stateTime: ch.stateTime, deadTime: ch.deadTime, action });
  }

  setFlash(on: boolean, tint = 'none') {
    const v = on ? 1 : 0;
    if (v === this.lastFlash && tint === this.lastTint) return;
    this.lastFlash = v;
    this.lastTint = tint;
    const e = TINT_EMISSIVE[tint] ?? TINT_EMISSIVE.none;
    if (on) this.body.emissive.setScalar(0.85);
    else this.body.emissive.setRGB(e[0], e[1], e[2]);
  }

  setSilhouettes(_on: boolean) {
    // Creatures skip silhouettes (they rarely hide behind the cut-away walls).
  }

  setIsolated(on: boolean) {
    this.root.traverse((o) => {
      if (on) o.layers.enable(LAYER.ISOLATE);
      else o.layers.disable(LAYER.ISOLATE);
    });
  }

  dispose() {
    this.root.removeFromParent();
    this.shadow.removeFromParent();
    this.rig.mesh.geometry.dispose();
  }
}

const ease = (u: number) => u * u * (3 - 2 * u);
/** 0 -> 1 over [a, b]. */
const span = (u: number, a: number, b: number) => Math.min(1, Math.max(0, (u - a) / (b - a)));

/** Poses every bone from scratch (rest = identity rotations). Pure function of the pose state. */
export function poseCreature(rig: CreatureRig, s: CreaturePoseState) {
  const g = rig.genome;
  for (const b of rig.bones) b.rotation.set(0, 0, 0);
  rig.root.position.set(0, 0, 0);
  rig.root.scale.set(1, 1, 1);
  const moving = s.speed > 0.4;
  const gait = Math.min(1, s.speed / 3);
  const ph = s.phase;
  const breathe = Math.sin(s.t * 2.2) * 0.03;

  // ---- locomotion
  if (g.plan === 'blob') {
    const hop = moving ? Math.abs(Math.sin(ph * 0.5)) : 0;
    const squash = moving ? 1 - 0.25 * Math.cos(ph) : 1 + Math.sin(s.t * 3) * 0.06;
    rig.root.position.y = hop * 0.35;
    rig.root.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  } else if (g.plan === 'floater') {
    rig.root.position.y = Math.sin(s.t * 2) * 0.08;
    rig.spine[0].rotation.x = moving ? 0.25 * gait : breathe;
    rig.tentacles.forEach((chain, i) => chain.forEach((b, k) => {
      b.rotation.x = Math.sin(s.t * 3 + i + k * 0.8) * 0.25 + (moving ? -0.3 * gait : 0);
      b.rotation.z = Math.cos(s.t * 2.4 + i * 1.3 + k * 0.7) * 0.2;
    }));
  } else {
    rig.root.position.y = (moving ? Math.abs(Math.sin(ph)) * 0.05 * gait : 0) + breathe * 0.5;
    if (rig.spine[0]) rig.spine[0].rotation.z = moving ? Math.sin(ph) * 0.04 * gait : 0;
    if (g.plan === 'serpent' || g.plan === 'centipede') {
      const amp = g.plan === 'serpent' ? (moving ? 0.35 : 0.12) : moving ? 0.12 : 0.04;
      const w = g.plan === 'serpent' ? (moving ? ph * 0.6 : s.t * 1.5) : ph * 0.5;
      rig.spine.forEach((b, i) => (b.rotation.y = Math.sin(w - i * 0.9) * amp));
    }
    for (const leg of rig.legs) {
      const a = ph + leg.phase;
      const swing = moving ? Math.sin(a) * 0.55 * gait : 0;
      const lift = moving ? Math.max(0, Math.cos(a)) * 0.6 * gait : 0;
      if (leg.mid) {
        // Arthropod legs: swing around the vertical axis, lift by raising the knee.
        leg.upper.rotation.y = swing * 0.8 * leg.side;
        leg.upper.rotation.z = -leg.side * lift * 0.5;
        leg.mid.rotation.z = leg.side * lift * 0.3;
      } else {
        leg.upper.rotation.x = -swing;
        leg.lower.rotation.x = lift * (leg.front ? -0.9 : 0.9) + swing * 0.3;
        leg.foot.rotation.x = swing * 0.5;
      }
    }
    rig.tail.forEach((b, i) => {
      b.rotation.y = Math.sin(s.t * 2.2 - i * 0.7) * (0.12 + (moving ? 0.1 : 0));
      b.rotation.x = Math.sin(s.t * 1.7 - i * 0.5) * 0.05;
    });
    for (const arm of rig.arms) {
      arm.upper.rotation.x = moving ? -Math.sin(ph + (arm.side > 0 ? 0 : Math.PI)) * 0.4 * gait : breathe * 2;
      arm.lower.rotation.x = -0.2;
    }
  }
  for (const w of rig.wings) w.bone.rotation.z = w.side * (Math.sin(s.t * (moving ? 9 : 2.5)) * (moving ? 0.6 : 0.15) + 0.1);
  if (rig.neck[0]) rig.neck[0].rotation.x = breathe;
  if (rig.jaw) rig.jaw.rotation.x = Math.max(0, Math.sin(s.t * 1.3)) * 0.08;

  // ---- actions
  const act = s.action;
  if (act) {
    const u = act.u;
    const wind = ease(span(u, 0, 0.42)), strike = ease(span(u, 0.42, 0.58)), rec = ease(span(u, 0.6, 1));
    const k = wind * (1 - strike) - strike * (1 - rec) * 0.6;
    const neck = rig.neck[rig.neck.length - 1] ?? rig.head;
    switch (act.pose) {
      case 'bite':
        neck.rotation.x = -0.5 * wind * (1 - strike) + 0.5 * strike * (1 - rec);
        rig.head.rotation.x = -0.3 * wind * (1 - strike) + 0.2 * strike * (1 - rec);
        if (rig.jaw) rig.jaw.rotation.x = 0.7 * wind * (1 - strike) + 0.05;
        if (rig.spine.length) rig.spine[rig.spine.length - 1].rotation.x = 0.15 * strike * (1 - rec);
        break;
      case 'claw':
        for (const arm of rig.arms) {
          arm.upper.rotation.x = -1.6 * wind * (1 - strike) + 0.6 * strike * (1 - rec);
          arm.lower.rotation.x = -0.6 * wind;
        }
        if (!rig.arms.length) for (const leg of rig.legs.filter((l) => l.front)) {
          leg.upper.rotation.x = -1.1 * wind * (1 - strike) + 0.4 * strike * (1 - rec);
          leg.lower.rotation.x = -0.8 * wind;
        }
        if (rig.jaw) rig.jaw.rotation.x = 0.4 * strike * (1 - rec);
        break;
      case 'slam': {
        const rear = -0.55 * wind * (1 - strike) + 0.25 * strike * (1 - rec);
        if (rig.spine[0]) rig.spine[0].rotation.x = rear;
        rig.root.position.y += 0.25 * wind * (1 - strike);
        for (const arm of rig.arms) arm.upper.rotation.x = -2.2 * wind * (1 - strike) + 0.4 * strike;
        if (rig.jaw) rig.jaw.rotation.x = 0.6 * strike * (1 - rec);
        break;
      }
      case 'spit': case 'cast':
        neck.rotation.x = 0.3 * wind * (1 - strike) - 0.4 * strike * (1 - rec);
        rig.head.rotation.x = -0.4 * wind * (1 - strike);
        if (rig.jaw) rig.jaw.rotation.x = 0.8 * strike * (1 - rec) + 0.2 * wind;
        if (act.pose === 'cast') {
          if (rig.spine[0]) rig.spine[0].rotation.x = -0.25 * wind * (1 - rec);
          for (const arm of rig.arms) arm.upper.rotation.x = -1.8 * wind * (1 - rec);
        }
        break;
      case 'charge':
        if (rig.spine[0]) rig.spine[0].rotation.x = 0.18 * wind;
        neck.rotation.x = 0.4 * wind;
        rig.head.rotation.x = 0.3 * wind;
        break;
      case 'roar':
        neck.rotation.x = -0.6 * wind * (1 - rec);
        rig.head.rotation.x = -0.4 * wind * (1 - rec);
        rig.head.rotation.z = Math.sin(s.t * 40) * 0.08 * wind * (1 - rec);
        if (rig.jaw) rig.jaw.rotation.x = 0.9 * wind * (1 - rec);
        if (rig.spine[0]) rig.spine[0].rotation.x = -0.25 * wind * (1 - rec);
        break;
      case 'leap':
        rig.root.position.y -= 0.15 * wind * (1 - strike);
        if (rig.spine[0]) rig.spine[0].rotation.x = -0.2 * strike * (1 - rec);
        break;
      case 'burst': {
        const swell = 1 + 0.45 * ease(span(u, 0, 0.95));
        rig.root.scale.multiplyScalar(swell);
        rig.root.position.x = Math.sin(s.t * 60) * 0.03 * u;
        break;
      }
      default:
        neck.rotation.x = -0.3 * k;
    }
  }

  // ---- reactions
  if (s.state === 'hit') {
    const u = Math.min(1, s.stateTime / 0.3);
    const k = Math.sin(u * Math.PI);
    if (rig.spine[0]) rig.spine[0].rotation.x -= 0.25 * k;
    rig.head.rotation.x -= 0.35 * k;
  } else if (s.state === 'stun') {
    rig.head.rotation.z = Math.sin(s.t * 6) * 0.15;
  } else if (s.state === 'dead') {
    const u = ease(Math.min(1, s.deadTime / 0.55));
    rig.root.rotation.z = 1.45 * u;
    rig.root.position.y = -0.05 * u + (g.plan === 'floater' ? -g.float * u : 0);
    for (const leg of rig.legs) {
      leg.upper.rotation.x = 0.6 * u;
      leg.lower.rotation.x = (leg.front ? -1.2 : 1.2) * u;
    }
    if (rig.jaw) rig.jaw.rotation.x = 0.5 * u;
    rig.tail.forEach((b, i) => (b.rotation.y = 0.2 * u * (i + 1)));
  }
}
