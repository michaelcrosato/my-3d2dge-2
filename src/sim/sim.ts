/**
 * Deterministic game simulation: Rapier physics, character state machines, skills, AI, combat,
 * loot, props, mechanics and events.
 *
 * Rules (see AGENTS.md): fixed 60 Hz steps, seeded RNG only, no wall-clock time, no DOM, no
 * rendering. Same level + seed + hero + inputs => same state, frame for frame. Runs in the
 * browser and in Node (tests, agent balance tools). The renderer only reads from it.
 *
 * Rapier does all spatial work: kinematic character controllers (walking, dashing, pushing),
 * dynamic crates and debris, collision groups, ray casts for line of sight and projectiles,
 * ground probes (blob shadows) and view occlusion (silhouettes), and collision events.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { config } from '../config';
import { animsOf, ATTACKS, PRESETS, type AnimSet } from '../content/characters';
import type { CharacterDef, Level, MonsterSpawn, PropDef, Team } from '../content/level';
import { BASES } from '../content/items';
import { ARCHETYPES, ensureMonster, MONSTERS, PALETTES, RARITY_SCALING, type Archetype } from '../content/monsters';
import { planOf, planRadius } from '../content/procgen/creature';
import { rareName } from '../content/procgen/encounters';
import { skill as skillDef, type HitSpec, type Shape, type SkillDef } from '../content/skills';
import { statusDef } from '../content/statuses';
import { mod, type Mod } from '../content/stats';
import { dir8, DIR8_SCREEN_NAMES } from '../render/pixelGrid';
import { autoTarget, blockedReason, inShape, segmentCircle, startSkill, stepProjectiles, stepZones, updateAction } from './actions';
import { thinkMonster } from './ai';
import { addStatus, affixMods, applyPacket, hostile, isDead, rollPacket, tickStatuses } from './combat';
import { buildHero, gainXp, heroSkills, type Hero, type HeroBuild } from './hero';
import { dropLoot, pickupItem } from './loot';
import { affixOnDeath, stepAffixes } from './monsterAffixes';
import { FlowField, NavGrid, type P2 } from './nav';
import { mechanicHit, propSpec, stepProps } from './props';
import { Rng } from './rng';
import { defense, monsterLife, monsterXp, xpPenalty } from './scaling';
import { StatBlock } from './stats';
import type {
  ActionState, AnimState, Character, CharacterInput, ClipMeta, ClipTable, Crate, Gait, Pickup, Projectile, Prop, SimEvent, SpriteState, V3, Zone,
} from './types';

export type { ActionState, AnimState, Character, CharacterInput, ClipMeta, ClipTable, Crate, Gait, SimEvent, SpriteState, V3 };
export type { CharState } from './types';

const CAPSULE_RADIUS = 0.3;
const CAPSULE_HALF = 0.55;
/** Height above the feet used for sword reach and line-of-sight rays. */
const CHEST = 1.1;
const STEP_HZ = 60;
export const HERO_ID = 'player';

/** Rapier collision groups: membership bits in the high half, filter bits in the low half. */
export const GROUP = { STATIC: 0x1, CRATE: 0x2, CHARACTER: 0x4, PROP: 0x8, DEBRIS: 0x10 } as const;
const ALL_GROUPS = 0xffff;
const groups = (membership: number, filter = ALL_GROUPS) => ((membership << 16) | filter) >>> 0;
/** Query filters: what blocks a sword or a line of sight, and what a character can stand on. */
const BLOCKERS = groups(ALL_GROUPS, GROUP.STATIC | GROUP.CRATE);
const MOVE_SOLID = groups(ALL_GROUPS, GROUP.STATIC | GROUP.CRATE | GROUP.CHARACTER | GROUP.PROP);
const MOVE_GHOST = groups(ALL_GROUPS, GROUP.STATIC | GROUP.CRATE | GROUP.PROP);

let rapierReady: Promise<void> | null = null;
export const initPhysics = () => (rapierReady ??= RAPIER.init());

export const emptyInput = (): CharacterInput => ({
  moveX: 0, moveZ: 0, gait: 'run', jump: false, attack: false, attackHeld: false, dodge: false, skill: -1, skillHeld: 0, aim: null, interact: false, flask: -1,
});
const chestOf = (ch: Character): V3 => ({ x: ch.pos.x, y: ch.pos.y + CHEST * Math.min(1.5, ch.scale), z: ch.pos.z });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const defaultTeam = (def: CharacterDef): Team =>
  def.team ?? (def.brain === 'input' || def.brain === 'bot' ? 'hero' : def.brain === 'monster' ? 'enemy' : def.brain === 'dummy' ? 'target' : 'neutral');

/** Per-stage bookkeeping (kills, boss, exit, timer, mechanic score). */
export interface StageState {
  kills: number;
  elites: number;
  bossDead: boolean;
  exitOpen: boolean;
  /** Frames since the level started (stops when cleared). */
  time: number;
  cleared: boolean;
  /** Mechanic-driven kills / triggers (speedrun & mastery bonus). */
  mechanicKills: number;
  mechanicUses: number;
  gold: number;
  items: number;
  deaths: number;
  xp: number;
}

/** Everything needed to rewind a Sim exactly (Rapier snapshot + JS-side state). */
export interface SimCheckpoint {
  frame: number;
  hitstop: number;
  rng: number;
  lastTick: number;
  eventSeq: number;
  idSeq: number;
  events: SimEvent[];
  world: Uint8Array;
  characters: Array<Omit<Character, 'body' | 'collider'> & { bodyHandle: number; colliderHandle: number }>;
  crates: Array<Omit<Crate, 'body' | 'collider'> & { bodyHandle: number; colliderHandle: number }>;
  props: Array<Omit<Prop, 'body' | 'collider'> & { bodyHandle: number | null; colliderHandle: number | null }>;
  projectiles: Projectile[];
  zones: Zone[];
  pickups: Pickup[];
  hero: Hero | null;
  stage: StageState;
}

export interface SimOptions {
  /** Persistent hero driving the 'player' character (stats, skills, gear). */
  hero?: Hero | null;
}

export class Sim {
  readonly dt = 1 / STEP_HZ;
  frame = 0;
  hitstop = 0;
  readonly rng: Rng;
  world: RAPIER.World;
  kcc!: RAPIER.KinematicCharacterController;
  readonly nav: NavGrid;
  readonly flow: FlowField;
  readonly characters = new Map<string, Character>();
  readonly crates = new Map<string, Crate>();
  readonly props = new Map<string, Prop>();
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  pickups: Pickup[] = [];
  events: SimEvent[] = [];
  hero: Hero | null;
  heroBuild: HeroBuild | null = null;
  readonly heroId = HERO_ID;
  stage: StageState = { kills: 0, elites: 0, bossDead: false, exitOpen: false, time: 0, cleared: false, mechanicKills: 0, mechanicUses: 0, gold: 0, items: 0, deaths: 0, xp: 0 };
  private eventSeq = 0;
  private idSeq = 0;
  private lastTick = -1;
  private crateByCollider = new Map<number, Crate>();
  private charByCollider = new Map<number, Character>();
  private propByCollider = new Map<number, Prop>();
  /** Collider handle -> wall id, for readable contact events. */
  private staticNames = new Map<number, string>();
  private eventQueue = new RAPIER.EventQueue(true);
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private statCache = new Map<string, { version: number; block: StatBlock }>();

