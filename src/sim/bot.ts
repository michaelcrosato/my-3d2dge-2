/**
 * Autoplayer: drives the hero through a dungeon the way a player would, by writing the same
 * `CharacterInput` a keyboard or gamepad produces. It explores rooms, fights with the hotbar,
 * dodges telegraphs, drinks flasks, picks up loot, optionally sets off level mechanics and walks
 * into the exit once the boss falls.
 *
 * Deterministic (reads only sim state, own RNG seeded from the sim seed), so a bot run is a
 * repeatable playtest: agents use it for balance sweeps (`balance.run`), soak tests and the
 * watchable autopilot (`bot.play`). Two strategies mirror the two audiences the levels serve:
 * `clear` explores every room (power-levelling), `rush` heads for the boss (speedrunning).
 */
import { skill as skillDef, type SkillDef } from '../content/skills';
import { blockedReason, inShape } from './actions';
import { estimateSkill, hostile } from './combat';
import type { P2 } from './nav';
import { propSpec } from './props';
import { Rng } from './rng';
import { emptyInput, type Sim } from './sim';
import type { Character, CharacterInput, Prop } from './types';

export interface BotOptions {
  strategy?: 'clear' | 'rush';
  /** Use hotbar skills (false: basic attacks only). */
  skills?: boolean;
  /** Walk over to dropped items and pick them up. */
  loot?: boolean;
  /** Set off level mechanics (kegs near packs, shrines, beacons). */
  mechanics?: boolean;
  /** Walk into the exit portal after the boss falls. */
  exit?: boolean;
  /** Dodge out of telegraphed attacks. */
  dodge?: boolean;
}

const DEFAULTS: Required<BotOptions> = { strategy: 'clear', skills: true, loot: true, mechanics: true, exit: true, dodge: true };

/** What the bot is doing this frame (shown by the autopilot overlay and in reports). */
export type BotGoal = 'fight' | 'explore' | 'loot' | 'mechanic' | 'exit' | 'dodge' | 'idle' | 'dead';

const AOE = new Set(['cleave', 'whirlwind', 'groundslam', 'leapslam', 'frostnova', 'bladevortex', 'warcry', 'venomcloud', 'meteor']);

export class Bot {
  readonly opts: Required<BotOptions>;
  goal: BotGoal = 'idle';
  /** Free-form note for the current goal (target name, room id). */
  note = '';
  private rng: Rng;
  private visited = new Set<number>();
  private path: P2[] = [];
  private pathTo: P2 | null = null;
  private pathAge = 0;
  private last: P2 = { x: 0, z: 0 };
  private stuck = 0;
  private cooldown = { flask0: 0, flask1: 0, dodge: 0, skill: 0, interact: 0 };
  private giveUp = new Set<string>();
  private goalKey = '';
  private goalFrames = 0;

  constructor(readonly sim: Sim, opts: BotOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.rng = new Rng(sim.seed * 7919 + 13);
  }

  roomsVisited(): number {
    return (this.sim.level.rooms ?? []).filter((r) => r.kind !== 'corridor' && this.visited.has(r.id)).length;
  }

  /** Decides this frame's input for the hero. Call before every `sim.step()`. */
  think(): void {
    const sim = this.sim, p = sim.player;
    if (!p) return;
    for (const k of Object.keys(this.cooldown) as Array<keyof Bot['cooldown']>) if (this.cooldown[k] > 0) this.cooldown[k]--;
    const input: CharacterInput = emptyInput();
    p.input = input;
    p.inputFrames = 0;
    if (p.state === 'dead') {
      this.goal = 'dead';
      this.path = [];
      return;
    }
    this.markRoom(p);
    this.trackStuck(p);

    this.flasks(p, input);
    if (this.opts.dodge && this.dodgeDanger(p, input)) return this.setGoal('dodge', '');
    const enemies = this.enemies(p);
    const target = this.pickTarget(p, enemies);
    if (target) {
      if (this.opts.mechanics && this.useKeg(p, input, enemies)) return this.setGoal('mechanic', 'keg');
      if (this.opts.mechanics && this.breakTotem(p, input, target)) return this.setGoal('mechanic', 'totem');
      this.fight(p, input, target, enemies);
      return this.setGoal('fight', target.name);
    }
    if (this.opts.loot && this.loot(p, input)) return;
    if (this.opts.mechanics && this.visitMechanic(p, input)) return;
    if (this.exitOrExplore(p, input)) return;
    this.setGoal('idle', '');
  }

