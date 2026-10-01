/**
 * Save files: three hero slots, the difficulty tuning and the Workshop bestiary, in localStorage when available
 * (private windows and some file:// contexts refuse it; the game then runs from memory).
 * Everything loaded goes through normalizeHero, so old or hand-edited saves can't break the game.
 */
import { CONFIG_SPEC, config, setConfig, type ConfigKey } from './config';
import { designProblems, type SpeciesDesign } from './content/bestiary';
import { BASES, EQUIP_SLOTS, type EquipSlot, type Item } from './content/items';
import { TREE } from './content/tree';
import { HOTBAR_SKILLS } from './content/skills';
import { HOTBAR_SIZE, INVENTORY_SIZE, newHero, STASH_SIZE, type Hero } from './sim/hero';

export const SAVE_KEY = '3dpixel2d.save.v1';
export const SLOTS = 3;
export const TUNE_KEYS = (Object.keys(CONFIG_SPEC) as ConfigKey[]).filter((k) => k.startsWith('tune.'));

export interface SaveFile {
  version: 1;
  slots: Array<Hero | null>;
  active: number;
  tune: Partial<Record<ConfigKey, number>>;
  /** Species designed in the Workshop (shared by every slot). */
  bestiary: SpeciesDesign[];
}

export const BESTIARY_SIZE = 24;

/** A design from storage, or null when it is broken (unknown parts, bad id). */
export function normalizeDesign(raw: unknown): SpeciesDesign | null {
  if (!isObj(raw)) return null;
  const d: SpeciesDesign = {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 32) : '',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 32) : 'Nameless',
    body: typeof raw.body === 'string' ? raw.body : '',
    seed: Math.round(num(raw.seed, 0, 2 ** 31, 1)),
    genome: isObj(raw.genome) ? (raw.genome as SpeciesDesign['genome']) : undefined,
    archetype: typeof raw.archetype === 'string' ? raw.archetype : '',
    skills: Array.isArray(raw.skills) ? raw.skills.filter((x): x is string => typeof x === 'string').slice(0, 3) : [],
    palette: typeof raw.palette === 'string' ? raw.palette : '',
    size: num(raw.size, 0.6, 1.8, 1),
    released: raw.released === true,
  };
  return designProblems(d).length ? null : d;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);

export function normalizeItem(raw: unknown): Item | null {
  if (!isObj(raw) || typeof raw.base !== 'string' || !BASES[raw.base]) return null;
  const rarity = (['normal', 'magic', 'rare', 'unique'] as const).includes(raw.rarity as never) ? (raw.rarity as Item['rarity']) : 'normal';
  return {
    uid: typeof raw.uid === 'string' ? raw.uid.slice(0, 32) : `i${Math.floor(Math.random() * 1e9)}`,
    base: raw.base,
    rarity,
    ilvl: Math.round(num(raw.ilvl, 1, 100000, 1)),
    name: typeof raw.name === 'string' ? raw.name.slice(0, 60) : BASES[raw.base].name,
    affixes: Array.isArray(raw.affixes)
      ? raw.affixes.filter((a): a is Item['affixes'][number] => isObj(a) && typeof a.id === 'string' && Array.isArray(a.values)).slice(0, 8)
        .map((a) => ({ id: a.id, tier: Math.round(num(a.tier, 1, 10000, 1)), values: a.values.filter((v) => typeof v === 'number').slice(0, 2) }))
      : [],
    unique: typeof raw.unique === 'string' ? raw.unique : undefined,
    quality: Math.round(num(raw.quality, 0, 20, 0)),
    seed: Math.round(num(raw.seed, 0, 2 ** 31, 1)),
    locked: raw.locked === true ? true : undefined,
  };
}

function items(raw: unknown, size: number): Array<Item | null> {
  const list = Array.isArray(raw) ? raw : [];
  const out: Array<Item | null> = new Array(size).fill(null);
  for (let i = 0; i < size; i++) out[i] = normalizeItem(list[i]);
  return out;
}

