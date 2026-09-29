/**
 * Pure math for the art-pixel grid. No three.js, so the sim and Node tests can use it.
 *
 * The camera is orthographic with a fixed yaw/pitch, so "screen position in art pixels" is just a
 * dot product with the camera's right/up vectors times pixelsPerMeter. Snapping a world point to
 * the grid means rounding those two coordinates and leaving depth alone. If the camera and an
 * object are both snapped, the object lands on whole pixels, so a held pose rasterizes to the
 * exact same pixels wherever it moves.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface IsoBasis {
  right: V3;
  up: V3;
  /** Direction the camera looks (into the screen). */
  forward: V3;
  /** Ground-plane unit vectors for screen-relative movement (screen right / screen up). */
  groundRight: V3;
  groundUp: V3;
}

const DEG = Math.PI / 180;

/** yaw: camera azimuth from +Z toward +X; pitch: downward tilt. 45/30 gives exact 2:1 pixel lines. */
export function isoBasis(yawDeg: number, pitchDeg: number): IsoBasis {
  const sy = Math.sin(yawDeg * DEG), cy = Math.cos(yawDeg * DEG);
  const sp = Math.sin(pitchDeg * DEG), cp = Math.cos(pitchDeg * DEG);
  return {
    right: { x: cy, y: 0, z: -sy },
    up: { x: -sy * sp, y: cp, z: -cy * sp },
    forward: { x: -sy * cp, y: -sp, z: -cy * cp },
    groundRight: { x: cy, y: 0, z: -sy },
    groundUp: { x: -sy, y: 0, z: -cy },
  };
}

export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Screen coordinates in art pixels (x right, y up), relative to the world origin. */
export function screenPx(p: V3, b: IsoBasis, ppm: number): { x: number; y: number } {
  return { x: dot(p, b.right) * ppm, y: dot(p, b.up) * ppm };
}

/** Moves p within the screen plane so it sits on whole art pixels. Depth is unchanged. */
export function snapToGrid(p: V3, b: IsoBasis, ppm: number, out: V3 = { x: 0, y: 0, z: 0 }): V3 {
  const sx = dot(p, b.right) * ppm;
  const sy = dot(p, b.up) * ppm;
  const dx = (Math.round(sx) - sx) / ppm;
  const dy = (Math.round(sy) - sy) / ppm;
  out.x = p.x + b.right.x * dx + b.up.x * dy;
  out.y = p.y + b.right.y * dx + b.up.y * dy;
  out.z = p.z + b.right.z * dx + b.up.z * dy;
  return out;
}

/** Sub-pixel remainder of p (in art pixels), i.e. how far p is from its snapped position. */
export function subPixel(p: V3, b: IsoBasis, ppm: number): { x: number; y: number } {
  const sx = dot(p, b.right) * ppm;
  const sy = dot(p, b.up) * ppm;
  return { x: sx - Math.round(sx), y: sy - Math.round(sy) };
}

/**
 * Integer upscale for a canvas measured in DEVICE pixels (so Windows 125%/150% scaling stays crisp).
 * Returns the low-res size that covers the canvas (plus `margin` texels per side for sub-pixel scroll).
 */
export function chooseScale(deviceW: number, deviceH: number, targetLines: number, margin = 1) {
  const scale = Math.max(1, Math.round(deviceH / targetLines));
  return {
    scale,
    width: Math.ceil(deviceW / scale) + margin * 2,
    height: Math.ceil(deviceH / scale) + margin * 2,
    margin,
  };
}

/** Nearest of 8 directions. Index 0 = +Z (toward the camera's lower-left on screen), counter-clockwise seen from above. */
export function dir8(yaw: number): { index: number; yaw: number } {
  const step = Math.PI / 4;
  const index = ((Math.round(yaw / step) % 8) + 8) % 8;
  return { index, yaw: index * step };
}

/** Names of the 8 directions as they appear on screen with the default 45° camera yaw. */
export const DIR8_SCREEN_NAMES = ['down-left', 'down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left'] as const;
