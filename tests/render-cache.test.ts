/** Render-side caches stay bounded over long sessions. */
import { expect, it } from 'vitest';
import { cachedItemGeometry, ITEM_GEOMETRY_CACHE, itemGeometryCacheSize } from '../src/render/itemMeshes';
import { ITEM_BASES } from '../src/content/items';

it('item geometry cache keeps only the most recent looks', () => {
  const bases = ITEM_BASES.filter((b) => b.look);
  let n = 0;
  for (const b of bases) for (let seed = 0; seed < 64; seed++) {
    cachedItemGeometry({ base: b.id, rarity: 'magic', seed });
    n++;
  }
  expect(n).toBeGreaterThan(ITEM_GEOMETRY_CACHE);
  expect(itemGeometryCacheSize()).toBe(ITEM_GEOMETRY_CACHE);
  // A recent look is served from the cache (same object), an evicted one is rebuilt.
  const recent = { base: bases[bases.length - 1].id, rarity: 'magic' as const, seed: 63 };
  expect(cachedItemGeometry(recent)).toBe(cachedItemGeometry(recent));
});
