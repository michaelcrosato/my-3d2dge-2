/**
 * Monster portraits for the Codex: a small idle frame of any monster (procedural creature or
 * humanoid family) through the game's pixel pipeline, cached as PNG data URLs.
 */
import * as THREE from 'three';
import { config } from '../config';
import { animsOf } from '../content/characters';
import { ensureMonster, MONSTERS } from '../content/monsters';
import type { AssetLibrary } from './assets';
import { CharacterView } from './characterView';
import { CreatureStudio } from './creature/studio';
import { snapToGrid, type IsoBasis } from './pixelGrid';
import { LAYER, PixelTargets, type PixelPipeline } from './pixelPipeline';

export class PortraitRenderer {
  private cache = new Map<string, string>();
  private studio: CreatureStudio;
  private targets: PixelTargets;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private canvas = document.createElement('canvas');

  constructor(private renderer: THREE.WebGLRenderer, private pipeline: PixelPipeline, private basis: IsoBasis, private lib: AssetLibrary, readonly size = 72) {
    this.studio = new CreatureStudio(renderer, pipeline, basis, size);
    this.targets = new PixelTargets(size, size);
    this.scene.add(new THREE.HemisphereLight(0xc4ccff, 0x3d3446, 1.35));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
    sun.position.set(10, 25, 15);
    this.scene.add(sun);
    this.canvas.width = this.canvas.height = size;
  }

  /** PNG data URL of a monster's idle portrait ('' when it cannot be drawn). */
  portrait(def: string, palette?: string): string {
    const key = `${def}|${palette ?? ''}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let url = '';
    // Workshop species can be deleted after being slain: no portrait, no noise.
    if (def.startsWith('custom:') && !MONSTERS[def]) {
      this.cache.set(key, url);
      return url;
    }
    try {
      const md = ensureMonster(def);
      const img = md.body.kind === 'creature' ? this.creature(md.body.plan, md.body.seed ?? 1, palette ?? md.palette, md.body.genome) : this.humanoid(md.body.preset);
      const g = this.canvas.getContext('2d')!;
      g.clearRect(0, 0, this.size, this.size);
      g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      url = this.canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('portrait', def, e);
    }
    this.cache.set(key, url);
    return url;
  }

  private creature(plan: string, seed: number, palette: string, genome: Parameters<CreatureStudio['setSubject']>[0]['genome']) {
    const rig = this.studio.setSubject({ plan, seed, palette, genome });
    // Shrink long bodies to fit the frame.
    const extent = Math.max(rig.genome.length + rig.genome.tail.length * 0.6, rig.height * 1.6);
    const fit = Math.min(1, (this.size / config['render.pixelsPerMeter']) / Math.max(0.5, extent + 0.4));
    this.studio.setSubject({ plan, seed, palette, genome, scale: fit });
    return this.studio.render('idle', 0.3, Math.PI * 0.75 + Math.PI / 4);
  }

  private humanoid(preset: string) {
    const view = new CharacterView('__portrait', preset, this.lib);
    try {
      this.scene.add(view.root);
      view.root.rotation.y = Math.PI / 4;
      view.pose({ clip: animsOf(preset).idle, time: 0.2, prevClip: null, prevTime: 0, blend: 1 });
      const ppm = config['render.pixelsPerMeter'];
      const b = this.basis;
      const f = snapToGrid({ x: 0, y: 0.95, z: 0 }, b, ppm);
      this.cam.position.set(f.x - b.forward.x * 40, f.y - b.forward.y * 40, f.z - b.forward.z * 40);
      this.cam.lookAt(f.x, f.y, f.z);
      const half = this.size / 2 / ppm;
      Object.assign(this.cam, { left: -half, right: half, top: half, bottom: -half });
      this.cam.updateProjectionMatrix();
      this.cam.updateMatrixWorld();
      this.scene.updateMatrixWorld(true);
      const r = this.renderer;
      const prevClear = r.getClearColor(new THREE.Color());
      const prevAlpha = r.getClearAlpha();
      r.setClearColor(0x000000, 0);
      try {
        this.pipeline.renderLowRes(this.targets, this.scene, this.cam, [LAYER.MAIN]);
        return this.pipeline.read(this.targets);
      } finally {
        r.setClearColor(prevClear, prevAlpha);
      }
    } finally {
      view.root.removeFromParent();
      view.dispose();
    }
  }
}
