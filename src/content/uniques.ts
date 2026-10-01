/**
 * Unique items: fixed names and build-defining mods. Values given at item level 1; `scale` says
 * which curve each line rides, so a unique found at stage 80 is as relevant as one from stage 5.
 * Rule-changing lines use 'rules' stats (flags) the combat code understands.
 */
import { mod, type Mod } from './stats';

export interface UniqueDef {
  id: string;
  name: string;
  base: string;
  /** Minimum item level to drop. */
  level: number;
  weight: number;
  flavour: string;
  /** [mod, scale] pairs: 'power' and 'defense' multiply by the curve at the item's level. */
  mods: Array<[Mod, 'power' | 'defense' | 'fixed']>;
}

const F = (m: Mod): [Mod, 'fixed'] => [m, 'fixed'];
const Pw = (m: Mod): [Mod, 'power'] => [m, 'power'];
const D = (m: Mod): [Mod, 'defense'] => [m, 'defense'];

export const UNIQUES: UniqueDef[] = [
  {
    id: 'starforge', name: 'Starforge', base: 'greatsword', level: 8, weight: 6, flavour: 'Forged from a fallen star; it remembers only how to fall.',
    mods: [F(mod('damage', 'inc', 120, ['physical'])), F(mod('damage', 'more', -100, ['elemental'])), Pw({ stat: 'addedPhysical', kind: 'flat', value: 6, max: 12, tags: ['attack'] }), F(mod('area', 'inc', 20))],
  },
  {
    id: 'emberheart', name: 'Emberheart', base: 'broad_sword', level: 5, weight: 10, flavour: 'Its pommel is still warm.',
    mods: [F(mod('physToFire', 'flat', 50)), F(mod('igniteChance', 'flat', 25)), F(mod('damage', 'inc', 40, ['fire'])), F(mod('explodeOnKill', 'flat', 20))],
  },
  {
    id: 'whisper', name: "Widow's Whisper", base: 'dirk', level: 3, weight: 10, flavour: 'Quiet as a held breath.',
    mods: [F(mod('critChance', 'inc', 80)), F(mod('critMulti', 'flat', 40)), F(mod('poisonChance', 'flat', 30)), F(mod('moveSpeed', 'inc', 8))],
  },
  {
    id: 'thunderlash', name: 'Thunderlash', base: 'hand_axe', level: 6, weight: 10, flavour: 'Every swing argues with the sky.',
    mods: [F(mod('physToLightning', 'flat', 60)), F(mod('shockChance', 'flat', 30)), F(mod('chain', 'flat', 1)), F(mod('attackSpeed', 'inc', 10))],
  },
  {
    id: 'rimeheart', name: 'Rimeheart Staff', base: 'gnarled_staff', level: 6, weight: 10, flavour: 'Winter kept in wood.',
    mods: [F(mod('damage', 'inc', 60, ['cold'])), F(mod('freezeChance', 'flat', 15)), F(mod('projectiles', 'flat', 1)), F(mod('castSpeed', 'inc', 12))],
  },
  {
    id: 'skullcrack', name: 'Skullcrack', base: 'club', level: 4, weight: 10, flavour: 'Subtlety was never invited.',
    mods: [F(mod('stagger', 'inc', 100)), F(mod('knockback', 'inc', 60)), F(mod('damage', 'inc', 50, ['physical'])), F(mod('area', 'inc', 15))],
  },
  {
    id: 'aegis', name: 'Aegis of the Last Watch', base: 'kite_shield', level: 10, weight: 8, flavour: 'The watch ended. The shield did not.',
    mods: [F(mod('block', 'flat', 12)), D(mod('life', 'flat', 30)), F(mod('cannotBeStunned', 'flag', 1)), F(mod('resFire', 'flat', 15)), F(mod('resCold', 'flat', 15)), F(mod('resLightning', 'flat', 15))],
  },
  {
    id: 'hollowcrown', name: 'The Hollow Crown', base: 'iron_helm', level: 8, weight: 8, flavour: 'Heavy is the head that wears nothing at all.',
    mods: [F(mod('stealMods', 'flag', 1)), D(mod('life', 'flat', 20)), F(mod('itemRarity', 'flat', 30))],
  },
  {
    id: 'kaomheart', name: 'Heart of the Mountain', base: 'plate', level: 14, weight: 5, flavour: 'It beats once per century.',
    mods: [D(mod('life', 'flat', 160)), F(mod('life', 'inc', 15)), F(mod('attackSpeed', 'inc', -10)), F(mod('stunThreshold', 'inc', 50))],
  },
  {
    id: 'silkshroud', name: 'Shroud of Silk Shadows', base: 'robe', level: 7, weight: 8, flavour: 'Worn by those who were never there.',
    mods: [F(mod('evasion', 'inc', 80)), F(mod('dodgeNoCooldown', 'flag', 1)), F(mod('moveSpeed', 'inc', 10)), D(mod('mana', 'flat', 30))],
  },
  {
    id: 'bloodpact', name: 'Bloodpact Wraps', base: 'wraps', level: 5, weight: 8, flavour: 'Every spell a small sacrifice.',
    mods: [F(mod('bloodMagic', 'flag', 1)), F(mod('damage', 'more', 25, ['spell'])), F(mod('lifeLeech', 'flat', 1.5)), D(mod('life', 'flat', 25))],
  },
  {
    id: 'gripofmaw', name: 'Grip of the Maw', base: 'gauntlets', level: 12, weight: 8, flavour: 'Hungry hands make for a full belly.',
    mods: [F(mod('lifeLeech', 'flat', 2)), F(mod('instantLeech', 'flag', 1)), Pw({ stat: 'addedPhysical', kind: 'flat', value: 2, max: 6, tags: ['attack'] }), F(mod('attackSpeed', 'inc', 8))],
  },
  {
    id: 'sevenleague', name: 'Seven-League Strides', base: 'sandals', level: 3, weight: 10, flavour: 'Took the long way. Arrived first.',
    mods: [F(mod('moveSpeed', 'inc', 30)), F(mod('dodgeCooldown', 'flat', -0.3)), F(mod('cooldownRecovery', 'inc', 10))],
  },
  {
    id: 'ironroot', name: 'Ironroot Greaves', base: 'greaves', level: 14, weight: 8, flavour: 'Rooted. Unmovable. Slightly slow.',
    mods: [F(mod('damage', 'more', 20, ['cond:stationary'])), F(mod('damageTaken', 'more', -15, ['cond:stationary'])), F(mod('cannotBeFrozen', 'flag', 1)), F(mod('moveSpeed', 'inc', -5))],
  },
  {
    id: 'shepherd', name: "The Shepherd's Coil", base: 'chain_belt', level: 10, weight: 8, flavour: 'Every flock needs a wolf to keep it.',
    mods: [F(mod('minionDamage', 'inc', 60)), F(mod('minionLife', 'inc', 40)), F(mod('splitOnKill', 'flat', 15))],
  },
  {
    id: 'brewmaster', name: "Brewmaster's Sash", base: 'sash', level: 2, weight: 10, flavour: 'Smells of a hundred tonics.',
    mods: [F(mod('flaskCharges', 'inc', 60)), F(mod('flaskEffect', 'inc', 40)), D(mod('lifeRegen', 'flat', 3))],
  },
  {
    id: 'eyeofstorm', name: 'Eye of the Storm', base: 'lapis_amulet', level: 8, weight: 8, flavour: 'Calm, at the very center.',
    mods: [F(mod('damage', 'inc', 40, ['lightning'])), F(mod('chain', 'flat', 2)), F(mod('shockChance', 'flat', 20)), F(mod('resLightning', 'flat', 30))],
  },
  {
    id: 'ouroboros', name: 'Ouroboros Loop', base: 'two_stone_ring', level: 16, weight: 6, flavour: 'Ends where it begins, again.',
    mods: [F(mod('cooldownRecovery', 'inc', 30)), F(mod('cost', 'inc', 25)), F(mod('castSpeed', 'inc', 15)), F(mod('attackSpeed', 'inc', 8))],
  },
  {
    id: 'glasscannon', name: 'Glass Lens', base: 'ruby_ring', level: 6, weight: 8, flavour: 'Focuses sunlight. And regret.',
    mods: [F(mod('damage', 'more', 30)), F(mod('damageTaken', 'more', 20)), F(mod('critChance', 'inc', 30))],
  },
  {
    id: 'plaguebearer', name: 'Plaguebearer', base: 'sapphire_ring', level: 9, weight: 8, flavour: 'Generous with what it carries.',
    mods: [F(mod('poisonChance', 'flat', 40)), F(mod('damage', 'inc', 50, ['dot'])), F(mod('ailmentDuration', 'inc', 25)), F(mod('resChaos', 'flat', 20))],
  },
  {
    id: 'avarice', name: "Merchant's Avarice", base: 'topaz_ring', level: 4, weight: 10, flavour: 'Gold sticks to it like rain to glass.',
    mods: [F(mod('goldFind', 'flat', 60)), F(mod('itemRarity', 'flat', 25)), F(mod('itemQuantity', 'flat', 8))],
  },
  {
    id: 'voidlens', name: 'Void Lens', base: 'focus', level: 12, weight: 6, flavour: 'Look through it and something looks back.',
    mods: [F(mod('elementalToChaos', 'flat', 100)), F(mod('damage', 'inc', 50, ['chaos'])), F(mod('poisonChance', 'flat', 25)), F(mod('chaosImmune', 'flag', 1))],
  },
  {
    id: 'lanternhelm', name: "Lamplighter's Cowl", base: 'leather_cap', level: 1, weight: 10, flavour: 'Darkness has learned to keep its distance.',
    mods: [F(mod('lightRadius', 'inc', 60)), F(mod('damage', 'inc', 25, ['fire'])), F(mod('igniteChance', 'flat', 10)), D(mod('life', 'flat', 15))],
  },
  {
    id: 'sporeheart', name: 'Sporeheart', base: 'jade_amulet', level: 10, weight: 6, flavour: 'Everything returns to the mycelium.',
    mods: [F(mod('splitOnKill', 'flat', 30)), F(mod('minionDamage', 'inc', 40)), F(mod('poisonChance', 'flat', 20)), F(mod('lifeRegenPct', 'flat', 1))],
  },
  {
    id: 'executioner_u', name: 'Last Rites', base: 'executioner', level: 20, weight: 5, flavour: 'The verdict was never in doubt.',
    mods: [F(mod('damage', 'more', 40, ['vs:elite'])), F(mod('critChance', 'inc', 40)), F(mod('lifeOnKill', 'flat', 20)), F(mod('stagger', 'inc', 50))],
  },
];

export const UNIQUE_BY_ID: Record<string, UniqueDef> = Object.fromEntries(UNIQUES.map((u) => [u.id, u]));
