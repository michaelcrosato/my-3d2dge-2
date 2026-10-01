/**
 * Deterministic game simulation: Rapier physics, character state machines, AI, combat, events.
 *
 * Rules (see AGENTS.md): fixed 60 Hz steps, seeded RNG only, no wall-clock time, no DOM, no
 * rendering. Same level + seed + inputs => same state, frame for frame. Runs in the browser and
 * in Node (tests). The renderer only reads from it.
 *
 * Rapier does all spatial work: kinematic character controllers (walking, stepping, pushing),
 * dynamic crates, collision groups, shape queries for sword reach, ray casts for line of sight,
 * ground probes (blob shadows) and view occlusion (silhouettes), and collision events for crates.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { config } from '../config';
import { ATTACKS, PRESETS, animsOf, type AnimSet } from '../content/characters';
import type { Brain, CharacterDef, Level } from '../content/level';
import { dir8, DIR8_SCREEN_NAMES } from '../render/pixelGrid';
import { NavGrid, type P2 } from './nav';
import { Rng } from './rng';

export interface ClipMeta {
  duration: number;
  loop: boolean;
  rootSpeed: number;
}
export type ClipTable = Record<string, ClipMeta>;

export type Gait = 'walk' | 'run' | 'sprint';
export type CharState = 'idle' | 'move' | 'air' | 'land' | 'attack' | 'recover' | 'hit' | 'dead' | 'forced';

export interface CharacterInput {
  /** World-space XZ direction; length 0..1 scales speed. */
  moveX: number;
  moveZ: number;
  gait: Gait;
  /** One-shot triggers, consumed when used. */
  jump: boolean;
  attack: boolean;
}

export interface AnimState {
  clip: string;
  time: number;
  speed: number;
  prevClip: string | null;
  prevTime: number;
  prevSpeed: number;
  /** Weight of `clip` (1 = blend finished). */
  blend: number;
}

