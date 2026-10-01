/**
 * Level themes: the visual half of a level's identity (layout and mechanics are the other half).
 * A theme colors the procedural floor and wall textures, sets the light rig (sky/ground
 * hemisphere, sun, darkness), torch color and the decor props scattered by the generator.
 * Endless mode mixes any theme with any layout, mechanic set and monster palette.
 */
export interface Theme {
  id: string;
  name: string;
  floor: { base: string; alt: string; grout: string; accent: string; pattern: 'flagstone' | 'brick' | 'cobble' | 'dirt' | 'tile' | 'plank' | 'grass' };
  wall: { side: string; top: string; trim: string; pattern: 'brick' | 'block' | 'rough' | 'plank' | 'hedge' };
  background: string;
  sky: string;
  ground: string;
  /** Hemisphere (ambient) intensity; low values make torches matter. */
  ambient: number;
  sun: { color: string; intensity: number; azimuthDeg: number; elevationDeg: number };
  torch: string;
  /** Decor props scattered on floors (render-only) and along walls. */
  decor: string[];
  /** Breakable containers that spill gold. */
  breakables: string[];
  /** Monster palettes that fit the theme (encounter generator bias). */
  palettes: string[];
  /** Floating dust / embers / snow particles. */
  particles: 'dust' | 'embers' | 'snow' | 'spores' | 'motes' | 'none';
}

