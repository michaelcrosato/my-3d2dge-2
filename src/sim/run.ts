/** Headless combat kernel. No DOM, clocks, unseeded RNG, or renderer dependencies. */
import RAPIER from "@dimforge/rapier3d-compat";
import {
  MONSTERS,
  SKILLS,
  THEMES,
  NPCS,
  generateEncounter,
  type Encounter,
  type RigKind,
  type Spawn,
  type SkillId,
  type CameraMode,
} from "../content/emberdeep";
import {
  freshProfile,
  statsOf,
  awardXP,
  rollItem,
  learn,
  chooseKeystone,
  equip,
  salvage,
  master,
  parseProfile,
  type Profile,
  type Item,
} from "./progression";
import { Sim, type SimCheckpoint, type Character } from "./sim";
import { Rng } from "./rng";
export interface Intent {
  x: number;
  z: number;
  aim?: { x: number; z: number };
  attack?: boolean;
  dash?: boolean;
  potion?: boolean;
  interact?: boolean;
  skill?: SkillId;
}
export interface Tuning {
  playerDamage: number;
  playerHealth: number;
  playerSpeed: number;
  enemyDamage: number;
  enemyHealth: number;
  enemySpeed: number;
  density: number;
}
export interface Actor {
  id: string;
  archetype: string;
  rig: RigKind;
  color: string;
  scale: number;
  elite: boolean;
  boss: string | null;
  npc?: string;
  cooldown: number;
  windup: number;
  attackX: number;
  attackZ: number;
  attacks: number;
  frozen: number;
  stun: number;
  deathAt: number;
  slash: number;
  combo: number;
  dash: number;
  dashX: number;
  dashZ: number;
  knockX: number;
  knockZ: number;
}
export interface Effect {
  id: number;
  kind: "slash" | "ring" | "hit" | "ghost" | "text" | "bolt";
  x: number;
  z: number;
  y: number;
  born: number;
  duration: number;
  color: string;
  radius: number;
  yaw: number;
  text?: string;
  actor?: string;
}
export interface Projectile {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  damage: number;
  color: string;
}
export interface Drop {
  id: string;
  x: number;
  z: number;
  gold: number;
  item: Item | null;
}
export interface RunEvent {
  seq: number;
  tick: number;
  type: string;
  [key: string]: unknown;
}
export interface RunCheckpoint {
  version: 1;
  seed: number;
  tick: number;
  profile: Profile;
  encounter: Encounter;
  actors: Actor[];
  rng: number;
  physics: SimCheckpoint;
  intent: Intent;
  tuning: Tuning;
  mana: number;
  stamina: number;
  cooldowns: Record<string, number>;
  effects: Effect[];
  projectiles: Projectile[];
  drops: Drop[];
  events: RunEvent[];
  seq: number;
  serial: number;
  combo: number;
  lastAttack: number;
  pending: { due: number; skill: SkillId; yaw: number; combo: number }[];
  buffs: Record<string, number>;
  failed: boolean;
  clear: boolean;
  auto: boolean;
  invulnerable: boolean;
  camera: CameraMode;
}
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const unit = (x: number, z: number) => {
  const d = Math.hypot(x, z) || 1;
  return { x: x / d, z: z / d };
};
const chest = (ch: Character) => ({
  x: ch.pos.x,
  y: ch.pos.y + 1,
  z: ch.pos.z,
});
export class Run {
  sim!: Sim;
  encounter!: Encounter;
  actors = new Map<string, Actor>();
  profile: Profile;
  rng: Rng;
  tick = 0;
  mana = 100;
  stamina = 100;
  intent: Intent = { x: 0, z: 0 };
  tuning: Tuning = {
    playerDamage: 1,
    playerHealth: 1,
    playerSpeed: 1,
    enemyDamage: 1,
    enemyHealth: 1,
    enemySpeed: 1,
    density: 1,
  };
  cooldowns: Record<string, number> = {};
  effects: Effect[] = [];
  projectiles: Projectile[] = [];
  drops: Drop[] = [];
  events: RunEvent[] = [];
  seq = 0;
  serial = 0;
  combo = 0;
  lastAttack = -100;
  pending: RunCheckpoint["pending"] = [];
  buffs: Record<string, number> = {};
  failed = false;
  clear = false;
  auto = false;
  invulnerable = false;
  camera: CameraMode = "iso";
  constructor(
    readonly seed = 1,
    profile = freshProfile(),
  ) {
    this.profile = parseProfile(profile);
    this.rng = new Rng(seed);
    this.enter(0);
  }
  get player() {
    return this.sim.get("player");
  }
  get stats() {
    const s = statsOf(this.profile);
    s.health *= this.tuning.playerHealth;
    s.damage *= this.tuning.playerDamage;
    s.speed *= this.tuning.playerSpeed;
    return s;
  }
  emit(type: string, data: Record<string, unknown> = {}) {
    this.events.push({ seq: ++this.seq, tick: this.tick, type, ...data });
    if (this.events.length > 512) this.events.shift();
  }
  fx(
    kind: Effect["kind"],
    x: number,
    z: number,
    color: string,
    radius = 1,
    duration = 18,
    extras: Partial<Effect> = {},
  ) {
    this.effects.push({
      id: ++this.serial,
      kind,
      x,
      z,
      y: 0.12,
      color,
      radius,
      duration,
      born: this.tick,
      yaw: 0,
      ...extras,
    });
    if (this.effects.length > 160) this.effects.shift();
  }
  private actor(
    id: string,
    archetype: string,
    rig: RigKind,
    color: string,
    scale = 1,
  ): Actor {
    return {
      id,
      archetype,
      rig,
      color,
      scale,
      elite: false,
      boss: null,
      cooldown: 30,
      windup: 0,
      attackX: 0,
      attackZ: 1,
      attacks: 0,
      frozen: 0,
      stun: 0,
      deathAt: -1,
      slash: 0,
      combo: 0,
      dash: 0,
      dashX: 0,
      dashZ: 1,
      knockX: 0,
      knockZ: 0,
    };
  }
  enter(depth: number) {
    const encounter = generateEncounter(depth, this.seed); // Validate before replacing the current world.
    this.sim?.dispose();
    this.encounter = encounter;
    this.camera = encounter.camera;
    this.sim = new Sim(encounter.level, {}, this.seed + depth);
    this.actors.clear();
    this.actors.set("player", this.actor("player", "", "ranger", "#90b97e"));
    for (const npc of NPCS)
      if (!depth) {
        const a = this.actor(
          npc.id,
          "",
          "ranger",
          npc.id === "smith"
            ? "#b58772"
            : npc.id === "mystic"
              ? "#a594c8"
              : "#d6b77b",
        );
        a.npc = npc.id;
        this.actors.set(a.id, a);
      }
    const enemies = encounter.enemies.slice(
      0,
      Math.min(64, Math.ceil(encounter.enemies.length * this.tuning.density)),
    );
    if (this.tuning.density > 1 && enemies.length)
      while (
        enemies.length <
        Math.min(64, Math.ceil(encounter.enemies.length * this.tuning.density))
      ) {
        const source =
          encounter.enemies[enemies.length % encounter.enemies.length];
        enemies.push({
          ...source,
          id: `extra_${enemies.length}`,
          boss: null,
          x: source.x + this.rng.range(-0.6, 0.6),
          z: source.z + this.rng.range(-0.6, 0.6),
        });
      }
    for (const e of enemies) this.spawnEnemy(e);
    const s = this.stats;
    this.player.hp = this.player.maxHp = s.health;
    this.mana = s.mana;
    this.stamina = 100;
    this.effects = [];
    this.projectiles = [];
    this.drops = [];
    this.pending = [];
    this.cooldowns = {};
    this.buffs = {};
    this.failed = false;
    this.clear = false;
    this.combo = 0;
    this.intent = { x: 0, z: 0 };
    if (depth) this.profile.deepest = Math.max(depth, this.profile.deepest);
    this.emit("level.enter", {
      depth,
      name: encounter.name,
      mechanics: encounter.mechanics,
    });
  }
  private spawnEnemy(e: Spawn) {
    if (this.actors.size >= 80) return;
    const def = MONSTERS[e.archetype],
      ch = this.sim.spawn({
        id: e.id,
        preset: "ember_monster",
        brain: "input",
        x: e.x,
        z: e.z,
      });
    const depthScale = 1 + this.encounter.depth * 0.12,
      hp =
        def.hp *
        depthScale *
        (e.boss ? 8 : e.elite ? 2 : 1) *
        this.tuning.enemyHealth *
        e.scale;
    ch.hp = ch.maxHp = hp;
    const a = this.actor(
      e.id,
      e.archetype,
      def.rig,
      e.elite ? "#eed59a" : THEMES[this.encounter.theme].enemy,
      e.scale * (e.elite && !e.boss ? 1.18 : 1),
    );
    a.elite = e.elite;
    a.boss = e.boss;
    a.cooldown = Math.floor(this.rng.range(20, 65));
    this.actors.set(a.id, a);
  }
  setIntent(input: Intent) {
    if (
      !input ||
      !Number.isFinite(input.x) ||
      !Number.isFinite(input.z) ||
      (input.aim &&
        (!Number.isFinite(input.aim.x) || !Number.isFinite(input.aim.z))) ||
      ["attack", "dash", "potion", "interact"].some(
        (k) => k in input && typeof input[k as keyof Intent] !== "boolean",
      ) ||
      (input.skill !== undefined && !(input.skill in SKILLS))
    )
      throw new Error("Input needs finite x and z values and valid triggers.");
    const len = Math.max(1, Math.hypot(input.x, input.z));
    this.intent = structuredClone({
      ...input,
      x: input.x / len,
      z: input.z / len,
    });
  }
  tune(values: Partial<Tuning>) {
    if (
      !values ||
      Object.entries(values).some(
        ([key, v]) =>
          !(key in this.tuning) ||
          typeof v !== "number" ||
          !Number.isFinite(v) ||
          v < 0.2 ||
          v > 4,
      )
    )
      throw new Error("Tuning values must be from 0.2 to 4.");
    const healthRatio = this.player.hp / this.player.maxHp,
      oldEnemy = this.tuning.enemyHealth;
    this.tuning = { ...this.tuning, ...values };
    this.syncStats();
    this.player.hp = this.player.maxHp * healthRatio;
    if (values.enemyHealth)
      for (const a of this.actors.values())
        if (a.archetype) {
          const ch = this.sim.get(a.id);
          ch.hp *= this.tuning.enemyHealth / oldEnemy;
          ch.maxHp *= this.tuning.enemyHealth / oldEnemy;
        }
    this.emit("tuning.change", values);
  }
  syncStats() {
    const s = this.stats;
    this.player.maxHp = s.health;
    this.player.hp = Math.min(this.player.hp, s.health);
    this.mana = Math.min(this.mana, s.mana);
  }
  learn(id: string) {
    learn(this.profile, id);
    this.syncStats();
    this.emit("skill.learn", { id });
  }
  keystone(id: string) {
    chooseKeystone(this.profile, id);
    this.syncStats();
  }
  master(skill: SkillId) {
    master(this.profile, skill);
  }
  equip(id: string) {
    equip(this.profile, id);
    this.syncStats();
    this.emit("loot.equip", { id });
  }
  salvage(id: string) {
    salvage(this.profile, id);
    this.syncStats();
  }
  slot(index: number, skill: SkillId) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > 3 ||
      !this.profile.unlocked.includes(skill)
    )
      throw new Error("Invalid slot or locked skill.");
    this.profile.slots[index] = skill;
  }
  refund() {
    if (this.encounter.depth) throw new Error("Refund skills in town.");
    this.profile.points +=
      Object.values(this.profile.ranks).reduce((a, b) => a + b, 0) +
      Object.values(this.profile.mastery).reduce((a, b) => a + b, 0);
    this.profile.ranks = {};
    this.profile.mastery = {};
    this.profile.unlocked = ["cleave", "whirlwind", "frost"];
    this.profile.keystone = null;
    this.profile.slots = ["whirlwind", "frost", "lunge", "storm"];
    this.syncStats();
  }
  service(id: string) {
    if (this.encounter.depth) throw new Error("Visit the town first.");
    if (id === "merchant") {
      if (this.profile.gold < 25) throw new Error("Need 25 gold.");
      this.profile.gold -= 25;
      this.profile.potions = 3;
    } else if (id === "smith") {
      const item = this.profile.inventory.find(
        (i) => i.id === this.profile.equipped.weapon,
      );
      if (!item || this.profile.gold < 60)
        throw new Error("Equip a weapon and bring 60 gold.");
      this.profile.gold -= 60;
      item.stats.damage = (item.stats.damage ?? 0) + 3;
      this.syncStats();
    } else if (id !== "mystic") throw new Error("Unknown service.");
    this.emit("town.service", { id });
  }
  interact() {
    if (this.failed) {
      this.enter(0);
      return;
    }
    if (!this.encounter.depth) {
      const npc = NPCS.find((n) => distance(n, this.player.pos) < 2.5);
      if (npc) this.emit("town.npc", { id: npc.id });
      else this.enter(this.profile.deepest);
    } else if (
      this.clear &&
      distance(this.encounter.exit, this.player.pos) < 2.7
    )
      this.enter(this.encounter.depth + 1);
  }
  useSkill(skill: SkillId): boolean {
    if (
      this.failed ||
      !this.encounter.depth ||
      !this.profile.unlocked.includes(skill) ||
      (this.cooldowns[skill] ?? 0) > 0
    )
      return false;
    const def = SKILLS[skill],
      s = this.stats,
      cost = def.cost * (this.profile.keystone === "overload" ? 1.35 : 1);
    if (this.mana < cost) return false;
    const player = this.player,
      a = this.actors.get("player")!;
    let aim = this.intent.aim;
    if (!aim) {
      const near = this.enemies().sort(
        (x, y) =>
          distance(this.sim.get(x.id).pos, player.pos) -
          distance(this.sim.get(y.id).pos, player.pos),
      )[0];
      if (near && distance(this.sim.get(near.id).pos, player.pos) < 9)
        aim = this.sim.get(near.id).pos;
    }
    if (aim)
      player.yaw = Math.atan2(aim.x - player.pos.x, aim.z - player.pos.z);
    this.mana -= cost;
    this.cooldowns[skill] = Math.max(
      3,
      Math.round(def.cooldown * 60 * s.cooldown),
    );
    if (skill === "cleave") {
      this.combo = this.tick - this.lastAttack < 55 ? (this.combo % 3) + 1 : 1;
      this.lastAttack = this.tick;
    } else this.combo = 1;
    a.slash = 18;
    a.combo = this.combo;
    this.pending.push({
      due: this.tick + (skill === "cleave" ? 5 : 3),
      skill,
      yaw: player.yaw,
      combo: this.combo,
    });
    this.fx(
      def.kind === "cone" ? "slash" : "ring",
      player.pos.x,
      player.pos.z,
      def.color,
      def.radius,
      def.kind === "cone" ? 9 : 24,
      { yaw: player.yaw, actor: "player" },
    );
    if (skill === "lunge") {
      const dir = unit(Math.sin(player.yaw), Math.cos(player.yaw));
      a.dash = 10;
      a.dashX = dir.x;
      a.dashZ = dir.z;
    }
    if (skill === "blades") this.buffs.barrier = this.tick + 180;
    this.emit("combat.skill", { skill, combo: this.combo });
    return true;
  }
  private enemies() {
    return [...this.actors.values()].filter(
      (a) => a.archetype && a.deathAt < 0,
    );
  }
  private impact(skill: SkillId, yaw: number, combo: number) {
    const p = this.player,
      s = this.stats,
      def = SKILLS[skill],
      range = def.radius,
      ids = new Set<number>();
    this.sim.world.intersectionsWithShape(
      chest(p),
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(range),
      (collider) => {
        ids.add(collider.handle);
        return true;
      },
    );
    let hits = 0;
    for (const a of this.enemies()) {
      const ch = this.sim.get(a.id),
        d = distance(ch.pos, p.pos),
        angle = Math.atan2(ch.pos.x - p.pos.x, ch.pos.z - p.pos.z),
        delta = Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw));
      if (
        !ids.has(ch.collider.handle) ||
        d > range + 0.25 ||
        (def.kind === "cone" && combo !== 3 && Math.abs(delta) > 1.65) ||
        !this.sim.lineOfSight(chest(p), chest(ch), p.collider)
      )
        continue;
      const crit = this.rng.next() < s.crit,
        damage =
          s.damage *
          def.damage *
          (1 + (this.profile.mastery[skill] ?? 0) * 0.08) *
          (combo === 3 && skill === "cleave" ? 1.7 : 1) *
          (crit ? 1.8 : 1) *
          (this.buffs.damage > this.tick ? 1.6 : 1) *
          (this.buffs.echo > this.tick ? 1.35 : 1) *
          (skill !== "cleave" && this.profile.keystone === "overload"
            ? 1.5
            : 1);
      this.hurtEnemy(a, damage, crit);
      hits++;
      if (skill === "frost" || this.power("frost"))
        a.frozen = this.tick + (skill === "frost" ? 100 : 24);
      const away = unit(ch.pos.x - p.pos.x, ch.pos.z - p.pos.z);
      a.knockX = away.x;
      a.knockZ = away.z;
      a.stun = 8;
      const leech =
        damage *
        (s.leech +
          (skill === "siphon" ? 0.18 : this.power("siphon") ? 0.025 : 0));
      p.hp = Math.min(p.maxHp, p.hp + leech);
      if (skill === "storm") {
        this.fx("bolt", ch.pos.x, ch.pos.z, def.color, d, 10, { yaw: angle });
        if (hits >= 6) break;
      }
      if (this.power("echo") && a.deathAt < 0)
        this.hurtEnemy(a, damage * 0.15, false);
    }
    for (const f of this.encounter.features)
      if (f.hp > 0 && distance(f, p.pos) < range + f.radius) {
        if (f.mechanic === "powder") {
          f.hp = 0;
          this.fx("ring", f.x, f.z, "#ffb463", 4, 24);
          for (const a of this.enemies())
            if (distance(f, this.sim.get(a.id).pos) < 4)
              this.hurtEnemy(a, 80 * this.tuning.playerDamage, false);
        }
        if (f.mechanic === "storm" && f.ready <= this.tick) {
          f.ready = this.tick + 180;
          this.fx("ring", f.x, f.z, "#fff3af", 5, 20);
          for (const a of this.enemies())
            if (distance(f, this.sim.get(a.id).pos) < 5) {
              this.hurtEnemy(a, 40 * this.tuning.playerDamage, false);
              this.fx(
                "bolt",
                this.sim.get(a.id).pos.x,
                this.sim.get(a.id).pos.z,
                "#ffee9f",
                2,
                10,
              );
            }
        }
        if (f.mechanic === "brood") f.hp -= s.damage * def.damage;
      }
  }
  private power(id: Item["power"]) {
    return Object.values(this.profile.equipped).some((itemId) =>
      this.profile.inventory.some(
        (item) => item.id === itemId && item.power === id,
      ),
    );
  }
  private hurtEnemy(a: Actor, damage: number, crit: boolean) {
    if (a.deathAt >= 0) return;
    const ch = this.sim.get(a.id);
    ch.hp -= damage;
    ch.flash = 6;
    this.fx("hit", ch.pos.x, ch.pos.z, "#fff1b6", 0.5, 10, { y: 1 });
    this.fx("text", ch.pos.x, ch.pos.z, crit ? "#ffdf88" : "#efe8d7", 1, 40, {
      text: `${Math.round(damage)}${crit ? "!" : ""}`,
      y: 1.8,
    });
    this.emit("combat.hit", { target: a.id, damage, crit });
    if (ch.hp <= 0) {
      ch.hp = 0;
      ch.state = "dead";
      ch.stateTime = 0;
      ch.collider.setEnabled(false);
      a.deathAt = this.tick;
      this.profile.kills++;
      const levels = awardXP(
        this.profile,
        (a.boss ? 180 : a.elite ? 45 : 18) *
          (1 + this.encounter.depth * 0.12) *
          this.stats.xp,
      );
      if (levels) {
        this.syncStats();
        this.player.hp = Math.min(
          this.player.maxHp,
          this.player.hp + this.player.maxHp * 0.35,
        );
        this.emit("progress.level", { level: this.profile.level, levels });
      }
      const gilded = this.buffs.gold > this.tick,
        gold = Math.floor(
          (a.boss ? 80 : a.elite ? 15 : 4) *
            (1 + this.encounter.depth * 0.08) *
            (gilded ? 1.8 : 1),
        );
      const item =
        a.boss || this.rng.next() < 0.33
          ? rollItem(
              this.profile,
              this.encounter.depth,
              this.rng,
              a.boss ? 0.18 : gilded ? 0.05 : 0,
            )
          : null;
      this.drops.push({
        id: `drop_${++this.serial}`,
        x: ch.pos.x,
        z: ch.pos.z,
        gold,
        item,
      });
      this.emit("combat.kill", { target: a.id, boss: a.boss });
      if (
        MONSTERS[a.archetype].behavior === "split" &&
        a.scale > 0.7 &&
        !a.boss
      )
        for (let i = 0; i < 2; i++)
          this.spawnEnemy({
            id: `split_${++this.serial}`,
            archetype: "slime",
            x: ch.pos.x + (i ? 0.5 : -0.5),
            z: ch.pos.z,
            elite: false,
            boss: null,
            scale: 0.55,
          });
    }
  }
  private hurtPlayer(damage: number) {
    const a = this.actors.get("player")!;
    if (this.failed || this.invulnerable || a.dash > 0) return;
    const actual =
      damage *
      (1 - this.stats.armor) *
      (this.buffs.barrier > this.tick ? 0.5 : 1);
    this.player.hp -= actual;
    this.player.flash = 7;
    this.fx("text", this.player.pos.x, this.player.pos.z, "#ff7c77", 1, 30, {
      text: `-${Math.round(actual)}`,
      y: 1.8,
    });
    this.emit("player.hurt", { damage: actual });
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.player.state = "dead";
      this.player.stateTime = 0;
      this.player.collider.setEnabled(false);
      a.deathAt = this.tick;
      this.failed = true;
      this.profile.deaths++;
      this.emit("run.failed", { depth: this.encounter.depth });
    }
  }
  private dash() {
    const a = this.actors.get("player")!,
      cost = this.profile.keystone === "iron" ? 40 : 30;
    if (this.failed || this.stamina < cost || (this.cooldowns.dash ?? 0) > 0)
      return;
    let dir = unit(this.intent.x, this.intent.z);
    if (!Math.hypot(dir.x, dir.z))
      dir = { x: Math.sin(this.player.yaw), z: Math.cos(this.player.yaw) };
    a.dash = 16;
    a.dashX = dir.x;
    a.dashZ = dir.z;
    this.stamina -= cost;
    this.cooldowns.dash = 25;
    if (
      this.enemies().some(
        (e) =>
          e.windup > 0 &&
          e.windup < 12 &&
          distance(this.sim.get(e.id).pos, this.player.pos) < 4,
      )
    ) {
      this.buffs.damage = this.tick + 120;
      this.emit("combat.perfect_dodge");
    }
    this.emit("combat.dash");
  }
  private enemyAI(a: Actor) {
    const ch = this.sim.get(a.id),
      p = this.player,
      def = MONSTERS[a.archetype];
    if (a.deathAt >= 0 || this.failed) {
      this.sim.setInput(a.id, {});
      return;
    }
    if (a.frozen > this.tick) {
      this.sim.setInput(a.id, {});
      return;
    }
    if (a.stun > 0) {
      a.stun--;
      ch.speedMultiplier = def.speed * 2;
      this.sim.setInput(a.id, { moveX: a.knockX, moveZ: a.knockZ });
      return;
    }
    const d = distance(ch.pos, p.pos),
      dir = unit(p.pos.x - ch.pos.x, p.pos.z - ch.pos.z),
      phase = a.boss && ch.hp < ch.maxHp * 0.5 ? 0.72 : 1;
    ch.speedMultiplier =
      def.speed * this.tuning.enemySpeed * (a.boss ? 1.15 : 1);
    if (a.cooldown > 0) a.cooldown--;
    if (a.windup > 0) {
      a.windup--;
      ch.yaw = Math.atan2(a.attackX, a.attackZ);
      this.sim.setInput(a.id, {});
      if (def.behavior === "charge" && a.windup < 12) {
        ch.speedMultiplier *= 3.4;
        this.sim.setInput(a.id, { moveX: a.attackX, moveZ: a.attackZ });
      }
      if (!a.windup) {
        a.attacks++;
        const damage =
          def.damage *
          (1 + this.encounter.depth * 0.07) *
          this.tuning.enemyDamage *
          (a.elite ? 1.4 : 1);
        if (a.boss && a.attacks % 3 === 0) {
          for (
            let i = 0;
            i < Math.min(20, 8 + Math.floor(this.encounter.depth / 8));
            i++
          ) {
            const theta =
              (i / Math.min(20, 8 + Math.floor(this.encounter.depth / 8))) *
              Math.PI *
              2;
            this.projectiles.push({
              id: ++this.serial,
              x: ch.pos.x,
              z: ch.pos.z,
              vx: Math.sin(theta) * 0.12,
              vz: Math.cos(theta) * 0.12,
              life: 150,
              damage,
              color: "#f2a17c",
            });
          }
        } else if (a.boss && a.attacks % 5 === 0)
          for (let i = 0; i < 3; i++)
            this.spawnEnemy({
              id: `summon_${++this.serial}`,
              archetype: "husk",
              x: ch.pos.x + Math.cos(i * 2.1) * 2,
              z: ch.pos.z + Math.sin(i * 2.1) * 2,
              elite: false,
              boss: null,
              scale: 0.8,
            });
        else if (def.behavior === "ranged")
          this.projectiles.push({
            id: ++this.serial,
            x: ch.pos.x,
            z: ch.pos.z,
            vx: a.attackX * 0.14,
            vz: a.attackZ * 0.14,
            life: 150,
            damage,
            color: "#d9b1ff",
          });
        else {
          const r = a.boss ? 3.8 : def.range + 0.5;
          this.fx("ring", ch.pos.x, ch.pos.z, "#ff8f74", r, 14);
          if (
            distance(ch.pos, p.pos) < r &&
            this.sim.lineOfSight(chest(ch), chest(p), ch.collider)
          )
            this.hurtPlayer(damage);
        }
        a.cooldown = Math.floor(def.cooldown * 60 * phase);
      }
      return;
    }
    if (
      d < def.range &&
      a.cooldown <= 0 &&
      this.sim.lineOfSight(chest(ch), chest(p), ch.collider)
    ) {
      a.windup = Math.ceil(def.windup * 60);
      a.attackX = dir.x;
      a.attackZ = dir.z;
      this.emit("enemy.windup", { id: a.id, duration: a.windup });
      this.sim.setInput(a.id, {});
      return;
    }
    let move = dir;
    if (!this.sim.lineOfSight(chest(ch), chest(p), ch.collider)) {
      if (!ch.ai.path.length || this.tick % 30 === 0)
        ch.ai.path = this.sim.nav.path(ch.pos, p.pos);
      while (ch.ai.path.length && distance(ch.pos, ch.ai.path[0]) < 0.5)
        ch.ai.path.shift();
      if (ch.ai.path[0])
        move = unit(ch.ai.path[0].x - ch.pos.x, ch.ai.path[0].z - ch.pos.z);
    } else if (def.behavior === "orbit" && d < 4)
      move = unit(dir.x + dir.z * 0.9, dir.z - dir.x * 0.9);
    else if (def.behavior === "ranged" && d < 5)
      move = { x: -dir.x, z: -dir.z };
    else if (d < def.range * 0.8) move = { x: 0, z: 0 };
    for (const f of this.encounter.features)
      if (f.mechanic === "gravity" && distance(f, ch.pos) < 4) {
        move = unit(
          move.x * 0.4 + (f.x - ch.pos.x) * 0.3,
          move.z * 0.4 + (f.z - ch.pos.z) * 0.3,
        );
      }
    this.sim.setInput(a.id, { moveX: move.x, moveZ: move.z });
  }
  private features() {
    for (const f of this.encounter.features) {
      if (f.hp <= 0) continue;
      const near = distance(f, this.player.pos) < f.radius + 0.6;
      if (near) {
        switch (f.mechanic) {
          case "gale":
          case "spring":
            this.buffs.speed = this.tick + 100;
            this.stamina = Math.min(100, this.stamina + 1);
            break;
          case "ember":
            this.buffs.damage = this.tick + 120;
            if (this.tick % 45 === 0)
              this.hurtPlayer(5 * this.tuning.enemyDamage);
            break;
          case "well":
            this.mana = Math.min(this.stats.mana, this.mana + 0.5);
            for (const k of Object.keys(this.cooldowns))
              this.cooldowns[k] = Math.max(0, this.cooldowns[k] - 1);
            break;
          case "blood":
            if (f.ready <= this.tick && this.player.hp > 30) {
              this.player.hp -= 12;
              this.buffs.damage = this.tick + 300;
              f.ready = this.tick + 360;
              this.fx("ring", f.x, f.z, "#e46986", 2, 30);
            }
            break;
          case "echo":
            this.buffs.echo = this.tick + 90;
            break;
          case "gold":
            this.buffs.gold = this.tick + 120;
            break;
        }
      }
      for (const a of this.enemies())
        if (distance(f, this.sim.get(a.id).pos) < f.radius + 0.2) {
          if (f.mechanic === "frost") a.frozen = this.tick + 20;
          if (f.mechanic === "ember" && this.tick % 45 === 0)
            this.hurtEnemy(a, 10, false);
          if (f.mechanic === "well" && this.tick % 2 === 0) a.cooldown++;
        }
      if (f.mechanic === "brood" && !this.clear && this.tick % 480 === 0)
        this.spawnEnemy({
          id: `nest_${++this.serial}`,
          archetype: "crawler",
          x: f.x,
          z: f.z,
          elite: false,
          boss: null,
          scale: 0.8,
        });
    }
  }
  private bot(): Intent {
    if (this.failed) return { x: 0, z: 0, interact: true };
    const p = this.player;
    let target: { x: number; z: number } | undefined;
    const enemy = this.enemies().sort(
      (a, b) =>
        distance(p.pos, this.sim.get(a.id).pos) -
        distance(p.pos, this.sim.get(b.id).pos),
    )[0];
    if (enemy) target = this.sim.get(enemy.id).pos;
    else target = this.drops[0] ?? this.encounter.exit;
    if (!this.encounter.depth) return { x: 0, z: 0, interact: true };
    const path = this.sim.nav.path(p.pos, target),
      direction = unit(
        (path[0] ?? target).x - p.pos.x,
        (path[0] ?? target).z - p.pos.z,
      ),
      d = distance(p.pos, target);
    const skill = this.profile.unlocked.find(
      (k) =>
        k !== "cleave" &&
        this.mana >= SKILLS[k].cost &&
        (this.cooldowns[k] ?? 0) <= 0 &&
        d < SKILLS[k].radius,
    );
    return {
      ...direction,
      aim: target,
      x: enemy && d < 1.6 ? 0 : direction.x,
      z: enemy && d < 1.6 ? 0 : direction.z,
      attack: !!enemy && d < 2.6,
      skill,
      dash: this.enemies().some(
        (e) =>
          e.windup > 0 &&
          e.windup < 10 &&
          distance(p.pos, this.sim.get(e.id).pos) < 3,
      ),
      potion: p.hp < p.maxHp * 0.45,
      interact: this.clear && d < 2.5 && !this.drops.length,
    };
  }
  step(frames = 1) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 100000)
      throw new Error("Step accepts 0 to 100000 frames.");
    for (let i = 0; i < frames; i++) this.frame();
    return this.observe();
  }
  private frame() {
    this.tick++;
    if (this.auto) this.intent = this.bot();
    for (const k of Object.keys(this.cooldowns))
      this.cooldowns[k] = Math.max(0, this.cooldowns[k] - 1);
    this.effects = this.effects.filter((e) => this.tick - e.born < e.duration);
    this.mana = Math.min(this.stats.mana, this.mana + 0.14);
    this.stamina = Math.min(100, this.stamina + 0.5);
    const intent = this.intent,
      actor = this.actors.get("player")!,
      p = this.player;
    if (!this.failed) {
      if (intent.dash) this.dash();
      if (intent.potion && this.profile.potions > 0 && p.hp < p.maxHp) {
        this.profile.potions--;
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.55);
        this.emit("player.potion");
      }
      if (intent.attack) this.useSkill("cleave");
      if (intent.skill) this.useSkill(intent.skill);
    }
    intent.dash = intent.potion = false;
    delete intent.skill;
    if (intent.interact) {
      intent.interact = false;
      this.interact();
      return;
    }
    if (actor.slash > 0) actor.slash--;
    p.speedMultiplier =
      this.stats.speed * (this.buffs.speed > this.tick ? 1.4 : 1);
    if (actor.dash > 0) {
      actor.dash--;
      p.speedMultiplier *= 3.4;
      p.vel.x = actor.dashX * 14 * this.stats.speed;
      p.vel.z = actor.dashZ * 14 * this.stats.speed;
      this.sim.setInput("player", { moveX: actor.dashX, moveZ: actor.dashZ });
      if (actor.dash % 3 === 0)
        this.fx("ghost", p.pos.x, p.pos.z, "#b4dfc4", 1, 18, {
          actor: "player",
          yaw: p.yaw,
        });
    } else
      this.sim.setInput("player", {
        moveX: this.failed ? 0 : intent.x,
        moveZ: this.failed ? 0 : intent.z,
      });
    for (const a of [...this.actors.values()])
      if (a.archetype) {
        if (a.deathAt >= 0 && this.tick - a.deathAt > 100) {
          this.sim.despawn(a.id);
          this.actors.delete(a.id);
        } else this.enemyAI(a);
      }
    this.sim.step();
    if (!this.failed) {
      const due = this.pending.filter((v) => v.due <= this.tick);
      this.pending = this.pending.filter((v) => v.due > this.tick);
      for (const v of due) this.impact(v.skill, v.yaw, v.combo);
      this.features();
    }
    for (const b of this.projectiles) {
      const from = { x: b.x, y: 1, z: b.z };
      b.x += b.vx;
      b.z += b.vz;
      b.life--;
      if (!this.sim.lineOfSight(from, { x: b.x, y: 1, z: b.z })) b.life = 0;
      if (distance(b, p.pos) < 0.65) {
        this.hurtPlayer(b.damage);
        b.life = 0;
      }
    }
    this.projectiles = this.projectiles.filter((b) => b.life > 0).slice(-160);
    if (!this.failed)
      for (const d of [...this.drops])
        if (distance(d, p.pos) < 2.3) {
          this.profile.gold += d.gold;
          if (d.item) {
            if (this.profile.inventory.length < 80)
              this.profile.inventory.push(d.item);
            else this.profile.gold += 15;
            this.emit("loot.pickup", { item: d.item, gold: d.gold });
          }
          this.drops = this.drops.filter((v) => v.id !== d.id);
        }
    if (!this.clear && this.encounter.depth && !this.enemies().length) {
      this.clear = true;
      this.emit("level.clear", { depth: this.encounter.depth });
      this.fx(
        "ring",
        this.encounter.exit.x,
        this.encounter.exit.z,
        "#bef8c8",
        2,
        60,
      );
    }
  }
  observe() {
    const s = this.stats;
    return {
      version: 1,
      seed: this.seed,
      tick: this.tick,
      hash: this.hash(),
      depth: this.encounter.depth,
      name: this.encounter.name,
      camera: this.camera,
      mechanics: this.encounter.mechanics,
      clear: this.clear,
      failed: this.failed,
      auto: this.auto,
      invulnerable: this.invulnerable,
      player: {
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        pos: { ...this.player.pos },
        yaw: this.player.yaw,
        mana: this.mana,
        maxMana: s.mana,
        stamina: this.stamina,
        cooldowns: { ...this.cooldowns },
        stats: s,
      },
      profile: structuredClone(this.profile),
      enemies: this.enemies().map((a) => {
        const ch = this.sim.get(a.id);
        return {
          id: a.id,
          archetype: a.archetype,
          boss: a.boss,
          elite: a.elite,
          hp: ch.hp,
          maxHp: ch.maxHp,
          pos: { ...ch.pos },
          windup: a.windup,
          frozen: a.frozen > this.tick,
        };
      }),
      drops: structuredClone(this.drops),
      features: structuredClone(this.encounter.features),
      exit: { ...this.encounter.exit },
      tuning: { ...this.tuning },
      eventSeq: this.seq,
    };
  }
  checkpoint(): RunCheckpoint {
    return {
      version: 1,
      seed: this.seed,
      tick: this.tick,
      profile: structuredClone(this.profile),
      encounter: structuredClone(this.encounter),
      actors: structuredClone([...this.actors.values()]),
      rng: this.rng.state,
      physics: this.sim.save(),
      intent: structuredClone(this.intent),
      tuning: { ...this.tuning },
      mana: this.mana,
      stamina: this.stamina,
      cooldowns: { ...this.cooldowns },
      effects: structuredClone(this.effects),
      projectiles: structuredClone(this.projectiles),
      drops: structuredClone(this.drops),
      events: structuredClone(this.events),
      seq: this.seq,
      serial: this.serial,
      combo: this.combo,
      lastAttack: this.lastAttack,
      pending: structuredClone(this.pending),
      buffs: { ...this.buffs },
      failed: this.failed,
      clear: this.clear,
      auto: this.auto,
      invulnerable: this.invulnerable,
      camera: this.camera,
    };
  }
  restore(cp: RunCheckpoint) {
    if (!cp || cp.version !== 1 || cp.seed !== this.seed)
      throw new Error("Incompatible checkpoint.");
    const profile = parseProfile(cp.profile);
    generateEncounter(cp.encounter.depth, this.seed);
    this.sim.dispose();
    this.sim = new Sim(cp.encounter.level, {}, this.seed + cp.encounter.depth);
    this.sim.restore(cp.physics);
    this.tick = cp.tick;
    this.profile = profile;
    this.encounter = structuredClone(cp.encounter);
    this.actors = new Map(structuredClone(cp.actors).map((a) => [a.id, a]));
    this.rng.state = cp.rng;
    for (const k of [
      "intent",
      "tuning",
      "mana",
      "stamina",
      "cooldowns",
      "effects",
      "projectiles",
      "drops",
      "events",
      "seq",
      "serial",
      "combo",
      "lastAttack",
      "pending",
      "buffs",
      "failed",
      "clear",
      "auto",
      "invulnerable",
      "camera",
    ] as const)
      (this as unknown as Record<string, unknown>)[k] = structuredClone(cp[k]);
  }
  hash() {
    let h = 2166136261;
    const data = JSON.stringify({
      tick: this.tick,
      rng: this.rng.state,
      profile: this.profile,
      actors: [...this.actors.values()],
      features: this.encounter.features,
      depth: this.encounter.depth,
      sim: this.sim.hash(),
      intent: this.intent,
      tuning: this.tuning,
      mana: this.mana,
      stamina: this.stamina,
      cooldowns: this.cooldowns,
      pending: this.pending,
      buffs: this.buffs,
      projectiles: this.projectiles,
      drops: this.drops,
      effects: this.effects,
      seq: this.seq,
      serial: this.serial,
      combo: this.combo,
      lastAttack: this.lastAttack,
      clear: this.clear,
      failed: this.failed,
      auto: this.auto,
      invulnerable: this.invulnerable,
      camera: this.camera,
    });
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  dispose() {
    this.sim.dispose();
  }
}
