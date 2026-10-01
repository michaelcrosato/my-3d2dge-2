/** Agent tools: the registry contract, every content tool, genome edits, custom species and the bot. */
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import '../src/agent/tools/content';
import { allTools, callTool, schemaOf, validateArgs, tool } from '../src/agent/registry';
import type { Img } from '../src/agent/capture';
import { resetConfig, config } from '../src/config';
import { campaignStage } from '../src/content/campaign';
import { registerMonster } from '../src/content/monsters';
import { generateDungeon } from '../src/content/procgen/dungeon';
import { generateGenome } from '../src/content/procgen/creature';
import { autoHero } from '../src/sim/autobuild';
import { runBot } from '../src/sim/bot';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));
const env = { game: null, clips };
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await callTool(name, args, env);
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r;
};

beforeAll(async () => {
  await initPhysics();
  resetConfig();
});

describe('tool registry', () => {
  it('every tool is documented with a valid schema', () => {
    expect(allTools().length).toBeGreaterThan(15);
    for (const t of allTools()) {
      expect(t.desc.length, t.name).toBeGreaterThan(20);
      expect(t.name).toMatch(/^[a-z]+(\.[a-z]+)?$/i);
      const s = schemaOf(t);
      expect(s.type).toBe('object');
      for (const [k, p] of Object.entries(t.params)) expect(p.desc.length, `${t.name}.${k}`).toBeGreaterThan(2);
      if (t.example) expect(() => validateArgs(t, t.example)).not.toThrow();
    }
  });

  it('validates arguments with helpful errors and fills defaults', async () => {
    const t = tool('item.roll')!;
    expect(validateArgs(t, {}).ilvl).toBe(10);
    expect(validateArgs(t, { ilvl: '25' }).ilvl).toBe(25);
    expect(() => validateArgs(t, { level: 3 })).toThrow(/unknown parameter "level".*ilvl/);
    expect(() => validateArgs(t, { rarity: 'epic' })).toThrow(/one of normal, magic, rare, unique/);
    expect(() => validateArgs(t, { ilvl: 0 })).toThrow(/within/);
    const bad = await callTool('nope.tool', {}, env);
    expect(bad.ok).toBe(false);
    const needsGame = await callTool('scene.capture', {}, env);
    expect(needsGame.ok).toBe(false);
  });

  it('runs every content tool on its example (or defaults)', async () => {
    for (const t of allTools()) {
      if (t.needs === 'game' || ['balance.run', 'species.create'].includes(t.name)) continue;
      const required = Object.entries(t.params).filter(([, p]) => p.required);
      if (!t.example && required.length) continue;
      const r = await callTool(t.name, t.example ?? {}, env);
      expect(r.ok, `${t.name}: ${r.ok ? '' : r.error}`).toBe(true);
    }
  });
});

