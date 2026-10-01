/**
 * Haven, the town hub. Hand-made with the same grid format as generated dungeons (so the same
 * renderer, nav and minimap work): a cobbled plaza with a well, buildings around it, and the
 * core NPCs, each with an idle animation that fits their trade (the smith hammers, the merchant
 * talks, the sage channels) and a role that opens their panel when the hero talks to them.
 */
import { wallBoxes } from './procgen/dungeon';
import { theme } from './themes';
import type { CharacterDef, Level, LevelGrid, LightDef, PropDef } from './level';

const COLS = 44, ROWS = 38;

/** Buildings and features as rectangles on the tile grid: [col, row, w, h]. */
const BUILDINGS: Array<[number, number, number, number]> = [
  [4, 3, 9, 6], // smithy
  [17, 2, 10, 5], // sage's hall
  [31, 3, 9, 6], // merchant
  [3, 14, 6, 8], // stash house
  [35, 14, 6, 8], // guard house
  [20, 17, 4, 3], // well
  [4, 28, 7, 5], // cottages
  [33, 28, 7, 5],
];

function townGrid(): LevelGrid {
  const cells: string[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const edge = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
      const inside = (c > 0 && r > 0 && c < COLS - 1 && r < ROWS - 1);
      let t = edge ? '#' : inside ? '.' : ' ';
      for (const [bc, br, bw, bh] of BUILDINGS) if (c >= bc && c < bc + bw && r >= br && r < br + bh) t = '#';
      // The south gate: a gap in the wall leading out (decorative; the waypoint is the way out).
      cells.push(t);
    }
  return { cols: COLS, rows: ROWS, cell: 1, originX: -COLS / 2, originZ: -ROWS / 2, cells: cells.join('') };
}

const at = (c: number, r: number) => ({ x: -COLS / 2 + c + 0.5, z: -ROWS / 2 + r + 0.5 });

export function townLevel(): Level {
  const grid = townGrid();
  const th = theme('town');
  const walls = wallBoxes(grid, (c, r) => (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 ? th.wall.trim : undefined));
  const P = (id: string, kind: string, c: number, r: number, extra: Partial<PropDef> = {}): PropDef => ({ id, kind, ...at(c, r), ...extra });
  const props: PropDef[] = [
    P('waypoint', 'waypoint', 22, 25),
    P('stash', 'stash', 10, 18, { yawDeg: 90 }),
    P('anvil', 'anvil', 9, 10.5, { yawDeg: 20 }),
    P('shrine', 'shrine_respec', 26, 8.5),
    P('post1', 'dummy_post', 30, 22),
    P('brazier1', 'brazier', 16, 12),
    P('brazier2', 'brazier', 28, 12),
    P('brazier3', 'brazier', 16, 24),
    P('brazier4', 'brazier', 28, 24),
  ];
  const decor: Array<[string, number, number]> = [
    ['barrels', 13.5, 4], ['sacks', 30, 10], ['barrels', 40.5, 10], ['sacks', 11, 23], ['flowers', 20, 21], ['flowers', 24.5, 21],
    ['flowers', 19, 16], ['flowers', 25, 16], ['grass', 6, 25], ['grass', 37, 25], ['grass', 14, 34], ['grass', 29, 34],
    ['barrels', 12, 29], ['sacks', 31, 29], ['candles', 22, 7.6], ['flowers', 3, 25], ['grass', 41, 34], ['grass', 2, 34],
  ];
  decor.forEach(([k, c, r], i) => props.push({ id: `d${i}`, kind: `decor:${k}`, ...at(c, r), yawDeg: i * 37, scale: 1 }));
  // Wall torches along the building fronts.
  const torches: Array<[number, number, number]> = [[8, 9, 0], [21, 7, 0], [35, 9, 0], [9, 17, 90], [34, 17, 270], [22, 1, 0]];
  const lights: LightDef[] = [];
  torches.forEach(([c, r, yaw], i) => {
    const p = at(c, r);
    props.push({ id: `t${i}`, kind: 'torch', x: p.x, z: p.z, y: 1.7, yawDeg: yaw });
    lights.push({ x: p.x, y: 1.9, z: p.z + 0.3, color: th.torch, intensity: 2, range: 7, flicker: 0.2 });
  });
  const npc = (id: string, preset: string, c: number, r: number, yaw: number, role: string, name: string, anim?: string): CharacterDef => ({
    id, preset, ...at(c, r), yawDeg: yaw, brain: 'npc', team: 'neutral', name, npc: { role, anim },
  });
  const characters: CharacterDef[] = [
    { id: 'player', preset: 'ranger', ...at(22, 28), yawDeg: 225, brain: 'input', team: 'hero' },
    npc('smith', 'smith', 10, 11, 200, 'smith', 'Brann the Smith', 'TreeChopping_Loop'),
    npc('merchant', 'merchant', 34, 10.5, 160, 'merchant', 'Odessa the Trader', 'Idle_Talking_Loop'),
    npc('sage', 'sage', 22, 9, 180, 'sage', 'Sage Ilmar', 'Spell_Simple_Idle_Loop'),
    npc('keeper', 'keeper', 10, 20, 100, 'stash', 'Keeper Wren', 'Idle_FoldArms_Loop'),
    npc('guard', 'guard', 34, 20, 250, 'guard', 'Captain Hale', 'Idle_Shield_Loop'),
    npc('farmer', 'farmer', 14, 30, 200, 'wander', 'Old Tobin'),
    npc('villager', 'villager', 30, 31, 140, 'wander', 'Mara'),
    npc('child', 'child', 23, 20.5, 180, 'wander', 'Pip'),
    { id: 'dummy1', preset: 'dummy', ...at(31, 23), yawDeg: 200, brain: 'dummy', team: 'target', name: 'Training Dummy' },
    { id: 'dummy2', preset: 'dummy', ...at(33, 24.5), yawDeg: 230, brain: 'dummy', team: 'target', name: 'Training Dummy' },
  ];
  return {
    name: 'haven', title: 'Haven', subtitle: 'The last lit town', kind: 'town', theme: 'town', seed: 7,
    width: COLS, depth: ROWS,
    floor: { colorA: th.floor.base, colorB: th.floor.alt, tile: 1 },
    wallColor: th.wall.side, wallTopColor: th.wall.top, background: th.background,
    sun: { azimuthDeg: th.sun.azimuthDeg, elevationDeg: th.sun.elevationDeg },
    walls, crates: [], characters, grid, props, lights,
    start: { ...at(22, 28), yawDeg: 225 },
    monsterLevel: 1,
  };
}

/** Lines townsfolk say (shown in their panel header). */
export const NPC_LINES: Record<string, string[]> = {
  smith: ['Bring me steel and shards and I\'ll make it sing.', 'A reforged blade remembers nothing of its past. Lucky blade.'],
  merchant: ['Everything has a price. Most things have two.', 'Sell me your junk; I know someone who loves junk.'],
  sage: ['The constellation of your soul has many paths. Choose.', 'Power that is unspent is power wasted.'],
  stash: ['Your things are safe with me. Safer than with you, anyway.'],
  guard: ['The waypoint takes you below. The deeper you go, the less comes back.', 'Every depth has its own trick. Learn it, or ignore it and swing harder.'],
  waypoint: ['The waypoint hums. Choose a depth.'],
  shrine_respec: ['The shrine offers to unmake your choices, for a price.'],
  wander: ['Lovely day for not going into the dungeon.', 'My cousin went down there once. Came back taller, somehow.'],
};