  /** Physics must be initialised first: `await initPhysics()`. */
  constructor(readonly level: Level, readonly clips: ClipTable, readonly seed = 1, opts: SimOptions = {}) {
    this.rng = new Rng(seed);
    this.hero = opts.hero ?? null;
    this.world = new RAPIER.World({ x: 0, y: -config['sim.gravity'], z: 0 });
    this.world.timestep = this.dt;
    this.createController();
    this.nav = new NavGrid(level, CAPSULE_RADIUS + 0.1, (level.props ?? []).filter((p) => propSpec(p.kind)?.navBlock).map((p) => {
      const r = propSpec(p.kind)!.radius * (p.scale ?? 1);
      return { minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r };
    }));
    this.flow = new FlowField(this.nav);
    this.buildStatic();
    for (const p of level.props ?? []) this.addProp(p);
    if (this.hero) this.heroBuild = buildHero(this.hero);
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

  static async create(level: Level, clips: ClipTable, seed = 1, opts: SimOptions = {}): Promise<Sim> {
    await initPhysics();
    return new Sim(level, clips, seed, opts);
  }

  dispose() {
    this.eventQueue.free();
    this.world.free();
  }

  nextId() {
    return ++this.idSeq;
  }

  // ---------------------------------------------------------------- checkpoints

  save(): SimCheckpoint {
    const strip = <T extends { body: unknown; collider: unknown }>(o: T) => {
      const { body, collider, ...rest } = o;
      return { rest, body, collider };
    };
    return {
      frame: this.frame, hitstop: this.hitstop, rng: this.rng.state, lastTick: this.lastTick, eventSeq: this.eventSeq, idSeq: this.idSeq,
      events: structuredClone(this.events),
      world: this.world.takeSnapshot(),
      characters: [...this.characters.values()].map((c) => {
        const { rest, body, collider } = strip(c);
        return { ...structuredClone(rest), bodyHandle: (body as RAPIER.RigidBody).handle, colliderHandle: (collider as RAPIER.Collider).handle };
      }),
      crates: [...this.crates.values()].map((c) => {
        const { rest, body, collider } = strip(c);
        return { ...structuredClone(rest), bodyHandle: (body as RAPIER.RigidBody).handle, colliderHandle: (collider as RAPIER.Collider).handle };
      }),
      props: [...this.props.values()].map((p) => {
        const { rest, body, collider } = strip(p);
        return { ...structuredClone(rest), bodyHandle: (body as RAPIER.RigidBody | null)?.handle ?? null, colliderHandle: (collider as RAPIER.Collider | null)?.handle ?? null };
      }),
      projectiles: structuredClone(this.projectiles),
      zones: structuredClone(this.zones),
      pickups: structuredClone(this.pickups),
      hero: this.hero ? structuredClone(this.hero) : null,
      stage: structuredClone(this.stage),
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
    this.idSeq = cp.idSeq;
    this.events = structuredClone(cp.events);
    this.statCache.clear();
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
    this.props.clear();
    this.propByCollider.clear();
    for (const { bodyHandle, colliderHandle, ...rest } of cp.props) {
      const p = {
        ...structuredClone(rest),
        body: bodyHandle !== null ? this.world.getRigidBody(bodyHandle) : null,
        collider: colliderHandle !== null ? this.world.getCollider(colliderHandle) : null,
      } as Prop;
      this.props.set(p.id, p);
      if (colliderHandle !== null) this.propByCollider.set(colliderHandle, p);
    }
    this.projectiles = structuredClone(cp.projectiles);
    this.zones = structuredClone(cp.zones);
    this.pickups = structuredClone(cp.pickups);
    if (cp.hero && this.hero) Object.assign(this.hero, structuredClone(cp.hero));
    if (this.hero) this.heroBuild = buildHero(this.hero);
    this.stage = structuredClone(cp.stage);
    this.flow.targetIndex = -1;
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
      // Generated walls are colliders at least 2 m tall so nothing hops over a low front wall.
      const h = L.grid ? Math.max(2, w.height) : w.height;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2));
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((maxX - minX) / 2, h / 2, (maxZ - minZ) / 2).setCollisionGroups(staticGroups),
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

  /** Gameplay props get sim state (and colliders when solid); pure decor is render-only. */
  addProp(def: PropDef): Prop | null {
    const spec = propSpec(def.kind);
    if (!spec) return null;
    let body: RAPIER.RigidBody | null = null, collider: RAPIER.Collider | null = null;
    const scale = def.scale ?? 1;
    if (spec.solid) {
      const desc = spec.dynamic
        ? RAPIER.RigidBodyDesc.dynamic().setLinearDamping(spec.damping ?? 1.5).setAngularDamping(2).setCcdEnabled(true).setCanSleep(true)
        : RAPIER.RigidBodyDesc.fixed();
      body = this.world.createRigidBody(desc.setTranslation(def.x, (def.y ?? 0) + spec.height * scale / 2, def.z));
      const shape = spec.ball
        ? RAPIER.ColliderDesc.ball(spec.radius * scale)
        : RAPIER.ColliderDesc.cylinder((spec.height * scale) / 2, spec.radius * scale);
      shape.setCollisionGroups(groups(GROUP.PROP)).setDensity(spec.density ?? 10).setFriction(spec.friction ?? 0.6);
      if (spec.dynamic) {
        shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        if (!spec.ball) body.lockRotations(true, false);
      }
      collider = this.world.createCollider(shape, body);
    }
    const prop: Prop = {
      id: def.id, kind: def.kind, x: def.x, z: def.z, y: def.y ?? 0, yaw: ((def.yawDeg ?? 0) * Math.PI) / 180, scale,
      state: spec.initial ?? 'idle', timer: (def.data?.phase as number | undefined) ?? 0, hp: spec.hp ?? 1, data: { ...(def.data ?? {}) },
      collider, body, vx: 0, vz: 0, prevX: def.x, prevZ: def.z, dead: false,
    };
    this.props.set(prop.id, prop);
    if (collider) this.propByCollider.set(collider.handle, prop);
    return prop;
  }

  removePropCollider(p: Prop) {
    if (p.collider) this.propByCollider.delete(p.collider.handle);
    if (p.body) this.world.removeRigidBody(p.body);
    p.body = null;
    p.collider = null;
  }

  // ---------------------------------------------------------------- spawning

  spawn(def: CharacterDef): Character {
    if (this.characters.has(def.id)) throw new Error(`character "${def.id}" already exists`);
    const m = def.monster;
    const md = m ? ensureMonster(m.def) : null;
    const presetId = md && md.body.kind === 'humanoid' ? md.body.preset : def.preset;
    const preset = PRESETS[presetId];
    if (!preset && !(md && md.body.kind === 'creature')) throw new Error(`unknown preset "${def.preset}". Known: ${Object.keys(PRESETS).join(', ')}`);
    const kind: Character['kind'] = md?.body.kind === 'creature' ? 'creature' : 'humanoid';
    const anims: AnimSet = animsOf(kind === 'humanoid' ? presetId : 'ranger');
    const rarity = m?.rarity ?? 'normal';
    const scale = (md ? md.size * RARITY_SCALING[rarity].size : 1) * (def.scale ?? 1);
    const radius = md?.body.kind === 'creature' ? planRadius(planOf(md.body.plan)) * Math.max(0.6, scale) : CAPSULE_RADIUS * Math.max(0.6, scale);
    const half = CAPSULE_HALF * scale;
    const yaw = ((def.yawDeg ?? 0) * Math.PI) / 180;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.x, half + radius, def.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(half, radius).setCollisionGroups(groups(GROUP.CHARACTER)),
      body,
    );
    const pos = { x: def.x, y: 0, z: def.z };
    const idleAnim: AnimState = { clip: anims.idle, time: 0, speed: 1, prevClip: null, prevTime: 0, prevSpeed: 1, blend: 1 };
    const team = defaultTeam(def);
    const ch: Character = {
      id: def.id, kind, preset: kind === 'humanoid' ? presetId : `creature:${md!.body.kind === 'creature' ? md!.body.plan : ''}`,
      name: def.name ?? md?.name ?? preset?.label ?? def.id, team, brain: def.brain, anims, level: m?.level ?? this.hero?.level ?? 1,
      pos, prevPos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw, grounded: true, airTime: 0, radius, scale,
      life: preset?.hp ?? 10, maxLife: preset?.hp ?? 10, mana: 0, maxMana: 0, baseMods: [], statsVersion: 0,
      state: 'idle', stateTime: 0, action: null, combo: 0, queued: false, hitDone: false, statuses: [], cooldowns: {},
      freeze: 0, iframes: 0, poise: 0, pushing: 0, speed: 0, flash: 0, knock: { x: 0, z: 0 }, spawn: { x: def.x, z: def.z, yaw },
      input: emptyInput(), inputFrames: 0,
      ai: { path: [], wait: 0.5 + this.rng.next() * 2, stuck: 0, last: { x: def.x, z: def.z }, target: null, mode: 'idle', modeTime: 0, strafeDir: this.rng.chance(0.5) ? 1 : -1, awake: false },
      order: null, forced: null, anim: idleAnim,
      sprite: { ...this.spriteOf(idleAnim, yaw), tick: 0 },
      groundY: 0, lift: 0, spin: 0, monster: null, look: {}, owner: null, expires: -1, deadTime: 0,
      regen: { life: 0, mana: 0, leechBudget: 0 }, since: { kill: 9999, dodge: 9999, hurt: 9999 },
      npc: def.npc ?? null,
      body, collider,
    };
    if (m && md) this.setupMonster(ch, m, md);
    else if (def.id === this.heroId && this.hero) this.setupHero(ch);
    // Stagger idle loops so characters don't breathe in unison.
    ch.anim.time = this.rng.next() * (this.clips[anims.idle]?.duration ?? 1);
    this.characters.set(ch.id, ch);
    this.charByCollider.set(collider.handle, ch);
    this.emit('spawn', { id: ch.id, preset: ch.preset, team: ch.team, x: def.x, z: def.z });
    return ch;
  }

