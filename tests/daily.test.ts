/** Daily Trial: one deterministic challenge per date, fitted to the hero's frontier. */
import { expect, it } from 'vitest';
import { buildTrialLevel, dailyTrial, dateKey } from '../src/content/daily';
import { MECHANIC_IDS } from '../src/content/mechanics';
import { PACT_BY_ID } from '../src/content/pacts';

it('is the same for everyone on a date and changes day to day', () => {
  expect(dailyTrial('2026-10-01', 12)).toEqual(dailyTrial('2026-10-01', 12));
  const sets = new Set(Array.from({ length: 10 }, (_, i) => dailyTrial(`2026-10-${String(i + 1).padStart(2, '0')}`, 12).mechanics.join('+')));
  expect(sets.size).toBeGreaterThan(5);
  const t = dailyTrial('2026-10-05', 1);
  expect(t.depth).toBe(3);
  for (const m of t.mechanics) expect(MECHANIC_IDS).toContain(m);
  expect(t.pacts).toHaveLength(2);
  for (const p of t.pacts) expect(PACT_BY_ID[p].minDepth).toBeLessThanOrEqual(t.depth);
  expect(dateKey(new Date(2026, 0, 9))).toBe('2026-01-09');
});

it('builds a level with its mechanics, pacts and a boss', () => {
  const t = dailyTrial('2026-10-01', 15);
  const level = buildTrialLevel(t);
  expect(level.title).toBe(t.title);
  // A dark pact adds Lightless on top of the trial's own mechanics.
  expect(level.mechanics).toEqual(expect.arrayContaining(t.mechanics));
  for (const m of level.mechanics ?? []) if (!t.mechanics.includes(m)) expect(m).toBe('lightless');
  expect(level.pacts).toEqual(t.pacts);
  expect(level.characters.some((c) => c.monster?.rarity === 'unique')).toBe(true);
  expect(JSON.stringify(buildTrialLevel(t).characters)).toBe(JSON.stringify(level.characters));
});
