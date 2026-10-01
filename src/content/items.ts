/**
 * Item bases: what can drop, which slot it goes in, its base numbers and how it looks.
 * Base values are at item level 1 and scale with the shared power curves (sim/scaling.ts), so a
 * level-300 Rusted Sword is still a sensible weapon: item level, not base tier, carries power.
 * Bases differ in feel (speed, crit, reach, block, implicit mods) and in their procedural mesh.
 */
import { mod, type Mod } from './stats';

export type SlotKind = 'weapon' | 'offhand' | 'helmet' | 'chest' | 'gloves' | 'boots' | 'belt' | 'amulet' | 'ring' | 'flask' | 'jewel';
export type EquipSlot = 'weapon' | 'offhand' | 'helmet' | 'chest' | 'gloves' | 'boots' | 'belt' | 'amulet' | 'ring1' | 'ring2' | 'flask1' | 'flask2';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2', 'flask1', 'flask2'];
export const SLOT_KIND: Record<EquipSlot, SlotKind> = {
  weapon: 'weapon', offhand: 'offhand', helmet: 'helmet', chest: 'chest', gloves: 'gloves', boots: 'boots', belt: 'belt',
  amulet: 'amulet', ring1: 'ring', ring2: 'ring', flask1: 'flask', flask2: 'flask',
};
export const SLOT_LABEL: Record<EquipSlot, string> = {
  weapon: 'Weapon', offhand: 'Off-hand', helmet: 'Helmet', chest: 'Body Armour', gloves: 'Gloves', boots: 'Boots', belt: 'Belt',
  amulet: 'Amulet', ring1: 'Ring', ring2: 'Ring', flask1: 'Life Flask', flask2: 'Mana Flask',
};

export const KIND_LABEL: Record<SlotKind, string> = {
  weapon: 'Weapon', offhand: 'Off-hand', helmet: 'Helmet', chest: 'Body Armour', gloves: 'Gloves', boots: 'Boots', belt: 'Belt',
  amulet: 'Amulet', ring: 'Ring', flask: 'Flask', jewel: 'Jewel',
};

export type ItemRarity = 'normal' | 'magic' | 'rare' | 'unique';
export const RARITY_COLOR: Record<ItemRarity, string> = { normal: '#e8e4da', magic: '#8888ff', rare: '#ffff77', unique: '#ff9a3d' };

export type WeaponClass = 'sword' | 'axe' | 'mace' | 'dagger' | 'greatsword' | 'staff';

export interface ItemBase {
  id: string;
  name: string;
  slot: SlotKind;
  /** Minimum item level to drop. */
  level: number;
  weapon?: { cls: WeaponClass; phys: [number, number]; speed: number; crit: number; twoHanded?: boolean; reach?: number };
  armour?: { armor?: number; evasion?: number; block?: number };
  flask?: { kind: 'life' | 'mana'; amount: number; duration: number; charges: number; perUse: number };
  implicit?: Mod[];
  /** Procedural mesh recipe and colors (render/itemMeshes.ts). */
  look: { shape: string; color: string; accent: string; size?: number };
  /** Gold value multiplier. */
  value?: number;
}

const W = (id: string, name: string, level: number, cls: WeaponClass, phys: [number, number], speed: number, crit: number, look: ItemBase['look'], extra: Partial<ItemBase> = {}): ItemBase =>
  ({ id, name, slot: 'weapon', level, weapon: { cls, phys, speed, crit, twoHanded: cls === 'greatsword' || cls === 'staff' }, look, ...extra });

