/** Hero skills: every one is learnable, drawn and doing what it says in a live sim. */
import { beforeAll, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { probeSim, spawnProbeMonster } from '../src/agent/probe';
import { HERO_SKILLS, HOTBAR_SKILLS, SKILLS } from '../src/content/skills';
import { TREE } from '../src/content/tree';
import { autoHero } from '../src/sim/autobuild';
import { callTool } from '../src/agent/registry';
import { estimateSkill, rollPacket } from '../src/sim/combat';
import { buildStageLevel } from '../src/agent/tools/content';
import { initPhysics, Sim, type ClipTable } from '../src/sim/sim';
import { hasIconRecipe } from '../src/ui/skillIcons';

const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));

beforeAll(async () => {
  await initPhysics();
});

it('every slottable skill has one tree node and an icon', () => {
  for (const id of HOTBAR_SKILLS) {
    const nodes = TREE.nodes.filter((n) => n.skill === id);
    // Cleave and Fireball are known from the start; their clusters have no skill node.
    expect(nodes.length, id).toBe(['cleave', 'fireball'].includes(id) ? 0 : 1);
  }
  for (const n of TREE.nodes) if (n.skill) expect(HOTBAR_SKILLS, n.id).toContain(n.skill);
  for (const s of HERO_SKILLS) expect(hasIconRecipe(s.icon), `${s.id}: icon ${s.icon}`).toBe(true);
});

/** Casts hotbar slot 0 at three sleeping golems and returns the hero's hits. */
async function cast(id: string): Promise<{ sim: Sim; hits: Array<{ target: string; damage: number; dmgType: string }>; statuses: string[] }> {
  const hero = autoHero({ level: 20 });
  const node = TREE.nodes.find((n) => n.skill === id);
  if (node) hero.tree.push(node.id);
  hero.hotbar = [id, null, null, null, null];
  const sim = await probeSim(clips, hero, 3);
  const p = sim.player!;
  const targets = [0, 1, 2].map((k) => {
    const m = spawnProbeMonster(sim, 'golem', 20, 'normal');
    m.ai.awake = false;
    sim.teleport(m.id, p.pos.x + 2.4 + k * 0.5, p.pos.z + (k - 1) * 1.0);
    return m;
  });
  const seq = sim.lastEventSeq;
  p.input.aim = { x: targets[1].pos.x, z: targets[1].pos.z };
  p.input.skill = 0;
  for (let f = 0; f < 150; f++) {
    sim.step();
    p.input.skill = -1;
  }
  const ev = sim.eventsSince(seq);
  const hits = ev.filter((e) => e.type === 'hit' && e.attacker === 'player') as unknown as Array<{ target: string; damage: number; dmgType: string }>;
  return { sim, hits, statuses: ev.filter((e) => e.type === 'status').map((e) => String(e.status)) };
}

it('Lacerate cuts twice and makes targets bleed', async () => {
  const { sim, hits, statuses } = await cast('lacerate');
  expect(sim.events.filter((e) => e.type === 'strike' && e.skill === 'lacerate')).toHaveLength(2);
  expect(hits.length).toBeGreaterThanOrEqual(2);
  expect(statuses).toContain('bleed');
  sim.dispose();
});

it('Knife Rain scatters six knife zones around the target', async () => {
  const { sim, hits } = await cast('kniferain');
  expect(sim.events.filter((e) => e.type === 'zone.resolve').length).toBeGreaterThanOrEqual(6);
  expect(hits.length).toBeGreaterThan(0);
  sim.dispose();
});

it('Flame Surge burns along a line and keeps ticking', async () => {
  const { sim, hits, statuses } = await cast('flamesurge');
  expect(hits.every((h) => h.dmgType === 'fire')).toBe(true);
  expect(hits.length).toBeGreaterThan(3);
  expect(statuses).toContain('ignite');
  sim.dispose();
});

