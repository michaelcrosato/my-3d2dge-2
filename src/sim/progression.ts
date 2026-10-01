import {
  TREE,
  KEYSTONES,
  SKILLS,
  type SkillId,
  type StatId,
} from "../content/emberdeep";
import { Rng } from "./rng";
export type Slot = "weapon" | "armor" | "charm";
export interface Item {
  id: string;
  name: string;
  slot: Slot;
  rarity: "common" | "magic" | "rare" | "legendary";
  level: number;
  stats: Partial<Record<StatId, number>>;
  power?: "echo" | "frost" | "siphon";
}
export interface Profile {
  version: 1;
  level: number;
  xp: number;
  gold: number;
  points: number;
  ranks: Record<string, number>;
  keystone: string | null;
  unlocked: SkillId[];
  slots: SkillId[];
  inventory: Item[];
  equipped: Record<Slot, string | null>;
  deepest: number;
  kills: number;
  deaths: number;
  potions: number;
  serial: number;
  mastery: Record<string, number>;
}
export function freshProfile(): Profile {
  return {
    version: 1,
    level: 1,
    xp: 0,
    gold: 0,
    points: 3,
    ranks: {},
    keystone: null,
    unlocked: ["cleave", "whirlwind", "frost"],
    slots: ["whirlwind", "frost", "lunge", "storm"],
    inventory: [],
    equipped: { weapon: null, armor: null, charm: null },
    deepest: 1,
    kills: 0,
    deaths: 0,
    potions: 3,
    serial: 0,
    mastery: {},
  };
}
export const xpNeeded = (level: number) =>
  Math.floor(75 + level * 40 + Math.pow(level, 1.4) * 15);
