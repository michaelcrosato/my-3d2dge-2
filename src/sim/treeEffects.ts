/**
 * Passive tree effects: allocated node ids -> mods and unlocked skills. The tree layout itself is
 * content (content/tree.ts); this keeps the hero build independent of how the tree is drawn.
 */
import type { Mod } from '../content/stats';
import { TREE } from '../content/tree';

export function treeMods(ids: readonly string[]): Mod[] {
  const out: Mod[] = [];
  for (const id of ids) {
    const n = TREE.byId.get(id);
    if (n) out.push(...n.mods);
  }
  return out;
}

export function treeSkills(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const n = TREE.byId.get(id);
    if (n?.skill) out.push(n.skill);
  }
  return out;
}