it('Flame Surge stops at walls', async () => {
  const hero = autoHero({ level: 20 });
  hero.tree.push(TREE.nodes.find((n) => n.skill === 'flamesurge')!.id);
  hero.hotbar = ['flamesurge', null, null, null, null];
  const sim = new Sim(buildStageLevel({ stage: 3 }), clips, 3, { hero });
  const p = sim.player!;
  sim.step(); // Rapier queries see colliders after the first step.
  // Face the nearest wall of the starting room.
  let best = { yaw: 0, d: Infinity };
  for (let k = 0; k < 16; k++) {
    const yaw = (k / 16) * Math.PI * 2;
    const d = sim.castBlockers(p.pos.x, 1, p.pos.z, Math.sin(yaw) * 30, 0, Math.cos(yaw) * 30) ?? Infinity;
    if (d < best.d) best = { yaw, d };
  }
  expect(best.d).toBeLessThan(9);
  p.input.aim = { x: p.pos.x + Math.sin(best.yaw) * 3, z: p.pos.z + Math.cos(best.yaw) * 3 };
  p.input.skill = 0;
  for (let f = 0; f < 40 && !sim.zones.length; f++) {
    sim.step();
    p.input.skill = -1;
  }
  const zone = sim.zones.find((z) => z.skill === 'flamesurge')!;
  expect(zone.shape.kind).toBe('line');
  expect((zone.shape as { length: number }).length).toBeLessThan(8);
  sim.dispose();
});

it('Molten Strike turns most of the blow to fire and throws globs', async () => {
  const { sim, hits } = await cast('moltenstrike');
  expect(sim.events.filter((e) => e.type === 'projectile' || e.type === 'explosion').length).toBeGreaterThan(0);
  const fire = hits.filter((h) => h.dmgType === 'fire').reduce((a, h) => a + h.damage, 0);
  const all = hits.reduce((a, h) => a + h.damage, 0);
  expect(fire / all).toBeGreaterThan(0.5);
  // The estimate counts the blow and one glob (30% of it): 1.3x the blow alone. Lacerate counts
  // both of its 75% cuts, matching Cleave's single 150% swing.
  const ms = SKILLS.moltenstrike;
  const est = estimateSkill(sim, sim.player!, ms);
  const blowOnly = estimateSkill(sim, sim.player!, { ...ms, effects: ms.effects.filter((e) => e.type === 'strike') });
  expect(est.hit / blowOnly.hit).toBeCloseTo(1.3, 2);
  const cleave = estimateSkill(sim, sim.player!, SKILLS.cleave);
  expect(est.byType.fire ?? 0).toBeGreaterThan(est.byType.physical ?? 0);
  expect(estimateSkill(sim, sim.player!, SKILLS.lacerate).hit).toBeCloseTo(cleave.hit, -1);
  sim.dispose();
});

it('Spirit Wolves deal a real share of their owner\'s damage and ignore enemy pacts', async () => {
  const env = { game: null, clips };
  const test = async (id: string) => {
    const r = await callTool('skill.test', { id, heroLevel: 30, focus: 'spell', casts: 20, targets: 1, rarity: 'unique', seconds: 10 }, env);
    if (!r.ok) throw new Error(r.error);
    return r.data as { damage: { perSecond: number }; effects: { minions: number } };
  };
  const wolves = await test('spiritwolves');
  const fireball = await test('fireball');
  expect(wolves.effects.minions).toBe(2);
  // Before: ~3% of Fireball (monster damage numbers); now a quarter to a half.
  expect(wolves.damage.perSecond / fireball.damage.perSecond).toBeGreaterThan(0.2);
  expect(wolves.damage.perSecond / fireball.damage.perSecond).toBeLessThan(0.6);

  // A pact that makes enemies hit harder does not make your wolves hit harder.
  const hero = autoHero({ level: 30, focus: 'spell' });
  const sim = await probeSim(clips, hero, 3);
  const [wolf] = sim.summon(sim.player!, 'spirit_wolf', 1, 10);
  const bite = SKILLS.m_bite;
  const roll = () => Object.values(rollPacket(sim, wolf, bite, undefined, null, 1, { next: () => 0.5 }, true).dmg).reduce((a, v) => a + (v ?? 0), 0);
  const plain = roll();
  (sim.pact as { enemyDamage: number }).enemyDamage = 1;
  expect(roll()).toBeCloseTo(plain, 6);
  sim.dispose();
});
