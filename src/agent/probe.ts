/**
 * Throwaway simulations for inspection tools: an empty training room with an optional hero, where
 * monsters can be spawned and measured (life, damage per skill, speed) without a dungeon, and
 * where loot tables can be rolled thousands of times. Never rendered.
 */
import { DEFAULT_LEVEL, type Level } from '../content/level';
import type { MonsterRarity } from '../content/monsters';
import { cooldownOf, costOf } from '../sim/actions';
import { estimateSkill } from '../sim/combat';
import { skill as skillDef } from '../content/skills';
import { xpToNext } from '../sim/scaling';
import { treePoints, type Hero } from '../sim/hero';
import { initPhysics, Sim, type ClipTable } from '../sim/sim';
import type { Character } from '../sim/types';

export async function probeSim(clips: ClipTable, hero: Hero | null = null, seed = 1): Promise<Sim> {
  await initPhysics();
  const level: Level = {
    ...structuredClone(DEFAULT_LEVEL),
    name: 'probe',
    kind: 'dungeon',
    crates: [],
    walls: DEFAULT_LEVEL.walls.slice(0, 4),
    characters: hero ? [{ id: 'player', preset: 'ranger', x: 0, z: 5, brain: 'input' }] : [],
  };
  return new Sim(level, clips, seed, { hero });
}

let probeSeq = 0;
export function spawnProbeMonster(sim: Sim, def: string, level: number, rarity: MonsterRarity, affixes: string[] = [], palette?: string): Character {
  return sim.spawn({ id: `probe${++probeSeq}`, preset: 'ranger', x: 0, z: -3, brain: 'monster', monster: { def, level, rarity, affixes, palette } });
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The numbers a player sees on the character sheet, plus every hotbar skill's damage. */
export function heroSheet(sim: Sim) {
  const ch = sim.player, hero = sim.hero;
  if (!ch || !hero) throw new Error('no hero in this sim');
  const st = sim.stats(ch);
  const w = sim.heroBuild?.weapon;
  const skills = ['slash1', ...hero.hotbar.filter((s): s is string => !!s)].map((id) => {
    const s = skillDef(id);
    const e = estimateSkill(sim, ch, s);
    const cd = cooldownOf(sim, ch, s);
    // Sustained rate: a cooldown caps how often the skill lands.
    const perSecond = cd > 0 ? Math.min(e.perSecond, e.hit / cd) : e.perSecond;
    return { id, name: s.name, hit: r1(e.hit), perSecond: r1(perSecond), critChance: r1(e.critChance), cost: r1(costOf(sim, ch, s)), cooldown: r1(cd), byType: Object.fromEntries(Object.entries(e.byType).map(([k, v]) => [k, r1(v ?? 0)])) };
  });
  return {
    name: hero.name, level: hero.level, xp: `${hero.xp}/${xpToNext(hero.level)}`, gold: hero.gold, passivePoints: { allocated: hero.tree.length, unspent: treePoints(hero) },
    life: Math.round(ch.maxLife), mana: Math.round(ch.maxMana),
    lifeRegen: r1(st.get('lifeRegen') + (st.get('lifeRegenPct') / 100) * ch.maxLife), manaRegen: r1(st.get('manaRegen')),
    armor: Math.round(st.get('armor')), evasion: Math.round(st.get('evasion')), block: r1(st.get('block')),
    resist: { fire: r1(st.get('resFire')), cold: r1(st.get('resCold')), lightning: r1(st.get('resLightning')), chaos: r1(st.get('resChaos')) },
    attributes: { str: Math.round(st.get('str')), dex: Math.round(st.get('dex')), int: Math.round(st.get('int')) },
    weapon: w ? { class: w.cls, damage: w.dmg, speed: w.speed, crit: w.crit } : null,
    attackSpeed: r1(st.get('attackSpeed')), castSpeed: r1(st.get('castSpeed')), moveSpeed: r1(st.get('moveSpeed')), critMulti: r1(st.get('critMulti')),
    loot: { itemRarity: r1(st.get('itemRarity')), itemQuantity: r1(st.get('itemQuantity')), goldFind: r1(st.get('goldFind')) },
    skills,
    hotbar: hero.hotbar,
    equipment: Object.fromEntries(Object.entries(hero.equipment).map(([slot, it]) => [slot, it ? `${it.name} (${it.rarity}, ilvl ${it.ilvl})` : null])),
  };
}

/** A monster's numbers at a level: what it takes to kill and what it deals. */
export function monsterSheet(sim: Sim, ch: Character) {
  const st = sim.stats(ch);
  const m = ch.monster!;
  return {
    name: ch.name, def: m.def, level: ch.level, rarity: m.rarity, affixes: m.affixes, palette: m.palette, element: m.element, boss: m.boss,
    life: Math.round(ch.maxLife), armor: Math.round(st.get('armor')), evasion: Math.round(st.get('evasion')),
    resist: { fire: r1(st.get('resFire')), cold: r1(st.get('resCold')), lightning: r1(st.get('resLightning')), chaos: r1(st.get('resChaos')) },
    runSpeed: r1(sim.runSpeed(ch)), radius: r1(ch.radius), scale: r1(ch.scale), xp: Math.round(m.xp),
    skills: m.skills.map((id) => {
      const s = skillDef(id);
      const e = estimateSkill(sim, ch, s);
      const cd = s.cooldown ?? 0;
      return { id, name: s.name, hit: r1(e.hit), perSecond: r1(cd > 0 ? Math.min(e.perSecond, e.hit / cd) : e.perSecond), range: s.range, cooldown: cd, tags: s.tags };
    }),
  };
}
