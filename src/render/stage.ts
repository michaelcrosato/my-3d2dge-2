/**
 * The three.js side of the game: builds meshes from level data, mirrors the sim every frame
 * (snapping movers to the art-pixel grid), drives the iso camera, and owns the capture helpers.
 *
 * Per-frame cost is kept low: all walls are one merged mesh, static meshes never recompute
 * matrices, the shadow map is only redrawn when a shadow caster moves, and silhouettes are only
 * drawn for characters that Rapier ray casts report as hidden behind walls or crates.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { config, configListeners } from '../config';
import type { Level } from '../content/level';
import type { Sim } from '../sim/sim';
import { AssetLibrary } from './assets';
import { CharacterView } from './characterView';
import { toonGradient, toonMaterial, writesNormals } from './materials';
import { isoBasis, snapToGrid, subPixel, type IsoBasis, type V3 } from './pixelGrid';
import { LAYER, type PixelPipeline } from './pixelPipeline';

const CAMERA_YAW = 45;
const CAMERA_PITCH = 30;
const CAMERA_DISTANCE = 40;
const FOLLOW_HEIGHT = 0.9;

function checkerTexture(a: string, b: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 2, 2);
  g.fillStyle = b;
  g.fillRect(1, 0, 1, 1);
  g.fillRect(0, 1, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function crateTexture(pushable: boolean): THREE.Texture {
  const n = 24;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = pushable ? '#b98150' : '#8a5a36';
  g.fillRect(0, 0, n, n);
  g.fillStyle = pushable ? '#d39a62' : '#9d6a41';
  for (let y = 3; y < n - 3; y += 6) g.fillRect(3, y, n - 6, 3);
  g.fillStyle = pushable ? '#4d4a56' : '#5a3a22';
  g.fillRect(0, 0, n, 3);
  g.fillRect(0, n - 3, n, 3);
  g.fillRect(0, 0, 3, n);
  g.fillRect(n - 3, 0, 3, n);
  if (!pushable) {
    for (let i = 3; i < n - 3; i++) g.fillRect(i, i, 2, 2);
  } else {
    g.fillStyle = '#8f8a99';
    g.fillRect(n / 2 - 1, 0, 2, n);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

const toV3 = (v: THREE.Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });

/** BoxGeometry builds 6 faces of 4 vertices each, in +x, -x, +y, -y, +z, -z order. */
const BOX_TOP_FACE = 2;

