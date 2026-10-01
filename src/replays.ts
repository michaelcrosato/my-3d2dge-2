/**
 * Replay storage: each save slot keeps its best replay per depth (and per Daily Trial), at most
 * MAX_PER_SLOT, gzipped with the browser's CompressionStream when it exists (a 3-minute run is
 * ~50 KB). Falls back to plain JSON, and to memory when localStorage is unavailable.
 */
import { REPLAY_VERSION, type Replay } from './sim/replay';

/** Shape check for replays from storage or files (they come from outside the code). */
function isReplay(r: unknown): r is Replay {
  const x = r as Partial<Replay> | null;
  return !!x && x.v === REPLAY_VERSION && typeof x.key === 'string' && typeof x.title === 'string' && typeof x.seed === 'number'
    && typeof x.frames === 'number' && x.frames > 0 && typeof x.time === 'number' && typeof x.hash === 'string'
    && !!x.level && typeof x.level === 'object' && !!x.hero && typeof x.hero === 'object' && Array.isArray(x.input) && Array.isArray(x.cmds);
}

/** Offers a replay as a file download (share a run). */
export async function downloadReplay(r: Replay) {
  const blob = new Blob([await encode(r)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const t = (r.time / 60).toFixed(1).replace('.', '_');
  a.download = `depthward-${r.key.replace(/[^\w-]+/g, '-')}-${t}s.dwr`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export interface ReplayMeta {
  key: string;
  title: string;
  time: number;
  frames: number;
  recorded: string;
  v: number;
}

const PREFIX = '3dpixel2d.replay.v1';
export const MAX_PER_SLOT = 12;

/** A replay as text: gzip + base64 when the browser can, plain JSON otherwise (also the file format). */
export async function encode(r: Replay): Promise<string> {
  const json = JSON.stringify(r);
  if (typeof CompressionStream === 'undefined') return `js:${json}`;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `gz:${btoa(bin)}`;
}

/** Reads stored or shared replay text; null when it is not a replay this version can play. */
export async function decode(text: string): Promise<Replay | null> {
  try {
    text = text.trim();
    let r: unknown;
    if (text.startsWith('js:')) r = JSON.parse(text.slice(3));
    else if (text.startsWith('{')) r = JSON.parse(text);
    else {
      if (!text.startsWith('gz:') || typeof DecompressionStream === 'undefined') return null;
      const bin = atob(text.slice(3));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      r = JSON.parse(await new Response(stream).text());
    }
    return isReplay(r) ? r : null;
  } catch {
    return null;
  }
}

export class ReplayStore {
  private memory = new Map<string, string>();

  constructor(private storage: Storage | null) {}

  private read(k: string): string | null {
    try {
      return this.storage ? this.storage.getItem(k) : this.memory.get(k) ?? null;
    } catch {
      return this.memory.get(k) ?? null;
    }
  }

  private write(k: string, v: string | null) {
    try {
      if (!this.storage) throw new Error('no storage');
      if (v === null) this.storage.removeItem(k);
      else this.storage.setItem(k, v);
    } catch (e) {
      if (v === null) this.memory.delete(k);
      else if (!this.storage) this.memory.set(k, v);
      else throw e;
    }
  }

  private indexKey = (slot: number) => `${PREFIX}.s${slot}`;
  private dataKey = (slot: number, key: string) => `${PREFIX}.s${slot}.${key}`;

  list(slot: number): ReplayMeta[] {
    try {
      const raw = JSON.parse(this.read(this.indexKey(slot)) ?? '[]') as ReplayMeta[];
      return Array.isArray(raw) ? raw.filter((m) => m && typeof m.key === 'string' && m.v === REPLAY_VERSION) : [];
    } catch {
      return [];
    }
  }

  has(slot: number, key: string) {
    return this.list(slot).some((m) => m.key === key);
  }

  /** Stores the replay if it beats the slot's replay for that depth. True when kept. */
  async put(slot: number, r: Replay): Promise<boolean> {
    const index = this.list(slot);
    const old = index.find((m) => m.key === r.key);
    if (old && old.time <= r.time) return false;
    const data = await encode(r);
    const meta: ReplayMeta = { key: r.key, title: r.title, time: r.time, frames: r.frames, recorded: r.recorded, v: r.v };
    let next = [...index.filter((m) => m.key !== r.key), meta];
    // Oldest recordings make room first, also when storage is full.
    next.sort((a, b) => a.recorded.localeCompare(b.recorded));
    while (next.length > MAX_PER_SLOT) this.write(this.dataKey(slot, next.shift()!.key), null);
    for (;;) {
      try {
        this.write(this.dataKey(slot, r.key), data);
        this.write(this.indexKey(slot), JSON.stringify(next));
        return true;
      } catch {
        const victim = next.find((m) => m.key !== r.key);
        if (!victim) return false;
        this.write(this.dataKey(slot, victim.key), null);
        next = next.filter((m) => m !== victim);
      }
    }
  }

  async get(slot: number, key: string): Promise<Replay | null> {
    const text = this.read(this.dataKey(slot, key));
    return text ? decode(text) : null;
  }

  /** Forgets a slot's replays (a new hero in that slot). */
  clear(slot: number) {
    for (const m of this.list(slot)) this.write(this.dataKey(slot, m.key), null);
    this.write(this.indexKey(slot), null);
  }
}
