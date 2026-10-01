/**
 * One humanoid on screen: Quaternius parts assembled on one skeleton, toon materials, retargeted
 * clips posed from the sim's sprite state, silhouette + blob shadow helpers, palette recoloring,
 * glowing materials, equipment attachments (weapon in the right hand, shield or focus in the
 * left, helmet on the head), status tints (frozen, burning, shocked, poisoned) and elite auras.
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { config } from '../config';
import { PRESETS } from '../content/characters';
import type { Look } from '../sim/types';
import { AssetLibrary, firstSkinnedMesh } from './assets';
import { itemObject, type ItemLookInput } from './itemMeshes';
import { toonize, writesNormals } from './materials';
import { LAYER } from './pixelPipeline';
import { restPoseOf, type RestPose } from './retarget';

export interface PoseInput {
  clip: string;
  time: number;
  prevClip: string | null;
  prevTime: number;
  blend: number;
}

export interface Equipment {
  weapon?: ItemLookInput | null;
  offhand?: ItemLookInput | null;
  helmet?: ItemLookInput | null;
  /** Body armour tint for the outfit. */
  chest?: string | null;
}

const silhouetteMaterial = writesNormals(new THREE.MeshBasicMaterial({
  color: 0x8fb8ff,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  depthFunc: THREE.GreaterDepth,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilZPass: THREE.KeepStencilOp,
}), 'fx');

const shadowMaterial = writesNormals(
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  'fx',
);
const shadowGeometry = new THREE.CircleGeometry(0.36, 20);
const auraGeometry = new THREE.RingGeometry(0.42, 0.56, 24);

/** Legacy weapon looks for presets (monsters, NPCs). */
const PRESET_WEAPON: Record<string, ItemLookInput> = {
  sword: { base: 'broad_sword', rarity: 'normal', seed: 3 },
  staff: { base: 'gnarled_staff', rarity: 'normal', seed: 5 },
  cleaver: { base: 'war_axe', rarity: 'normal', seed: 9 },
};

export type StatusTint = 'none' | 'frozen' | 'chilled' | 'burning' | 'shocked' | 'poisoned' | 'shielded' | 'empowered';
const TINT_EMISSIVE: Record<StatusTint, [number, number, number]> = {
  none: [0, 0, 0], frozen: [0.25, 0.45, 0.7], chilled: [0.05, 0.15, 0.3], burning: [0.5, 0.15, 0], shocked: [0.45, 0.4, 0.05],
  poisoned: [0.08, 0.3, 0.02], shielded: [0.5, 0.45, 0.2], empowered: [0.3, 0.1, 0.4],
};

export class CharacterView {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly bones = new Map<string, THREE.Bone>();
  readonly materials: THREE.MeshToonMaterial[] = [];
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly shadow: THREE.Mesh;
  readonly aura: THREE.Mesh | null = null;
  private readonly silhouettes: THREE.SkinnedMesh[] = [];
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly rest: RestPose;
  private readonly restKey: string;
  private baseEmissive = new Map<THREE.MeshToonMaterial, THREE.Color>();
  private baseColor = new Map<THREE.MeshToonMaterial, THREE.Color>();
  private lastFlash = -1;
  private lastTint: StatusTint = 'none';
  private silhouettesOn: boolean | null = null;
  private attachments: THREE.Object3D[] = [];
  private equipKey = '';
  /** Last pose applied; the skeleton only changes on sprite ticks, so most frames skip the mixer. */
  private lastPose: PoseInput = { clip: '', time: NaN, prevClip: null, prevTime: NaN, blend: NaN };

  constructor(readonly id: string, readonly preset: string, private lib: AssetLibrary, readonly look: Look = {}) {
    const p = PRESETS[preset];
    if (!p) throw new Error(`unknown preset "${preset}"`);
    this.root.name = `character:${id}`;
    this.model = SkeletonUtils.clone(lib.model(p.base).scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    const baseMesh = firstSkinnedMesh(this.model);
    const armature = baseMesh.parent ?? this.model;

    for (const partId of p.parts) {
      const part = SkeletonUtils.clone(lib.model(partId).scene);
      const skinned: THREE.SkinnedMesh[] = [];
      part.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
      });
      for (const m of skinned) {
        const bones = m.skeleton.bones.map((b) => {
          const target = this.bones.get(b.name);
          if (!target) throw new Error(`part ${partId}: bone ${b.name} missing on ${p.base}`);
          return target;
        });
        m.bind(new THREE.Skeleton(bones, m.skeleton.boneInverses), m.bindMatrix);
        armature.add(m);
      }
    }

