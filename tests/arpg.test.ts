/** ARPG systems: stats, items, passive tree, dungeon generation, combat rewards, species, saves. */
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { resetConfig, setConfig } from '../src/config';
import { AFFIX_BY_ID } from '../src/content/affixes';
import { itemBase } from '../src/content/items';
import { gridAt } from '../src/content/level';
import { ensureMonster } from '../src/content/monsters';
import { generateGenome } from '../src/content/procgen/creature';
import { generateDungeon } from '../src/content/procgen/dungeon';
import { HOTBAR_SKILLS } from '../src/content/skills';
import { stageSpec } from '../src/content/stages';
import { mod } from '../src/content/stats';
import { townLevel } from '../src/content/town';
import { canRefund, pathTo, TREE } from '../src/content/tree';
import { normalizeHero } from '../src/save';
import { buildHero, gainXp, heroSkills, newHero, STARTING_SKILLS, treePoints } from '../src/sim/hero';
import { allocate, equip, sell } from '../src/sim/heroOps';
import { itemMods, rollItem } from '../src/sim/items';
import { Rng } from '../src/sim/rng';
import { armorReduction, power, xpToNext } from '../src/sim/scaling';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';
import { StatBlock } from '../src/sim/stats';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));

beforeAll(async () => {
  await initPhysics();
  resetConfig();
});

describe('stats', () => {
  it('sums flat, adds increased, multiplies more, and honours tag conditions', () => {
    const st = new StatBlock([
      mod('life', 'flat', 100), mod('life', 'inc', 50), mod('life', 'more', 20),
      mod('damage', 'inc', 30, ['fire']), mod('damage', 'inc', 10, ['spell']), mod('damage', 'more', 50, ['cond:lowLife']),
    ]);
    expect(st.get('life')).toBeCloseTo(100 * 1.5 * 1.2);
    expect(st.scale('damage', ['spell', 'fire', 'elemental'])).toBeCloseTo(1.4);
    expect(st.scale('damage', ['attack', 'physical'])).toBeCloseTo(1);
    expect(st.scale('damage', ['spell', 'fire', 'cond:lowLife'])).toBeCloseTo(1.4 * 1.5);
    // Resistances clamp at 75%.
    expect(new StatBlock([mod('resFire', 'flat', 120)]).get('resFire')).toBe(75);
  });

  it('the power curves never stop growing', () => {
    for (let l = 1; l < 400; l += 7) {
      expect(power(l + 7)).toBeGreaterThan(power(l));
      expect(xpToNext(l + 7)).toBeGreaterThan(xpToNext(l));
    }
    expect(armorReduction(500, 10)).toBeGreaterThan(armorReduction(500, 1000));
  });
});

describe('items', () => {
  it('rolls deterministically and respects affix limits and groups', () => {
    const a = rollItem(new Rng(42), { ilvl: 30, uid: 'x', rarity: 'rare' });
    const b = rollItem(new Rng(42), { ilvl: 30, uid: 'x', rarity: 'rare' });
    expect(a).toEqual(b);
    for (let seed = 1; seed < 300; seed++) {
      const it = rollItem(new Rng(seed), { ilvl: 1 + (seed % 80), uid: `u${seed}` });
      const defs = it.affixes.map((r) => AFFIX_BY_ID[r.id]);
      const limit = it.rarity === 'magic' ? 1 : 3;
      expect(defs.filter((d) => d.kind === 'prefix').length).toBeLessThanOrEqual(limit);
      expect(defs.filter((d) => d.kind === 'suffix').length).toBeLessThanOrEqual(limit);
      expect(new Set(defs.map((d) => d.group)).size).toBe(defs.length);
      for (const d of defs) expect(d.slots.includes(itemBase(it.base).slot) || itemBase(it.base).slot === 'jewel').toBe(true);
      for (const m of itemMods(it)) expect(Number.isFinite(m.value)).toBe(true);
      if (it.rarity === 'unique') expect(it.unique).toBeTruthy();
    }
  });

  it('item level drives power without a cap', () => {
    const low = rollItem(new Rng(7), { ilvl: 5, uid: 'a', base: 'rusted_sword', rarity: 'normal' });
    const high = rollItem(new Rng(7), { ilvl: 300, uid: 'b', base: 'rusted_sword', rarity: 'normal' });
    const dmg = (h: ReturnType<typeof newHero>) => buildHero(h).weapon.dmg.physical![1];
    const h1 = newHero(), h2 = newHero();
    h1.equipment.weapon = low;
    h2.equipment.weapon = high;
    expect(dmg(h2)).toBeGreaterThan(dmg(h1) * 50);
  });
});

