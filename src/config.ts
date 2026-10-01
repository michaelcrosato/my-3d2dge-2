/**
 * Every tunable, in one flat table keyed by stable dotted paths.
 * Agents read it with `config.describe` and change it with `config.set` (see src/agent/api.ts);
 * code reads `config['render.outlines']`. Keys prefixed `sim.`/`anim.` affect the deterministic
 * simulation; `render.` keys only change how frames are drawn.
 */
import { PALETTE_NAMES } from './render/palettes';

interface Spec {
  value: boolean | number | string;
  desc: string;
  min?: number;
  max?: number;
  options?: readonly string[];
}

export const CONFIG_SPEC = {
  'render.pixelMode': {
    value: true,
    desc: 'Master switch. false = plain full-resolution 3D with smooth 60 fps animation and free rotation (the "before" picture); all sprite techniques off.',
  },
  'render.targetLines': {
    value: 270, min: 120, max: 540,
    desc: 'Desired low-res height in art pixels; the integer upscale factor is picked to land closest to it for the current window.',
  },
  'render.pixelsPerMeter': {
    value: 31.1127, min: 8, max: 128,
    desc: 'Art pixels per meter across the screen. 31.1127 makes a 1 m floor tile an exact 44x22 px diamond and a 1.8 m character ~48 px tall.',
  },
  'render.outlines': { value: true, desc: '1-px dark outline on the near side of depth edges (silhouettes).' },
  'render.outlineStrength': { value: 0.62, min: 0, max: 1, desc: 'How much outline pixels are darkened.' },
  'render.innerLines': { value: true, desc: '1-px light line on creases (normal edges), like painted highlights.' },
  'render.innerLineStrength': { value: 0.28, min: 0, max: 1, desc: 'How much crease pixels are brightened.' },
  'render.palette': { value: 'none', options: PALETTE_NAMES, desc: 'Lock final colors to a fixed palette (nearest color in OKLab).' },
  'render.toonBands': { value: 3, min: 2, max: 6, desc: 'Number of hard light bands in the toon shading.' },
  'render.snapMovers': { value: true, desc: 'Draw every moving object at whole art-pixel positions, so a held pose moves as identical pixels (the key sprite trick).' },
  'render.snapCamera': { value: true, desc: 'Keep the camera on the art-pixel grid so static scenery never shimmers.' },
  'render.smoothScroll': {
    value: false,
    desc: "true: camera follows the player's continuous position and the leftover sub-pixel is applied after upscaling (smooth world scroll, player jitters up to 1 art px). false: camera locks to the player's snapped position (player steady, world scrolls in whole pixels).",
  },
  'render.blobShadows': { value: true, desc: 'Round shadow under each character (stable at low resolution).' },
  'render.shadows': { value: true, desc: 'Hard-edged shadow maps cast by walls and crates.' },
  'render.silhouettes': { value: true, desc: 'Draw characters as flat silhouettes where walls hide them.' },
  'render.colliders': { value: false, desc: 'Overlay Rapier collider wireframes.' },
  'render.headScale': { value: 1.2, min: 0.5, max: 2, desc: 'Head bone scale (chunkier sprite proportions).' },
  'render.handScale': { value: 1.25, min: 0.5, max: 2, desc: 'Hand bone scale (chunkier sprite proportions).' },
  'anim.stepped': { value: true, desc: 'Hold each pose until the next sprite tick instead of animating every frame.' },
  'anim.fps': { value: 12, min: 1, max: 60, desc: 'Sprite ticks per second. Poses and 8-way facing change only on ticks.' },
  'anim.dir8': { value: true, desc: 'Displayed facing snaps to 8 directions like an 8-way sprite sheet.' },
  'anim.blend': { value: 0.1, min: 0, max: 0.5, desc: 'Crossfade seconds between clips.' },
  'sim.walkSpeed': { value: 1.25, min: 0.2, max: 5, desc: 'm/s when walking (NPC wander, agent walk).' },
  'sim.runSpeed': { value: 4.2, min: 0.5, max: 10, desc: 'm/s default movement.' },
  'sim.sprintSpeed': { value: 6.8, min: 1, max: 14, desc: 'm/s while sprinting.' },
  'sim.accel': { value: 30, min: 1, max: 200, desc: 'Horizontal acceleration, m/s^2.' },
  'sim.turnRate': { value: 14, min: 1, max: 60, desc: 'Turn speed toward the movement direction, rad/s.' },
  'sim.jumpSpeed': { value: 6.6, min: 0, max: 15, desc: 'Take-off speed, m/s (~1 m jump with default gravity).' },
  'sim.gravity': { value: 22, min: 1, max: 60, desc: 'Downward acceleration, m/s^2 (snappier than 9.8 on purpose).' },
  'sim.hitstopFrames': { value: 5, min: 0, max: 30, desc: 'Frames everything freezes on a hit (impact feel).' },
  'sim.crateKnock': { value: 0.6, min: 0, max: 3, desc: "Sword hits shove pushable crates: speed given = the attack's knockback x this (Rapier impulse). 0 = crates ignore swords." },
  'sim.respawnSeconds': { value: 4, min: 0.5, max: 30, desc: 'Seconds before a dead character respawns.' },
  'sim.timeScale': { value: 1, min: 0, max: 4, desc: 'Real-time playback speed. Ignored by agent step(), which always advances exact frames.' },
  'ui.screenShake': { value: 1, min: 0, max: 1.5, desc: 'Screen shake strength (0 = off). Starts at 0 when the system asks for reduced motion.' },
  'ui.damageNumbers': { value: true, desc: 'Floating damage numbers over hit characters.' },
  'ui.lootFilter': { value: 'all', options: ['all', 'magic', 'rare'], desc: 'Ground item labels to show: all, magic and better, or rare and better (uniques always show). Hidden items can still be picked up.' },
  'audio.master': { value: 0.7, min: 0, max: 1, desc: 'Master volume.' },
  'audio.sfx': { value: 0.85, min: 0, max: 1, desc: 'Combat, loot and mechanic sounds (all synthesized live).' },
  'audio.ambience': { value: 0.6, min: 0, max: 1, desc: 'Per-theme ambient drone.' },
  'audio.music': { value: 0.45, min: 0, max: 1, desc: 'Generative music: a calm town tune, dark dungeon phrases per theme, a driving pulse in boss fights.' },
  'audio.mute': { value: false, desc: 'Silence everything.' },
  'tune.playerDamage': { value: 1, min: 0.1, max: 10, desc: 'Difficulty: multiplier on all damage the hero (and minions) deal.' },
  'tune.playerLife': { value: 1, min: 0.1, max: 10, desc: 'Difficulty: multiplier on the hero\'s maximum life.' },
  'tune.playerSpeed': { value: 1, min: 0.3, max: 3, desc: 'Difficulty: multiplier on the hero\'s movement, attack and cast speed.' },
  'tune.enemyDamage': { value: 1, min: 0.1, max: 10, desc: 'Difficulty: multiplier on all damage monsters deal.' },
  'tune.enemyLife': { value: 1, min: 0.1, max: 10, desc: 'Difficulty: multiplier on monster maximum life.' },
  'tune.enemySpeed': { value: 1, min: 0.3, max: 3, desc: 'Difficulty: multiplier on monster movement, attack and cast speed.' },
  'tune.xp': { value: 1, min: 0, max: 20, desc: 'Experience multiplier (playtesting).' },
  'tune.loot': { value: 1, min: 0, max: 20, desc: 'Item drop quantity multiplier (playtesting).' },
  'tune.density': { value: 1, min: 0.2, max: 4, desc: 'Monster pack density multiplier for newly generated levels.' },
} as const satisfies Record<string, Spec>;

