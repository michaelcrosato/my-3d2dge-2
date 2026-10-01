/**
 * Item icons rendered by the engine: the item's procedural mesh is lit, framed and drawn through
 * the same pixel pipeline as the game (toon bands, 1-px outlines, creases) into a small
 * transparent target, then cached as a PNG data URL. Inventory icons therefore always match the
 * loot on the floor and the weapon in the hero's hand. Agents get the same images via the
 * `item.icon` tool.
 */
import * as THREE from 'three';
import { itemBase } from '../content/items';
import { itemObject, type ItemLookInput } from './itemMeshes';
import { LAYER, PixelTargets, type PixelPipeline } from './pixelPipeline';

export class IconRenderer {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  private targets: PixelTargets;
  private cache = new Map<string, string>();
  private canvas = document.createElement('canvas');

  constructor(private renderer: THREE.WebGLRenderer, private pipeline: PixelPipeline, readonly size = 32) {
    this.targets = new PixelTargets(size, size);
    this.scene.add(new THREE.HemisphereLight(0xd8dcff, 0x3a3046, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    this.canvas.width = this.canvas.height = size;
  }

  icon(it: ItemLookInput): string {
    const key = `${it.base}|${it.rarity}|${it.seed % 64}|${it.unique ?? ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const obj = itemObject(it);
    const slot = itemBase(it.base).slot;
    // Long things lie diagonally; armour faces the viewer.
    if (slot === 'weapon') obj.rotation.set(0, 0.3, -Math.PI / 4);
    else if (slot === 'ring') obj.rotation.set(0.6, 0.4, 0);
    else obj.rotation.set(0.25, -0.5, 0);
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const dim = box.getSize(new THREE.Vector3());
    const half = Math.max(dim.x, dim.y, dim.z * 0.6) * 0.62 + 0.02;
    const cam = this.camera;
    Object.assign(cam, { left: -half, right: half, top: half, bottom: -half });
    cam.position.set(center.x, center.y, center.z + 10);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    obj.traverse((o) => o.layers.set(LAYER.MAIN));
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevTarget = r.getRenderTarget();
    r.setClearColor(0x000000, 0);
    let url = '';
    try {
      this.pipeline.renderLowRes(this.targets, this.scene, cam, [LAYER.MAIN]);
      const img = this.pipeline.read(this.targets);
      const g = this.canvas.getContext('2d')!;
      g.clearRect(0, 0, this.size, this.size);
      g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      url = this.canvas.toDataURL('image/png');
    } finally {
      r.setClearColor(prevClear, prevAlpha);
      r.setRenderTarget(prevTarget);
      obj.removeFromParent();
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
    }
    this.cache.set(key, url);
    return url;
  }
}
