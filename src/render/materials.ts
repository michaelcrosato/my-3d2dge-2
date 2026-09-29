/** Toon materials: hard light bands, no specular. Everything in the scene goes through here. */
import * as THREE from 'three';
import { config } from '../config';

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

export function toonMaterial(color: THREE.ColorRepresentation, map: THREE.Texture | null = null): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, map, gradientMap: toonGradient() });
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
  return m;
}
