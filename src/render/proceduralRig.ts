/** Joint pivots sit at the sockets. Every visible part is a geometric primitive. */
import * as T from "three/webgpu";
import type { RigKind } from "../content/emberdeep";
import type { Actor } from "../sim/run";
import type { Character } from "../sim/sim";
export class ProceduralRig {
  root = new T.Group();
  torso = new T.Group();
  head = new T.Group();
  shoulderL = new T.Group();
  shoulderR = new T.Group();
  armL = new T.Group();
  armR = new T.Group();
  hipL = new T.Group();
  hipR = new T.Group();
  legL = new T.Group();
  legR = new T.Group();
  weapon = new T.Group();
  cape: T.Group[] = [];
  limbs: T.Group[] = [];
  mats: T.MeshStandardMaterial[] = [];
  private geometries: T.BufferGeometry[] = [];
  constructor(
    readonly kind: RigKind,
    color: string,
    npc?: string,
  ) {
    const body = this.material(color),
      dark = this.material("#30303b"),
      skin = this.material(kind === "ranger" ? "#d3b493" : "#bc9f9e"),
      metal = this.material("#c3c4bd", 0.45),
      leather = this.material("#775c52");
    this.root.name = "Root";
    this.torso.name = "Torso";
    this.root.add(this.torso);
    this.torso.position.y = 1.1;
    if (kind === "spider") {
      this.part(
        this.torso,
        new T.CapsuleGeometry(0.35, 0.42, 2, 6),
        body,
        0,
        0,
        0,
      );
      this.torso.scale.set(1, 0.7, 1);
      this.head.position.set(0, 0.04, 0.4);
      this.torso.add(this.head);
      this.part(this.head, new T.BoxGeometry(0.4, 0.25, 0.35), dark, 0, 0, 0);
      for (let i = 0; i < 8; i++) {
        const side = i < 4 ? -1 : 1,
          j = i % 4,
          pivot = new T.Group(),
          knee = new T.Group();
        pivot.position.set(side * 0.25, -0.08, (j - 1.5) * 0.2);
        pivot.rotation.z = side * -0.5;
        pivot.rotation.y = (j - 1.5) * 0.38;
        this.torso.add(pivot);
        this.part(
          pivot,
          new T.CylinderGeometry(0.045, 0.07, 0.7, 5),
          body,
          side * 0.28,
          -0.1,
          0,
          0,
          0,
          (side * Math.PI) / 2 - 0.35,
        );
        knee.position.set(side * 0.58, -0.2, 0);
        pivot.add(knee);
        this.part(
          knee,
          new T.CylinderGeometry(0.025, 0.05, 0.7, 5),
          dark,
          0,
          -0.35,
          0,
        );
        this.limbs.push(pivot);
      }
      this.part(
        this.head,
        new T.BoxGeometry(0.08, 0.08, 0.04),
        this.material("#ffcba2"),
        -0.12,
        0.06,
        0.18,
      );
      this.part(
        this.head,
        new T.BoxGeometry(0.08, 0.08, 0.04),
        this.material("#ffcba2"),
        0.12,
        0.06,
        0.18,
      );
    } else if (kind === "slime") {
      this.part(
        this.torso,
        new T.SphereGeometry(0.64, 8, 6),
        body,
        0,
        -0.35,
        0,
      );
      this.torso.scale.set(1, 0.85, 1);
      this.part(
        this.torso,
        new T.BoxGeometry(0.11, 0.12, 0.06),
        dark,
        -0.2,
        -0.23,
        0.58,
      );
      this.part(
        this.torso,
        new T.BoxGeometry(0.11, 0.12, 0.06),
        dark,
        0.2,
        -0.23,
        0.58,
      );
      this.part(
        this.torso,
        new T.BoxGeometry(0.18, 0.06, 0.06),
        dark,
        0,
        -0.45,
        0.61,
      );
    } else if (kind === "wisp") {
      this.part(this.torso, new T.OctahedronGeometry(0.45), body, 0, 0, 0);
      this.part(
        this.torso,
        new T.ConeGeometry(0.45, 0.85, 5),
        dark,
        0,
        -0.5,
        0,
        Math.PI,
        0,
        0,
      );
      for (let i = 0; i < 5; i++) {
        const group = new T.Group();
        this.root.add(group);
        this.part(group, new T.OctahedronGeometry(0.13), metal, 0, 0, 0);
        this.limbs.push(group);
      }
      this.part(
        this.torso,
        new T.BoxGeometry(0.28, 0.08, 0.1),
        this.material("#f2dca7"),
        0,
        0.15,
        0.36,
      );
    } else {
      const brute = kind === "brute";
      this.part(
        this.torso,
        new T.BoxGeometry(brute ? 0.82 : 0.57, 0.64, 0.35),
        body,
        0,
        0.1,
        0,
      );
      this.part(
        this.torso,
        new T.BoxGeometry(0.59, 0.13, 0.39),
        leather,
        0,
        -0.27,
        0,
      );
      this.head.name = "Head";
      this.head.position.set(0, 0.63, 0);
      this.torso.add(this.head);
      this.part(this.head, new T.BoxGeometry(0.4, 0.4, 0.38), skin, 0, 0.08, 0);
      this.part(
        this.head,
        new T.BoxGeometry(0.43, 0.16, 0.42),
        dark,
        0,
        0.31,
        -0.02,
      );
      this.part(
        this.head,
        new T.BoxGeometry(0.06, 0.055, 0.035),
        dark,
        -0.11,
        0.1,
        0.198,
      );
      this.part(
        this.head,
        new T.BoxGeometry(0.06, 0.055, 0.035),
        dark,
        0.11,
        0.1,
        0.198,
      );
      this.shoulderL.name = "ShoulderL";
      this.shoulderR.name = "ShoulderR";
      this.armL.name = "ArmL";
      this.armR.name = "ArmR";
      this.weapon.name = "Weapon";
      this.hipL.name = "HipL";
      this.hipR.name = "HipR";
      this.legL.name = "LegL";
      this.legR.name = "LegR";
      for (const [side, shoulder, arm, hip, leg] of [
        [-1, this.shoulderL, this.armL, this.hipL, this.legL],
        [1, this.shoulderR, this.armR, this.hipR, this.legR],
      ] as const) {
        shoulder.position.set(side * (brute ? 0.52 : 0.38), 0.33, 0);
        this.torso.add(shoulder);
        this.part(shoulder, new T.BoxGeometry(0.25, 0.2, 0.32), metal, 0, 0, 0);
        this.part(
          shoulder,
          new T.CapsuleGeometry(0.095, 0.29, 2, 5),
          body,
          0,
          -0.22,
          0,
        );
        arm.position.y = -0.4;
        shoulder.add(arm);
        this.part(
          arm,
          new T.CapsuleGeometry(0.085, 0.22, 2, 5),
          skin,
          0,
          -0.18,
          0,
        );
        this.part(
          arm,
          new T.BoxGeometry(0.18, 0.15, 0.2),
          leather,
          0,
          -0.31,
          0,
        );
        hip.position.set(side * 0.18, 0.8, 0);
        this.root.add(hip);
        this.part(
          hip,
          new T.CapsuleGeometry(0.12, 0.25, 2, 5),
          dark,
          0,
          -0.22,
          0,
        );
        leg.position.y = -0.4;
        hip.add(leg);
        this.part(
          leg,
          new T.CapsuleGeometry(0.1, 0.21, 2, 5),
          body,
          0,
          -0.17,
          0,
        );
        this.part(
          leg,
          new T.BoxGeometry(0.23, 0.16, 0.34),
          leather,
          0,
          -0.33,
          0.07,
        );
      }
      this.weapon.position.set(0, -0.32, 0.05);
      this.armR.add(this.weapon);
      this.part(
        this.weapon,
        new T.CylinderGeometry(0.045, 0.045, 0.27, 5),
        leather,
        0,
        -0.03,
        0,
      );
      this.part(
        this.weapon,
        new T.BoxGeometry(0.38, 0.07, 0.1),
        metal,
        0,
        0.12,
        0,
      );
      this.part(
        this.weapon,
        new T.BoxGeometry(0.12, brute ? 1.2 : 0.9, 0.055),
        metal,
        0,
        brute ? 0.74 : 0.61,
        0,
      );
      this.part(
        this.weapon,
        new T.ConeGeometry(0.08, 0.18, 4),
        metal,
        0,
        brute ? 1.43 : 1.14,
        0,
      );
      if (npc) {
        for (const child of [...this.weapon.children]) child.visible = false;
        if (npc === "smith") {
          this.part(
            this.weapon,
            new T.CylinderGeometry(0.045, 0.045, 0.65, 5),
            leather,
            0,
            0.12,
            0,
          );
          this.part(
            this.weapon,
            new T.BoxGeometry(0.45, 0.25, 0.25),
            metal,
            0,
            0.45,
            0,
          );
        }
      }
      if (kind === "ranger") {
        let parent = this.torso;
        const capeMat = this.material("#9d4e50");
        for (let i = 0; i < 4; i++) {
          const seg = new T.Group();
          seg.position.set(0, i ? -0.2 : 0.39, i ? 0 : -0.23);
          parent.add(seg);
          this.part(
            seg,
            new T.BoxGeometry(0.54 + i * 0.04, 0.22, 0.04),
            capeMat,
            0,
            -0.1,
            0,
          );
          this.cape.push(seg);
          parent = seg;
        }
        this.part(
          this.torso,
          new T.BoxGeometry(0.64, 0.1, 0.41),
          leather,
          0,
          0.35,
          0,
        );
      }
      if (brute) {
        this.part(
          this.head,
          new T.BoxGeometry(0.46, 0.35, 0.43),
          metal,
          0,
          0.22,
          0,
        );
        for (const side of [-1, 1])
          this.part(
            this.head,
            new T.ConeGeometry(0.11, 0.42, 5),
            leather,
            side * 0.31,
            0.4,
            0,
            0,
            0,
            -side * 0.5,
          );
      }
    }
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }
  private material(color: string, metalness = 0) {
    const m = new T.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness,
      flatShading: true,
    });
    this.mats.push(m);
    return m;
  }
  private part(
    parent: T.Group,
    geometry: T.BufferGeometry,
    material: T.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    this.geometries.push(geometry);
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  }
  animate(ch: Character, a: Actor, tick: number) {
    const time = tick / 60,
      gait = time * 12,
      speed = Math.min(1, ch.speed / 4.2),
      breath = Math.sin(time * 2.5) * 0.025;
    this.root.position.set(ch.pos.x, ch.pos.y, ch.pos.z);
    this.root.rotation.set(0, ch.yaw, 0);
    this.root.scale.setScalar(a.scale);
    this.torso.position.y =
      1.1 + breath + Math.abs(Math.sin(gait)) * 0.045 * speed;
    this.torso.rotation.set(0.12 * speed, 0, Math.sin(time * 1.8) * 0.018);
    this.shoulderL.rotation.set(Math.sin(gait) * 0.65 * speed, 0, 0.1);
    this.shoulderR.rotation.set(-Math.sin(gait) * 0.65 * speed, 0, -0.1);
    this.armL.rotation.x = -0.12;
    this.armR.rotation.x = -0.2;
    this.hipL.rotation.x = -Math.sin(gait) * 0.8 * speed;
    this.hipR.rotation.x = Math.sin(gait) * 0.8 * speed;
    this.legL.rotation.x = Math.max(0, Math.cos(gait)) * 0.55 * speed;
    this.legR.rotation.x = Math.max(0, -Math.cos(gait)) * 0.55 * speed;
    this.weapon.rotation.z = Math.sin(time * 2) * 0.035;
    if (a.slash > 0) {
      const p = 1 - a.slash / 18;
      this.torso.rotation.y =
        Math.sin(p * Math.PI) * ((a.combo % 2 ? 1 : -1) * 1.1);
      this.shoulderR.rotation.set(-1.3 + Math.sin(p * Math.PI) * 1.7, 0, -0.7);
      this.armR.rotation.x = -0.5;
    }
    if (a.windup > 0) {
      this.shoulderR.rotation.x = -2.2;
      this.shoulderL.rotation.x = -0.6;
      this.torso.rotation.x = -0.18;
    }
    if (a.dash > 0) {
      this.root.rotation.x = (1 - a.dash / 16) * Math.PI * 2;
      this.torso.rotation.x = 0.3;
      this.hipL.rotation.x = -1.3;
      this.hipR.rotation.x = -1.3;
      this.shoulderR.rotation.x = -1.5;
    }
    this.cape.forEach(
      (seg, i) =>
        (seg.rotation.x =
          0.08 + Math.sin(time * 7 - i * 0.7) * 0.08 + speed * 0.25),
    );
    if (this.kind === "spider") {
      this.torso.position.y = 0.7 + Math.sin(gait * 2) * 0.04;
      this.limbs.forEach(
        (limb, i) =>
          (limb.rotation.x = Math.sin(gait + (i % 2) * Math.PI) * 0.5 * speed),
      );
    }
    if (this.kind === "slime") {
      this.torso.position.y = 0.8 + Math.sin(time * 7) * 0.12;
      this.torso.scale.set(
        1 + Math.sin(time * 7) * 0.07,
        0.8 - Math.sin(time * 7) * 0.1,
        1 + Math.sin(time * 7) * 0.07,
      );
    }
    if (this.kind === "wisp") {
      this.torso.position.y = 1.2 + Math.sin(time * 4) * 0.15;
      this.torso.rotation.y = time * 0.5;
      this.limbs.forEach((l, i) => {
        l.position.set(
          Math.sin(time + i * 1.26) * 0.7,
          0.9 + Math.sin(time * 3 + i) * 0.2,
          Math.cos(time + i * 1.26) * 0.7,
        );
        l.rotation.y = time;
      });
    }
    if (a.npc === "smith") {
      this.shoulderR.rotation.x = -0.7 - Math.sin(time * 4) * 0.8;
      this.torso.rotation.x = 0.1;
    }
    if (a.npc === "mystic") {
      this.shoulderL.rotation.z = 0.7;
      this.shoulderR.rotation.z = -0.7;
      this.torso.position.y += Math.sin(time * 2) * 0.06;
    }
    if (a.npc === "merchant") {
      this.shoulderL.rotation.x = Math.sin(time * 2) * 0.4 - 0.4;
      this.head.rotation.y = Math.sin(time) * 0.15;
    }
    this.mats.forEach((m) => {
      m.emissive.set(
        ch.flash > 0 ? "#ffe3ac" : a.frozen > tick ? "#316fa0" : "#000000",
      );
      m.emissiveIntensity = ch.flash > 0 ? 0.6 : 0.2;
    });
    if (a.deathAt >= 0) {
      const p = Math.min(1, (tick - a.deathAt) / 35);
      this.root.rotation.z = (p * Math.PI) / 2;
      this.root.position.y -= p * 0.55;
      this.root.scale.multiplyScalar(
        Math.max(0.02, 1 - Math.max(0, (tick - a.deathAt - 60) / 40)),
      );
    }
  }
  ghost() {
    const clone = this.root.clone(true);
    clone.traverse((o) => {
      if (o instanceof T.Mesh) {
        const material = (o.material as T.MeshStandardMaterial).clone();
        material.transparent = true;
        material.opacity = 0.27;
        material.depthWrite = false;
        material.emissive.set("#83bc9d");
        o.material = material;
      }
    });
    return clone;
  }
  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
  }
}