/** One geometry for every wall, colored per vertex (sides vs. tops), so walls cost one draw call per pass. */
function wallGeometry(level: Level): THREE.BufferGeometry | null {
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
    for (let v = 0; v < n; v++) (Math.floor(v / 4) === BOX_TOP_FACE ? top : side).toArray(colors, v * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.clearGroups();
    return g;
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

const freeze = (o: THREE.Object3D) => {
  o.matrixAutoUpdate = false;
  o.updateMatrix();
};

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 2.5);
  readonly basis: IsoBasis = isoBasis(CAMERA_YAW, CAMERA_PITCH);
  readonly views = new Map<string, CharacterView>();
  readonly crateMeshes = new Map<string, THREE.Mesh>();
  follow = 'player';
  /** Continuous camera look-at point (world) and its snapped version from the last update. */
  readonly focus = new THREE.Vector3();
  readonly focusSnapped = new THREE.Vector3();
  subPixel = { x: 0, y: 0 };
  private env = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  private colliderLines: THREE.LineSegments;
  private tmp = new THREE.Vector3();
  /** Set when a shadow caster moved or shadow settings changed; the shadow map redraws once. */
  private shadowsDirty = true;
  private snapOut: V3 = { x: 0, y: 0, z: 0 };

  constructor(readonly lib: AssetLibrary) {
    this.scene.add(this.env);
    this.scene.add(new THREE.HemisphereLight(0xc4ccff, 0x3d3446, 1.35));
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
    this.scene.background = new THREE.Color(level.background);
    this.shadowsDirty = true;

    const floorTex = checkerTexture(level.floor.colorA, level.floor.colorB);
    floorTex.repeat.set(level.width / level.floor.tile / 2, level.depth / level.floor.tile / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(level.width, level.depth), toonMaterial(0xffffff, floorTex));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    freeze(floor);
    this.env.add(floor);

    const walls = wallGeometry(level);
    if (walls) {
      const mesh = new THREE.Mesh(walls, toonMaterial(0xffffff, null, true));
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

    const az = (level.sun.azimuthDeg * Math.PI) / 180, el = (level.sun.elevationDeg * Math.PI) / 180;
    this.sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(30);
    this.sun.target.position.set(0, 0, 0);
    const ext = Math.max(level.width, level.depth) * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
    this.sun.shadow.camera.updateProjectionMatrix();
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
        const view = new CharacterView(ch.id, ch.preset, this.lib);
        this.scene.add(view.root, view.shadow);
        this.views.set(ch.id, view);
      }
  }

  /** Mirror sim state into the scene. alpha interpolates between the last two sim steps. */
  update(sim: Sim, alpha: number, pipeline: PixelPipeline) {
    const pixel = config['render.pixelMode'];
    const snapMovers = pixel && config['render.snapMovers'];
    const ppm = config['render.pixelsPerMeter'];
    const snap = (p: V3): V3 => (snapMovers ? snapToGrid(p, this.basis, ppm, this.snapOut) : p);
    const silhouettes = pixel && config['render.silhouettes'];
    toonGradient();

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
      const s = snap(p);
      view.root.position.set(s.x, s.y, s.z);
      const sp = pixel ? ch.sprite : null;
      view.root.rotation.y = sp ? sp.yaw : ch.yaw;
      view.pose(sp ?? ch.anim);
      view.setFlash(ch.flash > 0);
      // Silhouettes cost a second skinned draw per mesh: only draw them when something hides the character.
      view.setSilhouettes(silhouettes && sim.occluded(ch.id, this.basis.forward, this.basis.right));
      const ground = ch.groundY;
      const height = Math.max(0, p.y - ground);
      const sh = snap({ x: p.x, y: ground + 0.012, z: p.z });
      view.shadow.position.set(sh.x, ground + 0.012, sh.z);
      view.shadow.visible = config['render.blobShadows'] && height < 1.5;
      view.shadow.scale.setScalar(Math.max(0.4, 1 - height * 0.35));
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
    this.sun.castShadow = config['render.shadows'];
    const shadowMap = pipeline.renderer.shadowMap;
    shadowMap.autoUpdate = false;
    if (this.shadowsDirty) {
      shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }

    // Camera: follow target. Locked mode follows the target's SNAPPED position, so the target
    // keeps the exact same screen pixels while the world scrolls in whole art pixels.
    const followView = this.views.get(this.follow);
    if (followPos && followView) {
      if (config['render.smoothScroll'] || !snapMovers) this.focus.set(followPos.x, followPos.y + FOLLOW_HEIGHT, followPos.z);
      else this.focus.copy(followView.root.position).setY(followView.root.position.y + FOLLOW_HEIGHT);
    }
    const snapCam = pixel && config['render.snapCamera'];
    const f = snapCam ? snapToGrid(toV3(this.focus), this.basis, ppm) : toV3(this.focus);
    this.focusSnapped.set(f.x, f.y, f.z);
    const sub = snapCam && config['render.smoothScroll'] ? subPixel(toV3(this.focus), this.basis, ppm) : { x: 0, y: 0 };
    this.subPixel = sub;
    this.placeCamera(this.focusSnapped, pipeline.width, pipeline.height, ppm);

    if (config['render.colliders']) {
      const { vertices, colors } = sim.world.debugRender();
      const g = this.colliderLines.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      this.colliderLines.visible = true;
    } else this.colliderLines.visible = false;
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
