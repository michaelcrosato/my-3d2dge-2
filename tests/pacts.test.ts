/** Pacts: every risk lands on the monsters and every reward on the hero. */
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { buildStageLevel } from '../src/agent/tools/content';
import { PACTS, pactRewardText, pactTotals } from '../src/content/pacts';
import { autoHero } from '../src/sim/autobuild';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));
const sim = (pacts: string[], stage = 8) => new Sim(buildStageLevel({ stage, pacts }), clips, 3, { hero: autoHero({ level: 20 }) });
const mons = (s: Sim) => [...s.characters.values()].filter((c) => c.monster);

beforeAll(async () => {
  await initPhysics();
});

describe('pacts', () => {
  it('are all valid and have both a risk and a reward', () => {
    for (const p of PACTS) {
      const t = pactTotals([p.id]);
      expect(t.xp + t.rarity + t.quantity + t.gold, p.id).toBeGreaterThan(0);
      expect(t.enemyDamage + t.enemyLife + t.enemySpeed + t.density + (t.elites - 1) + t.affixes.length + (t.dark ? 1 : 0), p.id).toBeGreaterThan(0);
    }
    expect(pactRewardText(['brutal', 'teeming'])).toMatch(/experience.*rarity.*quantity/);
  });

  it('teeming and champions add packs and elites', () => {
    const base = sim([]), more = sim(['teeming', 'champions']);
    expect(mons(more).length).toBeGreaterThan(mons(base).length * 1.2);
    const elite = (s: Sim) => mons(s).filter((c) => c.monster!.rarity !== 'normal').length;
    expect(elite(more)).toBeGreaterThan(elite(base));
    base.dispose();
    more.dispose();
  });

  it('stalwart, brutal and volatile change every monster; the hero earns the rewards', () => {
    const base = sim([]), hard = sim(['stalwart', 'brutal', 'volatile']);
    const a = mons(base).find((c) => !c.monster!.boss)!, b = mons(hard).find((c) => c.monster!.def === a.monster!.def && c.monster!.rarity === a.monster!.rarity && !c.monster!.boss)!;
    expect(b.maxLife / a.maxLife).toBeCloseTo(1.6, 1);
    expect(hard.monsterDamageMult(b) / base.monsterDamageMult(a)).toBeCloseTo(1.4, 2);
    expect(mons(hard).every((c) => c.monster!.affixes.includes('deathburst'))).toBe(true);
    const st = hard.stats(hard.player!), st0 = base.stats(base.player!);
    expect(st.get('itemRarity') - st0.get('itemRarity')).toBe(50);
    expect(st.get('xpGain') - st0.get('xpGain')).toBe(40);
    expect(st.get('goldFind') - st0.get('goldFind')).toBe(40);
    base.dispose();
    hard.dispose();
  });

  it('eclipse darkens any depth and brings beacons', () => {
    const s = sim(['eclipse'], 2);
    expect(s.level.dark).toBe(true);
    expect(s.level.mechanics).toContain('lightless');
    expect([...s.props.values()].some((p) => p.kind === 'beacon')).toBe(true);
    expect(s.level.subtitle).toMatch(/Pacts: Eclipse/);
    s.dispose();
  });
});
