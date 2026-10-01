/**
 * Replays: a depth run is its starting level, the hero as it walked in, the seed, and the player's
 * input on every frame. The sim is deterministic, so feeding the same input into a fresh sim
 * reproduces the run frame for frame; the state hash at the end proves it.
 *
 * Input is quantized *before* the live sim reads it (aim to 1/64 m, stick to 1/512), so the
 * recording never differs from what the player did and stays small. Commands that bypass the input
 * (click-to-move, clicking a loot label) are logged through `Sim.onCommand`. A run where the
 * build changed mid-depth (equipping, spending points) is not replayable and is not kept.
 */
import type { Level } from '../content/level';
import type { Hero } from './hero';
import type { Sim } from './sim';
import type { CharacterInput, Gait } from './types';

export const REPLAY_VERSION = 1;

/** Input fields under short keys (changes only). */
type Packed = Partial<{ mx: number; mz: number; g: Gait; j: 1 | 0; a: 1 | 0; ah: 1 | 0; d: 1 | 0; s: number; sh: number; aim: [number, number] | null; i: 1 | 0; f: number }>;

export interface Replay {
  v: number;
  /** Depth key ("12") or Daily Trial key ("trial:2026-10-01"). */
  key: string;
  title: string;
  level: Level;
  seed: number;
  /** The hero as it entered the depth. */
  hero: Hero;
  /** Settings the sim reads (difficulty tuning, sim.*), applied while it plays back. */
  config: Record<string, unknown>;
  /** Frames recorded (the run ends when the boss falls). */
  frames: number;
  /** Clear time in frames (the stage clock, as on the waypoint). */
  time: number;
  /** sim.hash() on the last frame. */
  hash: string;
  recorded: string;
  input: Array<[number, Packed]>;
  cmds: Array<[number, 'moveTo' | 'pickUp', unknown[]]>;
}

const q = (v: number, k: number) => Math.round(v * k) / k;

/** The settings a run depends on: difficulty tuning and sim constants. */
export function simConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([k]) => k.startsWith('tune.') || k.startsWith('sim.')));
}

/** Rounds the parts of an input that are continuous, in place. */
export function quantizeInput(i: CharacterInput) {
  i.moveX = q(i.moveX, 512);
  i.moveZ = q(i.moveZ, 512);
  if (i.aim) i.aim = { x: q(i.aim.x, 64), z: q(i.aim.z, 64) };
}

function pack(i: CharacterInput): Required<Packed> {
  const b = (v: boolean): 1 | 0 => (v ? 1 : 0);
  return { mx: i.moveX, mz: i.moveZ, g: i.gait, j: b(i.jump), a: b(i.attack), ah: b(i.attackHeld), d: b(i.dodge), s: i.skill, sh: i.skillHeld, aim: i.aim ? [i.aim.x, i.aim.z] : null, i: b(i.interact), f: i.flask };
}

function unpack(p: Required<Packed>): CharacterInput {
  return {
    moveX: p.mx, moveZ: p.mz, gait: p.g, jump: !!p.j, attack: !!p.a, attackHeld: !!p.ah, dodge: !!p.d, skill: p.s, skillHeld: p.sh,
    aim: p.aim ? { x: p.aim[0], z: p.aim[1] } : null, interact: !!p.i, flask: p.f,
  };
}

const EMPTY: Required<Packed> = { mx: 0, mz: 0, g: 'run', j: 0, a: 0, ah: 0, d: 0, s: -1, sh: 0, aim: null, i: 0, f: -1 };
const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b);

/** The hero's build as far as a replay cares: what changes it changes the run. */
export function buildSignature(hero: Hero): string {
  return JSON.stringify([Object.entries(hero.equipment).map(([k, v]) => [k, v?.uid ?? null]), hero.tree, hero.hotbar, Object.entries(hero.jewels).map(([k, v]) => [k, v.uid])]);
}

export class ReplayRecorder {
  private prev: Required<Packed> = { ...EMPTY };
  private input: Replay['input'] = [];
  private cmds: Replay['cmds'] = [];
  private readonly signature: string;
  /** False once the build changed mid-run (the recording can't reproduce it). */
  valid = true;

  constructor(readonly sim: Sim, private meta: { key: string; title: string; level: Level; seed: number; hero: Hero; config: Record<string, unknown> }) {
    this.signature = buildSignature(meta.hero);
    sim.onCommand = (name, args) => {
      this.cmds.push([sim.frame, name, structuredClone(args)]);
    };
  }

  /** Call right before sim.step(): quantizes the player's input in place and records changes. */
  capture() {
    const p = this.sim.player;
    if (!p) return;
    if (this.valid && this.sim.hero && buildSignature(this.sim.hero) !== this.signature) this.valid = false;
    quantizeInput(p.input);
    const now = pack(p.input);
    const diff: Packed = {};
    for (const k of Object.keys(now) as Array<keyof Packed>) if (!same(now[k], this.prev[k])) (diff as Record<string, unknown>)[k] = now[k];
    if (Object.keys(diff).length) this.input.push([this.sim.frame, diff]);
    this.prev = now;
  }

  /** The finished recording (call when the run ends, before any more steps). */
  finish(time: number): Replay {
    this.sim.onCommand = null;
    return {
      v: REPLAY_VERSION, key: this.meta.key, title: this.meta.title, level: this.meta.level, seed: this.meta.seed, hero: this.meta.hero, config: this.meta.config,
      frames: this.sim.frame, time, hash: this.sim.hash(), recorded: new Date().toISOString(), input: this.input, cmds: this.cmds,
    };
  }

  stop() {
    this.sim.onCommand = null;
  }
}

export class ReplayPlayer {
  private cur: Required<Packed> = { ...EMPTY };
  private ii = 0;
  private ci = 0;

  constructor(readonly sim: Sim, readonly replay: Replay) {}

  /** Call right before sim.step(): repeats this frame's commands and input. */
  apply() {
    const sim = this.sim, f = sim.frame, r = this.replay;
    const p = sim.player;
    while (this.ci < r.cmds.length && r.cmds[this.ci][0] <= f) {
      const [, name, args] = r.cmds[this.ci++];
      try {
        if (name === 'moveTo') sim.moveTo(...(args as [string, number, number, Gait]));
        else sim.pickUp(args[0] as number);
      } catch {
        // The live click failed the same way (no path); nothing to repeat.
      }
    }
    while (this.ii < r.input.length && r.input[this.ii][0] <= f) Object.assign(this.cur, r.input[this.ii++][1]);
    if (p) {
      p.input = unpack(this.cur);
      p.inputFrames = 0;
    }
  }

  get done() {
    return this.sim.frame >= this.replay.frames;
  }

  /** True when the run reproduced exactly (call when done). */
  get matches() {
    return this.sim.hash() === this.replay.hash;
  }
}
