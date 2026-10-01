/**
 * Triangle budgets for character parts. Characters are drawn ~48 art pixels tall, so the source
 * meshes (13k-27k triangles per outfit) carry far more detail than a pixel can show; meshoptimizer
 * collapses edges down to a ratio while keeping skin weights, UVs and the silhouette.
 */
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

/** Fraction of triangles to keep, by model id prefix. */
export const KEEP = [
  [/^outfit_/, 0.3],
  [/^mannequin_/, 0.35],
  [/^head_/, 0.45],
  [/^hair_/, 0.6],
];

export const keepFor = (id) => KEEP.find(([re]) => re.test(id))?.[1] ?? 1;

export function countTriangles(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return n;
}

/** Simplifies every primitive of a model to its budget (no-op for ratio 1). */
export async function simplifyModel(doc, id) {
  const ratio = keepFor(id);
  if (ratio >= 1) return;
  await MeshoptSimplifier.ready;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false }));
}
