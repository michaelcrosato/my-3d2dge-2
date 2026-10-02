/**
 * The three.js side of the game: builds meshes from level data, mirrors the sim every frame
 * (snapping movers to the art-pixel grid), drives the iso camera, lights and effects.
 *
 * Per-frame cost is kept low: floors, walls and decor are merged meshes, static meshes never
 * recompute matrices, the sun's shadow map is only redrawn when a caster moves or the camera
 * crosses a shadow cell, characters off screen are culled before posing, silhouettes are only
 * drawn when Rapier ray casts report a character hidden, and point lights come from a fixed pool.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { config, configListeners } from '../config';
import { BASES } from '../content/items';
import type { Level } from '../content/level';
import { THEMES, theme as themeOf, type Theme } from '../content/themes';
import type { Hero } from '../sim/hero';
import type { Sim } from '../sim/sim';
import type { Character, Prop } from '../sim/types';
import { AssetLibrary } from './assets';
import { CharacterView, type Equipment, type StatusTint } from './characterView';
import { CreatureView } from './creature/view';
import { itemObject } from './itemMeshes';
import { LightPool } from './lights';
import { CUTAWAY, glowMaterial, toonGradient, toonMaterial, withCutaway, writesNormals } from './materials';
import { isoBasis, snapToGrid, subPixel, type IsoBasis, type V3 } from './pixelGrid';
import { LAYER, type PixelPipeline } from './pixelPipeline';
import { merge } from './geo';
import { decorMesh, propMesh } from './propMeshes';
import { SHRINE_COLORS } from '../sim/mechanics';
import { checkerTexture, crateTexture, floorTexture, wallTexture } from './textures';
import { Vfx } from './vfx';

const CAMERA_YAW = 45;
const CAMERA_PITCH = 30;
const CAMERA_DISTANCE = 40;
const FOLLOW_HEIGHT = 0.9;

const toV3 = (v: THREE.Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });

/** BoxGeometry builds 6 faces of 4 vertices each, in +x, -x, +y, -y, +z, -z order. */
const BOX_TOP_FACE = 2;

/**
 * One geometry for every wall, colored per vertex (sides vs. tops, darker at the foot) with
 * world-space UVs so the brick texture runs continuously across merged boxes.
 */
