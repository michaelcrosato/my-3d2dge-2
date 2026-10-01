import type { Level } from "./level";
import { Rng } from "../sim/rng";
export type CameraMode = "iso" | "side" | "top";
export type RigKind = "ranger" | "husk" | "brute" | "spider" | "wisp" | "slime";
export interface MonsterDef {
  label: string;
  rig: RigKind;
  hp: number;
  damage: number;
  speed: number;
  range: number;
  windup: number;
  cooldown: number;
  behavior: "chase" | "orbit" | "charge" | "ranged" | "split";
}
export const MONSTERS: Record<string, MonsterDef> = {
  husk: {
    label: "Ash husk",
    rig: "husk",
    hp: 38,
    damage: 12,
    speed: 0.68,
    range: 1.4,
    windup: 0.5,
    cooldown: 1.25,
    behavior: "chase",
  },
  duelist: {
    label: "Cinder duelist",
    rig: "husk",
    hp: 48,
    damage: 18,
    speed: 0.95,
    range: 1.7,
    windup: 0.38,
    cooldown: 1.1,
    behavior: "orbit",
  },
  brute: {
    label: "Iron brute",
    rig: "brute",
    hp: 115,
    damage: 27,
    speed: 0.48,
    range: 2.3,
    windup: 0.9,
    cooldown: 2.2,
    behavior: "charge",
  },
  crawler: {
    label: "Glass crawler",
    rig: "spider",
    hp: 30,
    damage: 10,
    speed: 1.05,
    range: 1.2,
    windup: 0.4,
    cooldown: 1,
    behavior: "chase",
  },
  seer: {
    label: "Hollow seer",
    rig: "wisp",
    hp: 42,
    damage: 16,
    speed: 0.55,
    range: 8,
    windup: 0.85,
    cooldown: 2,
    behavior: "ranged",
  },
  slime: {
    label: "Mireheart",
    rig: "slime",
    hp: 55,
    damage: 14,
    speed: 0.5,
    range: 1.6,
    windup: 0.6,
    cooldown: 1.4,
    behavior: "split",
  },
};
export const BOSSES = [
  { label: "Furnace Warden", base: "brute" },
  { label: "Brood Sovereign", base: "crawler" },
  { label: "Unlit Oracle", base: "seer" },
];
export const THEMES = [
  {
    id: "cinder",
    floor: "#38323d",
    tile: "#443944",
    wall: "#62505a",
    cap: "#967b78",
    background: "#13121b",
    accent: "#ffac64",
    enemy: "#ca6a62",
    light: "#ffad72",
  },
  {
    id: "verdigris",
    floor: "#283e3b",
    tile: "#344c45",
    wall: "#48645a",
    cap: "#7b9e82",
    background: "#111c1c",
    accent: "#b1efa6",
    enemy: "#78b990",
    light: "#86f5be",
  },
  {
    id: "amethyst",
    floor: "#373047",
    tile: "#443751",
    wall: "#624768",
    cap: "#ac85aa",
    background: "#181222",
    accent: "#d69dfb",
    enemy: "#a17dcc",
    light: "#c28afd",
  },
  {
    id: "glacier",
    floor: "#2c3b4a",
    tile: "#34485a",
    wall: "#496b80",
    cap: "#89b6c3",
    background: "#111b25",
    accent: "#8de7ed",
    enemy: "#77b4cd",
    light: "#9eefff",
  },
];
export const MECHANICS = [
  {
    id: "powder",
    label: "Powder Kegs",
    tip: "Strike a keg to blast a pack.",
    color: "#ff995c",
  },
  {
    id: "gale",
    label: "Gale Lanes",
    tip: "Cross the lanes for speed and stamina.",
    color: "#d5ecba",
  },
  {
    id: "frost",
    label: "Frost Sigils",
    tip: "Lure enemies onto frost to freeze them.",
    color: "#a0eafa",
  },
  {
    id: "ember",
    label: "Ember Forges",
    tip: "Fire burns both sides. Forge heat boosts your damage.",
    color: "#ff6e46",
  },
  {
    id: "well",
    label: "Time Wells",
    tip: "Wells hasten skill recovery and slow enemy attacks.",
    color: "#bfabff",
  },
  {
    id: "storm",
    label: "Storm Pylons",
    tip: "Strike a pylon to chain lightning through a pack.",
    color: "#e6e496",
  },
  {
    id: "brood",
    label: "Brood Nests",
    tip: "Nests spawn crawlers. Break them or farm them.",
    color: "#9bc784",
  },
  {
    id: "blood",
    label: "Blood Altars",
    tip: "Trade a little life for a large damage boost.",
    color: "#e36980",
  },
  {
    id: "echo",
    label: "Echo Mirrors",
    tip: "Fight near mirrors for stronger strikes.",
    color: "#dbadfb",
  },
  {
    id: "gravity",
    label: "Gravity Runes",
    tip: "Runes gather enemies for area attacks.",
    color: "#8faff5",
  },
  {
    id: "spring",
    label: "Launch Plates",
    tip: "Plates refill stamina and grant speed.",
    color: "#b6e5b3",
  },
  {
    id: "gold",
    label: "Gilded Seals",
    tip: "Slay enemies near seals for richer drops.",
    color: "#ffdc82",
  },
] as const;
export type MechanicId = (typeof MECHANICS)[number]["id"];
export const SKILLS = {
  cleave: {
    label: "Cleave",
    cost: 0,
    cooldown: 0.23,
    damage: 1,
    radius: 2.35,
    kind: "cone",
    color: "#fff4bf",
  },
  whirlwind: {
    label: "Whirlwind",
    cost: 24,
    cooldown: 3,
    damage: 1.8,
    radius: 3.2,
    kind: "spin",
    color: "#ffa567",
  },
  frost: {
    label: "Frost Nova",
    cost: 28,
    cooldown: 5,
    damage: 1.3,
    radius: 4,
    kind: "nova",
    color: "#9bdef6",
  },
  lunge: {
    label: "Sundering Lunge",
    cost: 18,
    cooldown: 2,
    damage: 2.3,
    radius: 3.8,
    kind: "leap",
    color: "#d4fbb7",
  },
  storm: {
    label: "Chain Storm",
    cost: 32,
    cooldown: 5,
    damage: 2.1,
    radius: 7,
    kind: "bolt",
    color: "#e9d695",
  },
  meteor: {
    label: "Starfall",
    cost: 40,
    cooldown: 8,
    damage: 4,
    radius: 4.5,
    kind: "nova",
    color: "#ff6850",
  },
  siphon: {
    label: "Soul Siphon",
    cost: 22,
    cooldown: 7,
    damage: 1.7,
    radius: 3.2,
    kind: "heal",
    color: "#ce91d6",
  },
  blades: {
    label: "Blade Ward",
    cost: 30,
    cooldown: 6,
    damage: 2.5,
    radius: 4.2,
    kind: "spin",
    color: "#bfdae1",
  },
} as const;
export type SkillId = keyof typeof SKILLS;
export type StatId =
  | "damage"
  | "health"
  | "crit"
  | "armor"
  | "mana"
  | "speed"
  | "leech"
  | "xp"
  | "cooldown";