  // ---------------------------------------------------------------- bookkeeping

  private setGoal(goal: BotGoal, note: string) {
    const key = `${goal}:${note}`;
    if (key !== this.goalKey) {
      this.goalKey = key;
      this.goalFrames = 0;
    } else this.goalFrames++;
    this.goal = goal;
    this.note = note;
  }

  private markRoom(p: Character) {
    for (const r of this.sim.level.rooms ?? [])
      if (p.pos.x >= r.x - 0.5 && p.pos.x <= r.x + r.w + 0.5 && p.pos.z >= r.z - 0.5 && p.pos.z <= r.z + r.h + 0.5) this.visited.add(r.id);
  }

  private trackStuck(p: Character) {
    const moved = Math.hypot(p.pos.x - this.last.x, p.pos.z - this.last.z);
    if (moved > 0.3 || p.action) {
      this.last = { x: p.pos.x, z: p.pos.z };
      this.stuck = 0;
    } else this.stuck++;
  }

  // ---------------------------------------------------------------- survival

  private flasks(p: Character, input: CharacterInput) {
    const has = (id: string) => p.statuses.some((s) => s.id === id);
    if (p.life < p.maxLife * 0.5 && !has('flask_life') && this.cooldown.flask0 === 0 && this.sim.hero && this.sim.hero.flasks[0] > 0) {
      input.flask = 0;
      this.cooldown.flask0 = 50;
    } else if (p.maxMana > 0 && p.mana < p.maxMana * 0.2 && !has('flask_mana') && this.cooldown.flask1 === 0 && this.sim.hero && this.sim.hero.flasks[1] > 0) {
      input.flask = 1;
      this.cooldown.flask1 = 50;
    }
  }

