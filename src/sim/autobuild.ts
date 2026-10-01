/**
 * Builds a plausible hero for a level without playing up to it: gear of the right item level and
 * rarity, passive points spent greedily toward a focus (melee, spell or balanced), and a hotbar
 * filled from what the tree unlocked. Balance sweeps, bot runs and the agent `hero.build` tool
 * use it to answer "how does a typical level-N character fare at depth M?".
 */
import { HOTBAR_SKILLS } from '../content/skills';
import { BASES, EQUIP_SLOTS, SLOT_KIND, type EquipSlot, type ItemRarity } from '../content/items';
import type { Mod } from '../content/stats';
import { TREE, type TreeNode } from '../content/tree';
import { newHero, type Hero } from './hero';
import { rollItem } from './items';
import { Rng } from './rng';

export type BuildFocus = 'melee' | 'spell' | 'balanced';

export interface AutoHeroOptions {
  level: number;
  /** 'starter' keeps the starting kit; otherwise every slot gets an item of this rarity. */
  gear?: 'starter' | ItemRarity;
  focus?: BuildFocus;
  /** Spend passive points (default true). Stage-clear bonus points are not assumed. */
  tree?: boolean;
  seed?: number;
  name?: string;
}

const WEAPON_FOR: Record<BuildFocus, string[]> = {
  melee: ['broad_sword', 'war_sword', 'greatsword', 'executioner', 'war_axe', 'hand_axe'],
  spell: ['gnarled_staff', 'runed_staff'],
  balanced: ['broad_sword', 'war_sword', 'hand_axe', 'war_axe'],
};

/** How much a mod is worth to a focus (rough, but stable and monotonic). */
function modScore(m: Mod, focus: BuildFocus): number {
  const tags = m.tags ?? [];
  const melee = focus !== 'spell', spell = focus !== 'melee';
  const fits = !tags.length || tags.some((t) => (melee && (t === 'melee' || t === 'attack' || t === 'physical')) || (spell && (t === 'spell' || t === 'fire' || t === 'cold' || t === 'lightning')));
  const v = Math.abs(m.value);
  const sign = m.value < 0 ? -1 : 1;
  switch (m.stat) {
    case 'life': return sign * (m.kind === 'flat' ? v / 10 : v / 5);
    case 'damage': return fits ? sign * v / 7 : 0.2;
    case 'attackSpeed': return melee ? sign * v / 3 : 0.1;
    case 'castSpeed': return spell ? sign * v / 3 : 0.1;
    case 'str': return melee ? v / 12 : v / 30;
    case 'int': return spell ? v / 12 : v / 30;
    case 'dex': return v / 18;
    case 'critChance': return v / 25;
    case 'critMulti': return v / 20;
    case 'armor': case 'evasion': return v / 20;
    case 'lifeRegen': case 'lifeLeech': case 'lifeOnHit': return 0.6;
    case 'resFire': case 'resCold': case 'resLightning': case 'resChaos': return v / 15;
    case 'area': return v / 8;
    case 'mana': return spell ? v / 15 : 0.1;
    case 'manaRegen': return spell ? v / 10 : 0.1;
    default: return m.kind === 'flag' ? 0 : 0.15;
  }
}

function nodeScore(n: TreeNode, focus: BuildFocus, hero: Hero): number {
  if (n.kind === 'keystone') return -1;
  let s = n.mods.reduce((a, m) => a + modScore(m, focus), 0);
  if (n.kind === 'notable') s *= 1.5;
  if (n.skill) {
    const wanted = focus === 'spell' ? ['meteor', 'icespear', 'chainlightning', 'frostnova', 'bladevortex', 'spiritwolves'] : focus === 'melee'
      ? ['whirlwind', 'groundslam', 'leapslam', 'dashstrike', 'warcry', 'shieldcharge'] : ['groundslam', 'chainlightning', 'warcry', 'leapslam', 'frostnova'];
    s += hero.hotbar.includes(null) && wanted.includes(n.skill) ? 4 : 0.3;
  }
  if (n.kind === 'mastery') s *= 0.6;
  return s;
}

/** Spends every available point: best frontier node per point, looking one step past minors. */
export function spendPoints(hero: Hero, points: number, focus: BuildFocus) {
  const taken = new Set(hero.tree);
  if (!taken.size) taken.add(TREE.start);
  for (let k = 0; k < points; k++) {
    let best: TreeNode | null = null, bestScore = -Infinity;
    for (const id of taken) {
      for (const nid of TREE.byId.get(id)!.links) {
        const n = TREE.byId.get(nid)!;
        if (taken.has(nid) && !n.repeatable) continue;
        if (n.kind === 'start') continue;
        // Value of the node plus the best thing it opens up (so a weak link to a notable wins).
        let look = 0;
        for (const nn of n.links) if (!taken.has(nn)) look = Math.max(look, nodeScore(TREE.byId.get(nn)!, focus, hero) * 0.6);
        const s = nodeScore(n, focus, hero) + look;
        if (s > bestScore || (s === bestScore && best && n.id < best.id)) {
          bestScore = s;
          best = n;
        }
      }
    }
    if (!best) break;
    taken.add(best.id);
    hero.tree.push(best.id);
    if (best.skill && HOTBAR_SKILLS.includes(best.skill) && !hero.hotbar.includes(best.skill)) {
      const free = hero.hotbar.indexOf(null);
      if (free >= 0) hero.hotbar[free] = best.skill;
    }
  }
}

export function autoHero(o: AutoHeroOptions): Hero {
  const hero = newHero(o.name ?? 'Bot');
  const level = Math.max(1, Math.floor(o.level));
  const focus = o.focus ?? 'melee';
  hero.level = level;
  const rng = new Rng((o.seed ?? 1) * 92821 + level);
  const gear = o.gear ?? (level < 4 ? 'starter' : level < 12 ? 'magic' : 'rare');
  if (gear !== 'starter') {
    const slots: EquipSlot[] = EQUIP_SLOTS.filter((s) => s !== 'flask1' && s !== 'flask2');
    for (const slot of slots) {
      const kind = SLOT_KIND[slot];
      let base: string | undefined;
      if (slot === 'weapon') {
        const options = WEAPON_FOR[focus].filter((b) => BASES[b].level <= level);
        base = options.length ? rng.pick(options) : WEAPON_FOR[focus][0];
      }
      if (slot === 'offhand') {
        if (focus === 'spell') base = level >= 6 ? 'focus' : undefined;
        else base = level >= 20 ? 'tower_shield' : level >= 10 ? 'kite_shield' : 'buckler';
      }
      const item = rollItem(rng, { ilvl: level, rarity: gear, base, slot: base ? undefined : kind, uid: `auto${slot}` });
      // Two-handers leave no room for an off-hand.
      if (slot === 'offhand' && hero.equipment.weapon && /greatsword|executioner|staff/.test(hero.equipment.weapon.base)) continue;
      hero.equipment[slot] = item;
    }
  }
  if (focus === 'spell') hero.hotbar = ['fireball', 'cleave', null, null, null];
  if (o.tree !== false) spendPoints(hero, level - 1, focus);
  hero.flasks = [30, 30];
  return hero;
}
