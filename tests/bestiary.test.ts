/** The Workshop bestiary: stats from parts, the threat budget, saving, bosses and the depths. */
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { designProblems, designStats, designToMonster, monsterId, randomDesign, registerDesign, releasedSpecies, setReleased, THREAT_BUDGET, type SpeciesDesign } from '../src/content/bestiary';
import { MONSTERS } from '../src/content/monsters';
import { stageSpec } from '../src/content/stages';
import { generateDungeon } from '../src/content/procgen/dungeon';
import { normalizeDesign, SaveStore } from '../src/save';
import { newHero } from '../src/sim/hero';
import { initPhysics, Sim } from '../src/sim/sim';

const clips = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));
const base = (): SpeciesDesign => ({ id: 'testling', name: 'Testling', body: 'wolf', seed: 3, archetype: 'skirmisher', skills: ['m_bite'], palette: 'moss', size: 1 });

beforeAll(async () => {
  await initPhysics();
});

describe('stats come from the parts', () => {
  it('horns and spikes add damage, bulk adds life and costs speed', () => {
    const plain = designStats(base());
    const armed = designStats({ ...base(), genome: { horns: { count: 4 }, spikes: { count: 8 } } });
    expect(armed.damage).toBeGreaterThan(plain.damage);
    const big = designStats({ ...base(), size: 1.4, genome: { girth: 0.4 } });
    expect(big.life).toBeGreaterThan(plain.life);
    expect(big.speed).toBeLessThan(plain.speed);
  });

  it('the threat budget keeps every design fair', () => {
    const monster = designStats({ ...base(), size: 1.8, genome: { horns: { count: 6 }, spikes: { count: 16 }, girth: 0.9, length: 3, wings: { span: 3 }, legs: { length: 1.6 } } });
    expect(monster.threat).toBeLessThanOrEqual(THREAT_BUDGET + 1e-9);
    expect(monster.notes.join(' ')).toMatch(/threat budget/);
    for (let s = 1; s < 60; s++) expect(designStats(randomDesign(s)).threat).toBeLessThanOrEqual(THREAT_BUDGET + 1e-9);
  });

  it('random designs are valid, and broken ones are reported', () => {
    for (let s = 1; s < 40; s++) expect(designProblems(randomDesign(s))).toEqual([]);
    expect(designProblems({ ...base(), body: 'unicorn' }).join()).toMatch(/body/);
    expect(designProblems({ ...base(), skills: ['m_bite', 'b_quake'] }).join()).toMatch(/attack/);
    expect(designProblems({ ...base(), id: 'Bad Id!' }).join()).toMatch(/id/);
  });
});

describe('designs in the game', () => {
  it('register a monster and a boss variant that spawn and fight', () => {
    const d = { ...base(), id: 'spawnling', skills: ['m_bite', 'm_charge'] };
    registerDesign(d);
    expect(MONSTERS[monsterId(d)].name).toBe('Testling');
    const boss = MONSTERS[monsterId(d, true)];
    expect(boss.boss).toBeTruthy();
    expect(boss.skills.length).toBeGreaterThan(2);
    expect(designToMonster(d).body).toMatchObject({ kind: 'creature', plan: 'wolf', seed: 3 });
    const hero = newHero();
    const spec = stageSpec(3, { boss: { def: monsterId(d, true) } });
    spec.pool = { entries: [{ def: monsterId(d), weight: 1 }], palettes: ['ember'], magic: 0, rare: 0 };
    const sim = new Sim(generateDungeon(spec), clips, 2, { hero });
    const mine = [...sim.characters.values()].filter((c) => c.monster?.def.startsWith('custom:spawnling'));
    expect(mine.some((c) => c.monster!.boss)).toBe(true);
    expect(mine.filter((c) => !c.monster!.boss).length).toBeGreaterThan(3);
    sim.dispose();
  });

  it('released designs join the depths deterministically', () => {
    const d = { ...base(), id: 'roamer', released: true };
    registerDesign(d);
    setReleased([d]);
    expect(releasedSpecies()).toEqual(['custom:roamer']);
    expect(stageSpec(1).pool.entries.some((e) => e.def === 'custom:roamer')).toBe(false);
    const a = stageSpec(6).pool.entries.map((e) => e.def);
    expect(a).toContain('custom:roamer');
    expect(stageSpec(6).pool.entries.map((e) => e.def)).toEqual(a);
    setReleased([]);
    expect(stageSpec(6).pool.entries.some((e) => e.def === 'custom:roamer')).toBe(false);
  });

  it('the bestiary survives a save round trip and drops broken entries', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
    const a = new SaveStore(storage);
    expect(a.saveDesign({ ...base(), genome: { horns: { count: 3 } }, released: true })).toBeNull();
    const raw = JSON.parse(mem.get([...mem.keys()][0])!);
    raw.bestiary.push({ id: 'broken', body: 'unicorn' });
    mem.set([...mem.keys()][0], JSON.stringify(raw));
    const b = new SaveStore(storage);
    expect(b.file.bestiary).toHaveLength(1);
    expect(b.file.bestiary[0]).toMatchObject({ id: 'testling', released: true, genome: { horns: { count: 3 } } });
    expect(normalizeDesign({ id: 'x', body: 'wolf', archetype: 'nope', palette: 'moss', skills: [] })).toBeNull();
  });
});

describe('save slots', () => {
  it('drops the untouched backdrop hero older builds left in a slot, keeps real ones', async () => {
    const { newHero } = await import('../src/sim/hero');
    const { SaveStore: Store, isPhantom } = await import('../src/save');
    const phantom = newHero();
    const named = newHero('Ranger');
    named.totals.kills = 3;
    const fresh = newHero('Mira');
    expect(isPhantom(phantom)).toBe(true);
    expect(isPhantom(named)).toBe(false);
    expect(isPhantom(fresh)).toBe(false);
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
    mem.set('3dpixel2d.save.v1', JSON.stringify({ version: 1, slots: [phantom, named, fresh], active: 0, tune: {} }));
    const s = new Store(storage);
    expect(s.file.slots.map((h) => h?.name ?? null)).toEqual([null, 'Ranger', 'Mira']);
  });
});
