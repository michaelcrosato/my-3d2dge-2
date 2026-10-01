/**
 * Level mechanics as content: name (the level is named after it), the arrival tip (how to use
 * it, or ignore it), words for procedural level titles, and a placement function that drops the
 * mechanic's props into a generated level. Behaviour lives in sim/mechanics.ts; visuals in
 * render/propMeshes.ts. Any set of mechanics can be combined in one level.
 */
import { Rng } from '../sim/rng';
import { cellCenter, gridAt, type CharacterDef, type Level, type PropDef, type RoomInfo } from './level';

export interface MechanicDef {
  id: string;
  name: string;
  /** Shown on arrival: what it does, how to exploit it, and that you can ignore it. */
  tip: string;
  /** Words for endless-mode titles ("Kegs", "Frozen"...). */
  noun: string;
  adjective: string;
  /** Themes that suit it (endless generator bias). */
  themes: string[];
  place(level: Level, rng: Rng, intensity: number): void;
}

/** Tracks free floor tiles while placing props. */
class Placer {
  private used = new Set<number>();
  constructor(readonly level: Level) {
    const g = level.grid!;
    const mark = (x: number, z: number, r = 0) => {
      const c0 = Math.floor((x - g.originX) / g.cell), r0 = Math.floor((z - g.originZ) / g.cell);
      for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) this.used.add((r0 + dr) * g.cols + c0 + dc);
    };
    for (const c of level.characters) mark(c.x, c.z, c.id === 'player' ? 2 : 0);
    for (const p of level.props ?? []) if (!p.kind.startsWith('decor:') && p.kind !== 'torch') mark(p.x, p.z);
    if (level.exit) mark(level.exit.x, level.exit.z, 1);
  }
  get grid() {
    return this.level.grid!;
  }
  isFloor(c: number, r: number) {
    return gridAt(this.grid, c, r) === '.';
  }
  free(c: number, r: number, spacing = 0) {
    for (let dr = -spacing; dr <= spacing; dr++) for (let dc = -spacing; dc <= spacing; dc++) {
      if (!this.isFloor(c + dc, r + dr) && dr === 0 && dc === 0) return false;
      if (this.used.has((r + dr) * this.grid.cols + c + dc)) return false;
    }
    return this.isFloor(c, r);
  }
  take(c: number, r: number) {
    this.used.add(r * this.grid.cols + c);
  }
  tiles(room: RoomInfo, margin = 1): Array<{ c: number; r: number }> {
    const g = this.grid;
    const out: Array<{ c: number; r: number }> = [];
    const c0 = Math.floor((room.x - g.originX) / g.cell), r0 = Math.floor((room.z - g.originZ) / g.cell);
    for (let r = r0 + margin; r < r0 + Math.floor(room.h / g.cell) - margin; r++)
      for (let c = c0 + margin; c < c0 + Math.floor(room.w / g.cell) - margin; c++) if (this.isFloor(c, r)) out.push({ c, r });
    return out;
  }
  pick(rng: Rng, room: RoomInfo, opts: { margin?: number; spacing?: number; nearWall?: boolean } = {}): { c: number; r: number; x: number; z: number } | null {
    const list = this.tiles(room, opts.margin ?? 1).filter((t) => this.free(t.c, t.r, opts.spacing ?? 0) && (!opts.nearWall || this.wallNear(t.c, t.r)));
    if (!list.length) return null;
    const t = rng.pick(list);
    this.take(t.c, t.r);
    return { ...t, ...cellCenter(this.grid, t.c, t.r) };
  }
  wallNear(c: number, r: number) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => gridAt(this.grid, c + dc, r + dr) === '#');
  }
}

let uid = 0;
const prop = (level: Level, kind: string, x: number, z: number, extra: Partial<PropDef> = {}): PropDef => {
  const p: PropDef = { id: `${kind}${uid++}_${Math.round(x * 10)}_${Math.round(z * 10)}`, kind, x, z, ...extra };
  (level.props ??= []).push(p);
  return p;
};

const combatRooms = (level: Level) => (level.rooms ?? []).filter((r) => r.kind !== 'start');
const monstersIn = (level: Level, room: RoomInfo) => level.characters.filter((c) => c.monster && c.x >= room.x && c.x < room.x + room.w && c.z >= room.z && c.z < room.z + room.h);