export const ITEM_BASES: ItemBase[] = [
  // ---- weapons
  W('rusted_sword', 'Rusted Sword', 1, 'sword', [5, 10], 1.0, 5, { shape: 'sword', color: '#a89f94', accent: '#6a4a2a' }),
  W('broad_sword', 'Broad Sword', 6, 'sword', [6, 11], 0.95, 5, { shape: 'sword', color: '#d9dde6', accent: '#c9a13b', size: 1.1 }),
  W('war_sword', 'War Sword', 14, 'sword', [6, 14], 1.0, 6, { shape: 'sword', color: '#e8eef6', accent: '#8a2a2a', size: 1.15 }, { implicit: [mod('critChance', 'inc', 15)] }),
  W('hand_axe', 'Hand Axe', 3, 'axe', [5, 12], 0.92, 5, { shape: 'axe', color: '#b8b0a4', accent: '#5a3a24' }, { implicit: [mod('bleedChance', 'flat', 10)] }),
  W('war_axe', 'War Axe', 16, 'axe', [8, 17], 0.9, 5, { shape: 'axe', color: '#c8ccd4', accent: '#3a2a1a', size: 1.2 }, { implicit: [mod('bleedChance', 'flat', 15)] }),
  W('club', 'Spiked Club', 2, 'mace', [6, 10], 0.88, 4, { shape: 'mace', color: '#7a5a3a', accent: '#a8a8a8' }, { implicit: [mod('stagger', 'inc', 25)] }),
  W('flanged_mace', 'Flanged Mace', 12, 'mace', [9, 14], 0.86, 4, { shape: 'mace', color: '#b0b6c0', accent: '#5a3a24', size: 1.15 }, { implicit: [mod('stagger', 'inc', 40)] }),
  W('dirk', 'Dirk', 2, 'dagger', [3, 8], 1.25, 7, { shape: 'dagger', color: '#d0d4dc', accent: '#3a2a1a' }, { implicit: [mod('critChance', 'inc', 30)] }),
  W('kris', 'Kris', 18, 'dagger', [4, 11], 1.25, 8, { shape: 'dagger', color: '#e8e0b0', accent: '#5a1a3a' }, { implicit: [mod('critMulti', 'flat', 20)] }),
  W('greatsword', 'Greatsword', 5, 'greatsword', [10, 19], 0.82, 5, { shape: 'greatsword', color: '#c8ccd4', accent: '#4a3a2a', size: 1.35 }, { implicit: [mod('area', 'inc', 15)] }),
  W('executioner', "Executioner's Blade", 20, 'greatsword', [14, 26], 0.8, 6, { shape: 'greatsword', color: '#5a5a66', accent: '#8a1a1a', size: 1.45 }, { implicit: [mod('area', 'inc', 20), mod('damage', 'inc', 15, ['vs:boss'])] }),
  W('gnarled_staff', 'Gnarled Staff', 3, 'staff', [5, 10], 0.95, 6, { shape: 'staff', color: '#6a4a2a', accent: '#8fd8ff', size: 1.3 }, { implicit: [mod('damage', 'inc', 25, ['spell'])] }),
  W('runed_staff', 'Runed Staff', 15, 'staff', [7, 14], 0.95, 7, { shape: 'staff', color: '#3a3a4a', accent: '#c77dff', size: 1.35 }, { implicit: [mod('damage', 'inc', 40, ['spell']), mod('castSpeed', 'inc', 10)] }),
  // ---- off-hands
  { id: 'buckler', name: 'Buckler', slot: 'offhand', level: 1, armour: { evasion: 18, block: 18 }, look: { shape: 'shield_round', color: '#7a5a3a', accent: '#a8a8a8' } },
  { id: 'kite_shield', name: 'Kite Shield', slot: 'offhand', level: 10, armour: { armor: 30, block: 24 }, look: { shape: 'shield_kite', color: '#5a6a8a', accent: '#c9a13b' } },
  { id: 'tower_shield', name: 'Tower Shield', slot: 'offhand', level: 20, armour: { armor: 50, block: 28 }, implicit: [mod('life', 'flat', 20)], look: { shape: 'shield_tower', color: '#6a6a72', accent: '#3a3a42' } },
  { id: 'focus', name: 'Spirit Focus', slot: 'offhand', level: 6, implicit: [mod('damage', 'inc', 20, ['spell']), mod('mana', 'flat', 15)], look: { shape: 'orb', color: '#8fd8ff', accent: '#3a3a5a' } },
  // ---- armour
  { id: 'leather_cap', name: 'Leather Cap', slot: 'helmet', level: 1, armour: { evasion: 14 }, look: { shape: 'cap', color: '#7a5a3a', accent: '#4a3020' } },
  { id: 'iron_helm', name: 'Iron Helm', slot: 'helmet', level: 8, armour: { armor: 18 }, look: { shape: 'helm', color: '#9aa0aa', accent: '#5a5a62' } },
  { id: 'circlet', name: 'Silver Circlet', slot: 'helmet', level: 12, implicit: [mod('mana', 'flat', 25)], armour: { evasion: 6 }, look: { shape: 'circlet', color: '#d8dce4', accent: '#8fd8ff' } },
  { id: 'great_helm', name: 'Great Helm', slot: 'helmet', level: 22, armour: { armor: 34 }, look: { shape: 'greathelm', color: '#8a8f9a', accent: '#c9a13b' } },
  { id: 'padded_vest', name: 'Padded Vest', slot: 'chest', level: 1, armour: { evasion: 24 }, look: { shape: 'vest', color: '#7a6a4a', accent: '#4a3a2a' } },
  { id: 'chainmail', name: 'Chainmail', slot: 'chest', level: 9, armour: { armor: 30, evasion: 12 }, look: { shape: 'mail', color: '#a0a6b0', accent: '#5a5a62' } },
  { id: 'robe', name: 'Silk Robe', slot: 'chest', level: 7, implicit: [mod('mana', 'flat', 30), mod('manaRegen', 'inc', 20)], armour: { evasion: 10 }, look: { shape: 'robe', color: '#4a3a7a', accent: '#c9a13b' } },
  { id: 'plate', name: 'Full Plate', slot: 'chest', level: 18, armour: { armor: 58 }, implicit: [mod('moveSpeed', 'inc', -3)], look: { shape: 'plate', color: '#b8bec8', accent: '#c9a13b' } },
  { id: 'wraps', name: 'Cloth Wraps', slot: 'gloves', level: 1, armour: { evasion: 8 }, look: { shape: 'gloves', color: '#8a7a5a', accent: '#5a4a3a' } },
  { id: 'gauntlets', name: 'Gauntlets', slot: 'gloves', level: 10, armour: { armor: 14 }, look: { shape: 'gauntlets', color: '#9aa0aa', accent: '#5a5a62' } },
  { id: 'sorcerer_gloves', name: "Sorcerer's Gloves", slot: 'gloves', level: 16, implicit: [mod('castSpeed', 'inc', 8)], armour: { evasion: 6 }, look: { shape: 'gloves', color: '#3a3a6a', accent: '#c77dff' } },
  { id: 'sandals', name: 'Sandals', slot: 'boots', level: 1, armour: { evasion: 8 }, implicit: [mod('moveSpeed', 'inc', 3)], look: { shape: 'boots', color: '#8a6a4a', accent: '#5a4a3a' } },
  { id: 'leather_boots', name: 'Leather Boots', slot: 'boots', level: 6, armour: { evasion: 14 }, look: { shape: 'boots', color: '#6a4a2a', accent: '#3a2a1a' } },
  { id: 'greaves', name: 'Iron Greaves', slot: 'boots', level: 14, armour: { armor: 18 }, look: { shape: 'greaves', color: '#9aa0aa', accent: '#5a5a62' } },
  { id: 'sash', name: 'Rope Sash', slot: 'belt', level: 1, implicit: [mod('flaskCharges', 'inc', 15)], look: { shape: 'belt', color: '#8a7a5a', accent: '#c9a13b' } },
  { id: 'heavy_belt', name: 'Heavy Belt', slot: 'belt', level: 8, implicit: [mod('str', 'flat', 15)], look: { shape: 'belt', color: '#5a3a24', accent: '#9aa0aa' } },
  { id: 'chain_belt', name: 'Chain Belt', slot: 'belt', level: 16, implicit: [mod('life', 'flat', 25)], look: { shape: 'belt', color: '#9aa0aa', accent: '#5a5a62' } },
  { id: 'jade_amulet', name: 'Jade Amulet', slot: 'amulet', level: 1, implicit: [mod('dex', 'flat', 12)], look: { shape: 'amulet', color: '#c9a13b', accent: '#3ad07a' } },
  { id: 'amber_amulet', name: 'Amber Amulet', slot: 'amulet', level: 1, implicit: [mod('str', 'flat', 12)], look: { shape: 'amulet', color: '#c9a13b', accent: '#ff9a3d' } },
  { id: 'lapis_amulet', name: 'Lapis Amulet', slot: 'amulet', level: 1, implicit: [mod('int', 'flat', 12)], look: { shape: 'amulet', color: '#c9a13b', accent: '#3a6aff' } },
  { id: 'iron_ring', name: 'Iron Ring', slot: 'ring', level: 1, implicit: [{ stat: 'addedPhysical', kind: 'flat', value: 1, max: 4, tags: ['attack'] }], look: { shape: 'ring', color: '#8a8f9a', accent: '#5a5a62' } },
  { id: 'ruby_ring', name: 'Ruby Ring', slot: 'ring', level: 4, implicit: [mod('resFire', 'flat', 20)], look: { shape: 'ring', color: '#c9a13b', accent: '#ff3a3a' } },
  { id: 'sapphire_ring', name: 'Sapphire Ring', slot: 'ring', level: 4, implicit: [mod('resCold', 'flat', 20)], look: { shape: 'ring', color: '#c9a13b', accent: '#3a6aff' } },
  { id: 'topaz_ring', name: 'Topaz Ring', slot: 'ring', level: 4, implicit: [mod('resLightning', 'flat', 20)], look: { shape: 'ring', color: '#c9a13b', accent: '#ffe95c' } },
  { id: 'two_stone_ring', name: 'Two-Stone Ring', slot: 'ring', level: 16, implicit: [mod('resFire', 'flat', 12), mod('resCold', 'flat', 12)], look: { shape: 'ring', color: '#d8dce4', accent: '#c77dff' } },
  // ---- flasks
  { id: 'life_flask', name: 'Life Flask', slot: 'flask', level: 1, flask: { kind: 'life', amount: 45, duration: 2.5, charges: 30, perUse: 10 }, look: { shape: 'flask', color: '#ff3a4a', accent: '#c9a13b' } },
  { id: 'mana_flask', name: 'Mana Flask', slot: 'flask', level: 1, flask: { kind: 'mana', amount: 60, duration: 3, charges: 30, perUse: 8 }, look: { shape: 'flask', color: '#3a6aff', accent: '#c9a13b' } },
  { id: 'jewel', name: 'Cobalt Jewel', slot: 'jewel', level: 1, look: { shape: 'jewel', color: '#3a6aff', accent: '#bfeaff' } },
  { id: 'jewel_crimson', name: 'Crimson Jewel', slot: 'jewel', level: 1, look: { shape: 'jewel', color: '#d6324a', accent: '#ffc0c8' } },
  { id: 'jewel_viridian', name: 'Viridian Jewel', slot: 'jewel', level: 1, look: { shape: 'jewel', color: '#3ad07a', accent: '#c8ffd8' } },
];

