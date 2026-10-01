import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../src/sim/sim";
import { Run } from "../src/sim/run";
import { generateEncounter, TREE } from "../src/content/emberdeep";
import {
  freshProfile,
  learn,
  statsOf,
  awardXP,
  parseProfile,
  equip,
  rollItem,
} from "../src/sim/progression";
import { Rng } from "../src/sim/rng";
beforeAll(async () => {
  await initPhysics();
});
describe("Emberdeep agent kernel", () => {
  it("introduces twelve mechanics then combines bounded seeded encounters", () => {
    expect(
      new Set(
        Array.from(
          { length: 12 },
          (_, i) => generateEncounter(i + 1, 32).mechanics[0],
        ),
      ).size,
    ).toBe(12);
    for (const depth of [13, 33, 102, 1000, 1000000]) {
      const e = generateEncounter(depth, 32);
      expect(e).toEqual(generateEncounter(depth, 32));
      expect(e.mechanics.length).toBeGreaterThan(1);
      expect(e.enemies.length).toBeLessThanOrEqual(37);
    }
  });
  it("enforces skill prerequisites and round trips progression and gear", () => {
    const p = freshProfile();
    expect(TREE.length).toBe(54);
    expect(() => learn(p, "blade_1_0")).toThrow();
    learn(p, "blade_0_0");
    learn(p, "blade_1_0");
    expect(p.unlocked).toContain("lunge");
    const old = statsOf(p).damage;
    const item = rollItem(p, 4, new Rng(3));
    item.slot = "weapon";
    item.stats = { damage: 12 };
    p.inventory.push(item);
    equip(p, item.id);
    expect(statsOf(p).damage).toBeGreaterThan(old);
    awardXP(p, 500);
    expect(p.level).toBeGreaterThan(1);
    expect(parseProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parseProfile({ ...p, gold: NaN })).toThrow();
  });
  it("restores physics and combat exactly through a mid-combat checkpoint", () => {
    const r = new Run(32);
    try {
      r.enter(4);
      r.auto = true;
      r.step(80);
      const cp = r.checkpoint();
      r.step(180);
      const hash = r.hash();
      r.restore(cp);
      r.step(180);
      expect(r.hash()).toBe(hash);
    } finally {
      r.dispose();
    }
  });
  it("applies enemy damage and spends stamina on a roll", () => {
    const r = new Run(5);
    try {
      r.enter(1);
      const target = r.encounter.enemies[0];
      r.sim.teleport(target.id, 0.8, 6.5);
      const hp = r.player.hp;
      r.step(100);
      expect(r.player.hp).toBeLessThan(hp);
      r.setIntent({ x: 1, z: 0, dash: true });
      r.step(1);
      expect(r.stamina).toBeLessThan(100);
    } finally {
      r.dispose();
    }
  });
  it("does not respawn slain monsters and rewards combat with XP, gold and loot", () => {
    const r = new Run(32);
    try {
      r.enter(1);
      r.tune({ playerDamage: 4, enemyHealth: 0.2, enemyDamage: 0.2 });
      r.auto = true;
      r.step(1800);
      expect(r.profile.kills).toBeGreaterThan(5);
      expect(r.profile.level).toBeGreaterThan(1);
      expect(r.profile.gold).toBeGreaterThan(0);
      expect(r.profile.inventory.length).toBeGreaterThan(0);
      expect(r.encounter.depth).toBeGreaterThan(1);
    } finally {
      r.dispose();
    }
  });
  it("rejects bad commands without partial tuning mutations", () => {
    const r = new Run();
    try {
      const before = { ...r.tuning };
      expect(() => r.tune({ playerDamage: 2, enemyHealth: NaN })).toThrow();
      expect(r.tuning).toEqual(before);
      expect(() => r.setIntent({ x: NaN, z: 0 })).toThrow();
      expect(() => r.enter(-1)).toThrow();
    } finally {
      r.dispose();
    }
  });
});