export const MECHANICS: Record<string, MechanicDef> = {
  kegs: {
    id: 'kegs', name: 'Blast Kegs', noun: 'Kegs', adjective: 'Powdered', themes: ['cellar', 'foundry', 'ashlands'],
    tip: 'Strike a keg and it blows a moment later, chaining to its neighbours. Lure packs close first. Mechanic kills give +50% experience.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        const mons = monstersIn(level, room);
        const n = Math.round((2 + room.w * room.h / 45) * k);
        for (let i = 0; i < n; i++) {
          // Half the kegs sit next to monster packs, the rest along walls in small clusters.
          const anchor = i % 2 === 0 && mons.length ? rng.pick(mons) : null;
          let spot = null;
          if (anchor) {
            const g = pl.grid;
            const c = Math.floor((anchor.x - g.originX) / g.cell) + rng.int(-2, 2), r = Math.floor((anchor.z - g.originZ) / g.cell) + rng.int(-2, 2);
            if (pl.free(c, r)) {
              pl.take(c, r);
              spot = cellCenter(g, c, r);
            }
          }
          spot ??= pl.pick(rng, room, { nearWall: rng.chance(0.6) });
          if (spot) prop(level, 'keg', spot.x + rng.range(-0.15, 0.15), spot.z + rng.range(-0.15, 0.15), { yawDeg: rng.int(0, 3) * 90 });
        }
      }
    },
  },
  spikes: {
    id: 'spikes', name: 'Spike Traps', noun: 'Spikes', adjective: 'Impaling', themes: ['catacomb', 'crypt', 'temple'],
    tip: 'Plates rise in waves: watch for the warning rattle. Knock monsters onto them, or just step around.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        const strips = Math.max(1, Math.round((room.w * room.h > 110 ? 2 : 1) * k));
        for (let s = 0; s < strips; s++) {
          const tiles = pl.tiles(room, 1);
          if (!tiles.length) continue;
          const horizontal = rng.chance(0.5);
          const anchor = rng.pick(tiles);
          const line = tiles.filter((t) => (horizontal ? t.r === anchor.r : t.c === anchor.c)).sort((a, b) => (horizontal ? a.c - b.c : a.r - b.r));
          const period = rng.pick([150, 180, 210]);
          line.forEach((t, i) => {
            if (!pl.free(t.c, t.r)) return;
            pl.take(t.c, t.r);
            const p = cellCenter(pl.grid, t.c, t.r);
            prop(level, 'spikes', p.x, p.z, { data: { period, phase: i * 10 } });
          });
        }
      }
    },
  },
  shrines: {
    id: 'shrines', name: 'Shrines', noun: 'Shrines', adjective: 'Blessed', themes: ['temple', 'ruins', 'crypt'],
    tip: 'Touch a shrine for 20 seconds of power: frenzy, empowerment, haste, fortune, conduit or fortify. Chain them for speed.',
    place(level, rng, k) {
      const pl = new Placer(level);
      const rooms = rng.shuffle(combatRooms(level).filter((r) => r.kind !== 'boss'));
      const buffs = rng.shuffle(['frenzy', 'power', 'haste', 'fortune', 'conduit', 'fortify']);
      const n = Math.min(rooms.length, Math.round(4 * k));
      for (let i = 0; i < n; i++) {
        const spot = pl.pick(rng, rooms[i], { margin: 2, spacing: 1 });
        if (spot) prop(level, 'shrine', spot.x, spot.z, { data: { buff: buffs[i % buffs.length] } });
      }
    },
  },
  launchpads: {
    id: 'launchpads', name: 'Launch Pads', noun: 'Pads', adjective: 'Soaring', themes: ['ruins', 'ashlands', 'temple'],
    tip: 'Step on a pad to be flung across walls; the landing knocks everything down. Route through them to reach the boss fast.',
    place(level, rng, k) {
      const pl = new Placer(level);
      const rooms = level.rooms ?? [];
      const start = rooms.find((r) => r.kind === 'start');
      const boss = rooms.find((r) => r.kind === 'boss');
      const others = rng.shuffle(rooms.filter((r) => r.kind !== 'start' && r.kind !== 'boss'));
      const pairs: Array<[RoomInfo, RoomInfo]> = [];
      if (start && others.length) pairs.push([start, others[0]]);
      for (let i = 1; i + 1 < others.length && pairs.length < Math.round(3 * k); i += 2) pairs.push([others[i], others[i + 1]]);
      if (boss && others.length > 2) pairs.push([others[others.length - 1], boss]);
      for (const [a, b] of pairs) {
        const pa = pl.pick(rng, a, { margin: 2, spacing: 1 }), pb = pl.pick(rng, b, { margin: 2, spacing: 1 });
        if (!pa || !pb) continue;
        const ida = `pad${uid++}`, idb = `pad${uid++}`;
        (level.props ??= []).push(
          { id: ida, kind: 'launchpad', x: pa.x, z: pa.z, data: { to: { x: pb.x, z: pb.z }, partner: idb } },
          { id: idb, kind: 'launchpad', x: pb.x, z: pb.z, data: { to: { x: pa.x, z: pa.z }, partner: ida } },
        );
      }
    },
  },
  ice: {
    id: 'ice', name: 'Black Ice', noun: 'Ice', adjective: 'Frozen', themes: ['frost', 'temple'],
    tip: 'No traction on the ice: momentum carries you, and knockback sends enemies sliding into walls and each other.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        const n = Math.round((1 + room.w * room.h / 70) * k);
        for (let i = 0; i < n; i++) {
          const spot = pl.pick(rng, room, { margin: 2 });
          if (spot) prop(level, 'ice', spot.x, spot.z, { scale: rng.range(1.6, 3.4), yawDeg: rng.int(0, 5) * 60 });
        }
      }
    },
  },
  lightless: {
    id: 'lightless', name: 'Lightless', noun: 'Darkness', adjective: 'Lightless', themes: ['crypt', 'abyss', 'catacomb'],
    tip: 'Monsters in darkness are shrouded: tougher and deadlier. Strike the beacons to light them and strip the shroud.',
    place(level, rng, k) {
      level.dark = true;
      const pl = new Placer(level);
      for (const room of level.rooms ?? []) {
        const n = room.kind === 'start' ? 1 : Math.round(2 * k);
        for (let i = 0; i < n; i++) {
          const spot = pl.pick(rng, room, { margin: 2, spacing: 1 });
          if (spot) prop(level, 'beacon', spot.x, spot.z);
        }
      }
      // Wall torches go out in the dark.
      level.lights = (level.lights ?? []).filter(() => rng.chance(0.2));
    },
  },
  boulders: {
    id: 'boulders', name: 'Rolling Boulders', noun: 'Boulders', adjective: 'Crushing', themes: ['ashlands', 'ruins', 'cellar'],
    tip: 'Chutes release boulders that crush anything in their path. Hit a rolling boulder to send it bowling into a pack.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        if (room.w * room.h < 70) continue;
        const n = Math.round((room.w * room.h > 150 ? 2 : 1) * k);
        for (let i = 0; i < n; i++) {
          const spot = pl.pick(rng, room, { margin: 1, nearWall: true, spacing: 1 });
          if (!spot) continue;
          // Aim the chute away from the nearest wall, across the room.
          const g = pl.grid;
          const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => gridAt(g, spot.c - dc, spot.r - dr) === '#');
          const [dc, dr] = dirs.length ? dirs[0] : [1, 0];
          prop(level, 'chute', spot.x, spot.z, { yawDeg: (Math.atan2(dc, dr) * 180) / Math.PI, data: { period: rng.int(200, 320), phase: rng.int(0, 200) } });
        }
      }
    },
  },
  rifts: {
    id: 'rifts', name: 'Rift Gates', noun: 'Rifts', adjective: 'Rifting', themes: ['abyss', 'temple', 'crypt'],
    tip: 'Paired rift gates fold the dungeon: step in to come out at the twin. One pair always leads near the boss.',
    place(level, rng, k) {
      const pl = new Placer(level);
      const rooms = level.rooms ?? [];
      const start = rooms.find((r) => r.kind === 'start');
      const boss = rooms.find((r) => r.kind === 'boss');
      const others = rng.shuffle(rooms.filter((r) => r.kind === 'combat' || r.kind === 'treasure'));
      const pairs: Array<[RoomInfo, RoomInfo]> = [];
      // The speedrun pair: start room to the room nearest the boss.
      if (start && boss) {
        const nearBoss = [...others].sort((a, b) => Math.hypot(a.x - boss.x, a.z - boss.z) - Math.hypot(b.x - boss.x, b.z - boss.z))[0];
        if (nearBoss) pairs.push([start, nearBoss]);
      }
      for (let i = 0; i + 1 < others.length && pairs.length < Math.round(2 + k); i += 2) pairs.push([others[i], others[i + 1]]);
      for (const [a, b] of pairs) {
        const pa = pl.pick(rng, a, { margin: 2, spacing: 1 }), pb = pl.pick(rng, b, { margin: 2, spacing: 1 });
        if (!pa || !pb) continue;
        const ida = `rift${uid++}`, idb = `rift${uid++}`;
        (level.props ??= []).push(
          { id: ida, kind: 'rift', x: pa.x, z: pa.z, yawDeg: 45, data: { to: idb } },
          { id: idb, kind: 'rift', x: pb.x, z: pb.z, yawDeg: 45, data: { to: ida } },
        );
      }
    },
  },
  vents: {
    id: 'vents', name: 'Fire Vents', noun: 'Vents', adjective: 'Smouldering', themes: ['foundry', 'ashlands', 'cellar'],
    tip: 'Vents glow, then erupt. Pull monsters over them; dodge out when the glow turns white.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        const n = Math.round((2 + room.w * room.h / 40) * k);
        const period = rng.pick([180, 220]);
        for (let i = 0; i < n; i++) {
          const spot = pl.pick(rng, room, { margin: 1, spacing: 1 });
          if (spot) prop(level, 'vent', spot.x, spot.z, { data: { period, phase: rng.int(0, period) } });
        }
      }
    },
  },
  totems: {
    id: 'totems', name: 'Totems', noun: 'Totems', adjective: 'Warded', themes: ['ruins', 'temple', 'abyss'],
    tip: 'Totems empower and heal monsters nearby. Break one (8 hits) and its power flows into you.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        const mons = monstersIn(level, room);
        if (!mons.length && room.kind !== 'boss') continue;
        const n = Math.max(1, Math.round((room.kind === 'boss' ? 2 : 1) * k));
        for (let i = 0; i < n; i++) {
          const spot = pl.pick(rng, room, { margin: 2, spacing: 1 });
          if (spot) prop(level, 'totem', spot.x, spot.z, { yawDeg: 45 });
        }
      }
    },
  },
  wells: {
    id: 'wells', name: 'Gravity Wells', noun: 'Wells', adjective: 'Collapsing', themes: ['abyss', 'temple'],
    tip: 'Wells drag everything to their centre. Let them gather a pack, then hit it with everything you have.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        const n = Math.round((room.w * room.h > 120 ? 2 : 1) * k);
        for (let i = 0; i < n; i++) {
          const spot = pl.pick(rng, room, { margin: 3, spacing: 2 });
          if (spot) prop(level, 'well', spot.x, spot.z, { scale: rng.range(3, 4.4) });
        }
      }
    },
  },
  chrono: {
    id: 'chrono', name: 'Chrono Fields', noun: 'Time', adjective: 'Timeless', themes: ['temple', 'frost', 'abyss'],
    tip: 'Time crawls inside the bubbles. Fight from the edge while monsters wade through, or skirt them entirely.',
    place(level, rng, k) {
      const pl = new Placer(level);
      for (const room of combatRooms(level)) {
        if (!rng.chance(0.75 * k)) continue;
        const spot = pl.pick(rng, room, { margin: 3, spacing: 2 });
        if (spot) prop(level, 'chrono', spot.x, spot.z, { scale: rng.range(2.8, 4) });
      }
    },
  },
  imps: {
    id: 'imps', name: 'Loot Imps', noun: 'Imps', adjective: 'Gilded', themes: ['catacomb', 'cellar', 'ruins'],
    tip: 'Golden imps flee and shed gold when struck. Catch one before it escapes (16 s) for a hoard.',
    place(level, rng, k) {
      const pl = new Placer(level);
      const rooms = rng.shuffle(combatRooms(level).filter((r) => r.kind !== 'boss'));
      const n = Math.min(rooms.length, Math.max(1, Math.round(2 * k)));
      for (let i = 0; i < n; i++) {
        const spot = pl.pick(rng, rooms[i], { margin: 2 });
        if (!spot) continue;
        const def: CharacterDef = {
          id: `imp${uid++}`, preset: 'creature', x: spot.x, z: spot.z, brain: 'monster', team: 'enemy',
          monster: { def: 'imp', level: level.monsterLevel ?? 1, rarity: 'magic', palette: 'gilded', pack: `imp${i}` },
        };
        level.characters.push(def);
      }
    },
  },
};

export const MECHANIC_IDS = Object.keys(MECHANICS);

/** Places every listed mechanic into a generated level (deterministic for the level seed). */
export function placeMechanics(level: Level, ids: string[], intensity = 1) {
  const rng = new Rng((level.seed ?? 1) * 7349 + ids.length);
  uid = 0;
  for (const id of ids) {
    const m = MECHANICS[id];
    if (!m) throw new Error(`unknown mechanic "${id}". Known: ${MECHANIC_IDS.join(', ')}`);
    m.place(level, rng, intensity);
  }
  level.mechanics = [...ids];
}