function wallGeometry(level: Level, gridLevel: boolean): THREE.BufferGeometry | null {
  const top = new THREE.Color(level.wallTopColor);
  const parts = level.walls.map((w) => {
    const t = (w.thickness ?? 0.4) / 2;
    const minX = Math.min(w.from[0], w.to[0]) - t, maxX = Math.max(w.from[0], w.to[0]) + t;
    const minZ = Math.min(w.from[1], w.to[1]) - t, maxZ = Math.max(w.from[1], w.to[1]) + t;
    const g = new THREE.BoxGeometry(maxX - minX, w.height, maxZ - minZ);
    g.translate((minX + maxX) / 2, w.height / 2, (minZ + maxZ) / 2);
    const side = new THREE.Color(w.color ?? level.wallColor);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const c = new THREE.Color();
    for (let v = 0; v < n; v++) {
      const isTop = Math.floor(v / 4) === BOX_TOP_FACE;
      const y = pos.getY(v);
      c.copy(isTop ? top : side);
      if (!isTop && y < 0.01 && gridLevel) c.multiplyScalar(0.72);
      c.toArray(colors, v * 3);
      const x = pos.getX(v), z = pos.getZ(v);
      const nx = Math.abs(nor.getX(v)), ny = Math.abs(nor.getY(v));
      if (ny > 0.5) uv.setXY(v, x / 2, z / 2);
      else if (nx > 0.5) uv.setXY(v, z / 2, y / 2);
      else uv.setXY(v, x / 2, y / 2);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.clearGroups();
    return g;
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Floor quads for every run of floor tiles (greedy rows), UVs into the level floor texture. */
function floorGeometry(level: Level): THREE.BufferGeometry {
  const g = level.grid!;
  const pos: number[] = [], uvs: number[] = [], nor: number[] = [], idx: number[] = [];
  const W = g.cols * g.cell, D = g.rows * g.cell;
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    const b = pos.length / 3;
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      pos.push(x, 0, z);
      nor.push(0, 1, 0);
      uvs.push((x - g.originX) / W, 1 - (z - g.originZ) / D);
    }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  };
  for (let r = 0; r < g.rows; r++) {
    let c = 0;
    while (c < g.cols) {
      // Walls get floor under them too, so low walls never show a gap at their foot.
      const t = g.cells[r * g.cols + c];
      if (t === ' ') {
        c++;
        continue;
      }
      let e = c;
      while (e < g.cols && g.cells[r * g.cols + e] !== ' ') e++;
      quad(g.originX + c * g.cell, g.originZ + r * g.cell, g.originX + e * g.cell, g.originZ + (r + 1) * g.cell);
      c = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

const freeze = (o: THREE.Object3D) => {
  o.matrixAutoUpdate = false;
  o.updateMatrix();
};

type View = CharacterView | CreatureView;

interface StaticLight { x: number; y: number; z: number; color: string; intensity: number; range: number; flicker: number; phase: number }

interface PropView {
  obj: THREE.Group;
  part: THREE.Object3D | null;
  glow: THREE.Object3D | null;
  fx: THREE.Mesh | null;
  light: { y: number; color: THREE.ColorRepresentation; intensity: number; range: number; flicker?: number } | null;
  kind: string;
}

/** Removes a ground-loot object and frees what it owns: its materials, and geometry made for it alone. */
function disposeObject(o: THREE.Object3D) {
  o.removeFromParent();
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of [m.material].flat()) mat?.dispose();
    if (m.userData.ownGeometry) m.geometry.dispose();
  });
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 2.5);
  readonly basis: IsoBasis = isoBasis(CAMERA_YAW, CAMERA_PITCH);
  readonly views = new Map<string, View>();
  readonly crateMeshes = new Map<string, THREE.Mesh>();
  readonly propViews = new Map<string, PropView>();
  readonly pickupViews = new Map<number, THREE.Object3D>();
  readonly vfx = new Vfx();
  readonly lights = new LightPool();
  follow = 'player';
  /** Hero whose equipment the 'player' view wears. */
  hero: Hero | null = null;
  /** The best run racing alongside: its own sim's hero, drawn translucent (Game ghosts). */
  private ghost: { sim: Sim; view: CharacterView } | null = null;
  theme: Theme = THEMES.crypt;
  /** Continuous camera look-at point (world) and its snapped version from the last update. */
  readonly focus = new THREE.Vector3();
  readonly focusSnapped = new THREE.Vector3();
  subPixel = { x: 0, y: 0 };
  private env = new THREE.Group();
  private hemi = new THREE.HemisphereLight(0xc4ccff, 0x3d3446, 1.35);
  private sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  private colliderLines: THREE.LineSegments;
  private tmp = new THREE.Vector3();
  /** Set when a shadow caster moved or shadow settings changed; the shadow map redraws once. */
  private shadowsDirty = true;
  private shadowCell = { x: NaN, z: NaN };
  private sunDir = new THREE.Vector3(0, 1, 0);
  private snapOut: V3 = { x: 0, y: 0, z: 0 };
  private staticLights: StaticLight[] = [];
  private levelBounds = { width: 16, depth: 16, grid: false };
  private time = 0;
  private flames: THREE.Object3D[] = [];
  private dark = false;

  constructor(readonly lib: AssetLibrary) {
    this.scene.add(this.env, this.hemi, this.vfx.group, this.lights.group);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.colliderLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      writesNormals(new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }), 'fx'),
    );
    this.colliderLines.layers.set(LAYER.DEBUG);
    this.colliderLines.frustumCulled = false;
    this.colliderLines.renderOrder = 20;
    this.scene.add(this.colliderLines);
    this.camera.up.set(0, 1, 0);
    configListeners.add((key) => {
      this.shadowsDirty = true;
      if (key === 'render.headScale' || key === 'render.handScale') for (const v of this.views.values()) v.applyProportions();
    });
  }

  buildLevel(level: Level) {
    for (const child of [...this.env.children]) {
      child.removeFromParent();
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
          (m as THREE.MeshToonMaterial).map?.dispose();
          m.dispose();
        }
      });
    }
    this.crateMeshes.clear();
    this.propViews.clear();
    for (const v of this.pickupViews.values()) disposeObject(v);
    this.pickupViews.clear();
    this.vfx.reset();
    this.flames = [];
    const th = level.theme ? themeOf(level.theme) : null;
    this.theme = th ?? THEMES.crypt;
    this.scene.background = new THREE.Color(level.background);
    this.shadowsDirty = true;
    this.shadowCell = { x: NaN, z: NaN };
    const gridLevel = !!level.grid;
    this.levelBounds = { width: level.width, depth: level.depth, grid: gridLevel };

    // Light rig from the theme (or the sandbox defaults).
    this.hemi.color.set(th?.sky ?? 0xc4ccff);
    this.hemi.groundColor.set(th?.ground ?? 0x3d3446);
    this.hemi.intensity = (th ? th.ambient * 1.35 : 1.35) * (level.dark ? 0.22 : 1);
    this.sun.color.set(th?.sun.color ?? 0xfff0dc);
    this.sun.intensity = (th ? th.sun.intensity * 2 : 2.4) * (level.dark ? 0.08 : 1);
    this.dark = !!level.dark;

    if (gridLevel && th) {
      const floor = new THREE.Mesh(floorGeometry(level), toonMaterial(0xffffff, floorTexture(level, th)));
      floor.receiveShadow = true;
      floor.name = 'floor';
      freeze(floor);
      this.env.add(floor);
    } else {
      const floorTex = checkerTexture(level.floor.colorA, level.floor.colorB);
      floorTex.repeat.set(level.width / level.floor.tile / 2, level.depth / level.floor.tile / 2);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(level.width, level.depth), toonMaterial(0xffffff, floorTex));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      floor.name = 'floor';
      freeze(floor);
      this.env.add(floor);
    }

    const walls = wallGeometry(level, gridLevel);
    if (walls) {
      const mat = toonMaterial(0xffffff, th ? wallTexture(th) : null, true);
      const mesh = new THREE.Mesh(walls, gridLevel ? withCutaway(mat) : mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = 'walls';
      freeze(mesh);
      this.env.add(mesh);
    }

    const crateMat = { true: toonMaterial(0xffffff, crateTexture(true)), false: toonMaterial(0xffffff, crateTexture(false)) };
    for (const c of level.crates) {
      const size = c.size ?? 1;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMat[String(!!c.pushable) as 'true' | 'false']);
      mesh.position.set(c.x, (c.y ?? 0) + size / 2, c.z);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = c.id;
      this.env.add(mesh);
      this.crateMeshes.set(c.id, mesh);
    }

    // Decor and static props: merged into one body mesh and one glow mesh.
    this.staticLights = (level.lights ?? []).map((l, i) => ({ ...l, flicker: l.flicker ?? 0, phase: i * 1.7 }));
    const decorBody: THREE.BufferGeometry[] = [], decorGlow: THREE.BufferGeometry[] = [], tallBody: THREE.BufferGeometry[] = [];
    let seed = level.seed ?? 1;
    for (const p of level.props ?? []) {
      seed++;
      const isDecor = p.kind.startsWith('decor:');
      if (!isDecor && p.kind !== 'torch' && p.kind !== 'brazier' && p.kind !== 'pillar') continue;
      const m = isDecor ? decorMesh(p.kind.slice(6), this.theme, seed) : propMesh(p.kind, this.theme, seed);
      if (!m) continue;
      const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y ?? 0, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ((p.yawDeg ?? 0) * Math.PI) / 180, 0)),
        new THREE.Vector3().setScalar(p.scale ?? 1),
      );
      (m.tall ? tallBody : decorBody).push(m.body.clone().applyMatrix4(mat));
      if (m.glow) decorGlow.push(m.glow.clone().applyMatrix4(mat));
      if (m.light && p.kind === 'brazier') this.staticLights.push({ x: p.x, y: m.light.y, z: p.z, color: String(m.light.color), intensity: m.light.intensity, range: m.light.range, flicker: m.light.flicker ?? 0, phase: seed });
    }
    const addMerged = (parts: THREE.BufferGeometry[], material: THREE.Material, name: string, shadow: boolean) => {
      if (!parts.length) return null;
      const mesh = new THREE.Mesh(merge(parts), material);
      parts.forEach((g) => g.dispose());
      mesh.name = name;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      freeze(mesh);
      this.env.add(mesh);
      return mesh;
    };
    addMerged(decorBody, toonMaterial(0xffffff, null, true), 'decor', false);
    addMerged(tallBody, withCutaway(toonMaterial(0xffffff, null, true)), 'decor-tall', true);
    const glowMat = glowMaterial(0xffffff);
    glowMat.vertexColors = true;
    const flames = addMerged(decorGlow, glowMat, 'decor-glow', false);
    if (flames) this.flames.push(flames);

    // Sun: direction from the level; the shadow camera follows the view (see update()).
    const sun = level.sun;
    const az = (sun.azimuthDeg * Math.PI) / 180, el = (sun.elevationDeg * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const ext = gridLevel ? 22 : Math.max(level.width, level.depth) * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 90 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.placeSun(0, 0);
  }

  private placeSun(cx: number, cz: number) {
    this.sun.position.set(cx + this.sunDir.x * 40, this.sunDir.y * 40, cz + this.sunDir.z * 40);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
  }

  /** Create/remove character views to match the sim. */
  syncRoster(sim: Sim) {
    for (const [id, view] of this.views)
      if (!sim.characters.has(id) || sim.characters.get(id)!.preset !== view.preset) {
        view.dispose();
        this.views.delete(id);
      }
    for (const ch of sim.characters.values())
      if (!this.views.has(ch.id)) {
        const view: View = ch.kind === 'creature'
          ? new CreatureView(ch.id, ch.preset, ch.look, ch.scale)
          : new CharacterView(ch.id, ch.preset, this.lib, ch.look);
        this.scene.add(view.root, view.shadow);
        this.views.set(ch.id, view);
      }
  }

  /** Shows (or removes, with null) a replay ghost: the hero of another sim, posed every frame. */
  setGhost(g: { sim: Sim; hero: Hero } | null) {
    if (this.ghost) {
      this.ghost.view.dispose();
      this.ghost = null;
    }
    const p = g?.sim.player;
    if (!g || !p) return;
    const view = new CharacterView('ghost', p.preset, this.lib, p.look);
    view.setEquipment(this.equipmentOf(g.hero));
    view.makeGhost();
    this.scene.add(view.root);
    this.ghost = { sim: g.sim, view };
  }

  private equipmentOf(hero: Hero): Equipment {
    const e = hero.equipment;
    const look = (slot: 'weapon' | 'offhand' | 'helmet') => {
      const it = e[slot];
      return it ? { base: it.base, rarity: it.rarity, seed: it.seed, unique: it.unique } : null;
    };
    return { weapon: look('weapon'), offhand: look('offhand'), helmet: look('helmet'), chest: e.chest ? BASES[e.chest.base]?.look.color ?? null : null };
  }

  private propView(p: Prop): PropView | null {
    let v = this.propViews.get(p.id);
    if (v) return v;
    const m = propMesh(p.kind, this.theme, p.id.length * 31 + Math.round(p.x * 7));
    if (!m) return null;
    const obj = new THREE.Group();
    obj.name = `prop:${p.id}`;
    const body = new THREE.Mesh(m.body, m.tall ? withCutaway(toonMaterial(0xffffff, null, true)) : toonMaterial(0xffffff, null, true));
    body.castShadow = true;
    body.receiveShadow = true;
    obj.add(body);
    let glow: THREE.Object3D | null = null, part: THREE.Object3D | null = null, fx: THREE.Mesh | null = null;
    if (m.fx) {
      fx = new THREE.Mesh(m.fx.geo, writesNormals(new THREE.MeshBasicMaterial({ color: m.fx.color, transparent: true, opacity: m.fx.opacity, depthWrite: false, side: THREE.DoubleSide }), 'fx'));
      fx.layers.set(LAYER.FX);
      fx.renderOrder = 4;
      fx.position.y = 0.03;
      fx.scale.setScalar(p.scale);
      obj.add(fx);
    }
    if (m.glow) {
      const gm = glowMaterial(0xffffff);
      gm.vertexColors = true;
      glow = new THREE.Mesh(m.glow, gm);
      obj.add(glow);
    }
    if (m.part) {
      const pivot = new THREE.Group();
      pivot.position.set(...(m.partAt ?? [0, 0, 0]));
      const pm = new THREE.Mesh(m.part, toonMaterial(0xffffff, null, true));
      pm.position.set(-(m.partAt?.[0] ?? 0), -(m.partAt?.[1] ?? 0), -(m.partAt?.[2] ?? 0));
      pivot.add(pm);
      obj.add(pivot);
      part = pivot;
    }
    obj.position.set(p.x, p.y, p.z);
    obj.rotation.y = p.yaw;
    // Field props scale only their overlay (the radius), not the fixture in the middle.
    if (!m.fx) obj.scale.setScalar(p.scale);
    this.env.add(obj);
    v = { obj, part, glow, fx, light: m.light ?? null, kind: p.kind };
    this.propViews.set(p.id, v);
    return v;
  }

  /** Mirror sim state into the scene. alpha interpolates between the last two sim steps. */
  update(sim: Sim, alpha: number, pipeline: PixelPipeline, dt = 1 / 60) {
    this.time += dt;
    const pixel = config['render.pixelMode'];
    const snapMovers = pixel && config['render.snapMovers'];
    const ppm = config['render.pixelsPerMeter'];
    const snap = (p: V3): V3 => (snapMovers ? snapToGrid(p, this.basis, ppm, this.snapOut) : p);
    const silhouettes = pixel && config['render.silhouettes'];
    toonGradient();
    this.lights.begin();

    // View rectangle in meters around the current focus (for culling).
    const hw = pipeline.width / 2 / ppm + 3, hh = pipeline.height / 2 / ppm + 3;
    const fx = this.focus.x, fy = this.focus.y, fz = this.focus.z;
    const onScreen = (x: number, y: number, z: number) => {
      const dx = x - fx, dy = y - fy, dz = z - fz;
      const sx = dx * this.basis.right.x + dy * this.basis.right.y + dz * this.basis.right.z;
      const sy = dx * this.basis.up.x + dy * this.basis.up.y + dz * this.basis.up.z;
      return Math.abs(sx) < hw && Math.abs(sy) < hh;
    };

    let followPos: V3 | null = null;
    for (const ch of sim.characters.values()) {
      const view = this.views.get(ch.id);
      if (!view) continue;
      const p = {
        x: ch.prevPos.x + (ch.pos.x - ch.prevPos.x) * alpha,
        y: ch.prevPos.y + (ch.pos.y - ch.prevPos.y) * alpha,
        z: ch.prevPos.z + (ch.pos.z - ch.prevPos.z) * alpha,
      };
      if (ch.id === this.follow) followPos = p;
      const visible = ch.id === this.follow || onScreen(p.x, p.y, p.z);
      view.root.visible = visible;
      view.shadow.visible = visible && config['render.blobShadows'];
      if (!visible) continue;
      // Corpses sink into the floor before despawning.
      const sink = ch.state === 'dead' && (ch.monster || ch.owner) ? Math.max(0, ch.deadTime - 2.5) * 0.5 : 0;
      const s = snap({ x: p.x, y: p.y + ch.lift - sink, z: p.z });
      view.root.position.set(s.x, s.y, s.z);
      const sp = pixel ? ch.sprite : null;
      view.root.rotation.y = sp ? sp.yaw : ch.yaw + ch.spin;
      if (view instanceof CreatureView) view.animate(ch, sim, pixel);
      else {
        view.root.scale.setScalar(ch.scale);
        view.pose(sp ?? ch.anim);
        if (ch.id === this.follow && this.hero) view.setEquipment(this.equipmentOf(this.hero));
      }
      view.setFlash(ch.flash > 0, statusTint(ch));
      // Silhouettes cost a second skinned draw per mesh: only draw them when something hides the character.
      view.setSilhouettes(silhouettes && ch.state !== 'dead' && (ch.id === this.follow || ch.team === 'enemy' && !!ch.monster && ch.monster.rarity !== 'normal') && sim.occluded(ch.id, this.basis.forward, this.basis.right));
      const ground = ch.groundY;
      const height = Math.max(0, p.y + ch.lift - ground);
      const sh = snap({ x: p.x, y: ground + 0.012, z: p.z });
      view.shadow.position.set(sh.x, ground + 0.012, sh.z);
      view.shadow.visible = config['render.blobShadows'] && height < 3 && sink < 0.5;
      view.shadow.scale.setScalar(Math.max(0.4, 1 - height * 0.3) * Math.max(0.7, ch.scale) * (ch.kind === 'creature' ? 1.6 : 1));
      if (ch.look.glow && ch.state !== 'dead' && ch.monster) {
        const glow = Object.values(ch.look.glow)[0];
        if (glow && (ch.monster.rarity !== 'normal' || ch.scale > 1.3)) this.lights.add({ x: p.x, y: 1.4 * ch.scale, z: p.z, color: glow, intensity: 1.2, range: 3.5 * ch.scale, priority: 1 });
      }
    }
    const gh = this.ghost, gp = gh?.sim.player;
    if (gh && gp) {
      const p = { x: gp.prevPos.x + (gp.pos.x - gp.prevPos.x) * alpha, y: gp.prevPos.y + (gp.pos.y - gp.prevPos.y) * alpha, z: gp.prevPos.z + (gp.pos.z - gp.prevPos.z) * alpha };
      gh.view.root.visible = gp.state !== 'dead' && onScreen(p.x, p.y, p.z);
      if (gh.view.root.visible) {
        const s = snap({ x: p.x, y: p.y + gp.lift, z: p.z });
        gh.view.root.position.set(s.x, s.y, s.z);
        const sp = pixel ? gp.sprite : null;
        gh.view.root.rotation.y = sp ? sp.yaw : gp.yaw + gp.spin;
        gh.view.pose(sp ?? gp.anim);
      }
    }
    for (const c of sim.crates.values()) {
      const mesh = this.crateMeshes.get(c.id);
      if (!mesh) continue;
      const s = snap({
        x: c.prevPos.x + (c.pos.x - c.prevPos.x) * alpha,
        y: c.prevPos.y + (c.pos.y - c.prevPos.y) * alpha + c.size / 2,
        z: c.prevPos.z + (c.pos.z - c.prevPos.z) * alpha,
      });
      if (mesh.position.x !== s.x || mesh.position.y !== s.y || mesh.position.z !== s.z) {
        mesh.position.set(s.x, s.y, s.z);
        this.shadowsDirty = true;
      }
    }
    this.updateProps(sim, alpha, snap, onScreen);
    this.updatePickups(sim, snap, onScreen);

    // Static lights (torches) with flicker.
    for (const l of this.staticLights) {
      if (!onScreen(l.x, l.y, l.z)) continue;
      const f = l.flicker ? 1 - l.flicker * (0.5 + 0.5 * Math.sin(this.time * 9 + l.phase) * Math.sin(this.time * 13.7 + l.phase * 2)) : 1;
      this.lights.add({ x: l.x, y: l.y, z: l.z, color: l.color, intensity: l.intensity * f, range: l.range, priority: 0 });
    }
    for (const f of this.flames) f.scale.y = 1;
    const hero = sim.characters.get(this.follow);
    if (hero && this.levelBounds.grid) {
      // The hero's lantern: stronger in dark themes, scaled by light radius.
      const lr = hero.state !== 'dead' && sim.characters.has(hero.id) ? sim.stats(hero).get('lightRadius') / 100 : 1;
      const dark = this.dark ? 1.1 : Math.max(0, 1.2 - this.theme.ambient);
      this.lights.add({ x: hero.pos.x, y: 2.2, z: hero.pos.z, color: '#ffe0b0', intensity: 0.8 + dark * 3, range: (this.dark ? 4.5 * 1.6 : 5 + dark * 6) * lr, priority: 4 });
    }

    this.vfx.update(sim, dt, this.lights, this.follow);

    this.sun.castShadow = config['render.shadows'];
    const shadowMap = pipeline.renderer.shadowMap;
    shadowMap.autoUpdate = false;

    // Camera: follow target. Locked mode follows the target's SNAPPED position, so the target
    // keeps the exact same screen pixels while the world scrolls in whole art pixels.
    const followView = this.views.get(this.follow);
    if (followPos && followView) {
      if (config['render.smoothScroll'] || !snapMovers) this.focus.set(followPos.x, followPos.y + FOLLOW_HEIGHT, followPos.z);
      else this.focus.copy(followView.root.position).setY(followView.root.position.y + FOLLOW_HEIGHT);
    }
    const shake = this.vfx.shake * config['ui.screenShake'];
    const shakeVec = shake > 0.3 && pixel ? { x: Math.round((Math.random() - 0.5) * shake) / ppm, y: Math.round((Math.random() - 0.5) * shake) / ppm } : { x: 0, y: 0 };
    const snapCam = pixel && config['render.snapCamera'];
    const fpos = toV3(this.focus);
    fpos.x += this.basis.right.x * shakeVec.x + this.basis.up.x * shakeVec.y;
    fpos.y += this.basis.up.y * shakeVec.y;
    fpos.z += this.basis.right.z * shakeVec.x + this.basis.up.z * shakeVec.y;
    const f = snapCam ? snapToGrid(fpos, this.basis, ppm) : fpos;
    this.focusSnapped.set(f.x, f.y, f.z);
    const sub = snapCam && config['render.smoothScroll'] ? subPixel(toV3(this.focus), this.basis, ppm) : { x: 0, y: 0 };
    this.subPixel = sub;
    this.placeCamera(this.focusSnapped, pipeline.width, pipeline.height, ppm);

    // Shadow camera follows the view in 6 m steps; each step redraws the shadow map once.
    if (this.levelBounds.grid) {
      const cx = Math.round(this.focus.x / 6) * 6, cz = Math.round(this.focus.z / 6) * 6;
      if (cx !== this.shadowCell.x || cz !== this.shadowCell.z) {
        this.shadowCell = { x: cx, z: cz };
        this.placeSun(cx, cz);
        this.shadowsDirty = true;
      }
    }
    if (this.shadowsDirty) {
      shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }
    this.lights.commit(this.focus.x, this.focus.z, Math.max(hw, hh) + 4);

    // Wall cutaway around the hero (view space).
    if (hero && this.levelBounds.grid) {
      this.tmp.set(hero.pos.x, hero.pos.y + 1.0, hero.pos.z).applyMatrix4(this.camera.matrixWorldInverse);
      CUTAWAY.uCut.value.set(this.tmp.x, this.tmp.y, this.tmp.z, 2.6);
      CUTAWAY.uCutOn.value = 1;
    } else CUTAWAY.uCutOn.value = 0;

    if (config['render.colliders']) {
      const { vertices, colors } = sim.world.debugRender();
      const g = this.colliderLines.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      this.colliderLines.visible = true;
    } else this.colliderLines.visible = false;
  }

  private updateProps(sim: Sim, alpha: number, snap: (p: V3) => V3, onScreen: (x: number, y: number, z: number) => boolean) {
    const alive = new Set<string>();
    for (const p of sim.props.values()) {
      const v = this.propView(p);
      if (!v) continue;
      alive.add(p.id);
      if (p.dead) {
        v.obj.visible = false;
        continue;
      }
      const x = p.prevX + (p.x - p.prevX) * alpha, z = p.prevZ + (p.z - p.prevZ) * alpha;
      const s = snap({ x, y: p.y, z });
      if (v.obj.position.x !== s.x || v.obj.position.z !== s.z) {
        v.obj.position.set(s.x, s.y, s.z);
        if (p.body) this.shadowsDirty = true;
      }
      if (p.body) {
        const q = p.body.rotation();
        v.obj.quaternion.set(q.x, q.y, q.z, q.w);
      }
      v.obj.visible = onScreen(x, p.y, z);
      // Hit wobble.
      const wob = p.timer > 0 && (v.kind === 'urn' || v.kind === 'crate' || v.kind === 'barrel' || v.kind === 'coffin') ? Math.sin(p.timer * 2) * 0.12 : 0;
      v.obj.rotation.z = wob;
      if (v.part && v.kind === 'chest') v.part.rotation.x = p.state === 'used' ? -1.9 : 0;
      if (v.glow) v.glow.rotation.y = this.time * (v.kind === 'portal' || v.kind === 'rift' ? 2 : 0.6);
      let lightK = p.state === 'used' && v.kind !== 'portal' ? 0.3 : 1;
      let lightColor: THREE.ColorRepresentation = v.light?.color ?? '#ffffff';
      switch (v.kind) {
        case 'spikes':
          if (v.part) v.part.position.y = p.state === 'up' ? 0 : p.state === 'warn' ? -0.28 + Math.sin(this.time * 60) * 0.02 : -0.42;
          break;
        case 'keg':
          if (p.state === 'lit') {
            v.obj.rotation.z = Math.sin(this.time * 40) * 0.06;
            if (v.glow) v.glow.scale.setScalar(1 + Math.sin(this.time * 30) * 0.4);
            this.lights.add({ x: p.x, y: 1.1, z: p.z, color: '#ff9a3d', intensity: 2.5, range: 3, priority: 2 });
            if (Math.random() < 0.5) this.vfx.emit(p.x + 0.1, 1.1, p.z, 1, { color: '#ffd070', speed: 0.6, up: 1.5, life: 0.3, size: 0.06 });
          }
          break;
        case 'shrine': {
          const c = SHRINE_COLORS[(p.data.buff as string) ?? 'power'] ?? '#ffffff';
          lightColor = c;
          if (v.glow) {
            v.glow.visible = p.state !== 'used';
            ((v.glow as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(c);
            v.glow.position.y = Math.sin(this.time * 2) * 0.08;
          }
          lightK = p.state === 'used' ? 0 : 1;
          break;
        }
        case 'pylon': {
          // Dark crystal when idle; bright and humming while charged, fading in the last second.
          const on = p.state === 'charged';
          const fade = on ? Math.min(1, p.timer / 60) : 0;
          if (v.glow) {
            ((v.glow as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(on ? '#dff4ff' : '#2a4a5a');
            v.glow.position.y = on ? Math.sin(this.time * 12 + p.x) * 0.04 : 0;
          }
          lightK = on ? (0.6 + 0.4 * fade) * (1 + Math.sin(this.time * 20 + p.z) * 0.15) : 0;
          if (on && v.obj.visible && Math.random() < 0.25) this.vfx.emit(p.x, 1.9, p.z, 1, { color: '#cdeeff', speed: 0.6, up: 0.6, life: 0.25, size: 0.06, gravity: 0 });
          break;
        }
        case 'beacon':
          if (v.glow) v.glow.visible = p.state === 'lit';
          lightK = p.state === 'lit' ? 1 + Math.sin(this.time * 9 + p.x) * 0.12 : 0;
          break;
        case 'vent':
          if (v.glow) ((v.glow as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(p.state === 'erupt' ? '#fff0c0' : p.state === 'warn' ? '#ff9a3d' : '#5a2010');
          lightK = p.state === 'erupt' ? 1 : p.state === 'warn' ? 0.4 : 0;
          if (p.state === 'erupt' && v.obj.visible) {
            this.vfx.emit(p.x, 0.2, p.z, 4, { color: Math.random() < 0.5 ? '#ff6a2a' : '#ffd070', speed: 0.8, up: 7, life: 0.45, size: 0.18, gravity: -2 });
            this.lights.add({ x: p.x, y: 1.2, z: p.z, color: '#ff7a3a', intensity: 4, range: 6, priority: 2 });
          } else if (p.state === 'warn' && Math.random() < 0.3) this.vfx.emit(p.x, 0.15, p.z, 1, { color: '#ff9a3d', speed: 0.3, up: 1.5, life: 0.4, size: 0.08 });
          break;
        case 'well':
          if (v.fx) v.fx.rotation.y = -this.time * 2.5;
          if (v.obj.visible && Math.random() < 0.6) {
            const a = Math.random() * Math.PI * 2, r = p.scale * (0.6 + Math.random() * 0.4);
            this.vfx.emit(p.x + Math.cos(a) * r, 0.15, p.z + Math.sin(a) * r, 1, { color: '#9a8cff', speed: 0.2, up: 0.4, life: 0.5, size: 0.08, gravity: 0 });
          }
          break;
        case 'chrono':
          if (v.fx) ((v.fx.material) as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(this.time * 1.5) * 0.05;
          if (v.glow) v.glow.rotation.y = this.time * 0.4;
          break;
        case 'launchpad':
          if (v.glow) v.glow.position.y = p.timer > 0 ? 0.1 : Math.abs(Math.sin(this.time * 3)) * 0.08;
          break;
        case 'totem':
          lightK = 0.7 + Math.sin(this.time * 4) * 0.3;
          v.obj.rotation.z = p.timer > 0 ? Math.sin(p.timer * 2) * 0.1 : 0;
          break;
      }
      if (v.light && v.obj.visible && lightK > 0) this.lights.add({ x: p.x, y: p.y + v.light.y, z: p.z, color: lightColor, intensity: v.light.intensity * lightK, range: v.light.range, priority: 1 });
    }
    for (const [id, v] of this.propViews) {
      if (alive.has(id)) continue;
      // Broken barrels, spent kegs, finished boulders: their meshes were built for them alone.
      v.obj.removeFromParent();
      v.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of [m.material].flat()) mat.dispose();
      });
      this.propViews.delete(id);
    }
  }

  private updatePickups(sim: Sim, snap: (p: V3) => V3, onScreen: (x: number, y: number, z: number) => boolean) {
    const alive = new Set<number>();
    for (const p of sim.pickups) {
      alive.add(p.id);
      let o = this.pickupViews.get(p.id);
      if (!o) {
        o = pickupObject(p.kind, p.item ? { base: p.item.base, rarity: p.item.rarity, seed: p.item.seed, unique: p.item.unique } : null, p.orb);
        this.scene.add(o);
        this.pickupViews.set(p.id, o);
      }
      // Pop out of the corpse in an arc, then rest on the floor.
      const u = p.t;
      const x = p.fromX + (p.x - p.fromX) * u, z = p.fromZ + (p.z - p.fromZ) * u;
      const y = 4 * u * (1 - u) * 1.2 + (p.kind === 'orb' ? 0.45 + Math.sin(this.time * 4 + p.id) * 0.08 : 0.08);
      const s = snap({ x, y, z });
      o.position.set(s.x, s.y, s.z);
      o.visible = onScreen(x, y, z);
      if (p.kind === 'item') {
        o.rotation.y = p.id * 1.3;
        const r = p.item!.rarity;
        if ((r === 'rare' || r === 'unique') && o.visible) {
          const color = r === 'unique' ? '#ff9a3d' : '#ffe14d';
          this.lights.add({ x: p.x, y: 0.8, z: p.z, color, intensity: 1.6, range: 3.5, priority: 2 });
        }
      }
    }
    for (const [id, o] of this.pickupViews) {
      if (alive.has(id)) continue;
      disposeObject(o);
      this.pickupViews.delete(id);
    }
  }

  /** Orthographic camera looking at `focus`, sized so one low-res texel = 1/ppm meters. */
  placeCamera(focus: THREE.Vector3, width: number, height: number, ppm: number) {
    const b = this.basis;
    this.camera.position.set(
      focus.x - b.forward.x * CAMERA_DISTANCE,
      focus.y - b.forward.y * CAMERA_DISTANCE,
      focus.z - b.forward.z * CAMERA_DISTANCE,
    );
    this.camera.lookAt(focus);
    const hw = width / 2 / ppm, hh = height / 2 / ppm;
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** World point -> low-res target pixel (x right, y down from the top-left of the target). */
  project(p: THREE.Vector3, width: number, height: number): { x: number; y: number } {
    this.tmp.copy(p).project(this.camera);
    return { x: ((this.tmp.x + 1) / 2) * width, y: ((1 - this.tmp.y) / 2) * height };
  }
}

function statusTint(ch: Character): StatusTint {
  if (ch.state === 'dead' || !ch.statuses.length) return 'none';
  let best: StatusTint = 'none';
  for (const s of ch.statuses) {
    if (s.id === 'freeze') return 'frozen';
    if (s.id === 'shielded') best = 'shielded';
    else if (best === 'none') best = s.id === 'ignite' ? 'burning' : s.id === 'shock' ? 'shocked' : s.id === 'poison' ? 'poisoned' : s.id === 'chill' || s.id === 'slowed' ? 'chilled' : s.id === 'empowered' || s.id === 'enraged' || s.id === 'shrouded' ? 'empowered' : 'none';
  }
  return best;
}

const goldGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.07, 0.07, 0.025, 8);
    g.deleteAttribute('uv');
    g.translate(Math.cos(i * 2.4) * 0.1, 0.02 + i * 0.026, Math.sin(i * 2.4) * 0.1);
    parts.push(g);
  }
  return mergeGeometries(parts);
})();

function pickupObject(kind: string, item: { base: string; rarity: 'normal' | 'magic' | 'rare' | 'unique'; seed: number; unique?: string } | null, orb?: string): THREE.Object3D {
  if (kind === 'item' && item) {
    const g = itemObject(item);
    g.rotation.z = Math.PI / 2;
    const holder = new THREE.Group();
    g.position.y = 0.05;
    holder.add(g);
    if (item.rarity === 'rare' || item.rarity === 'unique') {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.16, 3, 6, 1, true),
        writesNormals(new THREE.MeshBasicMaterial({ color: item.rarity === 'unique' ? '#ff9a3d' : '#ffe14d', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }), 'fx'),
      );
      beam.position.y = 1.5;
      beam.userData.ownGeometry = true;
      beam.layers.set(LAYER.FX);
      holder.add(beam);
    }
    return holder;
  }
  if (kind === 'orb') {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), glowMaterial(orb === 'mana' ? '#5a8aff' : '#ff3a4a'));
    m.userData.ownGeometry = true;
    return m;
  }
  const m = new THREE.Mesh(goldGeo, glowMaterial('#ffd84a'));
  return m;
}