  private setupHero(ch: Character) {
    const build = (this.heroBuild = buildHero(this.hero!));
    ch.baseMods = build.mods;
    ch.level = this.hero!.level;
    ch.name = this.hero!.name;
    ch.statsVersion++;
    this.refreshPools(ch, true);
  }

  /** Recomputes the hero build after gear / tree / level changes (keeps current life ratio). */
  refreshHero() {
    if (!this.hero) return;
    const ch = this.characters.get(this.heroId);
    this.heroBuild = buildHero(this.hero);
    if (!ch) return;
    ch.baseMods = this.heroBuild.mods;
    ch.level = this.hero.level;
    ch.statsVersion++;
    this.refreshPools(ch, false);
  }

  /** Max life/mana from stats and difficulty; `fill` tops both up. */
  refreshPools(ch: Character, fill: boolean) {
    const st = this.stats(ch);
    const lifeTune = ch.team === 'hero' ? config['tune.playerLife'] : config['tune.enemyLife'];
    const ownerMinionLife = ch.owner ? this.stats(this.characters.get(ch.owner) ?? ch).scale('minionLife') : 1;
    const maxLife = Math.max(1, st.get('life') * lifeTune * ownerMinionLife);
    const maxMana = Math.max(0, st.get('mana'));
    const lifeRatio = ch.maxLife > 0 ? ch.life / ch.maxLife : 1;
    ch.maxLife = maxLife;
    ch.maxMana = maxMana;
    if (fill) {
      ch.life = maxLife;
      ch.mana = maxMana;
    } else {
      ch.life = Math.min(maxLife, Math.max(ch.life > 0 ? 1 : 0, lifeRatio * maxLife));
      ch.mana = Math.min(maxMana, ch.mana);
    }
  }

  /** Re-applies difficulty multipliers to every character (debug slider). */
  retune() {
    for (const ch of this.characters.values()) if (ch.state !== 'dead' && (ch.monster || ch.id === this.heroId || ch.owner)) this.refreshPools(ch, false);
  }

  archetypeOf(ch: Character): Archetype {
    return ARCHETYPES[ch.monster ? MONSTERS[ch.monster.def].archetype : 'minion'] ?? ARCHETYPES.brute;
  }

  monsterDamageMult(ch: Character): number {
    if (!ch.monster) return 1;
    const md = MONSTERS[ch.monster.def];
    return md.damage * this.archetypeOf(ch).damage * RARITY_SCALING[ch.monster.rarity].damage;
  }

  private setupMonster(ch: Character, m: MonsterSpawn, md: (typeof MONSTERS)[string]) {
    const arch = ARCHETYPES[md.archetype];
    const rar = RARITY_SCALING[m.rarity];
    const pal = PALETTES[m.palette ?? md.palette] ?? PALETTES.bone;
    const L = m.level;
    const affixes = m.affixes ?? [];
    const mods: Mod[] = [
      mod('life', 'flat', monsterLife(L) * md.life * arch.life * rar.life),
      mod('armor', 'flat', 6 * (md.armor ?? 0.5) * defense(L) * (md.boss ? 2 : 1)),
      mod('evasion', 'flat', 5 * defense(L) * (arch.speed > 1.1 ? 2 : 1)),
      mod('manaRegen', 'flat', 0),
      ...affixMods(affixes),
    ];
    for (const [t, v] of Object.entries({ ...pal.resist, ...md.resist })) {
      const stat = ({ fire: 'resFire', cold: 'resCold', lightning: 'resLightning', chaos: 'resChaos', physical: null } as const)[t as 'fire'];
      if (stat) mods.push(mod(stat, 'flat', v as number));
    }
    if (md.boss) mods.push(mod('cannotBeFrozen', 'flag', 0));
    ch.baseMods = mods;
    ch.level = L;
    ch.monster = {
      def: md.id, rarity: m.rarity, affixes, pack: m.pack ?? null, palette: pal.id, element: pal.element, skills: [...md.skills],
      boss: !!md.boss, phase: 1, thinkIn: this.rng.range(0.1, arch.think), xp: monsterXp(L) * md.xp * rar.xp, timers: {},
    };
    for (const a of affixes) ch.monster.timers[a] = this.rng.range(1, 4);
    const preset = md.body.kind === 'humanoid' ? PRESETS[md.body.preset] : null;
    const tint: Record<string, string> = { ...(preset?.tint ?? {}) };
    const glow: Record<string, string> = { ...(preset?.glow ?? {}) };
    for (const name of preset?.slots?.primary ?? []) tint[name] = pal.primary;
    for (const name of preset?.slots?.secondary ?? []) tint[name] = pal.secondary;
    for (const name of preset?.slots?.glow ?? []) {
      tint[name] = pal.accent;
      glow[name] = pal.glow;
    }
    ch.look = {
      tint, glow, palette: pal.id,
      plan: md.body.kind === 'creature' ? md.body.plan : undefined,
      seed: m.seed ?? (md.body.kind === 'creature' ? md.body.seed : undefined),
      aura: m.rarity === 'magic' ? '#7f8cff' : m.rarity === 'rare' ? '#ffe14d' : m.rarity === 'unique' ? '#ff8a3d' : undefined,
    };
    if (m.rarity === 'rare' && !m.name) ch.name = rareName(this.rng, md.name);
    if (m.name) ch.name = m.name;
    ch.statsVersion++;
    this.refreshPools(ch, true);
  }

  /** Summons minions next to `owner` (hero spirit wolves, hexer thralls, splitting monsters). */
  summon(owner: Character, monster: string, count: number, duration: number, opts: { scale?: number; rarity?: 'normal' | 'magic'; at?: P2 } = {}): Character[] {
    const out: Character[] = [];
    const md = ensureMonster(monster);
    for (let i = 0; i < count; i++) {
      const ang = this.rng.next() * Math.PI * 2;
      const base = opts.at ?? owner.pos;
      const p = this.nav.nearestFree({ x: base.x + Math.cos(ang) * 1.4, z: base.z + Math.sin(ang) * 1.4 });
      const ch = this.spawn({
        id: `${owner.id}~${monster}${this.nextId()}`, preset: md.body.kind === 'humanoid' ? md.body.preset : 'creature', x: p.x, z: p.z,
        yawDeg: (owner.yaw * 180) / Math.PI, brain: owner.team === 'hero' ? 'minion' : 'monster', team: owner.team, scale: opts.scale,
        monster: { def: monster, level: owner.level, rarity: opts.rarity ?? 'normal', palette: owner.monster?.palette ?? md.palette },
      });
      ch.owner = owner.team === 'hero' ? (owner.owner ?? owner.id) : owner.id;
      ch.expires = duration > 0 ? Math.round(duration * STEP_HZ) : -1;
      ch.ai.awake = true;
      if (ch.monster) ch.monster.xp = owner.team === 'hero' ? 0 : ch.monster.xp * 0.3;
      if (ch.team === 'hero') this.refreshPools(ch, true);
      this.emit('summon', { id: ch.id, owner: owner.id, monster });
      out.push(ch);
    }
    return out;
  }