/** What the renderer draws: the animation state captured at the last sprite tick. */
export interface SpriteState {
  clip: string;
  time: number;
  prevClip: string | null;
  prevTime: number;
  blend: number;
  yaw: number;
  dir: number;
  tick: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Character {
  id: string;
  preset: string;
  brain: Brain;
  anims: AnimSet;
  pos: V3;
  prevPos: V3;
  vel: V3;
  yaw: number;
  grounded: boolean;
  airTime: number;
  hp: number;
  maxHp: number;
  state: CharState;
  stateTime: number;
  combo: number;
  queued: boolean;
  hitDone: boolean;
  pushing: number;
  speed: number;
  flash: number;
  knock: P2;
  spawn: { x: number; z: number; yaw: number };
  input: CharacterInput;
  inputFrames: number;
  ai: { path: P2[]; wait: number; stuck: number; last: P2 };
  order: { x: number; z: number; gait: Gait; path: P2[]; stuck: number; last: P2 } | null;
  forced: { clip: string; loop: boolean } | null;
  anim: AnimState;
  sprite: SpriteState;
  /** Height of the walkable surface under the character (Rapier ray probe; floor = 0). */
  groundY: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface Crate {
  id: string;
  pushable: boolean;
  size: number;
  pos: V3;
  prevPos: V3;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface SimEvent {
  seq: number;
  frame: number;
  type: string;
  [key: string]: unknown;
}

const CAPSULE_RADIUS = 0.3;
const CAPSULE_HALF = 0.55;
const CAPSULE_CENTER = CAPSULE_HALF + CAPSULE_RADIUS;
/** Height above the feet used for sword reach and line-of-sight rays. */
const CHEST = 1.1;
const STEP_HZ = 60;

/** Rapier collision groups: membership bits in the high half, filter bits in the low half. */
export const GROUP = { STATIC: 0x1, CRATE: 0x2, CHARACTER: 0x4 } as const;
const ALL_GROUPS = 0xffff;
const groups = (membership: number, filter = ALL_GROUPS) => ((membership << 16) | filter) >>> 0;
/** Query filters: what blocks a sword or a line of sight, and what a character can stand on. */
const BLOCKERS = groups(ALL_GROUPS, GROUP.STATIC | GROUP.CRATE);
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

let rapierReady: Promise<void> | null = null;
export const initPhysics = () => (rapierReady ??= RAPIER.init());

const emptyInput = (): CharacterInput => ({ moveX: 0, moveZ: 0, gait: 'run', jump: false, attack: false });
const chestOf = (ch: Character): V3 => ({ x: ch.pos.x, y: ch.pos.y + CHEST, z: ch.pos.z });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Everything needed to rewind a Sim exactly (Rapier snapshot + JS-side state). */
export interface SimCheckpoint {
  frame: number;
  hitstop: number;
  rng: number;
  lastTick: number;
  eventSeq: number;
  events: SimEvent[];
  world: Uint8Array;
  characters: Array<Omit<Character, 'body' | 'collider'> & { bodyHandle: number; colliderHandle: number }>;
  crates: Array<Omit<Crate, 'body' | 'collider'> & { bodyHandle: number; colliderHandle: number }>;
}

export class Sim {
  readonly dt = 1 / STEP_HZ;
  frame = 0;
  hitstop = 0;
  readonly rng: Rng;
  world: RAPIER.World;
  kcc!: RAPIER.KinematicCharacterController;
  readonly nav: NavGrid;
  readonly characters = new Map<string, Character>();
  readonly crates = new Map<string, Crate>();
  events: SimEvent[] = [];
  private eventSeq = 0;
  private lastTick = -1;
  private crateByCollider = new Map<number, Crate>();
  private charByCollider = new Map<number, Character>();
  /** Collider handle -> wall id, for readable contact events. */
  private staticNames = new Map<number, string>();
  private eventQueue = new RAPIER.EventQueue(true);
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /** Physics must be initialised first: `await initPhysics()`. */
  constructor(readonly level: Level, readonly clips: ClipTable, readonly seed = 1) {
    this.rng = new Rng(seed);
    this.world = new RAPIER.World({ x: 0, y: -config['sim.gravity'], z: 0 });
    this.world.timestep = this.dt;
    this.createController();
    this.nav = new NavGrid(level, CAPSULE_RADIUS + 0.1);
    this.buildStatic();
    for (const def of level.characters) this.spawn(def);
  }

  private createController() {
    this.kcc = this.world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setSlideEnabled(true);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.kcc.enableAutostep(0.3, 0.2, false);
    this.kcc.enableSnapToGround(0.25);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(70);
  }

  save(): SimCheckpoint {
    return {
      frame: this.frame,
      hitstop: this.hitstop,
      rng: this.rng.state,
      lastTick: this.lastTick,
      eventSeq: this.eventSeq,
      events: structuredClone(this.events),
      world: this.world.takeSnapshot(),
      characters: [...this.characters.values()].map(({ body, collider, ...rest }) => ({
        ...structuredClone(rest), bodyHandle: body.handle, colliderHandle: collider.handle,
      })),
      crates: [...this.crates.values()].map(({ body, collider, ...rest }) => ({
        ...structuredClone(rest), bodyHandle: body.handle, colliderHandle: collider.handle,
      })),
    };
  }

  restore(cp: SimCheckpoint) {
    this.world.free();
    this.world = RAPIER.World.restoreSnapshot(cp.world);
    this.world.timestep = this.dt;
    this.eventQueue.free();
    this.eventQueue = new RAPIER.EventQueue(true);
    this.createController();
    this.frame = cp.frame;
    this.hitstop = cp.hitstop;
    this.rng.state = cp.rng;
    this.lastTick = cp.lastTick;
    this.eventSeq = cp.eventSeq;
    this.events = structuredClone(cp.events);
    this.characters.clear();
    this.charByCollider.clear();
    for (const { bodyHandle, colliderHandle, ...rest } of cp.characters) {
      const ch = { ...structuredClone(rest), body: this.world.getRigidBody(bodyHandle), collider: this.world.getCollider(colliderHandle) } as Character;
      this.characters.set(ch.id, ch);
      this.charByCollider.set(colliderHandle, ch);
    }
    this.crates.clear();
    this.crateByCollider.clear();
    for (const { bodyHandle, colliderHandle, ...rest } of cp.crates) {
      const c = { ...structuredClone(rest), body: this.world.getRigidBody(bodyHandle), collider: this.world.getCollider(colliderHandle) } as Crate;
      this.crates.set(c.id, c);
      this.crateByCollider.set(colliderHandle, c);
    }
  }

  static async create(level: Level, clips: ClipTable, seed = 1): Promise<Sim> {
    await initPhysics();
    return new Sim(level, clips, seed);
  }

  dispose() {
    this.eventQueue.free();
    this.world.free();
  }

  // ---------------------------------------------------------------- world setup

  private buildStatic() {
    const L = this.level;
    const staticGroups = groups(GROUP.STATIC);
    const floor = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const floorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(L.width / 2 + 2, 0.5, L.depth / 2 + 2).setCollisionGroups(staticGroups),
      this.world.createRigidBody(floor),
    );
    this.staticNames.set(floorCollider.handle, 'floor');
    for (const w of L.walls) {
      const t = (w.thickness ?? 0.4) / 2;
      const minX = Math.min(w.from[0], w.to[0]) - t, maxX = Math.max(w.from[0], w.to[0]) + t;
      const minZ = Math.min(w.from[1], w.to[1]) - t, maxZ = Math.max(w.from[1], w.to[1]) + t;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((minX + maxX) / 2, w.height / 2, (minZ + maxZ) / 2));
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((maxX - minX) / 2, w.height / 2, (maxZ - minZ) / 2).setCollisionGroups(staticGroups),
        body,
      );
      this.staticNames.set(collider.handle, w.id);
    }
    for (const c of L.crates) {
      const size = c.size ?? 1;
      const y = (c.y ?? 0) + size / 2;
      // CCD keeps a crate knocked by a heavy hit from tunnelling through a thin wall.
      const desc = c.pushable
        ? RAPIER.RigidBodyDesc.dynamic().lockRotations().setLinearDamping(6).setCanSleep(true).setCcdEnabled(true)
        : RAPIER.RigidBodyDesc.fixed();
      const body = this.world.createRigidBody(desc.setTranslation(c.x, y, c.z));
      const colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
        .setDensity(40)
        .setFriction(0.4)
        .setCollisionGroups(groups(GROUP.CRATE));
      if (c.pushable) colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.world.createCollider(colliderDesc, body);
      const pos = { x: c.x, y: y - size / 2, z: c.z };
      const crate: Crate = { id: c.id, pushable: !!c.pushable, size, pos, prevPos: { ...pos }, body, collider };
      this.crates.set(c.id, crate);
      this.crateByCollider.set(collider.handle, crate);
    }
  }

