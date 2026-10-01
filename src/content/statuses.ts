/**
 * Status effects: ailments (ignite, chill, freeze, shock, poison, bleed), buffs (shrines, war
 * cry, flasks) and monster auras. Each is data: optional stat mods (scaled by magnitude), damage
 * over time, movement/action slow, stacking rules and a display color.
 */
import { mod, type DamageType, type Mod } from './stats';

export interface StatusDef {
  id: string;
  name: string;
  kind: 'ailment' | 'buff' | 'debuff';
  color: string;
  /** Mods applied while active; numeric values are multiplied by the status magnitude. */
  mods?: (magnitude: number) => Mod[];
  /** Damage per second per stack (magnitude = DPS). */
  dot?: DamageType;
  /** Fraction of action and movement speed removed (magnitude = percent). */
  slow?: boolean;
  /** Can't act or move. */
  stun?: boolean;
  /** Extra damage taken (magnitude = percent). */
  vulnerable?: boolean;
  /** 'refresh' keeps the strongest; 'stack' adds independent stacks up to maxStacks. */
  stacking: 'refresh' | 'stack';
  maxStacks?: number;
  /** Bleed: more damage while the victim moves. */
  movingMult?: number;
  /** Flasks: recovers magnitude percent of the pool per second. */
  heal?: 'life' | 'mana';
}

export const STATUSES: Record<string, StatusDef> = {
  ignite: { id: 'ignite', name: 'Burning', kind: 'ailment', color: '#ff8a3d', dot: 'fire', stacking: 'refresh' },
  chill: { id: 'chill', name: 'Chilled', kind: 'ailment', color: '#8fd8ff', slow: true, stacking: 'refresh' },
  freeze: { id: 'freeze', name: 'Frozen', kind: 'ailment', color: '#cdf3ff', stun: true, stacking: 'refresh' },
  shock: { id: 'shock', name: 'Shocked', kind: 'ailment', color: '#ffe95c', vulnerable: true, stacking: 'refresh' },
  poison: { id: 'poison', name: 'Poisoned', kind: 'ailment', color: '#8fe36a', dot: 'chaos', stacking: 'stack', maxStacks: 40 },
  bleed: { id: 'bleed', name: 'Bleeding', kind: 'ailment', color: '#d6324a', dot: 'physical', stacking: 'refresh', movingMult: 2 },
  stun: { id: 'stun', name: 'Staggered', kind: 'debuff', color: '#ffffff', stun: true, stacking: 'refresh' },
  slowed: { id: 'slowed', name: 'Slowed', kind: 'debuff', color: '#9f9fbf', slow: true, stacking: 'refresh' },
  // buffs
  rage: {
    id: 'rage', name: 'Rage', kind: 'buff', color: '#ff5a3d', stacking: 'refresh',
    mods: (m) => [mod('damage', 'inc', 25 * m), mod('moveSpeed', 'inc', 12 * m), mod('attackSpeed', 'inc', 10 * m)],
  },
  haste: {
    id: 'haste', name: 'Haste', kind: 'buff', color: '#7fffd4', stacking: 'refresh',
    mods: (m) => [mod('moveSpeed', 'inc', 30 * m), mod('attackSpeed', 'inc', 20 * m), mod('castSpeed', 'inc', 20 * m), mod('cooldownRecovery', 'inc', 25 * m)],
  },
  frenzy: {
    id: 'frenzy', name: 'Frenzy', kind: 'buff', color: '#5aff6a', stacking: 'refresh',
    mods: (m) => [mod('attackSpeed', 'inc', 40 * m), mod('castSpeed', 'inc', 40 * m), mod('critChance', 'inc', 60 * m)],
  },
  power: {
    id: 'power', name: 'Empowered', kind: 'buff', color: '#ffd04d', stacking: 'refresh',
    mods: (m) => [mod('damage', 'more', 60 * m), mod('area', 'inc', 25 * m)],
  },
  fortune: {
    id: 'fortune', name: 'Fortune', kind: 'buff', color: '#ffb84d', stacking: 'refresh',
    mods: (m) => [mod('itemRarity', 'flat', 150 * m), mod('itemQuantity', 'flat', 60 * m), mod('goldFind', 'flat', 100 * m)],
  },
  conduit: {
    id: 'conduit', name: 'Conduit', kind: 'buff', color: '#9fdcff', stacking: 'refresh',
    mods: (m) => [mod('addedLightning', 'flat', 5 * m), mod('shockChance', 'flat', 50 * m), mod('chain', 'flat', 2)],
  },
  fortify: {
    id: 'fortify', name: 'Fortified', kind: 'buff', color: '#c9c9d9', stacking: 'refresh',
    mods: (m) => [mod('damageTaken', 'more', -30 * m), mod('cannotBeStunned', 'flag', 1)],
  },
  regen: {
    id: 'regen', name: 'Regenerating', kind: 'buff', color: '#ff7aa8', stacking: 'refresh',
    mods: (m) => [mod('lifeRegenPct', 'flat', 4 * m)],
  },
  // monster buffs
  empowered: {
    id: 'empowered', name: 'Warded', kind: 'buff', color: '#b388ff', stacking: 'refresh',
    mods: (m) => [mod('damage', 'more', 35 * m), mod('damageTaken', 'more', -30 * m), mod('moveSpeed', 'inc', 15 * m)],
  },
  enraged: {
    id: 'enraged', name: 'Enraged', kind: 'buff', color: '#ff3d3d', stacking: 'refresh',
    mods: (m) => [mod('damage', 'more', 30 * m), mod('attackSpeed', 'inc', 30 * m), mod('castSpeed', 'inc', 30 * m), mod('moveSpeed', 'inc', 20 * m)],
  },
  flask_life: { id: 'flask_life', name: 'Life Flask', kind: 'buff', color: '#ff3a4a', heal: 'life', stacking: 'refresh' },
  flask_mana: { id: 'flask_mana', name: 'Mana Flask', kind: 'buff', color: '#3a6aff', heal: 'mana', stacking: 'refresh' },
  stolen: { id: 'stolen', name: 'Stolen Power', kind: 'buff', color: '#ffe14d', stacking: 'stack', maxStacks: 12 },
  shielded: { id: 'shielded', name: 'Shielded', kind: 'buff', color: '#fff2b0', stacking: 'refresh' },
  shrouded: {
    id: 'shrouded', name: 'Shrouded', kind: 'buff', color: '#5a4a7a', stacking: 'refresh',
    mods: (m) => [mod('damage', 'more', 25 * m), mod('damageTaken', 'more', -20 * m)],
  },
};

export function statusDef(id: string): StatusDef {
  const s = STATUSES[id];
  if (!s) throw new Error(`unknown status "${id}"`);
  return s;
}