export function normalizeHero(raw: unknown): Hero {
  const base = newHero();
  if (!isObj(raw)) return base;
  const eq: Partial<Record<EquipSlot, Item>> = {};
  if (isObj(raw.equipment)) for (const s of EQUIP_SLOTS) {
    const it = normalizeItem(raw.equipment[s]);
    if (it) eq[s] = it;
  }
  const tree = Array.isArray(raw.tree) ? raw.tree.filter((id): id is string => typeof id === 'string' && TREE.byId.has(id)) : [];
  const jewels: Record<string, Item> = {};
  if (isObj(raw.jewels)) for (const [k, v] of Object.entries(raw.jewels)) {
    const it = normalizeItem(v);
    if (it && TREE.byId.get(k)?.kind === 'socket') jewels[k] = it;
  }
  const p = isObj(raw.progress) ? raw.progress : {};
  const t = isObj(raw.totals) ? raw.totals : {};
  const hotbar = Array.isArray(raw.hotbar) ? raw.hotbar.slice(0, HOTBAR_SIZE).map((s) => (typeof s === 'string' && HOTBAR_SKILLS.includes(s) ? s : null)) : base.hotbar;
  while (hotbar.length < HOTBAR_SIZE) hotbar.push(null);
  const cleared: Record<string, number> = {};
  if (isObj(p.cleared)) for (const [k, v] of Object.entries(p.cleared)) if (typeof v === 'number') cleared[k] = v;
  return {
    version: 1,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : base.name,
    level: Math.round(num(raw.level, 1, 100000, 1)),
    xp: Math.round(num(raw.xp, 0, 1e15, 0)),
    gold: Math.round(num(raw.gold, 0, 1e15, 0)),
    shards: Math.round(num(raw.shards, 0, 1e12, 0)),
    hotbar,
    equipment: Object.keys(eq).length ? eq : base.equipment,
    inventory: items(raw.inventory, INVENTORY_SIZE),
    stash: items(raw.stash, STASH_SIZE),
    tree,
    jewels,
    flasks: Array.isArray(raw.flasks) ? [num(raw.flasks[0], 0, 1000, 30), num(raw.flasks[1], 0, 1000, 30)] : base.flasks,
    progress: { unlocked: Math.round(num(p.unlocked, 1, 100000, 1)), cleared, endlessBest: Math.round(num(p.endlessBest, 0, 100000, 0)) },
    totals: {
      kills: num(t.kills, 0, 1e12, 0), deaths: num(t.deaths, 0, 1e12, 0), gold: num(t.gold, 0, 1e15, 0),
      frames: num(t.frames, 0, 1e15, 0), elites: num(t.elites, 0, 1e12, 0), bosses: num(t.bosses, 0, 1e12, 0),
    },
    nextUid: Math.round(num(raw.nextUid, 1, 1e12, 1)),
  };
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    s.setItem(`${SAVE_KEY}.probe`, '1');
    s.removeItem(`${SAVE_KEY}.probe`);
    return s;
  } catch {
    return null;
  }
}

export class SaveStore {
  file: SaveFile;
  readonly persistent: boolean;
  private store: Storage | null;

  constructor(store: Storage | null = typeof window !== 'undefined' ? storage() : null) {
    this.store = store;
    this.persistent = !!store;
    let raw: unknown = null;
    try {
      const text = store?.getItem(SAVE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    const r = isObj(raw) ? raw : {};
    const slots = Array.isArray(r.slots) ? r.slots.slice(0, SLOTS).map((s) => (s ? normalizeHero(s) : null)) : [];
    while (slots.length < SLOTS) slots.push(null);
    const tune: SaveFile['tune'] = {};
    if (isObj(r.tune)) for (const k of TUNE_KEYS) if (typeof r.tune[k] === 'number') tune[k] = r.tune[k] as number;
    const bestiary = Array.isArray(r.bestiary) ? r.bestiary.map(normalizeDesign).filter((d): d is SpeciesDesign => !!d).slice(0, BESTIARY_SIZE) : [];
    this.file = { version: 1, slots, active: Math.round(num(r.active, 0, SLOTS - 1, 0)), tune, bestiary };
  }

  write() {
    try {
      this.store?.setItem(SAVE_KEY, JSON.stringify(this.file));
    } catch {
      // Quota or privacy mode: keep playing from memory.
    }
  }

  saveHero(slot: number, hero: Hero) {
    this.file.slots[slot] = hero;
    this.file.active = slot;
    this.write();
  }

  deleteSlot(slot: number) {
    this.file.slots[slot] = null;
    this.write();
  }

  /** Adds or replaces a design (by id). */
  saveDesign(d: SpeciesDesign): string | null {
    const i = this.file.bestiary.findIndex((x) => x.id === d.id);
    if (i < 0 && this.file.bestiary.length >= BESTIARY_SIZE) return `The bestiary holds ${BESTIARY_SIZE} species; release or delete one first.`;
    if (i >= 0) this.file.bestiary[i] = structuredClone(d);
    else this.file.bestiary.push(structuredClone(d));
    this.write();
    return null;
  }

  deleteDesign(id: string) {
    this.file.bestiary = this.file.bestiary.filter((d) => d.id !== id);
    this.write();
  }

  /** Applies saved difficulty to the live config. */
  applyTune() {
    for (const k of TUNE_KEYS) {
      const v = this.file.tune[k];
      try {
        setConfig(k, v ?? CONFIG_SPEC[k].value);
      } catch {
        setConfig(k, CONFIG_SPEC[k].value);
      }
    }
  }

  recordTune() {
    for (const k of TUNE_KEYS) {
      const v = config[k] as number;
      if (v === CONFIG_SPEC[k].value) delete this.file.tune[k];
      else this.file.tune[k] = v;
    }
    this.write();
  }
}