  despawn(id: string) {
    const ch = this.get(id);
    this.charByCollider.delete(ch.collider.handle);
    this.world.removeRigidBody(ch.body);
    this.characters.delete(id);
    this.statCache.delete(id);
    this.emit('despawn', { id });
  }

  get(id: string): Character {
    const ch = this.characters.get(id);
    if (!ch) throw new Error(`no character "${id}". Known: ${[...this.characters.keys()].join(', ')}`);
    return ch;
  }

  get player(): Character | undefined {
    return this.characters.get(this.heroId);
  }

  /** Stats with statuses applied; cached until the character's statsVersion changes. */
  stats(ch: Character): StatBlock {
    const c = this.statCache.get(ch.id);
    if (c && c.version === ch.statsVersion) return c.block;
    const mods: Mod[] = [...ch.baseMods];
    for (const s of ch.statuses) {
      if (s.mods) mods.push(...s.mods);
      const def = statusDef(s.id);
      if (def.mods) mods.push(...def.mods(s.magnitude));
    }
    const block = new StatBlock(mods);
    this.statCache.set(ch.id, { version: ch.statsVersion, block });
    return block;
  }

  // ---------------------------------------------------------------- commands (agents / input / UI)

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
    const center = CAPSULE_HALF * ch.scale + ch.radius;
    ch.body.setTranslation({ x, y: center, z }, true);
    ch.body.setNextKinematicTranslation({ x, y: center, z });
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

  /** Use a hero flask slot (0 life, 1 mana). */
  useFlask(slot: number): boolean {
    const hero = this.hero, ch = this.player;
    if (!hero || !ch || ch.state === 'dead') return false;
    const item = hero.equipment[slot === 0 ? 'flask1' : 'flask2'];
    const base = item ? (BASE_FLASK[item.base] ?? null) : null;
    if (!item || !base) return false;
    if (hero.flasks[slot] < base.perUse) {
      this.emit('flask.empty', { slot });
      return false;
    }
    hero.flasks[slot] -= base.perUse;
    const st = this.stats(ch);
    const eff = (st.get('flaskEffect') / 100) * (1 + item.quality / 100);
    addStatus(this, ch, base.kind === 'life' ? 'flask_life' : 'flask_mana', base.duration, (base.amount / base.duration) * eff, ch.id);
    if (base.kind === 'life') {
      // Drinking also clears bleeding and burning (PoE-style flask utility).
      ch.statuses = ch.statuses.filter((s) => s.id !== 'bleed' && s.id !== 'ignite');
    }
    this.emit('flask', { slot, kind: base.kind });
    return true;
  }

  // ---------------------------------------------------------------- stepping

