/** Unique items: every line is built from vocabulary the stat engine understands, and every base hosts one. */
import { beforeAll, expect, it } from 'vitest';
import manifest from '../public/assets/manifest.json';
import { probeSim } from '../src/agent/probe';
import { SKILLS } from '../src/content/skills';
import { autoHero } from '../src/sim/autobuild';
import { skillTags } from '../src/sim/combat';
import { initPhysics, type ClipTable } from '../src/sim/sim';
import { BASES } from '../src/content/items';
import { HERO_SKILLS, SKILL_NAMES } from '../src/content/skills';
import { STATS, type Tag } from '../src/content/stats';
import { UNIQUES } from '../src/content/uniques';
import { describeItem, rollItem } from '../src/sim/items';
import { Rng } from '../src/sim/rng';

const KNOWN_TAGS = new Set<string>([
  'attack', 'spell', 'melee', 'projectile', 'area', 'movement', 'dot', 'minion', 'aura', 'warcry', 'channel',
  'physical', 'fire', 'cold', 'lightning', 'chaos', 'elemental',
  'cond:lowLife', 'cond:fullLife', 'cond:moving', 'cond:stationary', 'cond:shrine', 'cond:recentKill', 'cond:recentDodge',
  'vs:burning', 'vs:chilled', 'vs:shocked', 'vs:poisoned', 'vs:bleeding', 'vs:boss', 'vs:elite',
]);
const heroSkills = new Set(HERO_SKILLS.map((s) => s.id));
const clips: ClipTable = Object.fromEntries(manifest.clips.map((c) => [c.name, { duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }]));

beforeAll(async () => {
  await initPhysics();
});

it('every unique uses a real base, real stats and tags the engine evaluates', () => {
  const ids = new Set<string>();
  for (const u of UNIQUES) {
    expect(ids.has(u.id), `duplicate ${u.id}`).toBe(false);
    ids.add(u.id);
    const base = BASES[u.base];
    expect(base, `${u.id}: base ${u.base}`).toBeTruthy();
    expect(u.flavour.length, u.id).toBeGreaterThan(5);
    for (const [m] of u.mods) {
      expect(STATS[m.stat], `${u.id}: stat ${m.stat}`).toBeTruthy();
      for (const t of (m.tags ?? []) as Tag[]) {
        if (t.startsWith('skill:')) expect(heroSkills.has(t.slice(6)), `${u.id}: ${t}`).toBe(true);
        else expect(KNOWN_TAGS.has(t), `${u.id}: tag ${t}`).toBe(true);
      }
    }
  }
});

it('every equippable base (and every jewel) can drop as a unique', () => {
  const hosted = new Set(UNIQUES.map((u) => u.base));
  const missing = Object.values(BASES).filter((b) => b.slot !== 'flask' && !hosted.has(b.id)).map((b) => b.id);
  expect(missing).toEqual([]);
});

it('rolls each unique and describes it without placeholders', () => {
  for (const u of UNIQUES) {
    const item = rollItem(new Rng(7), { uid: 'u1', ilvl: Math.max(u.level, 40), rarity: 'unique', base: u.base });
    if (item.unique !== u.id) continue; // another unique on the same base won the roll
    const text = describeItem(item, SKILL_NAMES).map((l) => l.text).join('\n');
    expect(item.name, u.id).toBe(u.name);
    expect(text, u.id).toContain(u.flavour);
    expect(text, u.id).not.toMatch(/undefined|NaN|skill:/);
  }
  // Skill uniques name the skill, not its id.
  const fireball = rollItem(new Rng(1), { uid: 'u1', ilvl: 10, rarity: 'unique', base: 'amber_amulet' });
  expect(describeItem(fireball, SKILL_NAMES).map((l) => l.text).join('\n')).toMatch(/Fireball/);
});

it('skill uniques change only their skill in the live stat engine', async () => {
  const hero = autoHero({ level: 20 });
  const sim = await probeSim(clips, hero);
  const st = () => sim.stats(sim.player!);
  const get = (stat: 'projectiles' | 'chain', skill: string) => st().get(stat, skillTags(SKILLS[skill]));
  const before = { fb: get('projectiles', 'fireball'), ice: get('projectiles', 'icespear'), cl: get('chain', 'chainlightning') };
  hero.equipment.amulet = rollItem(new Rng(1), { uid: 'u901', ilvl: 20, rarity: 'unique', base: 'amber_amulet' });
  hero.equipment.gloves = rollItem(new Rng(1), { uid: 'u902', ilvl: 20, rarity: 'unique', base: 'sorcerer_gloves' });
  expect([hero.equipment.amulet.unique, hero.equipment.gloves.unique]).toEqual(['firsthearth', 'stormweaver']);
  sim.refreshHero();
  expect(get('projectiles', 'fireball')).toBe(before.fb + 1);
  expect(get('projectiles', 'icespear')).toBe(before.ice);
  expect(get('chain', 'chainlightning')).toBe(before.cl + 2);
  sim.dispose();
});