describe('passive tree', () => {
  it('is large, connected, symmetric and unlocks every hotbar skill', () => {
    expect(TREE.nodes.length).toBeGreaterThan(450);
    expect(new Set(TREE.nodes.map((n) => n.id)).size).toBe(TREE.nodes.length);
    const seen = new Set([TREE.start]);
    const q = [TREE.start];
    for (let i = 0; i < q.length; i++) for (const l of TREE.byId.get(q[i])!.links) {
      expect(TREE.byId.get(l)!.links).toContain(q[i]);
      if (!seen.has(l)) {
        seen.add(l);
        q.push(l);
      }
    }
    expect(seen.size).toBe(TREE.nodes.length);
    const unlockable = new Set(TREE.nodes.filter((n) => n.skill).map((n) => n.skill));
    for (const s of HOTBAR_SKILLS) expect(unlockable.has(s) || STARTING_SKILLS.includes(s), s).toBe(true);
    expect(TREE.nodes.filter((n) => n.kind === 'keystone').length).toBeGreaterThanOrEqual(18);
  });

  it('allocates along the shortest path and refuses refunds that would disconnect', () => {
    const hero = newHero();
    gainXp(hero, 1e7);
    const skillNode = TREE.nodes.find((n) => n.skill === 'dashstrike')!;
    const path = pathTo(new Set(), skillNode.id);
    expect(path.length).toBeGreaterThan(1);
    expect(allocate(hero, skillNode.id)).toBeNull();
    expect(hero.tree).toEqual(path);
    expect(heroSkills(hero)).toContain('dashstrike');
    expect(canRefund(hero.tree, path[0])).toBe(false);
    expect(canRefund(hero.tree, skillNode.id)).toBe(true);
    const poor = newHero();
    expect(allocate(poor, skillNode.id)).toMatch(/points/);
    expect(treePoints(poor)).toBe(0);
  });
});

describe('dungeon generation', () => {
  it('is deterministic, connected, and places the hero, monsters and a boss on floor', () => {
    for (const stage of [1, 4, 9, 23]) {
      const spec = stageSpec(stage);
      const a = generateDungeon(spec), b = generateDungeon(stageSpec(stage));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const g = a.grid!;
      const tile = (x: number, z: number) => gridAt(g, Math.floor((x - g.originX) / g.cell), Math.floor((z - g.originZ) / g.cell));
      // Every floor tile reachable from the start.
      const start = a.characters.find((c) => c.id === 'player')!;
      expect(tile(start.x, start.z)).toBe('.');
      const sc = Math.floor((start.x - g.originX) / g.cell), sr = Math.floor((start.z - g.originZ) / g.cell);
      const seen = new Set([sr * g.cols + sc]);
      const q = [sr * g.cols + sc];
      for (let i = 0; i < q.length; i++) {
        const c = q[i] % g.cols, r = Math.floor(q[i] / g.cols);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (r + dr) * g.cols + c + dc;
          if (gridAt(g, c + dc, r + dr) === '.' && !seen.has(k)) {
            seen.add(k);
            q.push(k);
          }
        }
      }
      const floor = [...g.cells].filter((t) => t === '.').length;
      expect(seen.size).toBe(floor);
      const monsters = a.characters.filter((c) => c.monster);
      expect(monsters.length).toBeGreaterThan(5);
      expect(monsters.some((m) => m.monster!.rarity === 'unique')).toBe(true);
      for (const m of monsters) expect(tile(m.x, m.z)).toBe('.');
    }
  });

  it('the town has every core NPC', () => {
    const town = townLevel();
    for (const role of ['smith', 'merchant', 'sage', 'stash']) expect(town.characters.some((c) => c.npc?.role === role)).toBe(true);
    expect(town.props!.some((p) => p.kind === 'waypoint')).toBe(true);
  });
});