export interface TreeNode {
  id: string;
  branch: "blade" | "ward" | "arcane";
  tier: number;
  lane: number;
  label: string;
  stat: StatId;
  value: number;
  max: number;
  requires: string | null;
  unlock?: SkillId;
}
const branchStats: Record<TreeNode["branch"], [StatId, StatId, StatId]> = {
  blade: ["damage", "crit", "leech"],
  ward: ["health", "armor", "speed"],
  arcane: ["mana", "cooldown", "xp"],
};
const values: Record<StatId, number> = {
  damage: 0.07,
  health: 9,
  crit: 0.025,
  armor: 0.025,
  mana: 6,
  speed: 0.025,
  leech: 0.012,
  xp: 0.06,
  cooldown: 0.025,
};
const titles = {
  blade: ["Edge", "Precision", "Blood"],
  ward: ["Vitality", "Iron", "Momentum"],
  arcane: ["Reservoir", "Tempo", "Insight"],
};
export const TREE: TreeNode[] = (["blade", "ward", "arcane"] as const).flatMap(
  (branch) =>
    Array.from({ length: 6 }, (_, tier) =>
      Array.from({ length: 3 }, (_, lane) => {
        const stat = branchStats[branch][lane];
        const unlock =
          tier === 1 && lane === 0
            ? ({ blade: "lunge", ward: "siphon", arcane: "storm" } as const)[
                branch
              ]
            : tier === 3 && lane === 1
              ? (
                  { blade: "blades", ward: "blades", arcane: "meteor" } as const
                )[branch]
              : undefined;
        return {
          id: `${branch}_${tier}_${lane}`,
          branch,
          tier,
          lane,
          label: `${titles[branch][lane]} ${tier + 1}`,
          stat,
          value: values[stat],
          max: 5,
          requires: tier ? `${branch}_${tier - 1}_${lane}` : null,
          unlock,
        };
      }),
    ).flat(),
);
export const KEYSTONES = [
  {
    id: "blood",
    label: "Blood Edge",
    tip: "Double life steal; 20% less maximum life.",
    branch: "blade",
  },
  {
    id: "iron",
    label: "Iron Heart",
    tip: "25% more armor; rolls cost 10 more stamina.",
    branch: "ward",
  },
  {
    id: "overload",
    label: "Overload",
    tip: "50% more spell damage; 35% higher mana costs.",
    branch: "arcane",
  },
] as const;
export const NPCS = [
  { id: "smith", label: "Orin · Forge", x: -5, z: -3 },
  { id: "mystic", label: "Vela · Skills", x: 4.5, z: -4 },
  { id: "merchant", label: "Mara · Supplies", x: -5, z: 3 },
];
export interface Spawn {
  id: string;
  archetype: string;
  x: number;
  z: number;
  elite: boolean;
  boss: string | null;
  scale: number;
}
export interface Feature {
  id: string;
  mechanic: MechanicId;
  x: number;
  z: number;
  radius: number;
  hp: number;
  ready: number;
}
export interface Encounter {
  depth: number;
  seed: number;
  name: string;
  camera: CameraMode;
  theme: number;
  level: Level;
  enemies: Spawn[];
  features: Feature[];
  mechanics: MechanicId[];
  exit: { x: number; z: number };
}
export function generateEncounter(depth: number, seed: number): Encounter {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > 1_000_000)
    throw new Error("Depth must be an integer from 0 to 1000000.");
  const rng = new Rng((seed + depth * 7919) >>> 0),
    camera: CameraMode =
      depth && depth % 4 === 2 ? "side" : depth % 4 === 3 ? "top" : "iso";
  const theme = depth ? Math.floor(rng.next() * THEMES.length) : 0,
    t = THEMES[theme];
  const width = camera === "side" ? 34 : 24,
    length = camera === "side" ? 7 : 22,
    wx = width / 2,
    wz = length / 2;
  const level: Level = {
    name: "",
    width,
    depth: length,
    floor: { colorA: t.floor, colorB: t.tile, tile: 1 },
    wallColor: t.wall,
    wallTopColor: t.cap,
    background: t.background,
    sun: { azimuthDeg: 30, elevationDeg: 50 },
    walls: [
      { id: "west", from: [-wx, -wz], to: [-wx, wz], height: 0.6 },
      { id: "north", from: [-wx, -wz], to: [wx, -wz], height: 1.6 },
      { id: "east", from: [wx, -wz], to: [wx, wz], height: 0.5 },
      { id: "south", from: [-wx, wz], to: [wx, wz], height: 0.45 },
    ],
    crates: [],
    characters: [
      {
        id: "player",
        preset: "ember_ranger",
        brain: "input",
        x: camera === "side" ? -12 : 0,
        z: camera === "side" ? 0 : 6.5,
      },
    ],
  };
  if (depth && camera !== "side" && rng.next() > 0.35)
    for (const [i, x, z] of [
      [0, -4, -3],
      [1, 4, -3],
      [2, -4, 3],
      [3, 4, 3],
    ])
      level.walls.push({
        id: `pillar_${i}`,
        from: [x - 0.4, z],
        to: [x + 0.4, z],
        thickness: 0.8,
        height: 1.6,
      });
  if (!depth)
    for (const n of NPCS)
      level.characters.push({
        id: n.id,
        preset: "ember_npc",
        brain: "idle",
        x: n.x,
        z: n.z,
      });
  const mechanics: MechanicId[] = [];
  if (depth && depth <= 12) mechanics.push(MECHANICS[depth - 1].id);
  else if (depth)
    while (mechanics.length < Math.min(4, 2 + Math.floor(depth / 30))) {
      const m = MECHANICS[Math.floor(rng.next() * 12)].id;
      if (!mechanics.includes(m)) mechanics.push(m);
    }
  const features = mechanics.flatMap((mechanic, i) =>
    Array.from({ length: 3 }, (_, j) => ({
      id: `${mechanic}_${j}`,
      mechanic,
      x: camera === "side" ? -5 + j * 5 : (j - 1) * 5,
      z: camera === "side" ? (i % 2 ? 1.8 : -1.8) : -4 + i * 2 + (j % 2) * 4,
      radius: mechanic === "powder" || mechanic === "brood" ? 0.8 : 1.7,
      hp: mechanic === "brood" ? 55 : 1,
      ready: 0,
    })),
  );
  const roster = Object.keys(MONSTERS).slice(
      0,
      Math.min(6, 1 + Math.ceil(depth / 2)),
    ),
    enemies: Spawn[] = [];
  for (let i = 0; depth && i < Math.min(36, 7 + depth * 2); i++) {
    let x = rng.range(-wx + 2, wx - 2),
      z = rng.range(-wz + 2, wz - 2);
    for (
      let a = 0;
      a < 30 &&
      (Math.hypot(x - level.characters[0].x, z - level.characters[0].z) < 4 ||
        level.walls
          .slice(4)
          .some((w) => Math.hypot(x - w.from[0], z - w.from[1]) < 1.5));
      a++
    ) {
      x = rng.range(-wx + 2, wx - 2);
      z = rng.range(-wz + 2, wz - 2);
    }
    enemies.push({
      id: `enemy_${i}`,
      archetype: roster[Math.floor(rng.next() * roster.length)],
      x,
      z,
      elite: depth > 2 && rng.next() < 0.16,
      boss: null,
      scale: 1,
    });
  }
  if (depth && depth % 4 === 0) {
    const boss = BOSSES[(depth / 4 - 1) % BOSSES.length];
    enemies.push({
      id: "boss",
      archetype: boss.base,
      x: 0,
      z: -5,
      elite: true,
      boss: boss.label,
      scale: 1.7,
    });
  }
  const name = depth
    ? mechanics.map((m) => MECHANICS.find((v) => v.id === m)!.label).join(" + ")
    : "Cinderhaven";
  level.name = name;
  return {
    depth,
    seed,
    name,
    camera,
    theme,
    level,
    enemies,
    features,
    mechanics,
    exit: camera === "side" ? { x: 13, z: 0 } : { x: 0, z: -8.5 },
  };
}