export const THEMES: Record<string, Theme> = {
  crypt: {
    id: 'crypt', name: 'Crypt',
    floor: { base: '#4a4553', alt: '#544e5e', grout: '#2c2833', accent: '#6b6178', pattern: 'flagstone' },
    wall: { side: '#5e566b', top: '#8f86a0', trim: '#3a3442', pattern: 'block' },
    background: '#0b0a10', sky: '#a9b4ff', ground: '#352c40', ambient: 0.9,
    sun: { color: '#e8e0ff', intensity: 1.2, azimuthDeg: 20, elevationDeg: 55 }, torch: '#ffb35a',
    decor: ['bones', 'rubble', 'candles', 'skull'], breakables: ['urn', 'coffin'], palettes: ['bone', 'void', 'spectral'], particles: 'dust',
  },
  cellar: {
    id: 'cellar', name: 'Powder Cellars',
    floor: { base: '#5a4636', alt: '#634d3b', grout: '#33261c', accent: '#7a5f46', pattern: 'plank' },
    wall: { side: '#6e5a48', top: '#9a8066', trim: '#3a2c20', pattern: 'brick' },
    background: '#0d0a08', sky: '#ffd9a8', ground: '#3a2a1c', ambient: 0.85,
    sun: { color: '#ffe2b8', intensity: 1.1, azimuthDeg: 30, elevationDeg: 60 }, torch: '#ff9a3d',
    decor: ['barrels', 'rubble', 'sacks', 'candles'], breakables: ['crate', 'barrel'], palettes: ['ember', 'rust', 'blood'], particles: 'embers',
  },
  catacomb: {
    id: 'catacomb', name: 'Catacombs',
    floor: { base: '#5c5546', alt: '#665e4e', grout: '#363126', accent: '#7d735f', pattern: 'cobble' },
    wall: { side: '#7a705e', top: '#a69b84', trim: '#3c3628', pattern: 'rough' },
    background: '#0c0b08', sky: '#fff0c8', ground: '#3a3224', ambient: 0.8,
    sun: { color: '#fff0d0', intensity: 1, azimuthDeg: 10, elevationDeg: 60 }, torch: '#ffc070',
    decor: ['bones', 'skull', 'rubble', 'candles'], breakables: ['urn', 'coffin'], palettes: ['bone', 'blood', 'venom'], particles: 'dust',
  },
  frost: {
    id: 'frost', name: 'Frozen Halls',
    floor: { base: '#9fb8c8', alt: '#adc6d6', grout: '#6a8496', accent: '#d8ecf6', pattern: 'tile' },
    wall: { side: '#7f9fb6', top: '#e4f4ff', trim: '#4a6278', pattern: 'block' },
    background: '#070b12', sky: '#cfeaff', ground: '#3a5068', ambient: 1.05,
    sun: { color: '#dff2ff', intensity: 1.35, azimuthDeg: 40, elevationDeg: 50 }, torch: '#9fd8ff',
    decor: ['icicles', 'crystals', 'rubble'], breakables: ['urn', 'crate'], palettes: ['frost', 'spectral', 'storm'], particles: 'snow',
  },
  foundry: {
    id: 'foundry', name: 'Foundry',
    floor: { base: '#3a3434', alt: '#433b3a', grout: '#1e1a1a', accent: '#6a4a3a', pattern: 'tile' },
    wall: { side: '#4a4040', top: '#6e6060', trim: '#241e1e', pattern: 'block' },
    background: '#0d0606', sky: '#ffb08a', ground: '#3a1810', ambient: 0.7,
    sun: { color: '#ffc8a0', intensity: 1.0, azimuthDeg: 25, elevationDeg: 55 }, torch: '#ff6a2a',
    decor: ['anvils', 'chains', 'rubble', 'barrels'], breakables: ['crate', 'barrel'], palettes: ['ember', 'ash', 'rust'], particles: 'embers',
  },
  ruins: {
    id: 'ruins', name: 'Overgrown Ruins',
    floor: { base: '#566142', alt: '#5f6a49', grout: '#394028', accent: '#7c8a55', pattern: 'grass' },
    wall: { side: '#7a7a68', top: '#9aa07a', trim: '#4a4a38', pattern: 'rough' },
    background: '#080b06', sky: '#e8ffd0', ground: '#3a4426', ambient: 1.15,
    sun: { color: '#fff6d8', intensity: 1.5, azimuthDeg: 35, elevationDeg: 50 }, torch: '#ffd070',
    decor: ['grass', 'mushrooms', 'rubble', 'flowers'], breakables: ['urn', 'crate'], palettes: ['moss', 'venom', 'gilded'], particles: 'spores',
  },
  abyss: {
    id: 'abyss', name: 'The Abyss',
    floor: { base: '#2a2238', alt: '#302740', grout: '#150f1e', accent: '#5a3a8a', pattern: 'tile' },
    wall: { side: '#3a2e52', top: '#5c4a80', trim: '#1a1428', pattern: 'block' },
    background: '#05030a', sky: '#c8a8ff', ground: '#24143a', ambient: 0.75,
    sun: { color: '#d8c0ff', intensity: 0.9, azimuthDeg: 15, elevationDeg: 60 }, torch: '#c77dff',
    decor: ['crystals', 'rubble', 'tentacles'], breakables: ['urn'], palettes: ['void', 'storm', 'spectral'], particles: 'motes',
  },
  temple: {
    id: 'temple', name: 'Sunken Temple',
    floor: { base: '#3e6a6a', alt: '#457474', grout: '#223e3e', accent: '#c9a13b', pattern: 'tile' },
    wall: { side: '#5a8a86', top: '#8ab8b0', trim: '#2a4a48', pattern: 'block' },
    background: '#030909', sky: '#c8fff4', ground: '#1a3a38', ambient: 1.0,
    sun: { color: '#e0fff8', intensity: 1.2, azimuthDeg: 30, elevationDeg: 55 }, torch: '#6affd8',
    decor: ['crystals', 'rubble', 'candles'], breakables: ['urn'], palettes: ['gilded', 'storm', 'venom'], particles: 'motes',
  },
  ashlands: {
    id: 'ashlands', name: 'Ashlands',
    floor: { base: '#4a4440', alt: '#524a45', grout: '#2a2422', accent: '#8a3a22', pattern: 'dirt' },
    wall: { side: '#5a524c', top: '#7a706a', trim: '#2a2422', pattern: 'rough' },
    background: '#0a0504', sky: '#ffc0a0', ground: '#3a2018', ambient: 0.95,
    sun: { color: '#ffd0b0', intensity: 1.3, azimuthDeg: 50, elevationDeg: 45 }, torch: '#ff7a3a',
    decor: ['rubble', 'bones', 'embers'], breakables: ['urn', 'crate'], palettes: ['ash', 'ember', 'blood'], particles: 'embers',
  },
  town: {
    id: 'town', name: 'Haven',
    floor: { base: '#6a6a52', alt: '#73725a', grout: '#45442f', accent: '#8a8460', pattern: 'cobble' },
    wall: { side: '#8a7a62', top: '#b0a080', trim: '#4a3e2e', pattern: 'plank' },
    background: '#0a0d12', sky: '#ffe8c8', ground: '#4a4430', ambient: 1.25,
    sun: { color: '#ffd8a8', intensity: 1.6, azimuthDeg: 60, elevationDeg: 35 }, torch: '#ffb35a',
    decor: ['grass', 'flowers', 'barrels', 'sacks'], breakables: [], palettes: ['bone'], particles: 'motes',
  },
};

export const DUNGEON_THEMES = Object.keys(THEMES).filter((t) => t !== 'town');

export function theme(id: string): Theme {
  return THEMES[id] ?? THEMES.crypt;
}
