/**
 * One power curve drives every number that grows with level, so the game scales without end:
 * monster life and skill damage, item base values and affix magnitudes, gold and experience.
 * Offense (damage, monster life) follows `power`; defense (life, armour, monster damage) follows
 * the gentler `defense`, so a hero with level-appropriate gear stays roughly as strong relative
 * to monsters at level 500 as at level 5. Pure functions; tests and agent balance tools use them.
 */

/** Offense curve: 1 at level 1, ~6 at 20, ~95 at 50, ~4800 at 100, unbounded after. */
export function power(level: number): number {
  const l = Math.max(1, level) - 1;
  return Math.pow(1.065, l) * (1 + 0.04 * l);
}

/** Defense curve: power^0.8. */
export function defense(level: number): number {
  return Math.pow(power(level), 0.8);
}

/**
 * Monster life also carries the hero's accumulated percentage increases (passive tree, strength,
 * gear, attack speed, crit), which grow about linearly with level on top of the power curve.
 * Measured with the agent `balance.campaign` tool: without this ramp a campaign hero's damage
 * outgrew monster life ~30x by level 85 and bosses fell in a second. Flat for the opening levels.
 */
export const lifeRamp = (level: number) => {
  const l = Math.max(0, Math.max(1, level) - 3);
  return 1 + 0.15 * l + 0.0008 * l * l;
};
export const monsterLife = (level: number) => 22 * power(level) * lifeRamp(level);
/**
 * Early bosses teach rather than wall: damage starts at 60% and reaches full strength by level 13
 * (bot playtests had a fresh hero dying twice to the depth-1 boss in every seed).
 */
export const bossEase = (level: number) => 0.6 + 0.4 * Math.min(1, (Math.max(1, level) - 1) / 12);
/** Boss life eases only over the first few levels (later bosses keep their full bulk). */
export const bossLifeEase = (level: number) => 0.45 + 0.55 * Math.min(1, (Math.max(1, level) - 1) / 4);
/** Monster damage: the defense curve, eased in over the first levels so the opening is learnable. */
export const monsterDamage = (level: number) => defense(level) * (0.65 + 0.35 * Math.min(1, (Math.max(1, level) - 1) / 10));
export const spellDamage = (level: number) => power(level);
export const heroBaseLife = (level: number) => Math.round(58 * defense(level) + 6 * (Math.max(1, level) - 1));
export const heroBaseMana = (level: number) => Math.round(36 + 4 * (Math.max(1, level) - 1));

/** Experience needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(70 * Math.pow(power(level), 0.9) * (1 + 0.18 * level));
}

/** Experience for killing a normal monster of `level` (before rarity and penalties). */
export function monsterXp(level: number): number {
  return 7 * Math.pow(power(level), 0.9);
}

/** Experience penalty when the monster is far below or above the hero (PoE-like). */
export function xpPenalty(heroLevel: number, monsterLevel: number): number {
  const safe = 3 + Math.floor(heroLevel / 16);
  const diff = Math.max(0, Math.abs(heroLevel - monsterLevel) - safe);
  return Math.pow((heroLevel + 5) / (heroLevel + 5 + Math.pow(diff, 2.5)), 1.5);
}

/**
 * Catch-up: monsters above the hero's level give +12% experience per level of difference (up to
 * +96%), so pushing deeper levels you faster and a hero who fell behind closes the gap. Without it,
 * campaign bot runs drifted 5 levels under the monsters by depth 40.
 */
export function xpCatchUp(heroLevel: number, monsterLevel: number): number {
  return 1 + 0.12 * Math.min(8, Math.max(0, monsterLevel - heroLevel));
}

export const goldDrop = (level: number) => 2 + 3 * Math.pow(power(level), 0.7);

/** Chance to evade an attack: evasion against the attacker's level. */
export function evadeChance(evasion: number, attackerLevel: number): number {
  if (evasion <= 0) return 0;
  return Math.min(0.75, evasion / (evasion + 120 * defense(attackerLevel)));
}

/** PoE armour formula: the bigger the hit, the less armour helps. */
export function armorReduction(armor: number, damage: number): number {
  if (armor <= 0 || damage <= 0) return 0;
  return Math.min(0.9, armor / (armor + 10 * damage));
}