describe('content tools', () => {
  it('level.generate returns a summary and a map of the right size', async () => {
    const r = await call('level.generate', { stage: 3, px: 3 });
    const d = r.data as { size: [number, number]; monsters: { total: number }; boss: unknown; criticalPathMeters: number };
    expect(d.monsters.total).toBeGreaterThan(5);
    expect(d.boss).not.toBeNull();
    expect(d.criticalPathMeters).toBeGreaterThan(10);
    const img = r.images[0].img as Img;
    expect([img.width, img.height]).toEqual([d.size[0] * 3, d.size[1] * 3]);
  });

  it('remixes a depth with any mechanics', async () => {
    const d = (await call('level.generate', { stage: 9, mechanics: ['kegs', 'ice'], map: false })).data as { mechanics: string[]; props: Record<string, number> };
    expect(d.mechanics).toEqual(['kegs', 'ice']);
    expect(d.props.keg).toBeGreaterThan(0);
    expect(d.props.ice).toBeGreaterThan(0);
  });

  it('loot.simulate is deterministic and responds to item rarity', async () => {
    const a = (await call('loot.simulate', { kills: 3000, monsterLevel: 20, seed: 4 })).data as { items: number; byRarity: Record<string, number> };
    const b = (await call('loot.simulate', { kills: 3000, monsterLevel: 20, seed: 4 })).data as { items: number };
    expect(a.items).toBe(b.items);
    const rich = (await call('loot.simulate', { kills: 3000, monsterLevel: 20, seed: 4, itemRarity: 300 })).data as { byRarity: Record<string, number> };
    expect(rich.byRarity.rare + rich.byRarity.unique).toBeGreaterThan(a.byRarity.rare + a.byRarity.unique);
  });

  it('hero.build makes stronger heroes at higher levels', async () => {
    const lo = (await call('hero.build', { level: 5 })).data as { life: number; skills: Array<{ perSecond: number }> };
    const hi = (await call('hero.build', { level: 40 })).data as { life: number; skills: Array<{ perSecond: number }>; passivePoints: { allocated: number } };
    expect(hi.life).toBeGreaterThan(lo.life * 3);
    expect(hi.skills[0].perSecond).toBeGreaterThan(lo.skills[0].perSecond * 3);
    expect(hi.passivePoints.allocated).toBe(39);
  });

  it('difficulty presets change tune values and restore cleanly', async () => {
    await call('difficulty.set', { preset: 'Nightmare' });
    expect(config['tune.enemyDamage']).toBe(2.2);
    await call('difficulty.set', { preset: 'Normal' });
    expect(config['tune.enemyDamage']).toBe(1);
  });
});

describe('custom species and genome edits', () => {
  it('genome edits merge, clamp and reject unknown fields', () => {
    const g = generateGenome('wolf', 3, { legs: { pairs: 99 }, horns: { count: 2 }, wings: { span: 2 } });
    expect(g.legs.pairs).toBe(8);
    expect(g.horns.count).toBe(2);
    expect(g.wings?.span).toBe(2);
    expect(generateGenome('drake', 3, { wings: null }).wings).toBeNull();
    expect(() => generateGenome('wolf', 3, { tusks: 2 } as never)).toThrow(/unknown genome field/);
    expect(generateGenome('wolf', 3).legs.pairs).toBe(2);
  });

  it('species.create registers a monster that inspects, and bad parts are refused', async () => {
    const made = (await call('species.create', { id: 'testbeast', body: 'boar', seed: 5, genome: { spikes: { count: 9 } }, archetype: 'charger', skills: ['m_charge', 'm_bite'], palette: 'venom' })).data as { id: string };
    expect(made.id).toBe('custom:testbeast');
    const sheet = (await call('monster.inspect', { id: made.id, level: 12, rarity: 'rare' })).data as { life: number; skills: Array<{ id: string; hit: number }>; resist: { chaos: number } };
    expect(sheet.life).toBeGreaterThan(0);
    expect(sheet.resist.chaos).toBe(60);
    // The telegraphed charge reports the damage of its real hit, not the zero-damage telegraph.
    expect(sheet.skills.find((s) => s.id === 'm_charge')!.hit).toBeGreaterThan(0);
    expect(() => registerMonster({ id: 'x', name: 'X', family: 'f', body: { kind: 'creature', plan: 'wolf' }, archetype: 'dancer', skills: [], life: 1, damage: 1, speed: 3, size: 1, xp: 1, palette: 'moss' })).toThrow(/archetype/);
    const r = await callTool('species.create', { id: 'bad', body: 'wolf', skills: ['m_nope'] }, env);
    expect(r.ok).toBe(false);
  });
});