export const BASES: Record<string, ItemBase> = Object.fromEntries(ITEM_BASES.map((b) => [b.id, b]));

export function itemBase(id: string): ItemBase {
  const b = BASES[id];
  if (!b) throw new Error(`unknown item base "${id}"`);
  return b;
}

/** One rolled affix: which affix, which tier it rolled and the rolled value(s). */
export interface AffixRoll {
  id: string;
  tier: number;
  values: number[];
}

export interface Item {
  uid: string;
  base: string;
  rarity: ItemRarity;
  ilvl: number;
  name: string;
  affixes: AffixRoll[];
  unique?: string;
  /** 0-20 percent; raises base damage / defences (blacksmith). */
  quality: number;
  /** Visual / roll seed. */
  seed: number;
  /** Jewels and corrupted items can't be modified further. */
  locked?: boolean;
}

export function canEquip(item: Item, slot: EquipSlot): boolean {
  return itemBase(item.base).slot === SLOT_KIND[slot];
}

/** Default kit for a new hero. */
export function starterKit(): Partial<Record<EquipSlot, Item>> {
  const mk = (base: string, uid: string): Item => ({ uid, base, rarity: 'normal', ilvl: 1, name: itemBase(base).name, affixes: [], quality: 0, seed: 1 });
  return { weapon: mk('rusted_sword', 'start-weapon'), flask1: mk('life_flask', 'start-flask1'), flask2: mk('mana_flask', 'start-flask2') };
}
