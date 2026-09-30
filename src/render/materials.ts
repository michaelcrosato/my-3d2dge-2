/** Toon materials: hard light bands, no specular. Everything in the scene goes through here. */
import * as THREE from 'three';
import { config } from '../config';

/**
 * The pixel pipeline draws color and view-space normals in ONE geometry pass (two render
 * targets), instead of re-rendering the whole scene with a normal override material.
 * Every material drawn into the pixel targets therefore writes attachment 1:
 * - 'surface': opaque materials write their shading normal (packed like MeshNormalMaterial).
 * - 'fx': blended overlays (silhouettes, blob shadows, debug lines) write alpha 0, which normal
 *   blending turns into "leave the normal buffer unchanged". FX materials must be transparent.
 * Targets with one attachment (plain mode, the canvas) simply discard the extra output.
 */
export function writesNormals<T extends THREE.Material>(material: T, kind: 'surface' | 'fx' = 'surface'): T {
  const write = kind === 'surface' ? 'pc_fragNormal = vec4( normalize( normal ) * 0.5 + 0.5, 1.0 );' : 'pc_fragNormal = vec4( 0.0 );';
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = `layout(location = 1) out highp vec4 pc_fragNormal;\n${shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>\n\t${write}`,
    )}`;
  };
  material.customProgramCacheKey = () => `normals-${kind}`;
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
