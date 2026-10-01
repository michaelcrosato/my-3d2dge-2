/** Shared simulation types (plain data, structured-clone friendly except Rapier handles). */
import type RAPIER from '@dimforge/rapier3d-compat';
import type { AnimSet } from '../content/characters';
import type { Brain, Team } from '../content/level';
import type { MonsterRarity } from '../content/monsters';
import type { GenomeEdits } from '../content/procgen/creature';
import type { AilmentId, HitSpec, ProjectileSpec, Shape, ZoneSpec } from '../content/skills';
import type { DamageType, Mod, Tag } from '../content/stats';
import type { P2 } from './nav';

export interface ClipMeta {
  duration: number;
  loop: boolean;
  rootSpeed: number;
}
export type ClipTable = Record<string, ClipMeta>;

export type Gait = 'walk' | 'run' | 'sprint';
export type CharState = 'idle' | 'move' | 'air' | 'land' | 'attack' | 'recover' | 'hit' | 'dead' | 'forced' | 'action' | 'stun';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface CharacterInput {
  /** World-space XZ direction; length 0..1 scales speed. */
  moveX: number;
  moveZ: number;
  gait: Gait;
  /** One-shot triggers, consumed when used. */
  jump: boolean;
  attack: boolean;
  /** Held: keep attacking / channelling. */
  attackHeld: boolean;
  dodge: boolean;
  /** Hotbar slot pressed this frame (-1 none) and bitmask of held slots. */
  skill: number;
  skillHeld: number;
  /** World point under the pointer (mouse aiming); null = auto-aim / facing. */
  aim: P2 | null;
  interact: boolean;
  /** Flask slot pressed (-1 none). */
  flask: number;
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

export interface ActionState {
  skill: string;
  /** Timeline progress 0..1. */
  t: number;
  /** Seconds for the whole timeline at the speed captured when the action started. */
  dur: number;
  /** Index of the next effect to fire (effects sorted by `at`). */
  next: number;
  aimX: number;
  aimZ: number;
  dirX: number;
  dirZ: number;
  startX: number;
  startZ: number;
  destX: number;
  destZ: number;
  /** Sweep effect state: ids already hit, active window end and parameters. */
  swept: string[];
  sweepUntil: number;
  sweepRadius: number;
  sweepHit: HitSpec | null;
  loops: number;
  /** Set once a buffered combo/skill press arrived during this action. */
  queued: boolean;
}

export interface StatusInst {
  id: string;
  /** Seconds remaining / total. */
  time: number;
  duration: number;
  /** DPS for DoTs, percent for slows/shock, multiplier for buffs. */
  magnitude: number;
  source: string;
  stacks: number;
  /** Ad-hoc mods carried by the status itself (stolen monster affixes). */
  mods?: Mod[];
}

export interface Look {
  /** Material name -> color overrides (palette, rarity). */
  tint?: Record<string, string>;
  glow?: Record<string, string>;
  palette?: string;
  /** Procedural creature genome seed / plan. */
  plan?: string;
  seed?: number;
  /** Hand edits on the generated genome (custom species). */
  genome?: GenomeEdits;
  /** Elite outline color (magic blue, rare yellow, unique orange). */
  aura?: string;
  weapon?: string;
}

export interface MonsterInfo {
  def: string;
  rarity: MonsterRarity;
  affixes: string[];
  pack: string | null;
  palette: string;
  element: DamageType | null;
  skills: string[];
  boss: boolean;
  phase: number;
  /** Seconds until the next AI decision. */
  thinkIn: number;
  xp: number;
  /** Affix behaviour timers. */
  timers: Record<string, number>;
}

export interface AiState {
  path: P2[];
  wait: number;
  stuck: number;
  last: P2;
  /** Monster brain: current target id and mode. */
  target: string | null;
  mode: 'idle' | 'chase' | 'kite' | 'strafe' | 'retreat' | 'flee' | 'return';
  modeTime: number;
  strafeDir: number;
  awake: boolean;
}

export interface Character {
  id: string;
  kind: 'humanoid' | 'creature';
  preset: string;
  name: string;
  team: Team;
  brain: Brain;
  anims: AnimSet;
  level: number;
  pos: V3;
  prevPos: V3;
  vel: V3;
  yaw: number;
  grounded: boolean;
  airTime: number;
  radius: number;
  scale: number;
  life: number;
  maxLife: number;
  mana: number;
  maxMana: number;
  /** Mods from the source (hero build, monster def + rarity + affixes); statuses add theirs on top. */
  baseMods: Mod[];
  /** Bumped whenever baseMods or mod-carrying statuses change; the StatBlock cache keys on it. */
  statsVersion: number;
  state: CharState;
  stateTime: number;
  action: ActionState | null;
  /** Legacy sandbox combo fields. */
  combo: number;
  queued: boolean;
  hitDone: boolean;
  statuses: StatusInst[];
  cooldowns: Record<string, number>;
  /** Local hitstop: frames this character's animation and action hold still. */
  freeze: number;
  iframes: number;
  poise: number;
  pushing: number;
  speed: number;
  flash: number;
  knock: P2;
  spawn: { x: number; z: number; yaw: number };
  input: CharacterInput;
  inputFrames: number;
  ai: AiState;
  order: { x: number; z: number; gait: Gait; path: P2[]; stuck: number; last: P2 } | null;
  forced: { clip: string; loop: boolean } | null;
  anim: AnimState;
  sprite: SpriteState;
  /** Height of the walkable surface under the character (Rapier ray probe; floor = 0). */
  groundY: number;
  /** Visual height above the ground (leaps). */
  lift: number;
  /** Visual extra yaw (whirlwind spin). */
  spin: number;
  monster: MonsterInfo | null;
  look: Look;
  /** Summoner id for minions. */
  owner: string | null;
  /** Frames until a summon expires (-1 = never). */
  expires: number;
  /** Seconds since death (corpse timer). */
  deadTime: number;
  /** Leech / regen fractional accumulators. */
  regen: { life: number; mana: number; leechBudget: number };
  /** Frames since this character last killed / dodged / took damage (conditions). */
  since: { kill: number; dodge: number; hurt: number };
  npc: { role: string; anim?: string; lines?: string[] } | null;
  /** Rapier objects (not cloned into checkpoints). */
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

/** A rolled hit: damage before the target's mitigation, plus everything the hit carries. */
export interface Packet {
  attacker: string;
  team: string;
  level: number;
  skill: string;
  tags: Tag[];
  dmg: Partial<Record<DamageType, number>>;
  crit: boolean;
  ailments: Partial<Record<AilmentId, number>>;
  knock: number;
  stagger: number;
  heavy: boolean;
  pull: number;
  isAttack: boolean;
  penetration: number;
  alwaysHit: boolean;
  leech: number;
  manaLeech: number;
  lifeOnHit: number;
  manaOnHit: number;
  ailmentEffect: number;
  ailmentDuration: number;
}

export interface Projectile {
  id: number;
  owner: string;
  team: string;
  skill: string;
  spec: ProjectileSpec;
  packet: Packet;
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  traveled: number;
  range: number;
  pierce: number;
  chain: number;
  hit: string[];
  /** Lobbed projectiles: origin, landing point and flight progress. */
  lob: { fx: number; fz: number; tx: number; tz: number; t: number; T: number } | null;
  dead: boolean;
  color: string;
}

export interface Zone {
  id: number;
  owner: string;
  team: string;
  skill: string;
  spec: ZoneSpec;
  shape: Shape;
  packet: Packet;
  x: number;
  z: number;
  yaw: number;
  /** Seconds of telegraph left. */
  delay: number;
  /** Seconds of lingering left after resolving. */
  life: number;
  tickIn: number;
  resolved: boolean;
  follow: string | null;
  /** Orbit angle for follow zones (visual). */
  angle: number;
  color: string;
  dead: boolean;
  /** Mechanic-owned zones (spike traps, vents) hit everyone regardless of team. */
  hostileToAll?: boolean;
}

export interface Pickup {
  id: number;
  kind: 'gold' | 'item' | 'orb' | 'shard';
  x: number;
  z: number;
  /** Pop-out arc from where it dropped. */
  fromX: number;
  fromZ: number;
  t: number;
  amount: number;
  item: import('../content/items').Item | null;
  /** Health / mana globe type for orbs. */
  orb?: 'life' | 'mana';
  /** Frames until it can be picked up (prevents instant re-pickup). */
  delay: number;
  dead: boolean;
}

export interface Prop {
  id: string;
  kind: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  scale: number;
  /** Generic state used by mechanics and breakables. */
  state: string;
  timer: number;
  hp: number;
  data: Record<string, unknown>;
  collider: RAPIER.Collider | null;
  body: RAPIER.RigidBody | null;
  /** Dynamic props (boulders, kegs knocked around) report positions. */
  vx: number;
  vz: number;
  prevX: number;
  prevZ: number;
  dead: boolean;
}

export interface SimEvent {
  seq: number;
  frame: number;
  type: string;
  [key: string]: unknown;
}