describe('autoplayer bot', () => {
  const play = (n: number, level: number, seed: number) => {
    const c = campaignStage(n);
    const lvl = generateDungeon(c.dungeon);
    c.place?.(lvl);
    const sim = new Sim(lvl, clips, seed, { hero: autoHero({ level, seed }) });
    const r = runBot(sim, { maxFrames: 60 * 240 });
    sim.dispose();
    return r;
  };

  it('clears a depth with a level-appropriate hero and takes the exit', () => {
    const r = play(1, 4, 1);
    expect(r.bossDead).toBe(true);
    expect(r.exited).toBe(true);
    expect(r.kills).toBeGreaterThan(5);
    expect(r.roomsVisited).toBeGreaterThan(2);
  });

  it('is deterministic', () => {
    const a = play(2, 5, 3), b = play(2, 5, 3);
    expect(a.frames).toBe(b.frames);
    expect(a.kills).toBe(b.kills);
    expect(a.damageTaken).toBe(b.damageTaken);
  });

  it('balance.run reports clear rate and time', async () => {
    const d = (await call('balance.run', { stage: 1, heroLevel: 4, seeds: [1], maxSeconds: 200 })).data as { summary: { clearRate: number; seconds: number } };
    expect(d.summary.clearRate).toBe(1);
    expect(d.summary.seconds).toBeGreaterThan(5);
  });
});

describe('balance guard (bot campaign)', () => {
  it('a fresh hero clears the opening depths and the first boss is a real fight', async () => {
    const d = (await call('balance.campaign', { from: 1, to: 4 })).data as { failedDepths: number[]; totalDeaths: number; rows: Array<{ bossSeconds: number; gap: number }> };
    expect(d.failedDepths).toEqual([]);
    expect(d.totalDeaths).toBeLessThanOrEqual(2);
    // The first boss neither melts nor walls a new hero.
    expect(d.rows[0].bossSeconds).toBeGreaterThan(8);
    expect(d.rows[0].bossSeconds).toBeLessThan(60);
    // The hero stays within a few levels of the monsters.
    for (const r of d.rows) expect(Math.abs(r.gap)).toBeLessThanOrEqual(5);
  });

  it('monster life keeps pace with a level-appropriate hero', async () => {
    const d = (await call('balance.curve', { levels: [10, 40, 80] })).data as { rows: Array<{ secondsToKill: number }> };
    // A normal monster takes a beat, never a fraction of a frame or a slog.
    for (const r of d.rows) {
      expect(r.secondsToKill).toBeGreaterThan(0.08);
      expect(r.secondsToKill).toBeLessThan(3);
    }
  });
});

describe('upgrade arrows', () => {
  it('rates bag items against the equipped ones and leaves the hero untouched', async () => {
    const { heroPower, upgradeGains } = await import('../src/sim/autobuild');
    const { newHero, addToInventory } = await import('../src/sim/hero');
    const { rollItem } = await import('../src/sim/items');
    const { Rng } = await import('../src/sim/rng');
    const { probeSim } = await import('../src/agent/probe');
    const hero = newHero();
    hero.level = 12;
    const good = rollItem(new Rng(5), { ilvl: 12, rarity: 'rare', base: 'war_sword', uid: 'good' });
    const bad = rollItem(new Rng(6), { ilvl: 1, rarity: 'normal', base: 'rusted_sword', uid: 'bad' });
    addToInventory(hero, good);
    addToInventory(hero, bad);
    const sim = await probeSim(clips, hero);
    const p = sim.player!;
    p.life = p.maxLife * 0.5;
    const before = { power: heroPower(sim), life: p.life, eq: JSON.stringify(hero.equipment), inv: JSON.stringify(hero.inventory) };
    const gains = upgradeGains(sim);
    expect(gains.get('good')!).toBeGreaterThan(1.05);
    expect(gains.get('bad')!).toBeLessThanOrEqual(1.001);
    expect(heroPower(sim)).toBeCloseTo(before.power, 6);
    expect(p.life).toBe(before.life);
    expect(JSON.stringify(hero.equipment)).toBe(before.eq);
    expect(JSON.stringify(hero.inventory)).toBe(before.inv);
    sim.dispose();
  });
});
