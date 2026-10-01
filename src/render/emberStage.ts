import * as T from "three/webgpu";
import { vec4, uv, uniform } from "three/tsl";
import { pixelationPass } from "three/addons/tsl/display/PixelationPassNode.js";
import {
  THEMES,
  MECHANICS,
  type Encounter,
  type CameraMode,
} from "../content/emberdeep";
import type { Run, Effect } from "../sim/run";
import { ProceduralRig } from "./proceduralRig";
const rarityColor = {
  common: "#dbd1b0",
  magic: "#84c1ee",
  rare: "#f1d17b",
  legendary: "#fca166",
};
/** Shared GPU/GL2 TSL pipeline: nearest pixel sampling, depth/normal edges, quantized color. */
export class EmberStage {
  renderer: T.WebGPURenderer;
  scene = new T.Scene();
  camera = new T.OrthographicCamera(-12, 12, 8, -8, 0.1, 150);
  post: T.RenderPipeline;
  pixel;
  env = new T.Group();
  dynamic = new T.Group();
  rigs = new Map<string, ProceduralRig>();
  fxObjects = new Map<number, T.Object3D>();
  bars = new Map<string, T.Group>();
  warnings = new Map<string, T.Mesh>();
  drops = new Map<string, T.Group>();
  bullets = new Map<number, T.Mesh>();
  features = new Map<string, T.Group>();
  private encounter: Encounter | null = null;
  private width = 0;
  private height = 0;
  private yaw = Math.PI / 4;
  private pitch = 0.66;
  private mode: CameraMode = "iso";
  private focus = new T.Vector3();
  private gate: T.Group | null = null;
  pixelMode = true;
  private pixelSize = uniform(3);
  constructor(
    readonly canvas: HTMLCanvasElement,
    forceWebGL = false,
  ) {
    this.renderer = new T.WebGPURenderer({
      canvas,
      antialias: false,
      forceWebGL,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.BasicShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.scene.add(this.env, this.dynamic);
    this.scene.add(new T.HemisphereLight("#d4c9d6", "#484250", 2.0));
    const sun = new T.DirectionalLight("#ffe0b5", 3.2);
    sun.position.set(-8, 15, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -20,
      right: 20,
      top: 20,
      bottom: -20,
      near: 0.1,
      far: 65,
    });
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
    this.pixel = pixelationPass(
      this.scene,
      this.camera,
      this.pixelSize,
      0.22,
      0.5,
    );
    this.pixel.updateBeforeType = T.NodeUpdateType.RENDER;
    const vignette = uv().sub(0.5).length().mul(0.26);
    const quantized = this.pixel.rgb
      .mul(64)
      .round()
      .div(64)
      .mul(vignette.oneMinus());
    this.post = new T.RenderPipeline(this.renderer, vec4(quantized, 1));
  }
  async init() {
    await this.renderer.init();
    this.resize();
  }
  private material(color: string, emissive = false) {
    return new T.MeshStandardMaterial({
      color,
      roughness: 0.9,
      flatShading: true,
      ...(emissive ? { emissive: color, emissiveIntensity: 0.65 } : {}),
    });
  }
  private mesh(
    geo: T.BufferGeometry,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Object3D = this.env,
  ) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  private box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    parent: T.Object3D = this.env,
  ) {
    return this.mesh(
      new T.BoxGeometry(w, h, d),
      this.material(color),
      x,
      y,
      z,
      parent,
    );
  }
  private ring(
    x: number,
    z: number,
    r: number,
    color: string,
    parent: T.Object3D = this.env,
  ) {
    const mesh = this.mesh(
      new T.RingGeometry(r * 0.88, r, 32),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: T.DoubleSide,
        depthWrite: false,
      }),
      x,
      0.035,
      z,
      parent,
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }
  private disposeObject(o: T.Object3D, geometries = true) {
    o.traverse((child) => {
      if (child instanceof T.Mesh) {
        if (geometries) child.geometry.dispose();
        for (const m of Array.isArray(child.material)
          ? child.material
          : [child.material]) {
          if ("map" in m && m.map instanceof T.Texture) m.map.dispose();
          m.dispose();
        }
      }
    });
    o.removeFromParent();
  }
  private clear() {
    for (const r of this.rigs.values()) {
      r.root.removeFromParent();
      r.dispose();
    }
    this.rigs.clear();
    for (const o of this.fxObjects.values())
      this.disposeObject(o, o.userData.kind !== "ghost");
    this.fxObjects.clear();
    for (const child of [...this.env.children]) this.disposeObject(child);
    for (const child of [...this.dynamic.children]) this.disposeObject(child);
    this.bars.clear();
    this.warnings.clear();
    this.drops.clear();
    this.bullets.clear();
    this.features.clear();
  }
  build(run: Run) {
    this.clear();
    this.encounter = run.encounter;
    const e = run.encounter,
      L = e.level,
      t = THEMES[e.theme];
    this.scene.background = new T.Color(t.background);
    this.focus.set(run.player.pos.x, 0, run.player.pos.z);
    const tile = new T.BoxGeometry(0.98, 0.14, 0.98),
      mat = this.material("#ffffff"),
      floor = new T.InstancedMesh(
        tile,
        mat,
        Math.floor(L.width) * Math.floor(L.depth),
      );
    const dummy = new T.Object3D();
    let index = 0;
    for (let x = 0; x < L.width; x++)
      for (let z = 0; z < L.depth; z++) {
        dummy.position.set(x - L.width / 2 + 0.5, -0.07, z - L.depth / 2 + 0.5);
        dummy.updateMatrix();
        floor.setMatrixAt(index, dummy.matrix);
        floor.setColorAt(index, new T.Color((x + z) % 2 ? t.floor : t.tile));
        index++;
      }
    floor.receiveShadow = true;
    this.env.add(floor);
    this.box(0, -0.32, 0, L.width + 0.3, 0.45, L.depth + 0.3, t.wall);
    for (const w of L.walls) {
      const thickness = w.thickness ?? 0.4,
        wx = Math.abs(w.to[0] - w.from[0]) + thickness,
        wz = Math.abs(w.to[1] - w.from[1]) + thickness,
        x = (w.from[0] + w.to[0]) / 2,
        z = (w.from[1] + w.to[1]) / 2;
      this.box(x, w.height / 2, z, wx, w.height, wz, t.wall);
      this.box(x, w.height + 0.07, z, wx + 0.08, 0.14, wz + 0.08, t.cap);
    }
    for (const [x, z] of [
      [-L.width / 2 + 1, -L.depth / 2 + 1],
      [L.width / 2 - 1, -L.depth / 2 + 1],
      [-L.width / 2 + 1, L.depth / 2 - 1],
      [L.width / 2 - 1, L.depth / 2 - 1],
    ]) {
      this.box(x, 0.4, z, 0.5, 0.8, 0.5, "#4d4249");
      this.mesh(
        new T.ConeGeometry(0.22, 0.5, 5),
        this.material(t.accent, true),
        x,
        1,
        z,
      );
      const light = new T.PointLight(t.light, 18, 9, 2);
      light.position.set(x, 1.5, z);
      this.env.add(light);
    }
    this.gate = new T.Group();
    this.gate.position.set(e.exit.x, 0, e.exit.z);
    this.env.add(this.gate);
    this.ring(0, 0, 1.5, t.accent, this.gate);
    this.box(-1, 1.2, 0, 0.3, 2.4, 0.4, t.cap, this.gate);
    this.box(1, 1.2, 0, 0.3, 2.4, 0.4, t.cap, this.gate);
    this.box(0, 2.4, 0, 2.3, 0.3, 0.4, t.cap, this.gate);
    this.mesh(
      new T.PlaneGeometry(1.7, 2.2),
      new T.MeshBasicMaterial({
        color: t.accent,
        transparent: true,
        opacity: 0.17,
        side: T.DoubleSide,
        depthWrite: false,
      }),
      0,
      1.2,
      0,
      this.gate,
    );
    if (!e.depth) {
      this.ring(0, 1, 3, "#947b62");
      this.box(-5, 0.45, -4.2, 2, 0.9, 1.2, "#674c43");
      this.box(-5, 1, -4.2, 1.5, 0.25, 1, "#a59c91");
      this.box(-6.3, 0.5, -3.9, 0.6, 1, 0.6, "#584844");
      this.mesh(
        new T.ConeGeometry(0.3, 0.6, 6),
        this.material("#ffab65", true),
        -6.3,
        1.2,
        -3.9,
      );
      this.box(4.5, 0.4, -5.4, 2, 0.8, 1, "#514965");
      this.mesh(
        new T.OctahedronGeometry(0.42),
        this.material("#b5a0e7", true),
        4.5,
        1.3,
        -5.4,
      );
      this.box(-5, 0.35, 4.4, 2.2, 0.7, 1.1, "#64563d");
      for (let i = 0; i < 4; i++)
        this.box(
          -5.8 + i * 0.5,
          0.85,
          4.4,
          0.35,
          0.3,
          0.4,
          i % 2 ? "#9daf81" : "#d1a276",
        );
    }
    for (const f of e.features) {
      const group = new T.Group();
      group.position.set(f.x, 0, f.z);
      this.env.add(group);
      const color = MECHANICS.find((m) => m.id === f.mechanic)!.color;
      this.ring(0, 0, f.radius, color, group);
      if (f.mechanic === "powder") {
        this.mesh(
          new T.CylinderGeometry(0.32, 0.38, 0.8, 7),
          this.material("#885747"),
          0,
          0.4,
          0,
          group,
        );
        for (const y of [0.15, 0.65])
          this.mesh(
            new T.CylinderGeometry(0.35, 0.35, 0.08, 7),
            this.material("#c5b299"),
            0,
            y,
            0,
            group,
          );
        this.mesh(
          new T.ConeGeometry(0.08, 0.2, 4),
          this.material(color, true),
          0,
          0.92,
          0,
          group,
        );
      } else if (f.mechanic === "storm" || f.mechanic === "echo") {
        this.mesh(
          new T.OctahedronGeometry(0.45),
          this.material(color, true),
          0,
          1,
          0,
          group,
        );
        this.box(0, 0.35, 0, 0.6, 0.7, 0.6, t.cap, group);
      } else if (f.mechanic === "brood") {
        this.mesh(
          new T.SphereGeometry(0.55, 7, 5),
          this.material(color),
          0,
          0.35,
          0,
          group,
        );
      } else if (f.mechanic === "blood" || f.mechanic === "ember") {
        this.box(0, 0.25, 0, 0.8, 0.5, 0.8, t.cap, group);
        this.mesh(
          new T.ConeGeometry(0.3, 0.6, 5),
          this.material(color, true),
          0,
          0.8,
          0,
          group,
        );
      } else {
        this.mesh(
          new T.CylinderGeometry(0.35, 0.6, 0.15, 6),
          this.material(color, true),
          0,
          0.12,
          0,
          group,
        );
      }
      this.features.set(f.id, group);
    }
  }
  resize() {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth),
      h = Math.max(1, this.canvas.clientHeight || innerHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.pixelSize.value = Math.max(1, Math.round(h / 320));
  }
  private view(mode: CameraMode) {
    this.mode = mode;
    this.yaw = mode === "iso" ? Math.PI / 4 : 0;
    this.pitch = mode === "top" ? 1.4 : mode === "side" ? 0.23 : 0.66;
  }
  moveDirection(x: number, z: number) {
    return {
      x: x * Math.cos(this.yaw) + z * Math.sin(this.yaw),
      z: -x * Math.sin(this.yaw) + z * Math.cos(this.yaw),
    };
  }
  pick(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect(),
      ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        (-(clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const point = new T.Vector3();
    ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), point);
    return { x: point.x, z: point.z };
  }
  project(x: number, y: number, z: number) {
    const p = new T.Vector3(x, y, z).project(this.camera);
    return {
      x: ((p.x + 1) * this.width) / 2,
      y: ((1 - p.y) * this.height) / 2,
    };
  }
  private effectObject(e: Effect, run: Run) {
    let o: T.Object3D;
    if (e.kind === "ghost") {
      const rig = this.rigs.get(e.actor ?? "player");
      o = rig ? rig.ghost() : new T.Group();
    } else if (e.kind === "text") {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 48;
      const ctx = c.getContext("2d")!;
      ctx.font = "bold 27px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = e.color;
      ctx.fillText(e.text ?? "", 64, 32);
      const texture = new T.CanvasTexture(c);
      texture.minFilter = texture.magFilter = T.NearestFilter;
      o = new T.Mesh(
        new T.PlaneGeometry(1.15, 0.43),
        new T.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
        }),
      );
      o.quaternion.copy(this.camera.quaternion);
    } else if (e.kind === "slash") {
      o = new T.Mesh(
        new T.RingGeometry(e.radius * 0.66, e.radius, 24, 1, 0, Math.PI),
        new T.MeshBasicMaterial({
          color: e.color,
          transparent: true,
          opacity: 0.85,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      );
      o.rotation.x = -Math.PI / 2;
    } else if (e.kind === "ring") {
      o = new T.Mesh(
        new T.RingGeometry(e.radius * 0.83, e.radius, 32),
        new T.MeshBasicMaterial({
          color: e.color,
          transparent: true,
          opacity: 0.8,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      );
      o.rotation.x = -Math.PI / 2;
    } else if (e.kind === "bolt") {
      o = new T.Mesh(
        new T.BoxGeometry(0.16, 2.7, 0.16),
        new T.MeshBasicMaterial({
          color: e.color,
          transparent: true,
          opacity: 0.9,
        }),
      );
    } else
      o = new T.Mesh(
        new T.OctahedronGeometry(0.2),
        new T.MeshBasicMaterial({
          color: e.color,
          transparent: true,
          opacity: 1,
        }),
      );
    o.userData.kind = e.kind;
    if (e.kind !== "ghost") o.position.set(e.x, e.y, e.z);
    else {
      o.position.set(e.x, run.player.pos.y, e.z);
      o.rotation.set(0, e.yaw, 0);
    }
    this.dynamic.add(o);
    this.fxObjects.set(e.id, o);
    return o;
  }
  draw(run: Run) {
    if (this.encounter !== run.encounter) this.build(run);
    this.resize();
    if (this.mode !== run.camera) this.view(run.camera);
    const half = (this.mode === "side" ? 10 : this.width < 600 ? 19 : 16) / 2,
      aspect = this.width / this.height;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    const target = run.encounter.depth
      ? new T.Vector3(run.player.pos.x, 0, run.player.pos.z)
      : new T.Vector3(0, 0, 0);
    this.focus.copy(target);
    const offset = new T.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(35);
    this.camera.position.copy(this.focus).add(offset);
    this.camera.lookAt(this.focus.x, 0.3, this.focus.z);
    this.camera.updateMatrixWorld();
    for (const [id, rig] of this.rigs)
      if (!run.actors.has(id)) {
        rig.root.removeFromParent();
        rig.dispose();
        this.rigs.delete(id);
      }
    for (const a of run.actors.values()) {
      let rig = this.rigs.get(a.id);
      if (!rig) {
        rig = new ProceduralRig(a.rig, a.color, a.npc);
        this.rigs.set(a.id, rig);
        this.dynamic.add(rig.root);
      }
      const ch = run.sim.get(a.id);
      rig.animate(ch, a, run.tick);
      if (a.id === "player") {
        const item = run.profile.inventory.find(
          (i) => i.id === run.profile.equipped.weapon,
        );
        rig.weapon.scale.y = 1 + Math.min(0.5, (item?.stats.damage ?? 0) / 100);
      }
      if (a.archetype) {
        let bar = this.bars.get(a.id);
        if (!bar) {
          bar = new T.Group();
          const bg = this.mesh(
              new T.PlaneGeometry(1.2, 0.1),
              new T.MeshBasicMaterial({ color: "#25222c", depthTest: false }),
              0,
              0,
              0,
              bar,
            ),
            fill = this.mesh(
              new T.PlaneGeometry(1.16, 0.065),
              new T.MeshBasicMaterial({
                color: a.boss ? "#f1bb79" : "#c37d7c",
                depthTest: false,
              }),
              0,
              0,
              0.01,
              bar,
            );
          bg.renderOrder = 20;
          fill.renderOrder = 21;
          bar.userData.fill = fill;
          this.dynamic.add(bar);
          this.bars.set(a.id, bar);
        }
        bar.visible = a.deathAt < 0;
        bar.position.set(ch.pos.x, 2 * a.scale + 0.3, ch.pos.z);
        bar.quaternion.copy(this.camera.quaternion);
        (bar.userData.fill as T.Mesh).scale.x = Math.max(
          0.001,
          ch.hp / ch.maxHp,
        );
        let warning = this.warnings.get(a.id);
        if (!warning) {
          warning = this.ring(
            0,
            0,
            a.boss ? 3.8 : (MONSTER_RANGE[a.archetype] ?? 1.5),
            "#fa6c5f",
            this.dynamic,
          );
          this.warnings.set(a.id, warning);
        }
        warning.visible = a.windup > 0;
        warning.position.set(ch.pos.x, 0.045, ch.pos.z);
        (warning.material as T.MeshBasicMaterial).opacity =
          0.35 + 0.25 * Math.sin(run.tick * 0.6);
      }
    }
    for (const [id, bar] of this.bars)
      if (!run.actors.has(id)) {
        this.disposeObject(bar);
        this.bars.delete(id);
        const warning = this.warnings.get(id);
        if (warning) this.disposeObject(warning);
        this.warnings.delete(id);
      }
    for (const f of run.encounter.features) {
      const o = this.features.get(f.id);
      if (o) {
        o.visible = f.hp > 0;
        if (o.children[1]) o.children[1].rotation.y = run.tick * 0.025;
      }
    }
    if (this.gate)
      this.gate.children.forEach((o) => {
        if (o instanceof T.Mesh && o.material instanceof T.MeshBasicMaterial)
          o.material.opacity = run.clear || !run.encounter.depth ? 0.55 : 0.08;
      });
    const activeFx = new Set(run.effects.map((e) => e.id));
    for (const [id, o] of this.fxObjects)
      if (!activeFx.has(id)) {
        this.disposeObject(o, o.userData.kind !== "ghost");
        this.fxObjects.delete(id);
      }
    for (const e of run.effects) {
      const o = this.fxObjects.get(e.id) ?? this.effectObject(e, run),
        p = (run.tick - e.born) / e.duration;
      if (e.kind === "slash") {
        o.position.y = 0.9;
        const hand = this.rigs.get("player")?.weapon;
        hand?.updateWorldMatrix(true, false);
        if (hand) {
          const pos = new T.Vector3();
          hand.getWorldPosition(pos);
          o.position.copy(pos);
        }
        o.rotation.z = e.yaw + p * Math.PI;
        o.scale.setScalar(0.5 + p * 0.8);
      }
      if (e.kind === "ring") o.scale.setScalar(0.35 + p * 0.9);
      if (e.kind === "text") {
        o.position.y = e.y + p;
        o.quaternion.copy(this.camera.quaternion);
      }
      o.traverse((c) => {
        if (c instanceof T.Mesh)
          for (const m of Array.isArray(c.material) ? c.material : [c.material])
            if (m.transparent)
              m.opacity = (e.kind === "ghost" ? 0.27 : 0.85) * (1 - p);
      });
    }
    for (const [id, o] of this.drops)
      if (!run.drops.some((d) => d.id === id)) {
        this.disposeObject(o);
        this.drops.delete(id);
      }
    for (const d of run.drops) {
      let o = this.drops.get(d.id);
      if (!o) {
        o = new T.Group();
        const color = d.item ? rarityColor[d.item.rarity] : "#e9c46c";
        this.mesh(
          new T.OctahedronGeometry(0.18),
          this.material(color, true),
          0,
          0.4,
          0,
          o,
        );
        if (d.item)
          this.mesh(
            new T.CylinderGeometry(0.03, 0.12, 1.8, 6),
            new T.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.15,
              depthWrite: false,
            }),
            0,
            0.95,
            0,
            o,
          );
        this.dynamic.add(o);
        this.drops.set(d.id, o);
      }
      o.position.set(d.x, Math.sin(run.tick * 0.07) * 0.08, d.z);
      o.rotation.y = run.tick * 0.05;
    }
    for (const [id, o] of this.bullets)
      if (!run.projectiles.some((b) => b.id === id)) {
        this.disposeObject(o);
        this.bullets.delete(id);
      }
    for (const b of run.projectiles) {
      let o = this.bullets.get(b.id);
      if (!o) {
        o = this.mesh(
          new T.OctahedronGeometry(0.18),
          this.material(b.color, true),
          b.x,
          0.9,
          b.z,
          this.dynamic,
        );
        this.bullets.set(b.id, o);
      }
      o.position.set(b.x, 0.9, b.z);
      o.rotation.y = run.tick * 0.2;
    }
    if (this.pixelMode) this.post.render();
    else this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.clear();
    this.pixel.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
const MONSTER_RANGE: Record<string, number> = {
  husk: 1.7,
  duelist: 2,
  brute: 2.8,
  crawler: 1.5,
  seer: 1.3,
  slime: 1.9,
};
