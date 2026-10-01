/**
 * Evaluates a list of mods (content/stats.ts) into final values for a tag context.
 *
 *   value = (base + Σflat) × (1 + Σinc/100) × Π(1 + more/100), clamped to the stat's range.
 *
 * A mod applies when every one of its tags is in the context. Results are cached per
 * (stat, context) key, so hot paths (every hit, every frame for move speed) stay cheap.
 * Deterministic and DOM-free: used by the sim, tests and agent tools.
 */
import { STATS, type Mod, type StatId, type Tag } from '../content/stats';

const EMPTY: readonly Tag[] = [];

function applies(m: Mod, ctx: ReadonlySet<Tag> | null): boolean {
  if (!m.tags || !m.tags.length) return true;
  if (!ctx) return false;
  for (const t of m.tags) if (!ctx.has(t)) return false;
  return true;
}

export class StatBlock {
  private byStat = new Map<StatId, Mod[]>();
  private cache = new Map<string, number>();
  private ctxCache = new Map<string, Set<Tag>>();

  constructor(readonly mods: readonly Mod[] = []) {
    for (const m of mods) {
      let list = this.byStat.get(m.stat);
      if (!list) this.byStat.set(m.stat, (list = []));
      list.push(m);
    }
  }

  private ctxSet(key: string, tags: readonly Tag[]): Set<Tag> | null {
    if (!tags.length) return null;
    let s = this.ctxCache.get(key);
    if (!s) this.ctxCache.set(key, (s = new Set(tags)));
    return s;
  }

  /** Sum of flat mods (no base). */
  flat(stat: StatId, tags: readonly Tag[] = EMPTY): number {
    let sum = 0;
    const ctx = tags.length ? new Set(tags) : null;
    for (const m of this.byStat.get(stat) ?? []) if (m.kind === 'flat' && applies(m, ctx)) sum += m.value;
    return sum;
  }

  /** [Σmin, Σmax] of ranged flat mods (added damage). */
  range(stat: StatId, tags: readonly Tag[] = EMPTY): [number, number] {
    let lo = 0, hi = 0;
    const ctx = tags.length ? new Set(tags) : null;
    for (const m of this.byStat.get(stat) ?? []) {
      if (m.kind !== 'flat' || !applies(m, ctx)) continue;
      lo += m.value;
      hi += m.max ?? m.value;
    }
    return [lo, hi];
  }

  /** Σ increased (percent points). */
  inc(stat: StatId, tags: readonly Tag[] = EMPTY): number {
    return this.agg(stat, tags, 'inc');
  }

  /** Π more, as a multiplier (1 = none). */
  more(stat: StatId, tags: readonly Tag[] = EMPTY): number {
    return this.agg(stat, tags, 'more');
  }

  /** Multiplier from increased and more mods only: (1 + inc/100) × more. */
  scale(stat: StatId, tags: readonly Tag[] = EMPTY): number {
    return Math.max(0, 1 + this.inc(stat, tags) / 100) * this.more(stat, tags);
  }

  has(stat: StatId, tags: readonly Tag[] = EMPTY): boolean {
    const ctx = tags.length ? new Set(tags) : null;
    for (const m of this.byStat.get(stat) ?? []) if (m.kind === 'flag' && m.value !== 0 && applies(m, ctx)) return true;
    return false;
  }

  /** Final value: (base + flat) scaled by inc/more, clamped. */
  get(stat: StatId, tags: readonly Tag[] = EMPTY): number {
    const key = tags.length ? `${stat}|${tags.join(',')}` : stat;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const spec = STATS[stat] as { base?: number; min?: number; max?: number };
    const ctx = this.ctxSet(tags.join(','), tags);
    let flat = spec.base ?? 0, inc = 0, more = 1;
    for (const m of this.byStat.get(stat) ?? []) {
      if (!applies(m, ctx)) continue;
      if (m.kind === 'flat') flat += m.value;
      else if (m.kind === 'inc') inc += m.value;
      else if (m.kind === 'more') more *= 1 + m.value / 100;
    }
    let v = flat * Math.max(0, 1 + inc / 100) * more;
    if (spec.min !== undefined) v = Math.max(spec.min, v);
    if (spec.max !== undefined) v = Math.min(spec.max, v);
    this.cache.set(key, v);
    return v;
  }

  private agg(stat: StatId, tags: readonly Tag[], kind: 'inc' | 'more'): number {
    const key = `${kind}:${stat}|${tags.join(',')}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const ctx = this.ctxSet(tags.join(','), tags);
    let v = kind === 'inc' ? 0 : 1;
    for (const m of this.byStat.get(stat) ?? []) {
      if (m.kind !== kind || !applies(m, ctx)) continue;
      if (kind === 'inc') v += m.value;
      else v *= 1 + m.value / 100;
    }
    this.cache.set(key, v);
    return v;
  }

  /** Every stat with a non-default value (character sheet, agent inspectors). */
  summary(): Array<{ stat: StatId; value: number }> {
    const out: Array<{ stat: StatId; value: number }> = [];
    for (const stat of this.byStat.keys()) out.push({ stat, value: Math.round(this.get(stat) * 100) / 100 });
    return out.sort((a, b) => a.stat.localeCompare(b.stat));
  }
}

/** Groups equal untagged mods for compact display ("+30 to Maximum Life" from three +10 nodes). */
export function mergeMods(mods: readonly Mod[]): Mod[] {
  const out = new Map<string, Mod>();
  for (const m of mods) {
    const key = `${m.stat}|${m.kind}|${(m.tags ?? []).join(',')}`;
    const prev = out.get(key);
    if (!prev) out.set(key, { ...m });
    else {
      const prevMax = prev.max ?? prev.value;
      const ranged = m.max !== undefined || prev.max !== undefined;
      prev.value = m.kind === 'more' ? ((1 + prev.value / 100) * (1 + m.value / 100) - 1) * 100 : prev.value + m.value;
      if (ranged) prev.max = prevMax + (m.max ?? m.value);
    }
  }
  return [...out.values()];
}
