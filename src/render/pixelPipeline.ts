/**
 * Low-res render -> 1-px outlines/creases -> optional palette lock -> exact integer upscale.
 *
 * Frame flow (pixel mode):
 *   1. scene  -> targets.scene   ONE geometry pass into two attachments: half-float color and
 *                                view-space normals (see writesNormals), plus depth/stencil texture
 *   2. post   -> targets.post    (edges, sRGB encode, palette; 8-bit, what agents capture)
 *   3. upscale-> canvas          (nearest, integer factor, centered, optional sub-pixel offset)
 * Plain mode renders the scene at full device resolution with 4x MSAA instead.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { config } from '../config';
import { chooseScale } from './pixelGrid';
import { hexToOklab, MAX_PALETTE, PALETTES, type PaletteName } from './palettes';

/** Layer bits. Layer 0 is the main pass; FX = blob shadows and silhouettes (see writesNormals). */
export const LAYER = { MAIN: 0, FX: 1, DEBUG: 2, ISOLATE: 7 } as const;
const MAIN_VIEW_LAYERS = [LAYER.MAIN, LAYER.FX, LAYER.DEBUG] as const;

export class PixelTargets {
  /** textures[0] = linear color, textures[1] = packed view-space normals. */
  scene: THREE.WebGLRenderTarget;
  post: THREE.WebGLRenderTarget;
  constructor(public width: number, public height: number) {
    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedInt248Type);
    depthTexture.format = THREE.DepthStencilFormat;
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    this.scene = new THREE.WebGLRenderTarget(width, height, {
      ...nearest, type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, depthTexture, count: 2,
    });
    this.scene.textures[1].name = 'normal';
    this.post = new THREE.WebGLRenderTarget(width, height, { ...nearest, type: THREE.UnsignedByteType, depthBuffer: false });
  }
  get normal(): THREE.Texture {
    return this.scene.textures[1];
  }
  dispose() {
    this.scene.depthTexture?.dispose();
    this.scene.dispose();
    this.post.dispose();
  }
}

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const postFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec4 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float outlineStrength;
uniform float innerStrength;
uniform float depthThreshold;
uniform int paletteSize;
uniform vec3 paletteLab[${MAX_PALETTE}];
uniform vec3 paletteRgb[${MAX_PALETTE}];
varying vec2 vUv;