type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : never;
export type ConfigKey = keyof typeof CONFIG_SPEC;
export type Config = { -readonly [K in ConfigKey]: Widen<(typeof CONFIG_SPEC)[K]['value']> };

const defaults = () =>
  Object.fromEntries(Object.entries(CONFIG_SPEC).map(([k, s]) => [k, s.value])) as Config;

export const config: Config = defaults();
export const configListeners = new Set<(key: ConfigKey) => void>();

export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_SPEC, key);
}

/** Throws with a message an agent can act on unless `value` is valid for `key`. */
export function validateConfig(key: string, value: unknown): asserts key is ConfigKey {
  if (!isConfigKey(key)) throw new Error(`unknown config key "${key}". Call config.describe for the list.`);
  const spec: Spec = CONFIG_SPEC[key];
  if (typeof spec.value === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${key} expects a boolean`);
  } else if (typeof spec.value === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} expects a number`);
    if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max))
      throw new Error(`${key} must be within [${spec.min}, ${spec.max}]`);
  } else {
    if (typeof value !== 'string') throw new Error(`${key} expects a string`);
    if (spec.options && !spec.options.includes(value)) throw new Error(`${key} must be one of: ${spec.options.join(', ')}`);
  }
}

/** Validates and applies one value. Throws with a message an agent can act on. */
export function setConfig(key: string, value: unknown): { key: ConfigKey; value: unknown; previous: unknown } {
  validateConfig(key, value);
  const previous = config[key];
  (config as Record<string, unknown>)[key] = value;
  for (const fn of configListeners) fn(key);
  return { key, value, previous };
}

export const configDefault = (key: ConfigKey): Config[ConfigKey] => CONFIG_SPEC[key].value;

export function resetConfig(): void {
  const d = defaults();
  for (const k of Object.keys(d) as ConfigKey[]) if (config[k] !== d[k]) setConfig(k, d[k]);
}

/** Difficulty presets (pause menu buttons and the agent `difficulty.set` tool). */
export const DIFFICULTY_PRESETS: Record<string, Partial<Record<ConfigKey, number>>> = {
  Story: { 'tune.playerDamage': 1.6, 'tune.playerLife': 1.8, 'tune.enemyDamage': 0.6, 'tune.enemyLife': 0.8 },
  Normal: {},
  Hard: { 'tune.enemyDamage': 1.5, 'tune.enemyLife': 1.4, 'tune.enemySpeed': 1.1 },
  Nightmare: { 'tune.enemyDamage': 2.2, 'tune.enemyLife': 2.2, 'tune.enemySpeed': 1.2, 'tune.loot': 1.5, 'tune.xp': 1.5 },
};

/** Sets every `tune.*` key to the preset's value (or its default). */
export function applyDifficulty(name: string): Record<string, number> {
  const values = DIFFICULTY_PRESETS[name];
  if (!values) throw new Error(`unknown difficulty "${name}". Presets: ${Object.keys(DIFFICULTY_PRESETS).join(', ')}`);
  const out: Record<string, number> = {};
  for (const k of Object.keys(CONFIG_SPEC) as ConfigKey[]) {
    if (!k.startsWith('tune.')) continue;
    const v = values[k] ?? (CONFIG_SPEC[k].value as number);
    setConfig(k, v);
    out[k] = v;
  }
  return out;
}

export function describeConfig() {
  return (Object.keys(CONFIG_SPEC) as ConfigKey[]).map((key) => {
    const s: Spec = CONFIG_SPEC[key];
    return { key, value: config[key], default: s.value, desc: s.desc, min: s.min, max: s.max, options: s.options };
  });
}