  spawn(def: CharacterDef): Character {
    if (this.characters.has(def.id)) throw new Error(`character "${def.id}" already exists`);
    const preset = PRESETS[def.preset];
    if (!preset) throw new Error(`unknown preset "${def.preset}". Known: ${Object.keys(PRESETS).join(', ')}`);
    const anims = animsOf(def.preset);
    const yaw = ((def.yawDeg ?? 0) * Math.PI) / 180;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.x, CAPSULE_CENTER, def.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(groups(GROUP.CHARACTER)),
      body,
    );
    const pos = { x: def.x, y: 0, z: def.z };
    const idleAnim: AnimState = { clip: anims.idle, time: 0, speed: 1, prevClip: null, prevTime: 0, prevSpeed: 1, blend: 1 };
    const ch: Character = {
      id: def.id, preset: def.preset, brain: def.brain, anims,
      pos, prevPos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw, grounded: true, airTime: 0,
      hp: preset.hp, maxHp: preset.hp, state: 'idle', stateTime: 0, combo: 0, queued: false, hitDone: false,
      pushing: 0, speed: 0, flash: 0, knock: { x: 0, z: 0 }, spawn: { x: def.x, z: def.z, yaw },
      input: emptyInput(), inputFrames: 0,
      ai: { path: [], wait: 0.5 + this.rng.next() * 2, stuck: 0, last: { x: def.x, z: def.z } },
      order: null, forced: null, anim: idleAnim,
      sprite: { ...this.spriteOf(idleAnim, yaw), tick: 0 },
      groundY: 0,
      body, collider,
    };
    // Stagger idle loops so characters don't breathe in unison.
    ch.anim.time = this.rng.next() * (this.clips[anims.idle]?.duration ?? 1);
    this.characters.set(ch.id, ch);
    this.charByCollider.set(collider.handle, ch);
    this.emit('spawn', { id: ch.id, preset: ch.preset });
    return ch;
  }

  despawn(id: string) {
    const ch = this.get(id);
    this.charByCollider.delete(ch.collider.handle);
    this.world.removeRigidBody(ch.body);
    this.characters.delete(id);
    this.emit('despawn', { id });
  }

  get(id: string): Character {
    const ch = this.characters.get(id);
    if (!ch) throw new Error(`no character "${id}". Known: ${[...this.characters.keys()].join(', ')}`);
    return ch;
  }

  // ---------------------------------------------------------------- commands (agents / input)

  /** External input for a character; lasts `frames` steps (-1 = until replaced). */
  setInput(id: string, input: Partial<CharacterInput>, frames = -1) {
    const ch = this.get(id);
    ch.input = { ...emptyInput(), ...input };
    ch.inputFrames = frames;
  }

  moveTo(id: string, x: number, z: number, gait: Gait = 'run') {
    const ch = this.get(id);
    const path = this.nav.path(ch.pos, { x, z });
    if (!path.length) throw new Error(`no path from (${r3(ch.pos.x)}, ${r3(ch.pos.z)}) to (${x}, ${z})`);
    ch.order = { x, z, gait, path, stuck: 0, last: { x: ch.pos.x, z: ch.pos.z } };
    return path;
  }

  teleport(id: string, x: number, z: number, yawDeg?: number) {
    const ch = this.get(id);
    ch.body.setTranslation({ x, y: CAPSULE_CENTER, z }, true);
    ch.body.setNextKinematicTranslation({ x, y: CAPSULE_CENTER, z });
    ch.pos = { x, y: 0, z };
    ch.prevPos = { ...ch.pos };
    ch.vel = { x: 0, y: 0, z: 0 };
    ch.order = null;
    if (yawDeg !== undefined) ch.yaw = (yawDeg * Math.PI) / 180;
  }

  /** Play a clip regardless of state (previews, sprite sheets). null returns to normal behaviour. */
  forceClip(id: string, clip: string | null, loop = true) {
    const ch = this.get(id);
    if (clip === null) {
      ch.forced = null;
      this.setState(ch, 'idle');
      return;
    }
    if (!this.clips[clip]) throw new Error(`unknown clip "${clip}"`);
    ch.forced = { clip, loop };
    this.setState(ch, 'forced');
    this.play(ch, clip, { restart: true });
  }

  // ---------------------------------------------------------------- stepping

  step() {
    this.frame++;
    for (const ch of this.characters.values()) {
      ch.prevPos = { ...ch.pos };
      if (ch.flash > 0) ch.flash--;
    }
    for (const c of this.crates.values()) c.prevPos = { ...c.pos };
    if (this.hitstop > 0) {
      this.hitstop--;
      this.spriteTick();
      return;
    }
    this.world.gravity = { x: 0, y: -config['sim.gravity'], z: 0 };
    for (const ch of this.characters.values()) this.updateCharacter(ch, this.think(ch));
    this.world.step(this.eventQueue);
    for (const ch of this.characters.values()) {
      const t = ch.body.translation();
      ch.pos = { x: t.x, y: t.y - CAPSULE_CENTER, z: t.z };
      ch.groundY = this.groundBelow(ch);
    }
    for (const c of this.crates.values()) {
      const t = c.body.translation();
      c.pos = { x: t.x, y: t.y - c.size / 2, z: t.z };
    }
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.crateByCollider.get(h1), b = this.crateByCollider.get(h2);
      const crate = a ?? b;
      const other = a ? h2 : h1;
      const withName = this.crateByCollider.get(other)?.id ?? this.charByCollider.get(other)?.id ?? this.staticNames.get(other);
      if (crate && withName && withName !== 'floor') this.emit('crate.contact', { crate: crate.id, with: withName });
    });
    this.spriteTick();
  }

  // ---------------------------------------------------------------- Rapier queries

  /** Casts the shared ray; returns the first blocker hit within maxToi (solid shapes). */
  private cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxToi: number, filter = BLOCKERS, exclude?: RAPIER.Collider) {
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    return this.world.castRay(r, maxToi, true, undefined, filter, exclude);
  }

  /** Top of the floor, wall or crate directly under a character's feet. */
  private groundBelow(ch: Character): number {
    const hit = this.cast(ch.pos.x, ch.pos.y + 0.05, ch.pos.z, 0, -1, 0, 50);
    return hit ? ch.pos.y + 0.05 - hit.timeOfImpact : 0;
  }

  /** First floor, wall or crate hit by a ray (pointer picking, agents). `dir` need not be normalized. */
  raycast(origin: V3, dir: V3, maxDistance = 500): { x: number; y: number; z: number; distance: number; id: string | null } | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9) return null;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
    const hit = this.cast(origin.x, origin.y, origin.z, dx, dy, dz, maxDistance);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    const h = hit.collider.handle;
    return {
      x: r3(origin.x + dx * t), y: r3(origin.y + dy * t), z: r3(origin.z + dz * t), distance: r3(t),
      id: this.crateByCollider.get(h)?.id ?? this.staticNames.get(h) ?? null,
    };
  }

  /** True when no wall or crate blocks the straight line between two points. */
  lineOfSight(from: V3, to: V3, ignore?: RAPIER.Collider): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.cast(from.x, from.y, from.z, dx / len, dy / len, dz / len, len, BLOCKERS, ignore);
  }

  /**
   * True when walls or crates hide part of a character from a viewer looking along `viewDir`
   * (unit vector into the screen). Samples feet, body, head and both shoulders.
   */
  occluded(id: string, viewDir: V3, right: V3): boolean {
    const ch = this.characters.get(id);
    if (!ch) return false;
    const samples: Array<[number, number]> = [[0, 0.25], [0, 0.95], [0, 1.65], [-0.28, 1.2], [0.28, 1.2]];
    for (const [side, h] of samples) {
      const ox = ch.pos.x + right.x * side, oy = ch.pos.y + h, oz = ch.pos.z + right.z * side;
      if (this.cast(ox, oy, oz, -viewDir.x, -viewDir.y, -viewDir.z, 60)) return true;
    }
    return false;
  }

  private emit(type: string, data: Record<string, unknown> = {}) {
    this.events.push({ seq: ++this.eventSeq, frame: this.frame, type, ...data });
    if (this.events.length > 1000) this.events.splice(0, this.events.length - 1000);
  }

  eventsSince(seq = 0): SimEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  get lastEventSeq() {
    return this.eventSeq;
  }

  // ---------------------------------------------------------------- brains

  private think(ch: Character): CharacterInput {
    const intent = emptyInput();
    if (ch.state === 'dead') return intent;
    if (ch.brain === 'input') {
      Object.assign(intent, ch.input);
      ch.input.jump = false;
      ch.input.attack = false;
      if (ch.inputFrames > 0 && --ch.inputFrames === 0) ch.input = emptyInput();
    }
    if (ch.order) {
      const o = ch.order;
      const dir = this.follow(ch, o.path);
      if (!dir) {
        this.emit('arrived', { id: ch.id, x: r3(ch.pos.x), z: r3(ch.pos.z) });
        ch.order = null;
      } else {
        const last = o.path.length === 1 && Math.hypot(o.x - ch.pos.x, o.z - ch.pos.z) < 0.8;
        intent.moveX = dir.x;
        intent.moveZ = dir.z;
        intent.gait = last ? 'walk' : o.gait;
        o.stuck = this.progress(ch, o.last, o.stuck);
        if (o.stuck > 1.2) {
          this.emit('moveTo.failed', { id: ch.id, reason: 'stuck', x: r3(ch.pos.x), z: r3(ch.pos.z) });
          ch.order = null;
        }
      }
      return intent;
    }
    if (ch.brain === 'wander') {
      const ai = ch.ai;
      if (ai.wait > 0) {
        ai.wait -= this.dt;
        return intent;
      }
      if (!ai.path.length) {
        for (let tries = 0; tries < 12 && !ai.path.length; tries++) {
          const t = { x: this.rng.range(-this.level.width / 2 + 1, this.level.width / 2 - 1), z: this.rng.range(-this.level.depth / 2 + 1, this.level.depth / 2 - 1) };
          if (this.nav.isFree(t)) ai.path = this.nav.path(ch.pos, t);
        }
        ai.stuck = 0;
        ai.last = { x: ch.pos.x, z: ch.pos.z };
      }
      const dir = this.follow(ch, ai.path);
      ai.stuck = this.progress(ch, ai.last, ai.stuck);
      if (!dir || ai.stuck > 1) {
        ai.path = [];
        ai.wait = this.rng.range(1, 3.5);
        return intent;
      }
      intent.moveX = dir.x;
      intent.moveZ = dir.z;
      intent.gait = 'walk';
    }
    return intent;
  }

  /** Unit direction toward the next waypoint (popping reached ones); null when done. */
  private follow(ch: Character, path: P2[]): P2 | null {
    while (path.length) {
      const dx = path[0].x - ch.pos.x;
      const dz = path[0].z - ch.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > (path.length === 1 ? 0.12 : 0.35)) return { x: dx / d, z: dz / d };
      path.shift();
    }
    return null;
  }

  /** Seconds without meaningful progress (resets every 0.5 s of real movement). */
  private progress(ch: Character, last: P2, stuck: number): number {
    if (Math.hypot(ch.pos.x - last.x, ch.pos.z - last.z) > 0.25) {
      last.x = ch.pos.x;
      last.z = ch.pos.z;
      return 0;
    }
    return stuck + this.dt;
  }

  // ---------------------------------------------------------------- character update

  private setState(ch: Character, s: CharState) {
    ch.state = s;
    ch.stateTime = 0;
  }

  private meta(clip: string): ClipMeta {
    return this.clips[clip] ?? { duration: 1, loop: true, rootSpeed: 0 };
  }

  private play(ch: Character, clip: string, o: { speed?: number; start?: number; restart?: boolean; blend?: number } = {}) {
    const a = ch.anim;
    if (a.clip === clip && !o.restart) {
      if (o.speed !== undefined) a.speed = o.speed;
      return;
    }
    const blendTime = o.blend ?? config['anim.blend'];
    ch.anim = {
      clip, time: o.start ?? 0, speed: o.speed ?? 1,
      prevClip: blendTime > 0 ? a.clip : null, prevTime: a.time, prevSpeed: a.speed,
      blend: blendTime > 0 ? 0 : 1,
    };
  }

  private advanceAnim(ch: Character) {
    const a = ch.anim;
    const m = this.meta(a.clip);
    a.time += this.dt * a.speed;
    if (m.loop || (ch.forced?.clip === a.clip && ch.forced.loop)) a.time %= m.duration;
    else a.time = Math.min(a.time, m.duration);
    if (a.prevClip) {
      const pm = this.meta(a.prevClip);
      a.prevTime = pm.loop ? (a.prevTime + this.dt * a.prevSpeed) % pm.duration : Math.min(a.prevTime + this.dt * a.prevSpeed, pm.duration);
      const bt = config['anim.blend'];
      a.blend = bt > 0 ? Math.min(1, a.blend + this.dt / bt) : 1;
      if (a.blend >= 1) a.prevClip = null;
    }
  }

  private clipDone(ch: Character) {
    return ch.anim.time >= this.meta(ch.anim.clip).duration - 1e-6;
  }

  private turnToward(ch: Character, targetYaw: number, rate = config['sim.turnRate']) {
    const d = wrapAngle(targetYaw - ch.yaw);
    const maxStep = rate * this.dt;
    ch.yaw = wrapAngle(ch.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
  }

  private updateCharacter(ch: Character, intent: CharacterInput) {
    const dt = this.dt;
    ch.stateTime += dt;
    let wantX = 0, wantZ = 0;
    const gaitSpeed = { walk: config['sim.walkSpeed'], run: config['sim.runSpeed'], sprint: config['sim.sprintSpeed'] }[intent.gait];
    const mag = Math.min(1, Math.hypot(intent.moveX, intent.moveZ));
    const moving = mag > 0.05;
    if (moving) {
      wantX = (intent.moveX / Math.hypot(intent.moveX, intent.moveZ)) * mag * gaitSpeed;
      wantZ = (intent.moveZ / Math.hypot(intent.moveX, intent.moveZ)) * mag * gaitSpeed;
    }
    let control = 1;

    switch (ch.state) {
      case 'dead':
        wantX = wantZ = 0;
        control = 0;
        if (ch.stateTime >= config['sim.respawnSeconds']) this.respawn(ch);
        break;
      case 'forced':
        wantX = wantZ = 0;
        if (!ch.forced || (!ch.forced.loop && this.clipDone(ch))) {
          ch.forced = null;
          this.setState(ch, 'idle');
        }
        break;
      case 'hit': {
        const k = Math.exp(-8 * dt);
        ch.knock.x *= k;
        ch.knock.z *= k;
        wantX = ch.knock.x;
        wantZ = ch.knock.z;
        control = 4;
        if (this.clipDone(ch)) this.setState(ch, 'idle');
        break;
      }
      case 'attack': {
        const step = ATTACKS[ch.combo];
        const dur = this.meta(ch.anim.clip).duration;
        const t = ch.anim.time;
        if (intent.attack && t > dur * 0.25) ch.queued = true;
        const fx = Math.sin(ch.yaw), fz = Math.cos(ch.yaw);
        const lunge = t < dur * 0.4 ? step.lunge : 0;
        wantX = fx * lunge;
        wantZ = fz * lunge;
        control = 3;
        if (!ch.hitDone && t >= dur * step.impact) {
          ch.hitDone = true;
          this.strike(ch, step);
        }
        if (this.clipDone(ch)) {
          if (ch.queued && ch.combo < 2) this.startAttack(ch, ch.combo + 1);
          else if (ch.anims.recover[ch.combo]) {
            this.setState(ch, 'recover');
            this.play(ch, ch.anims.recover[ch.combo], { blend: 0.05 });
          } else this.setState(ch, 'idle');
        }
        break;
      }
      case 'recover':
        if (intent.attack && ch.combo < 2) {
          this.startAttack(ch, ch.combo + 1);
          break;
        }
        if ((moving && ch.stateTime > 0.15) || this.clipDone(ch)) this.setState(ch, moving ? 'move' : 'idle');
        else wantX = wantZ = 0;
        break;
      case 'air':
        control = 0.35;
        if (ch.anim.clip === ch.anims.jumpStart && (ch.vel.y < 0 || this.clipDone(ch))) this.play(ch, ch.anims.jumpLoop);
        break;
      case 'land':
        if ((moving || intent.attack) && ch.stateTime > 0.12) this.setState(ch, moving ? 'move' : 'idle');
        else if (ch.stateTime > 0.35) this.setState(ch, 'idle');
        else wantX = wantZ = 0;
        break;
      default: // idle | move
        if (intent.attack) {
          this.startAttack(ch, 0);
          wantX = wantZ = 0;
        } else if (intent.jump && ch.grounded) {
          ch.vel.y = config['sim.jumpSpeed'];
          ch.grounded = false;
          this.setState(ch, 'air');
          this.play(ch, ch.anims.jumpStart, { start: 0.35, speed: 1.25, blend: 0.05 });
          this.emit('jump', { id: ch.id });
        } else if (!ch.grounded && ch.airTime > 0.15) {
          this.setState(ch, 'air');
          this.play(ch, ch.anims.jumpLoop);
        }
    }
    if (ch.state === 'idle' && moving) this.setState(ch, 'move');

    // Horizontal velocity: accelerate toward the wanted velocity.
    const accel = config['sim.accel'] * control * dt;
    const dvx = wantX - ch.vel.x, dvz = wantZ - ch.vel.z;
    const dv = Math.hypot(dvx, dvz);
    if (dv <= accel || control >= 3) {
      ch.vel.x = wantX;
      ch.vel.z = wantZ;
    } else {
      ch.vel.x += (dvx / dv) * accel;
      ch.vel.z += (dvz / dv) * accel;
    }
    if (ch.state === 'dead') ch.vel.x = ch.vel.z = 0;
    ch.vel.y -= config['sim.gravity'] * dt;
    if (moving && (ch.state === 'move' || ch.state === 'air' || ch.state === 'idle')) this.turnToward(ch, Math.atan2(wantX, wantZ));

    // Kinematic move through Rapier's character controller.
    if (ch.collider.isEnabled()) {
      this.kcc.computeColliderMovement(ch.collider, { x: ch.vel.x * dt, y: ch.vel.y * dt, z: ch.vel.z * dt });
      const mv = this.kcc.computedMovement();
      const wasGrounded = ch.grounded;
      ch.grounded = this.kcc.computedGrounded();
      let pushed = false;
      for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
        const c = this.kcc.computedCollision(i);
        const crate = c?.collider ? this.crateByCollider.get(c.collider.handle) : undefined;
        if (crate?.pushable && moving) pushed = true;
      }
      ch.pushing = pushed ? 6 : Math.max(0, ch.pushing - 1);
      const t = ch.body.translation();
      ch.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
      ch.speed = ch.speed * 0.7 + (Math.hypot(mv.x, mv.z) / dt) * 0.3;
      if (ch.grounded) {
        if (ch.vel.y < 0) ch.vel.y = 0;
        if (!wasGrounded && ch.state === 'air') {
          this.setState(ch, 'land');
          this.play(ch, ch.anims.jumpLand, { start: 0.25, speed: 1.3, blend: 0.05 });
          this.emit('land', { id: ch.id });
        }
        ch.airTime = 0;
      } else ch.airTime += dt;
    }

    if (ch.state === 'idle' || ch.state === 'move') this.locomotionAnim(ch, moving);
    this.advanceAnim(ch);
  }

  private locomotionAnim(ch: Character, moving: boolean) {
    if (!moving && ch.speed < 0.3) {
      if (ch.state === 'move') this.setState(ch, 'idle');
      this.play(ch, ch.anims.idle);
      return;
    }
    if (ch.pushing > 0) {
      this.play(ch, ch.anims.push, { speed: 1 });
      return;
    }
    const s = Math.max(ch.speed, 0.3);
    const pick = s < (config['sim.walkSpeed'] + config['sim.runSpeed']) / 2
      ? ch.anims.walk
      : s < (config['sim.runSpeed'] + config['sim.sprintSpeed']) / 2 ? ch.anims.run : ch.anims.sprint;
    const rootSpeed = this.meta(pick).rootSpeed || s;
    this.play(ch, pick, { speed: Math.max(0.5, Math.min(1.6, s / rootSpeed)) });
  }

  private startAttack(ch: Character, index: number) {
    ch.combo = index;
    ch.queued = false;
    ch.hitDone = false;
    this.setState(ch, 'attack');
    // Auto-aim: face the nearest living character in front-ish range.
    let best: Character | null = null;
    let bestD = 2.6;
    for (const o of this.characters.values()) {
      if (o === ch || o.state === 'dead') continue;
      const d = Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z);
      if (d < bestD && this.lineOfSight(chestOf(ch), chestOf(o))) {
        bestD = d;
        best = o;
      }
    }
    if (best) ch.yaw = Math.atan2(best.pos.x - ch.pos.x, best.pos.z - ch.pos.z);
    this.play(ch, ch.anims.attack[index], { restart: true, blend: 0.05 });
    this.emit('attack', { id: ch.id, step: index + 1, clip: ch.anims.attack[index] });
  }

  private strike(ch: Character, step: (typeof ATTACKS)[number]) {
    const fx = Math.sin(ch.yaw), fz = Math.cos(ch.yaw);
    const cosArc = Math.cos(((step.arcDeg / 2) * Math.PI) / 180);
    const chest = chestOf(ch);
    // Broad phase: every character and crate collider the swing could reach.
    const reach = new Set<number>();
    this.world.intersectionsWithShape(
      chest, IDENTITY_ROT, new RAPIER.Ball(step.range + 1),
      (c) => { reach.add(c.handle); return true; },
      undefined, groups(ALL_GROUPS, GROUP.CHARACTER | GROUP.CRATE), ch.collider,
    );
    let hits = 0;
    // Iterate in roster order (not query order) so event order stays stable.
    for (const o of this.characters.values()) {
      if (o === ch || o.state === 'dead' || !reach.has(o.collider.handle)) continue;
      const dx = o.pos.x - ch.pos.x, dz = o.pos.z - ch.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > step.range || d < 1e-4 || (dx * fx + dz * fz) / d < cosArc) continue;
      if (!this.lineOfSight(chest, chestOf(o))) continue;
      hits++;
      o.hp = Math.max(0, o.hp - step.damage);
      o.flash = 8;
      o.order = null;
      o.ai.path = [];
      o.ai.wait = 1.5;
      o.yaw = Math.atan2(-dx, -dz);
      this.emit('hit', { attacker: ch.id, target: o.id, damage: step.damage, hp: o.hp, heavy: step.heavy });
      if (o.hp <= 0) {
        this.setState(o, 'dead');
        this.play(o, o.anims.death, { restart: true, blend: 0.05 });
        o.collider.setEnabled(false);
        this.emit('death', { id: o.id, by: ch.id });
      } else {
        o.knock = { x: (dx / d) * step.knock, z: (dz / d) * step.knock };
        this.setState(o, 'hit');
        this.play(o, step.heavy ? o.anims.hitHeavy : o.anims.hit, { restart: true, blend: 0.03 });
      }
    }
    let crateHits = 0;
    const knock = config['sim.crateKnock'];
    for (const c of this.crates.values()) {
      if (!c.pushable || knock <= 0 || !reach.has(c.collider.handle)) continue;
      const dx = c.pos.x - ch.pos.x, dz = c.pos.z - ch.pos.z;
      const d = Math.hypot(dx, dz);
      if (d - c.size / 2 > step.range || d < 1e-4 || (dx * fx + dz * fz) / d < cosArc) continue;
      // The first blocker along the swing must be this crate itself.
      const center = { x: c.pos.x, y: Math.min(c.pos.y + c.size / 2, chest.y), z: c.pos.z };
      const len = Math.hypot(center.x - chest.x, center.y - chest.y, center.z - chest.z);
      const hit = this.cast(chest.x, chest.y, chest.z, (center.x - chest.x) / len, (center.y - chest.y) / len, (center.z - chest.z) / len, len + c.size);
      if (hit && hit.collider.handle !== c.collider.handle) continue;
      const speed = step.knock * knock;
      const m = c.body.mass();
      c.body.applyImpulse({ x: (dx / d) * speed * m, y: 0, z: (dz / d) * speed * m }, true);
      crateHits++;
      this.emit('crate.hit', { attacker: ch.id, crate: c.id, speed: r3(speed), heavy: step.heavy });
    }
    if (hits) this.hitstop = Math.max(this.hitstop, config['sim.hitstopFrames'] + (step.heavy ? 3 : 0));
    else if (crateHits) this.hitstop = Math.max(this.hitstop, Math.floor(config['sim.hitstopFrames'] / 2));
    else this.emit('whiff', { id: ch.id, step: ch.combo + 1 });
  }

  private respawn(ch: Character) {
    ch.collider.setEnabled(true);
    this.teleport(ch.id, ch.spawn.x, ch.spawn.z);
    ch.yaw = ch.spawn.yaw;
    ch.hp = ch.maxHp;
    ch.flash = 6;
    this.setState(ch, 'idle');
    this.play(ch, ch.anims.idle, { restart: true, blend: 0 });
    this.emit('respawn', { id: ch.id });
  }

  // ---------------------------------------------------------------- sprite ticks

  private spriteOf(a: AnimState, yaw: number): Omit<SpriteState, 'tick'> {
    const d = dir8(yaw);
    return {
      clip: a.clip, time: a.time, prevClip: a.prevClip, prevTime: a.prevTime, blend: a.blend,
      yaw: config['anim.dir8'] ? d.yaw : yaw, dir: d.index,
    };
  }

  /** Poses and facing are sampled only on sprite ticks (anim.fps), like frames of a sprite sheet. */
  private spriteTick() {
    const tick = Math.floor((this.frame * config['anim.fps']) / STEP_HZ);
    if (config['anim.stepped'] && tick === this.lastTick) return;
    this.lastTick = tick;
    for (const ch of this.characters.values()) ch.sprite = { ...this.spriteOf(ch.anim, ch.yaw), tick };
  }

  // ---------------------------------------------------------------- snapshot for agents

  snapshot() {
    const fps = config['anim.fps'];
    return {
      frame: this.frame,
      time: r3(this.frame / STEP_HZ),
      seed: this.seed,
      hitstop: this.hitstop,
      characters: [...this.characters.values()].map((ch) => ({
        id: ch.id,
        preset: ch.preset,
        brain: ch.brain,
        state: ch.state,
        hp: ch.hp,
        maxHp: ch.maxHp,
        pos: [r3(ch.pos.x), r3(ch.pos.y), r3(ch.pos.z)],
        vel: [r3(ch.vel.x), r3(ch.vel.y), r3(ch.vel.z)],
        speed: r3(ch.speed),
        yawDeg: r3((ch.yaw * 180) / Math.PI),
        facing: DIR8_SCREEN_NAMES[dir8(ch.yaw).index],
        grounded: ch.grounded,
        groundY: r3(ch.groundY),
        pushing: ch.pushing > 0,
        anim: { clip: ch.anim.clip, time: r3(ch.anim.time), speed: r3(ch.anim.speed) },
        sprite: {
          clip: ch.sprite.clip,
          frame: Math.floor(ch.sprite.time * fps + 1e-6),
          frames: Math.max(1, Math.round(this.meta(ch.sprite.clip).duration * fps)),
          dir: ch.sprite.dir,
          dirName: DIR8_SCREEN_NAMES[ch.sprite.dir],
        },
        order: ch.order ? { x: ch.order.x, z: ch.order.z, gait: ch.order.gait, waypoints: ch.order.path.length } : null,
      })),
      crates: [...this.crates.values()].map((c) => ({
        id: c.id, pushable: c.pushable, size: c.size, pos: [r3(c.pos.x), r3(c.pos.y), r3(c.pos.z)],
      })),
    };
  }

  /** Stable hash of the physical state (determinism checks). */
  hash(): string {
    let h = 2166136261;
    const add = (n: number) => {
      h ^= Math.round(n * 1e4);
      h = Math.imul(h, 16777619);
    };
    add(this.frame);
    for (const ch of this.characters.values()) [ch.pos.x, ch.pos.y, ch.pos.z, ch.yaw, ch.hp, ch.anim.time].forEach(add);
    for (const c of this.crates.values()) [c.pos.x, c.pos.y, c.pos.z].forEach(add);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