float depthAt(vec2 uv) { return cameraNear + texture2D(tDepth, uv).r * (cameraFar - cameraNear); }
// Normals share the half-float MRT pass; quantize like an 8-bit target so flat faces compare exactly equal.
vec3 normalAt(vec2 uv) { return normalize(floor(texture2D(tNormal, uv).rgb * 255.0 + 0.5) / 255.0 * 2.0 - 1.0); }

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toOklab(vec3 c) {
  float l = pow(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 1.0 / 3.0);
  float m = pow(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 1.0 / 3.0);
  float s = pow(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b, 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

// Crease test against one neighbour: only the shallower pixel, and only the side whose normal
// leans toward the bias direction, marks the edge, so creases stay exactly 1 px wide.
float crease(vec2 offs, float d, vec3 n) {
  vec2 uv = vUv + offs * resolution.zw;
  float dd = depthAt(uv) - d;
  if (abs(dd) > depthThreshold) return 0.0;
  vec3 nn = normalAt(uv);
  float side = step(0.0, dot(n - nn, vec3(1.0, 1.0, 1.0)));
  float shallower = step(0.0, dd * 0.25 + 0.0025);
  return (1.0 - dot(n, nn)) * side * shallower;
}

void main() {
  vec4 color = texture2D(tColor, vUv);
  vec3 c = color.rgb;
  float a = color.a;
  float d = depthAt(vUv);
  vec2 px = resolution.zw;

  float far = 0.0;
  far = max(far, depthAt(vUv + vec2(px.x, 0.0)) - d);
  far = max(far, depthAt(vUv - vec2(px.x, 0.0)) - d);
  far = max(far, depthAt(vUv + vec2(0.0, px.y)) - d);
  far = max(far, depthAt(vUv - vec2(0.0, px.y)) - d);
  bool isOutline = outlineStrength > 0.0 && far > depthThreshold && a > 0.0;

  if (isOutline) {
    c *= 1.0 - outlineStrength;
  } else if (innerStrength > 0.0 && a > 0.0) {
    vec3 n = normalAt(vUv);
    float e = crease(vec2(1.0, 0.0), d, n) + crease(vec2(-1.0, 0.0), d, n)
            + crease(vec2(0.0, 1.0), d, n) + crease(vec2(0.0, -1.0), d, n);
    if (e > 0.18) c = mix(c, c * 1.6 + 0.04, innerStrength);
  }

  vec3 outRgb = toSrgb(c);
  if (paletteSize > 0) {
    vec3 lab = toOklab(clamp(c, 0.0, 1.0));
    float best = 1e9;
    vec3 pick = outRgb;
    for (int i = 0; i < ${MAX_PALETTE}; i++) {
      if (i >= paletteSize) break;
      vec3 dl = lab - paletteLab[i];
      float dist = dot(dl, dl);
      if (dist < best) { best = dist; pick = paletteRgb[i]; }
    }
    outRgb = pick;
  }
  gl_FragColor = vec4(outRgb, a);
}`;

const upscaleFragment = /* glsl */ `
uniform sampler2D tPost;
uniform sampler2D tOverlay;
uniform float overlayOn;
uniform vec2 lowRes;
uniform float scale;
uniform vec2 offset;
uniform vec2 overlayOffset;
uniform vec3 background;
void main() {
  vec2 p = floor((gl_FragCoord.xy + offset) / scale);
  vec4 c = texture2D(tPost, (p + 0.5) / lowRes);
  vec3 col = mix(background, c.rgb, c.a);
  if (overlayOn > 0.5) {
    // The overlay is anchored to the screen grid (not the sub-pixel scroll), so HUD text never wobbles.
    vec2 q = floor((gl_FragCoord.xy + overlayOffset) / scale);
    vec4 o = texture2D(tOverlay, (q + 0.5) / lowRes);
    col = mix(col, o.rgb, o.a);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const copyFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tOverlay;
uniform float overlayOn;
uniform vec2 lowRes;
uniform float scale;
uniform vec2 overlayOffset;
varying vec2 vUv;
void main() {
  vec3 c = clamp(texture2D(tColor, vUv).rgb, 0.0, 1.0);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  if (overlayOn > 0.5) {
    vec2 q = floor((gl_FragCoord.xy + overlayOffset) / scale);
    vec4 o = texture2D(tOverlay, (q + 0.5) / lowRes);
    c = mix(c, o.rgb, o.a);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export interface RenderOptions {
  /** Sub-pixel camera remainder in art pixels (smooth scroll), applied after upscaling. */
  subPixel?: { x: number; y: number };
  /** Draw edges/palette. false = raw low-res (used for plain-mode comparisons). */
  post?: boolean;
  /** Low-res overlay (damage numbers, labels, minimap) composited over the frame. */
  overlay?: THREE.Texture | null;
}

export class PixelPipeline {
  scale = 1;
  width = 2;
  height = 2;
  margin = 1;
  deviceW = 1;
  deviceH = 1;
  main: PixelTargets;
  private full: THREE.WebGLRenderTarget;
  private postMaterial: THREE.ShaderMaterial;
  private upscaleMaterial: THREE.ShaderMaterial;
  private copyMaterial: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private paletteKey = '';
  background = new THREE.Color(0x0d0c11);

  constructor(readonly renderer: THREE.WebGLRenderer) {
    this.main = new PixelTargets(2, 2);
    this.full = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.postMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: postFragment,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
        resolution: { value: new THREE.Vector4() }, cameraNear: { value: 0.1 }, cameraFar: { value: 100 },
        outlineStrength: { value: 0 }, innerStrength: { value: 0 }, depthThreshold: { value: 0.3 },
        paletteSize: { value: 0 },
        paletteLab: { value: Array.from({ length: MAX_PALETTE }, () => new THREE.Vector3()) },
        paletteRgb: { value: Array.from({ length: MAX_PALETTE }, () => new THREE.Vector3()) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.upscaleMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: upscaleFragment,
      uniforms: {
        tPost: { value: null }, lowRes: { value: new THREE.Vector2() }, scale: { value: 1 },
        offset: { value: new THREE.Vector2() }, background: { value: new THREE.Vector3() },
        tOverlay: { value: null }, overlayOn: { value: 0 }, overlayOffset: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: copyFragment,
      uniforms: {
        tColor: { value: null }, tOverlay: { value: null }, overlayOn: { value: 0 }, lowRes: { value: new THREE.Vector2() },
        scale: { value: 1 }, overlayOffset: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Canvas size in device pixels. Recomputes the integer scale and low-res target size. */
  setSize(deviceW: number, deviceH: number): boolean {
    const s = chooseScale(deviceW, deviceH, config['render.targetLines']);
    const changed = s.width !== this.width || s.height !== this.height || deviceW !== this.deviceW || deviceH !== this.deviceH;
    this.deviceW = deviceW;
    this.deviceH = deviceH;
    this.scale = s.scale;
    this.margin = s.margin;
    if (s.width !== this.width || s.height !== this.height) {
      this.main.dispose();
      this.main = new PixelTargets(s.width, s.height);
      this.width = s.width;
      this.height = s.height;
    }
    this.full.setSize(deviceW, deviceH);
    return changed;
  }

  /** Visible low-res rectangle (inside the margin), in target pixels, origin bottom-left. */
  visibleRect() {
    const w = Math.ceil(this.deviceW / this.scale);
    const h = Math.ceil(this.deviceH / this.scale);
    return { x: Math.floor((this.width - w) / 2), y: Math.floor((this.height - h) / 2), w, h };
  }

  private syncPalette() {
    const name = config['render.palette'] as PaletteName;
    if (name === this.paletteKey) return;
    this.paletteKey = name;
    const colors = PALETTES[name] ?? [];
    const u = this.postMaterial.uniforms;
    u.paletteSize.value = Math.min(colors.length, MAX_PALETTE);
    colors.slice(0, MAX_PALETTE).forEach((hex, i) => {
      const [L, A, B] = hexToOklab(hex);
      (u.paletteLab.value as THREE.Vector3[])[i].set(L, A, B);
      const n = parseInt(hex, 16);
      (u.paletteRgb.value as THREE.Vector3[])[i].set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    });
  }

  /** Steps 1-2 into `targets`. The camera must already be sized to the targets. */
  renderLowRes(targets: PixelTargets, scene: THREE.Scene, camera: THREE.OrthographicCamera, layers: readonly number[], opts: RenderOptions = {}) {
    const r = this.renderer;
    const prevMask = camera.layers.mask;
    camera.layers.disableAll();
    for (const l of layers) camera.layers.enable(l);
    r.setRenderTarget(targets.scene);
    r.clear(true, true, true);
    r.render(scene, camera);
    camera.layers.mask = prevMask;

    const post = opts.post !== false;
    this.syncPalette();
    const u = this.postMaterial.uniforms;
    u.tColor.value = targets.scene.texture;
    u.tDepth.value = targets.scene.depthTexture;
    u.tNormal.value = targets.normal;
    u.resolution.value.set(targets.width, targets.height, 1 / targets.width, 1 / targets.height);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.outlineStrength.value = post && config['render.outlines'] ? config['render.outlineStrength'] : 0;
    u.innerStrength.value = post && config['render.innerLines'] ? config['render.innerLineStrength'] : 0;
    if (!post) u.paletteSize.value = 0;
    this.quad.material = this.postMaterial;
    r.setRenderTarget(targets.post);
    this.quad.render(r);
    if (!post) this.paletteKey = '';
  }

  /** Full frame for the main view. */
  render(scene: THREE.Scene, camera: THREE.OrthographicCamera, opts: RenderOptions = {}) {
    const r = this.renderer;
    const ovOffX = (this.width * this.scale - this.deviceW) / 2, ovOffY = (this.height * this.scale - this.deviceH) / 2;
    if (!config['render.pixelMode']) {
      r.setRenderTarget(this.full);
      r.clear(true, true, true);
      r.render(scene, camera);
      const cu = this.copyMaterial.uniforms;
      cu.tColor.value = this.full.texture;
      cu.tOverlay.value = opts.overlay ?? null;
      cu.overlayOn.value = opts.overlay ? 1 : 0;
      cu.lowRes.value.set(this.width, this.height);
      cu.scale.value = this.scale;
      cu.overlayOffset.value.set(ovOffX, ovOffY);
      this.quad.material = this.copyMaterial;
      r.setRenderTarget(null);
      this.quad.render(r);
      return;
    }
    this.renderLowRes(this.main, scene, camera, MAIN_VIEW_LAYERS, opts);
    const u = this.upscaleMaterial.uniforms;
    u.tPost.value = this.main.post.texture;
    u.lowRes.value.set(this.width, this.height);
    u.scale.value = this.scale;
    const sub = opts.subPixel ?? { x: 0, y: 0 };
    u.offset.value.set(
      (this.width * this.scale - this.deviceW) / 2 + sub.x * this.scale,
      (this.height * this.scale - this.deviceH) / 2 + sub.y * this.scale,
    );
    const bg = this.background;
    u.background.value.set(bg.r, bg.g, bg.b);
    u.tOverlay.value = opts.overlay ?? null;
    u.overlayOn.value = opts.overlay ? 1 : 0;
    u.overlayOffset.value.set(ovOffX, ovOffY);
    this.quad.material = this.upscaleMaterial;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  /** RGBA bytes of a target's post image, top row first. `rect` in target pixels (origin bottom-left). */
  read(targets: PixelTargets, rect?: { x: number; y: number; w: number; h: number }) {
    const { x, y, w, h } = rect ?? { x: 0, y: 0, w: targets.width, h: targets.height };
    const buf = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(targets.post, x, y, w, h, buf);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) out.set(buf.subarray((h - 1 - row) * w * 4, (h - row) * w * 4), row * w * 4);
    return { width: w, height: h, data: out };
  }
}