describe('combat and rewards', () => {
  const run = (frames: number) => {
    const level = generateDungeon(stageSpec(2));
    const hero = newHero();
    const sim = new Sim(level, clips, 5, { hero });
    const target = [...sim.characters.values()].find((c) => c.monster && !c.monster.boss)!;
    const near = sim.nav.nearestFree({ x: target.pos.x + 1.2, z: target.pos.z });
    sim.teleport('player', near.x, near.z);
    const p = sim.get('player');
    for (let i = 0; i < frames; i++) {
      const enemy = [...sim.characters.values()].filter((c) => c.monster && c.state !== 'dead')
        .sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z))[0];
      p.input.attackHeld = true;
      p.input.aim = enemy ? { x: enemy.pos.x, z: enemy.pos.z } : null;
      sim.step();
    }
    return { sim, hero };
  };

  it('kills monsters, grants experience and drops loot', () => {
    setConfig('tune.playerDamage', 4);
    setConfig('tune.playerLife', 10);
    const { sim, hero } = run(600);
    const types = new Set(sim.events.map((e) => e.type));
    expect(types).toContain('hit');
    expect(types).toContain('death');
    expect(hero.xp + (hero.level - 1) * 1000).toBeGreaterThan(0);
    expect(sim.stage.kills).toBeGreaterThan(0);
    expect(types).toContain('drop');
    sim.dispose();
    resetConfig();
  });

  it('replays a fight identically', () => {
    const a = run(300), b = run(300);
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.sim.events.length).toBe(b.sim.events.length);
    a.sim.dispose();
    b.sim.dispose();
  });
});

describe('procedural species', () => {
  it('genomes and species are deterministic and resolve to valid monsters', () => {
    expect(generateGenome('wolf', 5)).toEqual(generateGenome('wolf', 5));
    expect(generateGenome('wolf', 5)).not.toEqual(generateGenome('wolf', 6));
    const a = ensureMonster('sp:spider:1234');
    expect(ensureMonster('sp:spider:1234')).toBe(a);
    expect(a.body.kind).toBe('creature');
    expect(a.skills.length).toBeGreaterThan(0);
    const boss = ensureMonster('sp:drake:77:boss');
    expect(boss.boss).toBeTruthy();
    expect(boss.size).toBeGreaterThan(1.5);
  });
});

describe('saves and hero operations', () => {
  it('normalizes garbage into a playable hero and keeps good data', () => {
    const h = normalizeHero({ level: -4, gold: 'lots', tree: ['nope', 'start', TREE.nodes[1].id], inventory: [{ base: 'fake' }, { base: 'iron_ring', rarity: 'rare', affixes: [] }], hotbar: ['meteor', 'bogus'] });
    expect(h.level).toBe(1);
    expect(h.gold).toBe(0);
    expect(h.tree).toEqual(['start', TREE.nodes[1].id]);
    expect(h.inventory[0]).toBeNull();
    expect(h.inventory[1]?.base).toBe('iron_ring');
    expect(h.hotbar.slice(0, 2)).toEqual(['meteor', null]);
    const round = normalizeHero(JSON.parse(JSON.stringify(h)));
    expect(round).toEqual(h);
  });

  it('equips with swaps and sells for gold', () => {
    const hero = newHero();
    hero.inventory[0] = rollItem(new Rng(3), { ilvl: 10, uid: 'w', base: 'war_axe', rarity: 'magic' });
    const old = hero.equipment.weapon!;
    expect(equip(hero, { area: 'inventory', index: 0 })).toBeNull();
    expect(hero.equipment.weapon!.base).toBe('war_axe');
    expect(hero.inventory[0]).toBe(old);
    expect(sell(hero, { area: 'inventory', index: 0 })).toBeNull();
    expect(hero.gold).toBeGreaterThan(0);
    expect(hero.inventory[0]).toBeNull();
  });
});