  step() {
    this.frame++;
    for (const ch of this.characters.values()) {
      ch.prevPos = { ...ch.pos };
      if (ch.flash > 0) ch.flash--;
    }
    for (const c of this.crates.values()) c.prevPos = { ...c.pos };
    for (const p of this.props.values()) {
      p.prevX = p.x;
      p.prevZ = p.z;
    }
    if (this.hitstop > 0) {
      this.hitstop--;
      this.spriteTick();
      return;
    }
    if (!this.stage.cleared) this.stage.time++;
    if (this.hero) this.hero.totals.frames++;
    this.world.gravity = { x: 0, y: -config['sim.gravity'], z: 0 };
    const hero = this.player;
    if (hero && hero.state !== 'dead') this.flow.update(hero.pos);
    for (const ch of this.characters.values()) {
      tickStatuses(this, ch);
      if (ch.monster && ch.state !== 'dead') stepAffixes(this, ch);
    }
    for (const ch of [...this.characters.values()]) {
      if (!this.characters.has(ch.id)) continue;
      this.updateCharacter(ch, this.think(ch));
    }
    this.world.step(this.eventQueue);
    for (const ch of this.characters.values()) {
      const t = ch.body.translation();
      ch.pos = { x: t.x, y: t.y - (CAPSULE_HALF * ch.scale + ch.radius), z: t.z };
      if (this.frame % 3 === 0 || ch.vel.y !== 0) ch.groundY = this.groundBelow(ch);
    }
    for (const c of this.crates.values()) {
      const t = c.body.translation();
      c.pos = { x: t.x, y: t.y - c.size / 2, z: t.z };
    }
    stepProjectiles(this);
    stepZones(this);
    stepProps(this);
    this.stepPickups();
    this.cleanupDead();
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.crateByCollider.get(h1), b = this.crateByCollider.get(h2);
      const crate = a ?? b;
      if (crate) {
        const other = a ? h2 : h1;
        const withName = this.crateByCollider.get(other)?.id ?? this.charByCollider.get(other)?.id ?? this.staticNames.get(other);
        if (withName && withName !== 'floor') this.emit('crate.contact', { crate: crate.id, with: withName });
        return;
      }
      const pa = this.propByCollider.get(h1), pb = this.propByCollider.get(h2);
      const prop = pa ?? pb;
      if (prop) {
        const other = pa ? h2 : h1;
        const ch = this.charByCollider.get(other);
        const withName = ch?.id ?? this.propByCollider.get(other)?.id ?? this.staticNames.get(other);
        if (withName && withName !== 'floor') this.emit('prop.contact', { prop: prop.id, with: withName });
      }
    });
    this.spriteTick();
  }

  private cleanupDead() {
    for (const ch of [...this.characters.values()]) {
      if (ch.expires > 0 && --ch.expires === 0 && ch.state !== 'dead') {
        ch.life = 0;
        this.kill(ch, null, true);
      }
      if (ch.state !== 'dead') continue;
      // Corpses linger, sink, then go.
      if ((ch.monster || ch.owner) && ch.deadTime > (ch.monster?.boss ? 12 : 5)) this.despawn(ch.id);
    }
  }

  // ---------------------------------------------------------------- Rapier queries

  /** Casts the shared ray; returns the first blocker hit within maxToi (solid shapes). */
  private cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxToi: number, filter = BLOCKERS, exclude?: RAPIER.Collider) {
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    return this.world.castRay(r, maxToi, true, undefined, filter, exclude);
  }

  /** Distance to the first wall/crate along a (non-normalized) displacement, or null. */
  castBlockers(x: number, y: number, z: number, dx: number, dy: number, dz: number): number | null {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    const hit = this.cast(x, y, z, dx / len, dy / len, dz / len, len);
    return hit ? hit.timeOfImpact : null;
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
    const k = Math.min(2, ch.scale);
    const samples: Array<[number, number]> = [[0, 0.25], [0, 0.95], [0, 1.65], [-0.28, 1.2], [0.28, 1.2]];
    for (const [side, h] of samples) {
      const ox = ch.pos.x + right.x * side * k, oy = ch.pos.y + h * k, oz = ch.pos.z + right.z * side * k;
      if (this.cast(ox, oy, oz, -viewDir.x, -viewDir.y, -viewDir.z, 60)) return true;
    }
    return false;
  }

  emit(type: string, data: Record<string, unknown> = {}) {
    this.events.push({ ...data, seq: ++this.eventSeq, frame: this.frame, type });
    if (this.events.length > 1500) this.events.splice(0, this.events.length - 1500);
  }

  eventsSince(seq = 0): SimEvent[] {
    // Events are ordered by seq: binary search the start.
    let lo = 0, hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].seq <= seq) lo = mid + 1;
      else hi = mid;
    }
    return this.events.slice(lo);
  }

  get lastEventSeq() {
    return this.eventSeq;
  }

  // ---------------------------------------------------------------- brains

  private think(ch: Character): CharacterInput {
    const intent = emptyInput();
    if (ch.state === 'dead') return intent;
    if (ch.brain === 'input' || ch.brain === 'bot') {
      Object.assign(intent, ch.input);
      ch.input.jump = false;
      ch.input.attack = false;
      ch.input.dodge = false;
      ch.input.skill = -1;
      ch.input.interact = false;
      ch.input.flask = -1;
      if (ch.inputFrames > 0 && --ch.inputFrames === 0) ch.input = emptyInput();
    }
    if (ch.brain === 'monster' || ch.brain === 'minion') return thinkMonster(this, ch);
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
    if (ch.brain === 'wander' || (ch.brain === 'npc' && ch.npc?.role === 'wander')) {
      const ai = ch.ai;
      if (ai.wait > 0) {
        ai.wait -= this.dt;
        return intent;
      }
      if (!ai.path.length) {
        for (let tries = 0; tries < 12 && !ai.path.length; tries++) {
          const range = ch.brain === 'npc' ? 6 : this.level.width / 2 - 1;
          const t = ch.brain === 'npc'
            ? { x: ch.spawn.x + this.rng.range(-range, range), z: ch.spawn.z + this.rng.range(-range, range) }
            : { x: this.rng.range(-range, range), z: this.rng.range(-this.level.depth / 2 + 1, this.level.depth / 2 - 1) };
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
    if (ch.brain === 'npc' && ch.npc) {
      // Townsfolk turn toward a nearby hero.
      const hero = this.player;
      if (hero && Math.hypot(hero.pos.x - ch.pos.x, hero.pos.z - ch.pos.z) < 4.5) this.turnToward(ch, Math.atan2(hero.pos.x - ch.pos.x, hero.pos.z - ch.pos.z), 5);
    }
    return intent;
  }

  /** Unit direction toward the next waypoint (popping reached ones); null when done. */
  follow(ch: Character, path: P2[]): P2 | null {
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
  progress(ch: Character, last: P2, stuck: number): number {
    if (Math.hypot(ch.pos.x - last.x, ch.pos.z - last.z) > 0.25) {
      last.x = ch.pos.x;
      last.z = ch.pos.z;
      return 0;
    }
    return stuck + this.dt;
  }

  // ---------------------------------------------------------------- character update

  setState(ch: Character, s: Character['state']) {
    ch.state = s;
    ch.stateTime = 0;
  }

  clipDuration(clip: string): number {
    return this.meta(clip).duration;
  }

  private meta(clip: string): ClipMeta {
    return this.clips[clip] ?? { duration: 1, loop: true, rootSpeed: 0 };
  }

  play(ch: Character, clip: string, o: { speed?: number; start?: number; restart?: boolean; blend?: number } = {}) {
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

  /** Starts a clip for an action (short blend from whatever was playing). */
  playClip(ch: Character, clip: string, start: number) {
    this.play(ch, clip, { restart: true, start, blend: 0.06, speed: 0 });
  }

  /** Sets the action clip's time directly (timeline-driven animation). */
  scrubClip(ch: Character, clip: string, time: number) {
    if (ch.anim.clip !== clip) this.play(ch, clip, { restart: true, start: time, blend: 0.05, speed: 0 });
    ch.anim.time = Math.max(0, Math.min(time, this.meta(clip).duration));
    ch.anim.speed = 0;
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

  turnToward(ch: Character, targetYaw: number, rate = config['sim.turnRate']) {
    const d = wrapAngle(targetYaw - ch.yaw);
    const maxStep = rate * this.dt;
    ch.yaw = wrapAngle(ch.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
  }

  /** Run speed for this character right now (m/s), before gait. */
  runSpeed(ch: Character): number {
    const st = this.stats(ch);
    const slow = ch.statuses.reduce((m, s) => (s.id === 'chill' || s.id === 'slowed' ? Math.max(m, s.magnitude) : m), 0);
    const k = (st.get('moveSpeed') / 100) * (1 - Math.min(70, slow) / 100);
    if (ch.monster) return MONSTERS[ch.monster.def].speed * this.archetypeOf(ch).speed * k * config['tune.enemySpeed'];
    if (ch.id === this.heroId && this.hero) return 4.7 * k * config['tune.playerSpeed'];
    if (ch.owner) return 5 * k * config['tune.playerSpeed'];
    return config['sim.runSpeed'] * k;
  }

  /** Hit reaction (stagger). Interrupts actions except boss wind-ups. */
  flinch(t: Character, heavy: boolean) {
    if (t.state === 'dead' || t.state === 'stun') return;
    if (t.action && t.action.skill === 'dodge') return;
    if (t.monster?.boss && !heavy) return;
    t.action = null;
    t.lift = 0;
    this.setState(t, 'hit');
    if (t.kind === 'humanoid') this.play(t, heavy ? t.anims.hitHeavy : t.anims.hit, { restart: true, blend: 0.03 });
    else t.anim = { ...t.anim, time: 0 };
  }

  stun(t: Character, why: string) {
    if (t.state === 'dead') return;
    t.action = null;
    t.lift = 0;
    this.setState(t, 'stun');
    if (t.kind === 'humanoid' && why !== 'freeze') this.play(t, t.anims.stun, { restart: true, blend: 0.03 });
    // Frozen characters hold their pose (the renderer tints them icy).
  }

  unstun(t: Character) {
    if (t.state === 'stun') this.setState(t, 'idle');
  }

  private updateCharacter(ch: Character, intent: CharacterInput) {
    const dt = this.dt;
    ch.stateTime += dt;
    for (const k in ch.cooldowns) if (ch.cooldowns[k] > 0) ch.cooldowns[k] = Math.max(0, ch.cooldowns[k] - dt);
    if (ch.iframes > 0) ch.iframes = Math.max(0, ch.iframes - dt);
    ch.since.kill++;
    ch.since.dodge++;
    ch.since.hurt++;
    if (ch.state === 'dead') {
      ch.deadTime += dt;
      ch.vel.x = ch.vel.z = 0;
      if (ch.id === this.heroId && this.hero && ch.deadTime > 3) this.respawnHero(ch);
      else if (!ch.monster && !ch.owner && ch.id !== this.heroId && ch.deadTime >= config['sim.respawnSeconds']) this.respawn(ch);
      this.advanceAnim(ch);
      return;
    }
    if (ch.freeze > 0) {
      ch.freeze--;
      return;
    }
    // Sleeping monsters skip the character controller entirely (big levels stay cheap).
    if (ch.brain === 'monster' && !ch.ai.awake && ch.state === 'idle' && ch.grounded && !ch.knock.x && !ch.knock.z) {
      this.advanceAnim(ch);
      return;
    }
    let wantX = 0, wantZ = 0;
    const run = this.runSpeed(ch);
    const gaitSpeed = ch.id === this.heroId || ch.monster || ch.owner
      ? { walk: Math.min(run, config['sim.walkSpeed']), run, sprint: run * 1.38 }[intent.gait]
      : { walk: config['sim.walkSpeed'], run: config['sim.runSpeed'], sprint: config['sim.sprintSpeed'] }[intent.gait];
    const mag = Math.min(1, Math.hypot(intent.moveX, intent.moveZ));
    const moving = mag > 0.05;
    const mdx = moving ? intent.moveX / Math.hypot(intent.moveX, intent.moveZ) : 0;
    const mdz = moving ? intent.moveZ / Math.hypot(intent.moveX, intent.moveZ) : 0;
    if (moving) {
      wantX = mdx * mag * gaitSpeed;
      wantZ = mdz * mag * gaitSpeed;
    }
    let control = 1;
    let ghost = false;
    const isHero = ch.id === this.heroId && !!this.hero;
    const legacy = !this.hero && (ch.brain === 'input' || ch.brain === 'dummy' || ch.brain === 'wander' || ch.brain === 'idle');

    // Utility inputs that work in any live state.
    if (intent.flask >= 0 && isHero) this.useFlask(intent.flask);
    if (intent.interact && isHero) this.interact(ch);

    const tryDodge = () => {
      if (!intent.dodge || blockedReason(this, ch, 'dodge')) return false;
      ch.action = null;
      ch.lift = 0;
      return startSkill(this, ch, 'dodge', null, moving ? { x: mdx, z: mdz } : null);
    };
    const tryAttackOrSkill = (): boolean => {
      if (intent.skill >= 0 && isHero) {
        const id = this.hero!.hotbar[intent.skill];
        if (id && heroSkills(this.hero!).includes(id)) {
          if (startSkill(this, ch, id, intent.aim)) return true;
          this.emit('skill.blocked', { id: ch.id, skill: id, reason: blockedReason(this, ch, id) });
        }
      }
      if (intent.skill < 0 && intent.skillHeld && isHero) {
        // Held hotbar slots repeat (channels and spam casting).
        for (let i = 0; i < 5; i++) {
          if (!(intent.skillHeld & (1 << i))) continue;
          const id = this.hero!.hotbar[i];
          if (id && heroSkills(this.hero!).includes(id) && !blockedReason(this, ch, id)) return startSkill(this, ch, id, intent.aim);
        }
      }
      if ((intent.attack || intent.attackHeld) && !legacy) return startSkill(this, ch, 'slash1', intent.aim);
      return false;
    };

    switch (ch.state) {
      case 'forced':
        wantX = wantZ = 0;
        if (!ch.forced || (!ch.forced.loop && this.clipDone(ch))) {
          ch.forced = null;
          this.setState(ch, 'idle');
        }
        break;
      case 'stun': {
        const k = Math.exp(-8 * dt);
        ch.knock.x *= k;
        ch.knock.z *= k;
        wantX = ch.knock.x;
        wantZ = ch.knock.z;
        control = 4;
        if (!ch.statuses.some((s) => statusDef(s.id).stun)) this.setState(ch, 'idle');
        break;
      }
      case 'hit': {
        const k = Math.exp(-8 * dt);
        ch.knock.x *= k;
        ch.knock.z *= k;
        wantX = ch.knock.x;
        wantZ = ch.knock.z;
        control = 4;
        if (isHero && tryDodge()) break;
        const recoverAt = ch.kind === 'humanoid' ? this.meta(ch.anim.clip).duration : 0.35;
        if ((ch.kind === 'humanoid' && this.clipDone(ch)) || ch.stateTime >= Math.min(recoverAt, ch.monster ? 0.6 : 0.4)) this.setState(ch, 'idle');
        break;
      }
      case 'action': {
        const a = ch.action;
        if (!a) {
          this.setState(ch, 'idle');
          break;
        }
        const s = skillDef(a.skill);
        const held = a.skill.startsWith('slash') ? intent.attackHeld : this.skillHeldFor(ch, a.skill, intent);
        // Cancels (fluid combat): dodge out of anything but a dodge; move or recast after the cancel point.
        if (isHero && a.skill !== 'dodge' && intent.dodge && a.t > 0.06 && tryDodge()) break;
        if ((intent.attack || intent.attackHeld) && s.next && a.t > 0.2) a.queued = true;
        const cancelAt = s.cancelAfter ?? 1;
        if (isHero && a.t >= cancelAt && !s.channel) {
          if (a.queued && s.next) {
            startSkill(this, ch, s.next, intent.aim);
            break;
          }
          if (intent.skill >= 0 || intent.skillHeld) {
            if (tryAttackOrSkill()) break;
          }
          if (moving) {
            ch.action = null;
            ch.lift = 0;
            this.setState(ch, 'move');
            break;
          }
        }
        const out = updateAction(this, ch, held, mdx * mag, mdz * mag, run);
        wantX = out.wantX;
        wantZ = out.wantZ;
        control = out.control;
        ghost = out.ghost;
        if (out.done && ch.action === a) {
          ch.action = null;
          ch.spin = 0;
          if (a.queued && s.next && this.characters.has(ch.id) && !isDead(ch)) startSkill(this, ch, s.next, intent.aim);
          else if (ch.state === 'action') {
            const rec = a.skill === 'slash1' ? ch.anims.recover[0] : a.skill === 'slash2' ? ch.anims.recover[1] : '';
            if (rec && ch.kind === 'humanoid' && !moving) {
              this.setState(ch, 'recover');
              this.play(ch, rec, { blend: 0.05 });
            } else this.setState(ch, moving ? 'move' : 'idle');
          }
        }
        break;
      }
      case 'attack': {
        // Legacy sandbox combo (training room without a hero).
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
          this.legacyStrike(ch, step);
        }
        if (this.clipDone(ch)) {
          if (ch.queued && ch.combo < 2) this.legacyAttack(ch, ch.combo + 1);
          else if (ch.anims.recover[ch.combo]) {
            this.setState(ch, 'recover');
            this.play(ch, ch.anims.recover[ch.combo], { blend: 0.05 });
          } else this.setState(ch, 'idle');
        }
        break;
      }
      case 'recover':
        if (legacy && intent.attack && ch.combo < 2) {
          this.legacyAttack(ch, ch.combo + 1);
          break;
        }
        if (!legacy && (tryDodge() || tryAttackOrSkill())) break;
        if ((moving && ch.stateTime > 0.1) || this.clipDone(ch)) this.setState(ch, moving ? 'move' : 'idle');
        else wantX = wantZ = 0;
        break;
      case 'air':
        control = 0.35;
        if (ch.anim.clip === ch.anims.jumpStart && (ch.vel.y < 0 || this.clipDone(ch))) this.play(ch, ch.anims.jumpLoop);
        break;
      case 'land':
        if (!legacy && (tryDodge() || tryAttackOrSkill())) break;
        if ((moving || intent.attack) && ch.stateTime > 0.12) this.setState(ch, moving ? 'move' : 'idle');
        else if (ch.stateTime > 0.35) this.setState(ch, 'idle');
        else wantX = wantZ = 0;
        break;
      default: // idle | move
        if (legacy && intent.attack) {
          this.legacyAttack(ch, 0);
          wantX = wantZ = 0;
        } else if (!legacy && (tryDodge() || tryAttackOrSkill())) {
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
    // Skills started this frame zero the wanted velocity until their own motion kicks in.
    if (ch.state === 'action' && ch.action && ch.action.t === 0) {
      wantX = wantZ = 0;
      control = 3;
    }

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
    ch.vel.y -= config['sim.gravity'] * dt;
    if (moving && (ch.state === 'move' || ch.state === 'air' || ch.state === 'idle' || (ch.state === 'action' && control < 3))) {
      this.turnToward(ch, Math.atan2(wantX, wantZ), ch.state === 'action' ? 6 : config['sim.turnRate']);
    }

    // Kinematic move through Rapier's character controller.
    if (ch.collider.isEnabled()) {
      this.kcc.computeColliderMovement(ch.collider, { x: ch.vel.x * dt, y: ch.vel.y * dt, z: ch.vel.z * dt }, undefined, ghost ? MOVE_GHOST : MOVE_SOLID);
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

    if (ch.state === 'idle' || ch.state === 'move') this.locomotionAnim(ch, moving, gaitSpeed);
    if (ch.state !== 'action') this.advanceAnim(ch);
    else if (ch.anim.prevClip) {
      // Action clips are scrubbed by the timeline; only the blend weight advances.
      const bt = 0.06;
      ch.anim.blend = Math.min(1, ch.anim.blend + dt / bt);
      if (ch.anim.blend >= 1) ch.anim.prevClip = null;
    }
  }

  private skillHeldFor(ch: Character, id: string, intent: CharacterInput): boolean {
    if (ch.monster || ch.owner) return ch.ai.mode !== 'retreat';
    if (!this.hero) return false;
    const slot = this.hero.hotbar.indexOf(id);
    return slot >= 0 && !!(intent.skillHeld & (1 << slot));
  }

  private locomotionAnim(ch: Character, moving: boolean, gaitSpeed: number) {
    if (!moving && ch.speed < 0.3) {
      if (ch.state === 'move') this.setState(ch, 'idle');
      const talk = ch.npc && this.player && Math.hypot(this.player.pos.x - ch.pos.x, this.player.pos.z - ch.pos.z) < 3.2;
      this.play(ch, ch.npc?.anim && !talk ? ch.npc.anim : talk ? ch.anims.talk : ch.anims.idle);
      return;
    }
    if (ch.pushing > 0) {
      this.play(ch, ch.anims.push, { speed: 1 });
      return;
    }
    const s = Math.max(ch.speed, 0.3);
    const runRef = ch.monster || ch.id === this.heroId || ch.owner ? Math.max(gaitSpeed, config['sim.walkSpeed'] + 0.5) : config['sim.runSpeed'];
    const pick = s < (config['sim.walkSpeed'] + runRef) / 2
      ? ch.anims.walk
      : s < runRef * 1.18 ? ch.anims.run : ch.anims.sprint;
    const rootSpeed = this.meta(pick).rootSpeed || s;
    this.play(ch, pick, { speed: Math.max(0.5, Math.min(1.8, s / rootSpeed)) });
  }

  // ---------------------------------------------------------------- legacy sandbox combat

  private legacyAttack(ch: Character, index: number) {
    ch.combo = index;
    ch.queued = false;
    ch.hitDone = false;
    this.setState(ch, 'attack');
    const best = autoTarget(this, ch, 2.6);
    if (best) ch.yaw = Math.atan2(best.pos.x - ch.pos.x, best.pos.z - ch.pos.z);
    this.play(ch, ch.anims.attack[index], { restart: true, blend: 0.05 });
    this.emit('attack', { id: ch.id, step: index + 1, clip: ch.anims.attack[index] });
  }

  private legacyStrike(ch: Character, step: (typeof ATTACKS)[number]) {
    const s = skillDef(`slash${ch.combo + 1}`);
    const shape: Shape = { kind: 'cone', radius: step.range, arc: step.arcDeg };
    let hits = 0;
    for (const o of this.characters.values()) {
      if (o === ch || o.state === 'dead' || !hostile(ch.team, o.team)) continue;
      if (!inShape(shape, ch.pos.x, ch.pos.z, ch.yaw, o.pos.x, o.pos.z, 0)) continue;
      if (!this.lineOfSight(chestOf(ch), chestOf(o))) continue;
      hits++;
      const p = rollPacket(this, ch, s, { knock: step.knock, heavy: step.heavy, stagger: 100 }, o);
      p.dmg = { physical: step.damage };
      p.crit = false;
      applyPacket(this, o, p, ch.pos.x, ch.pos.z);
    }
    const crates = this.knockCrates(ch, shape, ch.pos.x, ch.pos.z, ch.yaw, step.knock);
    if (hits) this.hitstop = Math.max(this.hitstop, config['sim.hitstopFrames'] + (step.heavy ? 3 : 0));
    else if (crates) this.hitstop = Math.max(this.hitstop, Math.floor(config['sim.hitstopFrames'] / 2));
    else this.emit('whiff', { id: ch.id, step: ch.combo + 1 });
  }

  /** Sword hits shove pushable crates (Rapier impulses). Returns crates hit. */
  knockCrates(ch: Character, shape: Shape, ox: number, oz: number, yaw: number, knockSpeed: number): number {
    const knock = config['sim.crateKnock'];
    if (knock <= 0) return 0;
    const chest = chestOf(ch);
    let n = 0;
    for (const c of this.crates.values()) {
      if (!c.pushable) continue;
      if (!inShape(shape, ox, oz, yaw, c.pos.x, c.pos.z, c.size / 2)) continue;
      const dx = c.pos.x - ch.pos.x, dz = c.pos.z - ch.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) continue;
      // The first blocker along the swing must be this crate itself.
      const center = { x: c.pos.x, y: Math.min(c.pos.y + c.size / 2, chest.y), z: c.pos.z };
      const len = Math.hypot(center.x - chest.x, center.y - chest.y, center.z - chest.z);
      const hit = this.cast(chest.x, chest.y, chest.z, (center.x - chest.x) / len, (center.y - chest.y) / len, (center.z - chest.z) / len, len + c.size);
      if (hit && hit.collider.handle !== c.collider.handle) continue;
      const speed = knockSpeed * knock;
      const m = c.body.mass();
      c.body.applyImpulse({ x: (dx / d) * speed * m, y: 0, z: (dz / d) * speed * m }, true);
      n++;
      this.emit('crate.hit', { attacker: ch.id, crate: c.id, speed: r3(speed), heavy: speed > 3 });
    }
    return n;
  }

  // ---------------------------------------------------------------- props (delegates to props.ts)

  /** Damages breakables / triggers mechanic props touched by a shape. Returns props affected. */
  hitProps(shape: Shape, ox: number, oz: number, yaw: number, by: Character, s: SkillDef, hit: HitSpec | undefined): number {
    let n = 0;
    for (const p of this.props.values()) {
      if (p.dead) continue;
      const spec = propSpec(p.kind);
      if (!spec?.hittable) continue;
      if (!inShape(shape, ox, oz, yaw, p.x, p.z, spec.radius * p.scale)) continue;
      if (by.team !== 'hero' && !spec.anyTeam) continue;
      this.damageProp(p, by, s, hit);
      n++;
    }
    return n;
  }

  damageProp(p: Prop, by: Character | null, s: SkillDef, hit: HitSpec | undefined) {
    mechanicHit(this, p, by, s, hit);
  }

  /** First hittable prop crossed by a projectile segment. */
  propOnSegment(ax: number, az: number, bx: number, bz: number, r: number): { prop: Prop; t: number } | null {
    let best: { prop: Prop; t: number } | null = null;
    for (const p of this.props.values()) {
      if (p.dead) continue;
      const spec = propSpec(p.kind);
      if (!spec?.hittable || !spec.solid) continue;
      const t = segmentCircle(ax, az, bx, bz, p.x, p.z, spec.radius * p.scale + r);
      if (t !== null && (!best || t < best.t)) best = { prop: p, t };
    }
    return best;
  }

  // ---------------------------------------------------------------- interaction & pickups

  /** Nearest thing the hero can interact with: item on the ground, prop, or NPC. */
  interactTarget(ch: Character): { kind: 'pickup'; pickup: Pickup } | { kind: 'prop'; prop: Prop } | { kind: 'npc'; npc: Character } | null {
    let best: ReturnType<Sim['interactTarget']> = null, bd = Infinity;
    for (const p of this.pickups) {
      if (p.dead || p.kind !== 'item' || p.delay > 0) continue;
      const d = Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z);
      if (d < 2 && d < bd) {
        bd = d;
        best = { kind: 'pickup', pickup: p };
      }
    }
    for (const p of this.props.values()) {
      if (p.dead) continue;
      const spec = propSpec(p.kind);
      if (!spec?.interact || p.state === 'used') continue;
      const d = Math.hypot(p.x - ch.pos.x, p.z - ch.pos.z) - spec.radius * p.scale;
      if (d < 1.6 && d < bd) {
        bd = d;
        best = { kind: 'prop', prop: p };
      }
    }
    for (const o of this.characters.values()) {
      if (!o.npc || o.state === 'dead') continue;
      const d = Math.hypot(o.pos.x - ch.pos.x, o.pos.z - ch.pos.z);
      if (d < 2.6 && d < bd) {
        bd = d;
        best = { kind: 'npc', npc: o };
      }
    }
    return best;
  }

  interact(ch: Character) {
    const t = this.interactTarget(ch);
    if (!t) return;
    if (t.kind === 'pickup') pickupItem(this, t.pickup);
    else if (t.kind === 'prop') mechanicHit(this, t.prop, ch, skillDef('env'), undefined, true);
    else this.emit('npc.talk', { id: t.npc.id, role: t.npc.npc?.role ?? 'villager', name: t.npc.name });
  }

  /** Picks up a specific ground item (clicking a label). */
  pickUp(id: number): boolean {
    const p = this.pickups.find((x) => x.id === id && !x.dead);
    const hero = this.player;
    if (!p || !hero) return false;
    if (Math.hypot(p.x - hero.pos.x, p.z - hero.pos.z) > 2.2) {
      try {
        this.moveTo(hero.id, p.x, p.z);
      } catch {
        return false;
      }
      hero.ai.target = `pickup:${p.id}`;
      return false;
    }
    return pickupItem(this, p);
  }

  private stepPickups() {
    const hero = this.player;
    for (const p of this.pickups) {
      if (p.dead) continue;
      if (p.t < 1) p.t = Math.min(1, p.t + this.dt * 2.6);
      if (p.delay > 0) p.delay--;
      if (!hero || hero.state === 'dead' || p.delay > 0) continue;
      const d = Math.hypot(p.x - hero.pos.x, p.z - hero.pos.z);
      // Walking to a clicked item picks it up on arrival.
      if (p.kind === 'item' && hero.ai.target === `pickup:${p.id}` && d < 1.2) {
        hero.ai.target = null;
        pickupItem(this, p);
        continue;
      }
      if (p.kind !== 'item' && d < (p.kind === 'gold' ? 1.6 : 1.2)) pickupItem(this, p);
    }
    if (this.pickups.some((p) => p.dead)) this.pickups = this.pickups.filter((p) => !p.dead);
  }

  // ---------------------------------------------------------------- death, rewards, respawn

  kill(t: Character, by: Character | null, silent = false) {
    if (t.state === 'dead') return;
    t.life = 0;
    t.action = null;
    t.lift = 0;
    t.spin = 0;
    t.statuses = [];
    t.statsVersion++;
    this.setState(t, 'dead');
    t.deadTime = 0;
    if (t.kind === 'humanoid') this.play(t, t.anims.death, { restart: true, blend: 0.05 });
    t.collider.setEnabled(false);
    // The credited killer: minions and mechanics credit their owner.
    const credit = by?.owner ? this.characters.get(by.owner) ?? by : by;
    this.emit('death', { id: t.id, by: credit?.id ?? null, x: t.pos.x, z: t.pos.z, rarity: t.monster?.rarity ?? null, def: t.monster?.def ?? null, boss: !!t.monster?.boss, silent });
    if (t.id === this.heroId && this.hero) {
      this.hero.totals.deaths++;
      this.stage.deaths++;
      this.emit('hero.died', { x: t.pos.x, z: t.pos.z });
      return;
    }
    if (!t.monster || silent) return;
    affixOnDeath(this, t, credit);
    if (credit && credit.team === 'hero' && this.hero) this.reward(t);
    if (t.monster.boss) {
      this.stage.bossDead = true;
      this.openExit();
      this.emit('boss.dead', { id: t.id, name: t.name });
    }
  }

  private reward(t: Character) {
    const hero = this.hero!;
    const heroCh = this.player;
    const st = heroCh ? this.stats(heroCh) : null;
    this.stage.kills++;
    hero.totals.kills++;
    if (t.monster!.rarity !== 'normal') {
      this.stage.elites++;
      hero.totals.elites++;
    }
    if (t.monster!.boss) hero.totals.bosses++;
    if (heroCh) {
      heroCh.since.kill = 0;
      if (st) {
        heroCh.life = Math.min(heroCh.maxLife, heroCh.life + st.get('lifeOnKill'));
        heroCh.mana = Math.min(heroCh.maxMana, heroCh.mana + st.get('manaOnKill'));
      }
    }
    const xp = t.monster!.xp * xpPenalty(hero.level, t.level) * ((st?.get('xpGain') ?? 100) / 100) * config['tune.xp'];
    this.stage.xp += xp;
    const levels = gainXp(hero, xp);
    this.emit('xp', { amount: Math.round(xp), from: t.id });
    if (levels > 0) {
      this.refreshHero();
      if (heroCh) {
        heroCh.life = heroCh.maxLife;
        heroCh.mana = heroCh.maxMana;
      }
      this.emit('levelup', { level: hero.level, gained: levels });
    }
    // Flask charges.
    const charges = { normal: 1, magic: 3, rare: 6, unique: 12 }[t.monster!.rarity] * ((st?.get('flaskCharges') ?? 100) / 100);
    for (const i of [0, 1] as const) {
      const item = hero.equipment[i === 0 ? 'flask1' : 'flask2'];
      const max = item ? (BASE_FLASK[item.base]?.charges ?? 30) : 0;
      hero.flasks[i] = Math.min(max, hero.flasks[i] + charges);
    }
    dropLoot(this, t);
  }

  private openExit() {
    if (this.stage.exitOpen || !this.level.exit) return;
    this.stage.exitOpen = true;
    const e = this.level.exit;
    const p = this.nav.nearestFree(e);
    this.addProp({ id: 'exit', kind: 'portal', x: p.x, z: p.z, data: { to: 'next' } });
    this.emit('exit.open', { x: p.x, z: p.z });
  }

  private respawnHero(ch: Character) {
    const start = this.level.start ?? { x: ch.spawn.x, z: ch.spawn.z, yawDeg: 0 };
    ch.collider.setEnabled(true);
    this.teleport(ch.id, start.x, start.z, start.yawDeg);
    this.setState(ch, 'idle');
    this.play(ch, ch.anims.idle, { restart: true, blend: 0 });
    ch.statuses = [];
    ch.statsVersion++;
    this.refreshPools(ch, true);
    ch.flash = 10;
    ch.iframes = 2;
    const lost = this.hero ? Math.floor(this.hero.gold * 0.1) : 0;
    if (this.hero) this.hero.gold -= lost;
    this.emit('hero.respawn', { goldLost: lost });
  }

  private respawn(ch: Character) {
    ch.collider.setEnabled(true);
    this.teleport(ch.id, ch.spawn.x, ch.spawn.z);
    ch.yaw = ch.spawn.yaw;
    ch.life = ch.maxLife;
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
    for (const ch of this.characters.values()) ch.sprite = { ...this.spriteOf(ch.anim, ch.yaw + ch.spin), tick };
  }

  // ---------------------------------------------------------------- snapshot for agents

  snapshot() {
    const fps = config['anim.fps'];
    return {
      frame: this.frame,
      time: r3(this.frame / STEP_HZ),
      seed: this.seed,
      hitstop: this.hitstop,
      level: { name: this.level.name, title: this.level.title, kind: this.level.kind, theme: this.level.theme, mechanics: this.level.mechanics ?? [] },
      stage: { ...this.stage, time: r3(this.stage.time / STEP_HZ) },
      hero: this.hero ? { level: this.hero.level, xp: this.hero.xp, gold: this.hero.gold, hotbar: this.hero.hotbar, flasks: this.hero.flasks } : null,
      characters: [...this.characters.values()].map((ch) => ({
        id: ch.id,
        name: ch.name,
        kind: ch.kind,
        preset: ch.preset,
        team: ch.team,
        brain: ch.brain,
        state: ch.state,
        hp: Math.round(ch.life * 10) / 10,
        maxHp: Math.round(ch.maxLife * 10) / 10,
        mana: Math.round(ch.mana),
        level: ch.level,
        pos: [r3(ch.pos.x), r3(ch.pos.y), r3(ch.pos.z)],
        vel: [r3(ch.vel.x), r3(ch.vel.y), r3(ch.vel.z)],
        speed: r3(ch.speed),
        yawDeg: r3((ch.yaw * 180) / Math.PI),
        facing: DIR8_SCREEN_NAMES[dir8(ch.yaw).index],
        grounded: ch.grounded,
        groundY: r3(ch.groundY),
        action: ch.action ? { skill: ch.action.skill, t: r3(ch.action.t) } : null,
        statuses: ch.statuses.map((s) => ({ id: s.id, time: r3(s.time) })),
        monster: ch.monster ? { def: ch.monster.def, rarity: ch.monster.rarity, affixes: ch.monster.affixes, palette: ch.monster.palette, awake: ch.ai.awake } : null,
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
      props: [...this.props.values()].filter((p) => !p.dead).map((p) => ({ id: p.id, kind: p.kind, state: p.state, pos: [r3(p.x), r3(p.y), r3(p.z)] })),
      projectiles: this.projectiles.length,
      zones: this.zones.map((z) => ({ id: z.id, skill: z.skill, visual: z.spec.visual, pos: [r3(z.x), r3(z.z)], delay: r3(Math.max(0, z.delay)) })),
      pickups: this.pickups.map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, item: p.item ? { name: p.item.name, rarity: p.item.rarity, base: p.item.base } : null, pos: [r3(p.x), r3(p.z)] })),
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
    for (const ch of this.characters.values()) [ch.pos.x, ch.pos.y, ch.pos.z, ch.yaw, ch.life, ch.anim.time].forEach(add);
    for (const c of this.crates.values()) [c.pos.x, c.pos.y, c.pos.z].forEach(add);
    for (const p of this.props.values()) [p.x, p.z, p.hp].forEach(add);
    add(this.projectiles.length);
    add(this.zones.length);
    add(this.pickups.length);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Flask parameters by base id. */
const BASE_FLASK: Record<string, NonNullable<(typeof BASES)[string]['flask']>> = Object.fromEntries(
  Object.values(BASES).filter((b) => b.flask).map((b) => [b.id, b.flask!]),
);
