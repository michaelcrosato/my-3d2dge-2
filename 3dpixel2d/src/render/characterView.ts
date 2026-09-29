/**
 * One character on screen: Quaternius parts assembled on one skeleton, toon materials,
 * retargeted clips posed from the sim's sprite state, silhouette + blob shadow helpers.
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { config } from '../config';
import { PRESETS } from '../content/characters';
import { AssetLibrary, firstSkinnedMesh } from './assets';
import { toonize } from './materials';
import { LAYER } from './pixelPipeline';
import { restPoseOf, type RestPose } from './retarget';

export interface PoseInput {
  clip: string;
  time: number;
  prevClip: string | null;
  prevTime: number;
  blend: number;
}

const silhouetteMaterial = new THREE.MeshBasicMaterial({
  color: 0x8fb8ff,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  depthFunc: THREE.GreaterDepth,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilZPass: THREE.KeepStencilOp,
});

function makeSword(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'sword';
  const steel = toonize(new THREE.MeshStandardMaterial({ color: 0xd9dde6 }));
  const leather = toonize(new THREE.MeshStandardMaterial({ color: 0x5a3a24 }));
  const brass = toonize(new THREE.MeshStandardMaterial({ color: 0xc9a13b }));
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.02), steel);
  blade.position.y = 0.47;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), brass);
  guard.position.y = 0.08;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.035), leather);
  grip.position.y = -0.01;
  g.add(blade, guard, grip);
  return g;
}

export class CharacterView {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly bones = new Map<string, THREE.Bone>();
  readonly materials: THREE.MeshToonMaterial[] = [];
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly shadow: THREE.Mesh;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly rest: RestPose;
  private readonly restKey: string;
  private lastFlash = -1;

  constructor(readonly id: string, readonly preset: string, private lib: AssetLibrary) {
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

    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
        const t = toonize(src);
        const tint = p.tint?.[src.name];
        if (tint) t.color.set(tint);
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
      }
    });

    if (p.weapon === 'sword') {
      const hand = this.bones.get('hand_r');
      if (hand) {
        const sword = makeSword();
        sword.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) this.materials.push((o as THREE.Mesh).material as THREE.MeshToonMaterial);
        });
        // Grip in the fist, blade along the thumb side. Tuned by eye against filmstrips.
        sword.position.set(0.02, 0.09, 0.03);
        sword.rotation.set(THREE.MathUtils.degToRad(90), 0, THREE.MathUtils.degToRad(-8));
        hand.add(sword);
      }
    }

    this.rest = restPoseOf(baseMesh.skeleton);
    this.restKey = p.base;
    this.mixer = new THREE.AnimationMixer(this.model);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.layers.set(LAYER.FX);
    this.shadow.name = `shadow:${id}`;
    this.applyProportions();
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

  setFlash(on: boolean) {
    const v = on ? 1 : 0;
    if (v === this.lastFlash) return;
    this.lastFlash = v;
    for (const m of this.materials) m.emissive.setScalar(v * 0.85);
  }

  setSilhouettes(on: boolean) {
    this.root.traverse((o) => {
      if (o.userData.silhouette) o.visible = on;
    });
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
    this.root.removeFromParent();
    this.shadow.removeFromParent();
  }
}
