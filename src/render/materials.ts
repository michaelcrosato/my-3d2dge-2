/** Toon materials: hard light bands, no specular. Everything in the scene goes through here. */
import * as THREE from 'three';
import { config } from '../config';

/**
 * Shader patches compose: each adds code to the program; the cache key lists them all.
 * - 'surface' / 'fx' normals: the pixel pipeline draws color and view-space normals in ONE pass
 *   (two render targets). Opaque materials write their shading normal; blended overlays write
 *   alpha 0 ("leave the normal buffer unchanged"). FX materials must be transparent.
 * - 'cutaway': wall and pillar fragments between the camera and the hero are dissolved with an
 *   ordered dither inside a circle around the hero, so tall iso walls never hide the fight.
 */
type Patch = 'normals-surface' | 'normals-fx' | 'cutaway';

/** Shared cutaway uniforms: xyz = hero position in view space, w = radius (m); on = 0/1. */
export const CUTAWAY = {
  uCut: { value: new THREE.Vector4(0, 0, 0, 2.6) },
  uCutOn: { value: 0 },
};

const BAYER = '0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0';

function applyPatches(material: THREE.Material, patches: Patch[]) {
  material.onBeforeCompile = (shader) => {
    let frag = shader.fragmentShader;
    if (patches.includes('cutaway')) {
      shader.uniforms.uCut = CUTAWAY.uCut;
      shader.uniforms.uCutOn = CUTAWAY.uCutOn;
      frag = `uniform vec4 uCut;\nuniform float uCutOn;\nconst float BAYER4[16] = float[16](${BAYER});\n${frag.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  if (uCutOn > 0.5) {
    vec3 fp = -vViewPosition;
    if (fp.z - uCut.z > 0.3) {
      float d = length(fp.xy - uCut.xy);
      if (d < uCut.w) {
        int ix = int(mod(gl_FragCoord.x, 4.0));
        int iy = int(mod(gl_FragCoord.y, 4.0));
        float b = (BAYER4[iy * 4 + ix] + 0.5) / 16.0;
        float edge = smoothstep(uCut.w * 0.62, uCut.w, d);
        if (edge < b) discard;
      }
    }
  }`,
      )}`;
    }
    const surface = patches.includes('normals-surface');
    const fx = patches.includes('normals-fx');
    // Unlit materials have no shading normal: derive a flat facet normal from screen-space
    // derivatives of the view-space position (crisp, matches the toon look).
    const unlit = surface && (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;
    if (unlit) {
      shader.vertexShader = `varying vec3 vPcView;\n${shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvPcView = mvPosition.xyz;')}`;
      frag = `varying vec3 vPcView;\n${frag}`;
    }
    if (surface || fx) {
      const write = fx ? 'pc_fragNormal = vec4( 0.0 );'
        : unlit ? 'pc_fragNormal = vec4( normalize( cross( dFdx( vPcView ), dFdy( vPcView ) ) ) * 0.5 + 0.5, 1.0 );'
          : 'pc_fragNormal = vec4( normalize( normal ) * 0.5 + 0.5, 1.0 );';
      frag = `layout(location = 1) out highp vec4 pc_fragNormal;\n${frag.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n\t${write}`)}`;
    }
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => patches.join('+');
  material.userData.patches = patches;
}

function patchesOf(m: THREE.Material): Patch[] {
  return (m.userData.patches as Patch[] | undefined) ?? [];
}

export function writesNormals<T extends THREE.Material>(material: T, kind: 'surface' | 'fx' = 'surface'): T {
  const keep = patchesOf(material).filter((p) => p === 'cutaway');
  applyPatches(material, [...keep, kind === 'surface' ? 'normals-surface' : 'normals-fx']);
  return material;
}

const GHOST_TINT = new THREE.Color('#9fd0ff');

/**
 * A translucent pale-blue copy of a material (replay ghosts). clone() drops the shader patch, and
 * without its normal output the draw fails on the pipeline's two render targets, so it is
 * reapplied as an fx patch (blended: leaves the normal buffer alone, so no outline).
 */
export function ghostMaterial(src: THREE.Material): THREE.Material {
  const c = src.clone() as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };
  c.transparent = true;
  c.opacity = 0.42;
  c.depthWrite = false;
  c.stencilWrite = false;
  c.color?.lerp(GHOST_TINT, 0.55);
  c.emissive?.set('#1a3050');
  return writesNormals(c, 'fx');
}

/** Adds the hero cutaway to a (normals-writing) material. */
export function withCutaway<T extends THREE.Material>(material: T): T {
  const keep = patchesOf(material).filter((p) => p !== 'cutaway');
  applyPatches(material, ['cutaway', ...(keep.length ? keep : ['normals-surface' as const])]);
  return material;
}

let gradient: THREE.DataTexture | null = null;
let gradientBands = 0;

/** Shared N-band ramp (nearest-filtered), rebuilt when render.toonBands changes. */
export function toonGradient(): THREE.DataTexture {
  const bands = config['render.toonBands'];
  if (gradient && gradientBands === bands) return gradient;
  const data = new Uint8Array(bands * 4);
  for (let i = 0; i < bands; i++) {
    // Dark band stays fairly bright: pixel art shadows are a hue/value shift, not black.
    const v = Math.round(255 * (0.42 + 0.58 * (i / (bands - 1))));
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, bands, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  if (gradient) {
    gradient.image = tex.image;
    gradient.needsUpdate = true;
    tex.dispose();
  } else gradient = tex;
  gradientBands = bands;
  return gradient!;
}

export function toonMaterial(color: THREE.ColorRepresentation, map: THREE.Texture | null = null, vertexColors = false): THREE.MeshToonMaterial {
  return writesNormals(new THREE.MeshToonMaterial({ color, map, gradientMap: toonGradient(), vertexColors }));
}

/** Unlit glowing material (eyes, runes, embers): still writes normals so outlines work. */
export function glowMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return writesNormals(new THREE.MeshBasicMaterial({ color }));
}

/** Converts any glTF material (usually MeshStandardMaterial) into a toon material with the same color/map. */
export function toonize(src: THREE.Material): THREE.MeshToonMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshToonMaterial({
    name: s.name,
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    gradientMap: toonGradient(),
    transparent: s.transparent,
    alphaTest: s.alphaTest || (s.transparent ? 0.5 : 0),
    side: s.side,
  });
  if (m.map) {
    m.map.colorSpace = THREE.SRGBColorSpace;
    // Mipmaps keep minified textures stable (no sparkle) at ~48 px character height.
    m.map.anisotropy = 1;
  }
  // Alpha-blended hair cards read as noise at low res; cut them out instead.
  if (m.transparent) {
    m.transparent = false;
    m.alphaTest = 0.5;
  }
  return writesNormals(m);
}
