/**
 * Rest-pose retargeting between skeletons that share bone names but not exact rest rotations.
 *
 * The Quaternius packs all use the same 65 UE5-style bone names, but their bind poses differ by up
 * to ~11° (spine_03), ~6° (neck) and ~12° (thumbs) from the UAL mannequin the clips were authored
 * on. Copying rotations verbatim would bend the spine/neck. For every bone b with parent p we keep
 * the same WORLD-space rotation delta from rest:
 *
 *   C_b = W_src(b)^-1 * W_dst(b)        (W = bind-pose world rotation)
 *   q_dst(t) = C_p^-1 * q_src(t) * C_b  (local rotation track, per keyframe)
 *
 * which maps the source rest pose exactly onto the target rest pose. Translation tracks (only the
 * pelvis survives the asset build) are scaled by the pelvis-height ratio so feet stay on the floor.
 */
import * as THREE from 'three';

export interface RestPose {
  world: Map<string, THREE.Quaternion>;
  parent: Map<string, string | null>;
  pelvisHeight: number;
}

export function restPoseOf(skeleton: THREE.Skeleton): RestPose {
  const world = new Map<string, THREE.Quaternion>();
  const parent = new Map<string, string | null>();
  const names = new Set(skeleton.bones.map((b) => b.name));
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let pelvisHeight = 1;
  skeleton.bones.forEach((bone, i) => {
    m.copy(skeleton.boneInverses[i]).invert();
    const q = new THREE.Quaternion();
    m.decompose(pos, q, scl);
    world.set(bone.name, q);
    parent.set(bone.name, bone.parent && names.has(bone.parent.name) ? bone.parent.name : null);
    if (bone.name === 'pelvis') pelvisHeight = pos.y;
  });
  return { world, parent, pelvisHeight };
}

export function retargetClip(clip: THREE.AnimationClip, src: RestPose, dst: RestPose): THREE.AnimationClip {
  const corr = new Map<string, THREE.Quaternion>();
  const correction = (bone: string | null) => {
    if (!bone) return null;
    let c = corr.get(bone);
    if (!c) {
      const s = src.world.get(bone);
      const d = dst.world.get(bone);
      c = s && d ? s.clone().invert().multiply(d) : new THREE.Quaternion();
      corr.set(bone, c);
    }
    return c;
  };
  const pelvisScale = dst.pelvisHeight / src.pelvisHeight;
  const q = new THREE.Quaternion();
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    if (!dst.world.has(bone)) continue;
    if (prop === 'quaternion') {
      const cb = correction(bone)!;
      const cpInv = correction(dst.parent.get(bone) ?? null)?.clone().invert() ?? new THREE.Quaternion();
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(track.values, i).premultiply(cpInv).multiply(cb);
        q.toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(track.name, track.times, values));
    } else if (prop === 'position') {
      const values = Float32Array.from(track.values, (v) => v * pelvisScale);
      tracks.push(new THREE.VectorKeyframeTrack(track.name, track.times, values));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