export function awardXP(p: Profile, amount: number): number {
  p.xp += Math.floor(amount);
  let levels = 0;
  while (p.xp >= xpNeeded(p.level)) {
    p.xp -= xpNeeded(p.level);
    p.level++;
    p.points += 2;
    levels++;
  }
  return levels;
}
export function learn(p: Profile, id: string) {
  const n = TREE.find((n) => n.id === id);
  if (
    !n ||
    !p.points ||
    (p.ranks[id] ?? 0) >= n.max ||
    (n.requires && !p.ranks[n.requires])
  )
    throw new Error("Node is locked, full, or needs a skill point.");
  p.points--;
  p.ranks[id] = (p.ranks[id] ?? 0) + 1;
  if (n.unlock && !p.unlocked.includes(n.unlock)) p.unlocked.push(n.unlock);
}
export function chooseKeystone(p: Profile, id: string) {
  const k = KEYSTONES.find((k) => k.id === id);
  if (
    !k ||
    TREE.filter((n) => n.branch === k.branch).reduce(
      (s, n) => s + (p.ranks[n.id] ?? 0),
      0,
    ) < 10
  )
    throw new Error("Spend 10 points in the branch first.");
  p.keystone = id;
}
export function master(p: Profile, skill: SkillId) {
  if (!p.unlocked.includes(skill) || !p.points)
    throw new Error("Mastery needs an unlocked skill and a skill point.");
  p.points--;
  p.mastery[skill] = (p.mastery[skill] ?? 0) + 1;
}
export function statsOf(p: Profile): Record<StatId, number> {
  const s = {
      damage: 18 + p.level * 2,
      health: 120 + (p.level - 1) * 7,
      crit: 0.06,
      armor: 0,
      mana: 100,
      speed: 1,
      leech: 0,
      xp: 1,
      cooldown: 1,
    },
    additive: Partial<Record<StatId, number>> = {};
  for (const n of TREE)
    additive[n.stat] = (additive[n.stat] ?? 0) + n.value * (p.ranks[n.id] ?? 0);
  s.damage *= 1 + (additive.damage ?? 0);
  for (const key of Object.keys(s) as StatId[])
    if (key !== "damage")
      s[key] +=
        key === "cooldown" ? -(additive[key] ?? 0) : (additive[key] ?? 0);
  for (const id of Object.values(p.equipped)) {
    const item = p.inventory.find((i) => i.id === id);
    if (item)
      for (const [key, value] of Object.entries(item.stats))
        s[key as StatId] += value!;
  }
  if (p.keystone === "blood") {
    s.health *= 0.8;
    s.leech *= 2;
  }
  if (p.keystone === "iron") s.armor += 0.25;
  s.armor = Math.min(0.7, s.armor);
  s.crit = Math.min(0.75, s.crit);
  s.cooldown = Math.max(0.25, s.cooldown);
  return s;
}
export function rollItem(p: Profile, depth: number, rng: Rng, bonus = 0): Item {
  const r = rng.next() + bonus,
    rarity: Item["rarity"] =
      r > 0.97
        ? "legendary"
        : r > 0.73
          ? "rare"
          : r > 0.32
            ? "magic"
            : "common",
    slot: Slot = (["weapon", "armor", "charm"] as const)[
      Math.floor(rng.next() * 3)
    ],
    q = { common: 1, magic: 1.3, rare: 1.7, legendary: 2.3 }[rarity],
    scale = Math.min(1000, 2 + depth * 0.38) * q;
  const stats: Item["stats"] =
    slot === "weapon"
      ? { damage: Math.round(scale * rng.range(1.3, 2.2)) }
      : slot === "armor"
        ? {
            health: Math.round(scale * 5),
            armor: Math.min(0.15, scale * 0.002),
          }
        : { crit: Math.min(0.12, scale * 0.003), mana: Math.round(scale * 2) };
  if (rarity === "rare" || rarity === "legendary") stats.leech = 0.01 * q;
  const power =
    rarity === "legendary"
      ? (["echo", "frost", "siphon"] as const)[Math.floor(rng.next() * 3)]
      : undefined;
  return {
    id: `item_${++p.serial}`,
    name: `${{ common: "Worn", magic: "Runed", rare: "Exalted", legendary: "Mythic" }[rarity]} ${slot === "weapon" ? "Edge" : slot === "armor" ? "Mantle" : "Sigil"}`,
    slot,
    rarity,
    level: depth,
    stats,
    ...(power ? { power } : {}),
  };
}
export function equip(p: Profile, id: string) {
  const item = p.inventory.find((i) => i.id === id);
  if (!item) throw new Error("Item not found.");
  p.equipped[item.slot] = id;
}
export function salvage(p: Profile, id: string) {
  const item = p.inventory.find((i) => i.id === id);
  if (!item) throw new Error("Item not found.");
  p.gold += Math.max(
    3,
    Math.floor(
      3 +
        item.level *
          { common: 1, magic: 2, rare: 4, legendary: 8 }[item.rarity],
    ),
  );
  if (p.equipped[item.slot] === id) p.equipped[item.slot] = null;
  p.inventory = p.inventory.filter((i) => i.id !== id);
}
export function parseProfile(raw: unknown): Profile {
  const p = structuredClone(raw) as Profile,
    integer = (n: unknown, lo = 0, hi = 1e9) =>
      typeof n === "number" && Number.isSafeInteger(n) && n >= lo && n <= hi;
  if (
    !p ||
    p.version !== 1 ||
    !integer(p.level, 1, 1000000) ||
    !integer(p.xp) ||
    p.xp >= xpNeeded(p.level) ||
    !integer(p.gold) ||
    !integer(p.points) ||
    !integer(p.deepest, 1, 1000000) ||
    !integer(p.kills) ||
    !integer(p.deaths) ||
    !integer(p.potions, 0, 3) ||
    !integer(p.serial) ||
    !p.ranks ||
    !p.mastery ||
    !Array.isArray(p.inventory) ||
    p.inventory.length > 80 ||
    !Array.isArray(p.unlocked) ||
    !Array.isArray(p.slots) ||
    p.slots.length !== 4 ||
    !p.equipped
  )
    throw new Error("Invalid profile.");
  for (const [id, rank] of Object.entries(p.ranks)) {
    const n = TREE.find((n) => n.id === id);
    if (
      !n ||
      !integer(rank, 0, n.max) ||
      (rank && n.requires && !p.ranks[n.requires])
    )
      throw new Error("Invalid skill rank.");
  }
  const expected = [
    "cleave",
    "whirlwind",
    "frost",
    ...TREE.filter((n) => p.ranks[n.id] && n.unlock).map((n) => n.unlock!),
  ];
  if (
    p.unlocked.some((id) => !expected.includes(id)) ||
    !["cleave", "whirlwind", "frost"].every((id) =>
      p.unlocked.includes(id as SkillId),
    ) ||
    p.slots.some((id) => !(id in SKILLS)) ||
    Object.entries(p.mastery).some(
      ([id, rank]) => !p.unlocked.includes(id as SkillId) || !integer(rank),
    )
  )
    throw new Error("Invalid skills.");
  if (p.keystone !== null) {
    const k = KEYSTONES.find((k) => k.id === p.keystone);
    if (
      !k ||
      TREE.filter((n) => n.branch === k.branch).reduce(
        (s, n) => s + (p.ranks[n.id] ?? 0),
        0,
      ) < 10
    )
      throw new Error("Invalid keystone.");
  }
  const ids = new Set<string>();
  for (const item of p.inventory) {
    if (
      !item ||
      typeof item.id !== "string" ||
      ids.has(item.id) ||
      typeof item.name !== "string" ||
      item.name.length > 100 ||
      !["weapon", "armor", "charm"].includes(item.slot) ||
      !["common", "magic", "rare", "legendary"].includes(item.rarity) ||
      !integer(item.level, 0, 1000000) ||
      !item.stats ||
      (item.power && !["echo", "frost", "siphon"].includes(item.power))
    )
      throw new Error("Invalid item.");
    ids.add(item.id);
    for (const [key, value] of Object.entries(item.stats))
      if (
        ![
          "damage",
          "health",
          "crit",
          "armor",
          "mana",
          "speed",
          "leech",
          "xp",
          "cooldown",
        ].includes(key) ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100000
      )
        throw new Error("Invalid item stat.");
  }
  for (const slot of ["weapon", "armor", "charm"] as const)
    if (
      p.equipped[slot] !== null &&
      !p.inventory.some((i) => i.id === p.equipped[slot] && i.slot === slot)
    )
      throw new Error("Invalid equipped item.");
  return p;
}