    const tints = { ...(p.tint ?? {}), ...(look.tint ?? {}) };
    const glows = { ...(p.glow ?? {}), ...(look.glow ?? {}) };
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
        const t = toonize(src);
        const tint = tints[src.name];
        if (tint) t.color.set(tint);
        const glow = glows[src.name];
        if (glow) t.emissive.set(glow).multiplyScalar(0.9);
        this.baseEmissive.set(t, t.emissive.clone());
        this.baseColor.set(t, t.color.clone());
        t.stencilWrite = true;
        t.stencilRef = 1;
        t.stencilZPass = THREE.ReplaceStencilOp;
        this.materials.push(t);
        return t;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
      m.castShadow = false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      if (m.isSkinnedMesh) {
        this.meshes.push(m);
        const sil = new THREE.SkinnedMesh(m.geometry, silhouetteMaterial);
        sil.bind(m.skeleton, m.bindMatrix);
        sil.renderOrder = 10;
        sil.frustumCulled = false;
        sil.layers.set(LAYER.FX);
        sil.name = `${m.name}:silhouette`;
        sil.userData.silhouette = true;
        m.parent!.add(sil);
        this.silhouettes.push(sil);
      }
    });

    const weapon = look.weapon ?? p.weapon;
    if (weapon && weapon !== 'none' && PRESET_WEAPON[weapon]) this.attach('hand_r', itemObject(PRESET_WEAPON[weapon]), 'weapon');

    this.rest = restPoseOf(baseMesh.skeleton);
    this.restKey = p.base;
    this.mixer = new THREE.AnimationMixer(this.model);

    this.shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.layers.set(LAYER.FX);
    this.shadow.name = `shadow:${id}`;
    if (look.aura) {
      const aura = new THREE.Mesh(auraGeometry, writesNormals(new THREE.MeshBasicMaterial({ color: look.aura, transparent: true, opacity: 0.7, depthWrite: false }), 'fx'));
      aura.userData.ownMaterial = true;
      aura.position.z = 0.001;
      this.shadow.add(aura);
      aura.layers.set(LAYER.FX);
      this.aura = aura;
    }
    this.applyProportions();
  }

  /** Attach an item object to a bone with a hand-tuned grip transform. */
  private attach(bone: string, obj: THREE.Object3D, slot: 'weapon' | 'offhand' | 'helmet') {
    const b = this.bones.get(bone);
    if (!b) return;
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) if ((mat as THREE.MeshToonMaterial).isMeshToonMaterial) this.materials.push(mat as THREE.MeshToonMaterial);
      }
    });
    // Bones carry the chunky-proportion scale; undo it so items keep their size.
    if (slot === 'weapon') {
      // Grip in the fist, blade along the thumb side. Tuned by eye against filmstrips.
      obj.position.set(0.02, 0.09, 0.03);
      obj.rotation.set(THREE.MathUtils.degToRad(90), 0, THREE.MathUtils.degToRad(-8));
    } else if (slot === 'offhand') {
      obj.position.set(-0.02, 0.08, 0.06);
      obj.rotation.set(THREE.MathUtils.degToRad(90), THREE.MathUtils.degToRad(90), 0);
    } else {
      obj.position.set(0, 0.12, 0.02);
    }
    obj.userData.slot = slot;
    b.add(obj);
    this.attachments.push(obj);
  }

  /** Hero gear visuals; rebuilt only when the equipment key changes. */
  setEquipment(eq: Equipment) {
    const key = JSON.stringify(eq);
    if (key === this.equipKey) return;
    this.equipKey = key;
    for (const a of this.attachments) {
      a.removeFromParent();
      a.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const i = this.materials.indexOf(m as THREE.MeshToonMaterial);
          if (i >= 0) this.materials.splice(i, 1);
          m.dispose();
        }
      });
    }
    this.attachments = [];
    if (eq.weapon) this.attach('hand_r', itemObject(eq.weapon), 'weapon');
    if (eq.offhand) this.attach('hand_l', itemObject(eq.offhand), 'offhand');
    if (eq.helmet) this.attach('Head', itemObject(eq.helmet), 'helmet');
    // Hide the outfit's hood under a helmet.
    this.model.traverse((o) => {
      if (/Hood/i.test(o.name) && (o as THREE.Mesh).isMesh) o.visible = !eq.helmet;
    });
    for (const m of this.materials) {
      const base = this.baseColor.get(m);
      if (!base || !/Ranger|Peasant/.test(m.name)) continue;
      m.color.copy(base);
      if (eq.chest) m.color.lerp(new THREE.Color(eq.chest), 0.45);
    }
    this.lastFlash = -1;
  }

  applyProportions() {
    const head = config['render.headScale'];
    const hand = config['render.handScale'];
    this.bones.get('Head')?.scale.setScalar(head);
    this.bones.get('hand_l')?.scale.setScalar(hand);
    this.bones.get('hand_r')?.scale.setScalar(hand);
  }

  private action(name: string): THREE.AnimationAction {
    let a = this.actions.get(name);
    if (!a) {
      a = this.mixer.clipAction(this.lib.clip(name, this.restKey, this.rest));
      this.actions.set(name, a);
    }
    return a;
  }

  /** Pose the skeleton exactly at the given clip times (no mixer clock). */
  pose(p: PoseInput) {
    const last = this.lastPose;
    const same = p.clip === last.clip && p.time === last.time && p.prevClip === last.prevClip && p.blend === last.blend &&
      (p.prevClip === null || p.blend >= 1 || p.prevTime === last.prevTime);
    if (same) return;
    last.clip = p.clip;
    last.time = p.time;
    last.prevClip = p.prevClip;
    last.prevTime = p.prevTime;
    last.blend = p.blend;
    const cur = this.action(p.clip);
    const prev = p.prevClip && p.blend < 1 ? this.action(p.prevClip) : null;
    for (const a of this.actions.values()) if (a !== cur && a !== prev && a.isRunning()) a.stop();
    if (!cur.isRunning()) cur.play();
    cur.time = p.time;
    cur.setEffectiveWeight(prev ? p.blend : 1);
    if (prev) {
      if (!prev.isRunning()) prev.play();
      prev.time = p.prevTime;
      prev.setEffectiveWeight(1 - p.blend);
    }
    this.mixer.update(0);
  }

  setFlash(on: boolean, tint: StatusTint = 'none') {
    const v = on ? 1 : 0;
    if (v === this.lastFlash && tint === this.lastTint) return;
    this.lastFlash = v;
    this.lastTint = tint;
    const t = TINT_EMISSIVE[tint];
    for (const m of this.materials) {
      if (on) m.emissive.setScalar(0.85);
      else {
        const base = this.baseEmissive.get(m);
        if (base) m.emissive.copy(base);
        else m.emissive.setScalar(0);
        m.emissive.r += t[0];
        m.emissive.g += t[1];
        m.emissive.b += t[2];
      }
    }
  }

  setSilhouettes(on: boolean) {
    if (on === this.silhouettesOn) return;
    this.silhouettesOn = on;
    for (const s of this.silhouettes) s.visible = on;
  }

  /** Put every mesh of this character on `layer` (used for isolated captures), or back to normal. */
  setIsolated(on: boolean) {
    this.root.traverse((o) => {
      if (o.userData.silhouette) return;
      if (on) o.layers.enable(LAYER.ISOLATE);
      else o.layers.disable(LAYER.ISOLATE);
    });
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
    this.shadow.removeFromParent();
    // Each part was rebound to its own Skeleton (one GPU bone texture each) and given cloned toon
    // materials; geometry and textures are shared with the asset library and stay.
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) m.skeleton.dispose();
      if ((o as THREE.Mesh).isMesh && o.userData.ownMaterial) for (const x of [(o as THREE.Mesh).material].flat()) x.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
