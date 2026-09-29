/**
 * Level data. Plain JSON-compatible data: agents can read it with `level.get`, edit it and send it
 * back with `level.set` (the sim and the view rebuild from it).
 *
 * Coordinates: meters, Y up, floor at y = 0. The camera looks from +X+Z toward -X-Z, so the
 * (-X,-Z) corner is at the top of the screen. Walls along x = -8 and z = -8 are the back walls
 * (full height); walls along x = +8 and z = +8 face the camera and are cut down to knee height so
 * they never hide anyone.
 */
export type Brain = 'input' | 'wander' | 'dummy' | 'idle';

export interface WallDef {
  id: string;
  from: [number, number];
  to: [number, number];
  height: number;
  thickness?: number;
  color?: string;
}

export interface CrateDef {
  id: string;
  x: number;
  z: number;
  /** Bottom height (for stacking). */
  y?: number;
  size?: number;
  pushable?: boolean;
}

export interface CharacterDef {
  id: string;
  preset: string;
  x: number;
  z: number;
  yawDeg?: number;
  brain: Brain;
}

export interface Level {
  name: string;
  /** Floor extents, centered on the origin. */
  width: number;
  depth: number;
  floor: { colorA: string; colorB: string; tile: number };
  wallColor: string;
  wallTopColor: string;
  background: string;
  /** Sun direction: azimuth from +Z toward +X, elevation above the horizon. */
  sun: { azimuthDeg: number; elevationDeg: number };
  walls: WallDef[];
  crates: CrateDef[];
  characters: CharacterDef[];
}

export const DEFAULT_LEVEL: Level = {
  name: 'training-room',
  width: 16,
  depth: 16,
  floor: { colorA: '#4b4553', colorB: '#554e5e', tile: 1 },
  wallColor: '#6e6479',
  wallTopColor: '#8f86a0',
  background: '#0d0c11',
  sun: { azimuthDeg: 20, elevationDeg: 55 },
  walls: [
    { id: 'wall_west', from: [-8.25, -8.25], to: [-8.25, 8.25], height: 2.6, thickness: 0.5 },
    { id: 'wall_north', from: [-8.25, -8.25], to: [8.25, -8.25], height: 2.6, thickness: 0.5 },
    { id: 'wall_east_low', from: [8.25, -8.25], to: [8.25, 8.25], height: 0.45, thickness: 0.5 },
    { id: 'wall_south_low', from: [-8.25, 8.25], to: [8.25, 8.25], height: 0.45, thickness: 0.5 },
    { id: 'partition_a', from: [-8, -1.5], to: [-3.5, -1.5], height: 1.6, thickness: 0.4 },
    { id: 'partition_b', from: [2.5, -8], to: [2.5, -4.2], height: 1.6, thickness: 0.4 },
    { id: 'pillar', from: [4.6, 2.6], to: [5.4, 2.6], height: 2.2, thickness: 0.8 },
  ],
  crates: [
    { id: 'crate_stack_1', x: -6.9, z: -6.9 },
    { id: 'crate_stack_2', x: -5.8, z: -7.0 },
    { id: 'crate_stack_3', x: -6.9, z: -5.8 },
    { id: 'crate_stack_top', x: -6.9, z: -6.9, y: 1 },
    { id: 'crate_big', x: 6, z: 6, size: 1.4 },
    { id: 'crate_push_1', x: 0.8, z: 1.2, pushable: true },
    { id: 'crate_push_2', x: -2.4, z: 3.4, pushable: true },
    { id: 'crate_push_3', x: 5.2, z: -1.8, pushable: true },
  ],
  characters: [
    { id: 'player', preset: 'ranger', x: 0, z: 4.5, yawDeg: 180, brain: 'input' },
    { id: 'dummy', preset: 'dummy', x: 0.4, z: -2.6, yawDeg: 20, brain: 'dummy' },
    { id: 'villager', preset: 'villager', x: -4.5, z: -4.5, brain: 'wander' },
    { id: 'farmer', preset: 'farmer', x: 5.5, z: -6, brain: 'wander' },
  ],
};