  /** Rolls out of an enemy telegraph that is about to land on the hero. */
  private dodgeDanger(p: Character, input: CharacterInput): boolean {
    if (this.cooldown.dodge > 0 || blockedReason(this.sim, p, 'dodge')) return false;
    for (const z of this.sim.zones) {
      if (z.dead || z.resolved || z.delay <= 0 || z.delay > 0.6) continue;
      if (!z.hostileToAll && !hostile(z.team, p.team)) continue;
      if (!inShape(z.shape, z.x, z.z, z.yaw, p.pos.x, p.pos.z, p.radius)) continue;
      let dx = p.pos.x - z.x, dz = p.pos.z - z.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) {
        const a = this.rng.next() * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
      } else {
        dx /= d;
        dz /= d;
      }
      input.moveX = dx;
      input.moveZ = dz;
      input.dodge = true;
      this.cooldown.dodge = 30;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- combat

  private enemies(p: Character): Character[] {
    const out: Character[] = [];
    for (const c of this.sim.characters.values()) {
      if (c.state === 'dead' || !c.monster || !hostile(p.team, c.team)) continue;
      out.push(c);
    }
    return out;
  }

  private pickTarget(p: Character, enemies: Character[]): Character | null {
    let best: Character | null = null, bd = Infinity;
    for (const c of enemies) {
      const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
      if (d > 11) continue;
      // Enemies behind walls do not count until the path leads there.
      if (d > 3 && !this.sim.nav.lineFree(p.pos, c.pos)) continue;
      if (this.giveUp.has(c.id)) continue;
      // Shrouded monsters (Lightless) are hard to see: only fight them up close.
      if (d > 4 && c.statuses.some((s) => s.id === 'shrouded')) continue;
      const score = d - (c.monster!.def === 'imp' ? 4 : 0) - (c.ai.awake ? 1 : 0);
      if (score < bd) {
        bd = score;
        best = c;
      }
    }
    return best;
  }

  private fight(p: Character, input: CharacterInput, t: Character, enemies: Character[]) {
    const sim = this.sim;
    const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
    const reach = 1.7 + t.radius;
    const crowd = enemies.filter((e) => Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 3.6).length;
    input.aim = { x: t.pos.x, z: t.pos.z };
    // A target that cannot be reached for a long time is skipped (stuck behind a pit, flying imp).
    if (this.goalFrames > 60 * 25) this.giveUp.add(t.id);

    const slot = this.opts.skills ? this.chooseSkill(p, t, d, reach, crowd) : -1;
    if (slot >= 0) {
      const id = sim.hero!.hotbar[slot]!;
      if (skillDef(id).channel) input.skillHeld = 1 << slot;
      else input.skill = slot;
      this.cooldown.skill = 8;
      if (d > reach) this.moveToward(p, input, t.pos, 0);
      return;
    }
    if (d <= reach) {
      input.attackHeld = true;
      return;
    }
    this.moveToward(p, input, t.pos, reach * 0.7);
  }

  /** Hotbar slot worth pressing now, or -1. */
  private chooseSkill(p: Character, t: Character, d: number, reach: number, crowd: number): number {
    const sim = this.sim, hero = sim.hero;
    if (!hero || this.cooldown.skill > 0 || p.action) return -1;
    let best = -1, bestScore = 0;
    hero.hotbar.forEach((id, slot) => {
      if (!id || blockedReason(sim, p, id)) return;
      const s: SkillDef = skillDef(id);
      let score = 0;
      if (s.tags.includes('minion')) score = [...sim.characters.values()].some((c) => c.owner === p.id && c.state !== 'dead') ? 0 : 30;
      else if (id === 'warcry') score = crowd >= 2 ? 25 : 0;
      else if (s.tags.includes('movement') && !s.tags.includes('attack')) score = 0;
      else {
        const est = estimateSkill(sim, p, s);
        const inRange = d <= Math.max(reach, s.range + t.radius);
        if (!inRange) return;
        score = est.hit * (AOE.has(id) ? Math.max(1, crowd) : 1);
        if (AOE.has(id) && crowd < 2 && !t.monster?.boss && t.monster?.rarity === 'normal') score *= 0.5;
        // Keep mana for emergencies: below 30% only cheap skills.
        if (p.maxMana > 0 && p.mana < p.maxMana * 0.3 && (s.cost ?? 0) > 6) score *= 0.2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = slot;
      }
    });
    // Basic attacks are free; a skill must beat a slash by a margin when already in reach.
    if (best >= 0 && d <= reach) {
      const slash = estimateSkill(sim, p, skillDef('slash1')).hit;
      if (bestScore < slash * 1.2) return -1;
    }
    return best;
  }

  /** Strikes a keg when it would catch two or more monsters in its blast. */
  private useKeg(p: Character, input: CharacterInput, enemies: Character[]): boolean {
    for (const k of this.sim.props.values()) {
      if (k.dead || k.kind !== 'keg' || k.state !== 'idle') continue;
      const dk = Math.hypot(k.x - p.pos.x, k.z - p.pos.z);
      if (dk > 6 || dk < 1.4) continue;
      const caught = enemies.filter((e) => Math.hypot(e.pos.x - k.x, e.pos.z - k.z) < 3).length;
      if (caught < 2) continue;
      input.aim = { x: k.x, z: k.z };
      if (dk <= 2.2) input.attackHeld = true;
      else this.moveToward(p, input, { x: k.x, z: k.z }, 1.6);
      return true;
    }
    return false;
  }

  /** A boss or elite standing by a totem is warded and healed: break the totem first. */
  private breakTotem(p: Character, input: CharacterInput, target: Character): boolean {
    if (!target.monster || (target.monster.rarity === 'normal' && !target.monster.boss)) return false;
    let best: Prop | null = null, bd = 10;
    for (const q of this.sim.props.values()) {
      if (q.dead || q.kind !== 'totem' || Math.hypot(q.x - target.pos.x, q.z - target.pos.z) > 9) continue;
      const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (!best) return false;
    input.aim = { x: best.x, z: best.z };
    if (bd <= 1.9) input.attackHeld = true;
    else this.moveToward(p, input, best, 1.4);
    return true;
  }

  // ---------------------------------------------------------------- loot, mechanics, exploring

  private loot(p: Character, input: CharacterInput): boolean {
    let best: { x: number; z: number; id: number } | null = null, bd = 12;
    for (const q of this.sim.pickups) {
      if (q.dead || q.kind !== 'item' || q.delay > 0 || this.giveUp.has(`pickup:${q.id}`)) continue;
      const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (!best) return false;
    this.setGoal('loot', String(best.id));
    if (this.goalFrames > 60 * 6) this.giveUp.add(`pickup:${best.id}`);
    if (bd < 1.4 && this.cooldown.interact === 0) {
      input.interact = true;
      this.cooldown.interact = 10;
    } else this.moveToward(p, input, best, 0.6);
    return true;
  }

  /** Walks to untouched shrines and dark beacons (the levels' optional helpers). */
  private visitMechanic(p: Character, input: CharacterInput): boolean {
    let best: Prop | null = null, bd = 14;
    for (const q of this.sim.props.values()) {
      if (q.dead || this.giveUp.has(q.id)) continue;
      const want = (q.kind === 'shrine' && q.state !== 'used') || (q.kind === 'beacon' && q.state !== 'lit');
      if (!want) continue;
      const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
      if (d < bd && this.sim.nav.lineFree(p.pos, q)) {
        bd = d;
        best = q;
      }
    }
    if (!best) return false;
    this.setGoal('mechanic', best.id);
    if (this.goalFrames > 60 * 8) this.giveUp.add(best.id);
    if (bd < 1.8 && this.cooldown.interact === 0) {
      input.interact = true;
      this.cooldown.interact = 20;
    }
    this.moveToward(p, input, best, 0.3);
    return true;
  }

  private exitOrExplore(p: Character, input: CharacterInput): boolean {
    const sim = this.sim;
    const exit = sim.props.get('exit');
    if (exit && !exit.dead && this.opts.exit && (sim.stage.bossDead || this.opts.strategy === 'rush')) {
      this.setGoal('exit', '');
      const d = Math.hypot(exit.x - p.pos.x, exit.z - p.pos.z);
      if (d < 1.6 && this.cooldown.interact === 0) {
        input.interact = true;
        this.cooldown.interact = 20;
      }
      this.moveToward(p, input, exit, 0.2);
      return true;
    }
    const room = this.nextRoom(p);
    if (!room) return this.hunt(p, input);
    this.setGoal('explore', `room ${room.id}`);
    // Rooms that cannot be reached (or take forever) are skipped.
    if (this.goalFrames > 60 * 30 || this.stuck > 60 * 6) {
      this.visited.add(room.id);
      this.stuck = 0;
    }
    this.moveToward(p, input, { x: room.x + room.w / 2, z: room.z + room.h / 2 }, 1);
    return true;
  }

  /** Every room seen and monsters remain (a boss that wandered off): go find the nearest. */
  private hunt(p: Character, input: CharacterInput): boolean {
    let best: Character | null = null, bd = Infinity;
    for (const c of this.enemies(p)) {
      if (this.giveUp.has(c.id)) continue;
      const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) - (c.monster!.boss ? 1000 : 0);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) return false;
    this.setGoal('explore', `hunt ${best.name}`);
    if (this.goalFrames > 60 * 30) this.giveUp.add(best.id);
    this.moveToward(p, input, best.pos, 1.5);
    return true;
  }

  private nextRoom(p: Character) {
    const rooms = (this.sim.level.rooms ?? []).filter((r) => !this.visited.has(r.id) && r.kind !== 'corridor');
    if (!rooms.length) return null;
    const boss = rooms.find((r) => r.kind === 'boss');
    if (this.opts.strategy === 'rush' && boss) return boss;
    // Clear: nearest room first, the boss room last.
    const others = rooms.filter((r) => r.kind !== 'boss');
    const pool = others.length ? others : rooms;
    let best = pool[0], bd = Infinity;
    for (const r of pool) {
      const d = Math.hypot(r.x + r.w / 2 - p.pos.x, r.z + r.h / 2 - p.pos.z);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- movement

  /**
   * Steers around launch pads and rift gates that are not the destination (stepping on one would
   * fling the hero away from its goal). Stops avoiding when stuck, since a pad may fill a corridor.
   */
  private avoidTraps(p: Character, dir: P2, to: P2): P2 {
    if (this.stuck > 90) return dir;
    const ax = p.pos.x + dir.x * 1.1, az = p.pos.z + dir.z * 1.1;
    for (const q of this.sim.props.values()) {
      if (q.dead || !TRAPS.has(q.kind)) continue;
      if (Math.hypot(q.x - to.x, q.z - to.z) < 1.5) continue;
      const r = (q.kind === 'rift' ? 0.8 : 0.7) * q.scale + p.radius + 0.3;
      if (Math.hypot(q.x - ax, q.z - az) > r) continue;
      // Turn 70 degrees toward the side away from the trap's centre.
      const side = Math.sign((q.x - p.pos.x) * dir.z - (q.z - p.pos.z) * dir.x) || 1;
      const a = Math.atan2(dir.z, dir.x) + side * 1.2;
      return { x: Math.cos(a), z: Math.sin(a) };
    }
    return dir;
  }

  private moveToward(p: Character, input: CharacterInput, to: P2, stopAt: number) {
    const d = Math.hypot(to.x - p.pos.x, to.z - p.pos.z);
    if (d <= stopAt) return;
    const nav = this.sim.nav;
    let dir: P2 | null = null;
    if (nav.lineFree(p.pos, to)) {
      dir = { x: (to.x - p.pos.x) / d, z: (to.z - p.pos.z) / d };
      this.path = [];
    } else {
      this.pathAge++;
      if (!this.pathTo || Math.hypot(this.pathTo.x - to.x, this.pathTo.z - to.z) > 1.5 || this.pathAge > 45 || !this.path.length || this.stuck > 40) {
        this.path = nav.path(p.pos, to);
        this.pathTo = { x: to.x, z: to.z };
        this.pathAge = 0;
        if (this.stuck > 40) this.stuck = 0;
      }
      dir = this.sim.follow(p, this.path);
    }
    if (!dir) return;
    dir = this.avoidTraps(p, dir, to);
    // Boxed in by urns or crates: smash the one in the way (a player would).
    if (this.stuck > 30) {
      let block: Prop | null = null, bd = 2;
      for (const q of this.sim.props.values()) {
        if (q.dead || !propSpec(q.kind)?.hittable || !propSpec(q.kind)?.solid) continue;
        const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
        const ahead = (q.x - p.pos.x) * dir.x + (q.z - p.pos.z) * dir.z;
        if (d < bd && ahead > -0.2) {
          bd = d;
          block = q;
        }
      }
      if (block) {
        input.aim = { x: block.x, z: block.z };
        input.attackHeld = true;
        return;
      }
    }
    // Pinned (a crowd, a gravity well): roll out along the way forward.
    if (this.stuck > 40 && this.cooldown.dodge === 0 && !blockedReason(this.sim, p, 'dodge')) {
      input.moveX = dir.x;
      input.moveZ = dir.z;
      input.dodge = true;
      this.cooldown.dodge = 45;
      return;
    }
    // Wriggle free when pinned against something.
    if (this.stuck > 25) {
      const a = Math.atan2(dir.z, dir.x) + (this.rng.chance(0.5) ? 1 : -1) * 1.2;
      dir = { x: Math.cos(a), z: Math.sin(a) };
    }
    input.moveX = dir.x;
    input.moveZ = dir.z;
    input.gait = 'run';
  }
}

const TRAPS = new Set(['launchpad', 'rift']);

// ---------------------------------------------------------------- reports

export interface BotReport {
  frames: number;
  seconds: number;
  cleared: boolean;
  exited: boolean;
  bossDead: boolean;
  kills: number;
  elites: number;
  mechanicKills: number;
  deaths: number;
  heroLevel: { start: number; end: number };
  xp: number;
  gold: number;
  itemsDropped: number;
  itemsPicked: number;
  flasks: number;
  damageDealt: number;
  damageTaken: number;
  /** Lowest life fraction reached (1 = never hurt). */
  lowestLife: number;
  /** Seconds from the boss's first wound to its death (null if it never died). */
  bossSeconds: number | null;
  roomsVisited: number;
  rooms: number;
  /** Seconds spent per goal. */
  goals: Partial<Record<BotGoal, number>>;
  /** Notable moments: deaths, boss, level-ups, exit. */
  timeline: Array<{ t: number; event: string }>;
  mechanicEvents: Record<string, number>;
}

/**
 * Plays the current level with a bot until the hero leaves through the exit (or `maxFrames`).
 * `onFrame` runs after every step (return false to stop); `step` replaces `sim.step()` (the live
 * game steps through `Game.step` so portals and events are handled).
 */
export function runBot(sim: Sim, opts: BotOptions & { maxFrames?: number } = {}, onFrame?: (frame: number) => boolean | void, step: () => void = () => sim.step()): BotReport {
  const bot = new Bot(sim, opts);
  const maxFrames = opts.maxFrames ?? 60 * 240;
  const hero = sim.hero;
  const start = { level: hero?.level ?? 1, gold: hero?.gold ?? 0, xp: sim.stage.xp, kills: sim.stage.kills, elites: sim.stage.elites, mk: sim.stage.mechanicKills, deaths: sim.stage.deaths };
  const r: BotReport = {
    frames: 0, seconds: 0, cleared: false, exited: false, bossDead: false, kills: 0, elites: 0, mechanicKills: 0, deaths: 0,
    heroLevel: { start: start.level, end: start.level }, xp: 0, gold: 0, itemsDropped: 0, itemsPicked: 0, flasks: 0,
    damageDealt: 0, damageTaken: 0, lowestLife: 1, bossSeconds: null, roomsVisited: 0, rooms: (sim.level.rooms ?? []).filter((x) => x.kind !== 'corridor').length,
    goals: {}, timeline: [], mechanicEvents: {},
  };
  // Mechanics the hero used (ambient cycles such as spikes rising are left out).
  const used = new Set(['keg.lit', 'beacon.lit', 'launch', 'rift', 'shrine', 'totem.break', 'imp.escape', 'mechanic.kill']);
  let seq = sim.lastEventSeq;
  let bossFirstHit = -1;
  const t = () => Math.round((r.frames / 60) * 10) / 10;
  for (let f = 0; f < maxFrames; f++) {
    bot.think();
    r.goals[bot.goal] = (r.goals[bot.goal] ?? 0) + 1 / 60;
    step();
    r.frames++;
    const p = sim.player;
    if (p && p.state !== 'dead') r.lowestLife = Math.min(r.lowestLife, p.life / Math.max(1, p.maxLife));
    for (const e of sim.eventsSince(seq)) {
      switch (e.type) {
        case 'hit':
          if (bossFirstHit < 0 && sim.characters.get(String(e.target))?.monster?.boss) bossFirstHit = r.frames;
          if (e.target === sim.heroId) r.damageTaken += Number(e.damage ?? 0);
          else if (e.attacker === sim.heroId || sim.characters.get(String(e.attacker))?.owner === sim.heroId) r.damageDealt += Number(e.damage ?? 0);
          break;
        case 'drop':
          if (e.kind === 'item') r.itemsDropped++;
          break;
        case 'pickup':
          if (e.kind === 'item') r.itemsPicked++;
          break;
        case 'flask':
          r.flasks++;
          break;
        case 'hero.died':
          r.timeline.push({ t: t(), event: 'hero died' });
          break;
        case 'levelup':
          r.timeline.push({ t: t(), event: `level ${e.level}` });
          break;
        case 'boss.dead':
          r.timeline.push({ t: t(), event: `boss down: ${e.name}` });
          if (bossFirstHit >= 0) r.bossSeconds = Math.round(((r.frames - bossFirstHit) / 60) * 10) / 10;
          break;
        case 'portal.enter':
          r.timeline.push({ t: t(), event: `portal to ${e.to}` });
          if (e.to === 'next') r.exited = true;
          break;
        default:
          if (used.has(e.type)) r.mechanicEvents[e.type] = (r.mechanicEvents[e.type] ?? 0) + 1;
      }
    }
    seq = sim.lastEventSeq;
    if (onFrame?.(r.frames) === false) break;
    if (r.exited) break;
    if (!bot.opts.exit && sim.stage.bossDead) break;
  }
  r.seconds = Math.round((r.frames / 60) * 10) / 10;
  r.bossDead = sim.stage.bossDead;
  r.cleared = sim.stage.bossDead;
  r.kills = sim.stage.kills - start.kills;
  r.elites = sim.stage.elites - start.elites;
  r.mechanicKills = sim.stage.mechanicKills - start.mk;
  r.deaths = sim.stage.deaths - start.deaths;
  r.xp = Math.round(sim.stage.xp - start.xp);
  r.gold = (hero?.gold ?? 0) - start.gold;
  r.heroLevel.end = hero?.level ?? 1;
  r.damageDealt = Math.round(r.damageDealt);
  r.damageTaken = Math.round(r.damageTaken);
  r.lowestLife = Math.round(r.lowestLife * 100) / 100;
  r.roomsVisited = bot.roomsVisited();
  for (const k of Object.keys(r.goals) as BotGoal[]) r.goals[k] = Math.round(r.goals[k]! * 10) / 10;
  return r;
}
