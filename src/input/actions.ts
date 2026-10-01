/**
 * Every bindable action, its label and group. Keyboard/mouse codes are `KeyboardEvent.code`
 * values plus `Mouse0`-`Mouse4` (buttons) and `WheelUp`/`WheelDown`. Gamepad inputs use the
 * W3C "standard" mapping (button 0 = A / Cross, axis 0/1 = left stick).
 */
export const ACTION_GROUPS = ['movement', 'combat', 'panels', 'system', 'engine'] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

export const GROUP_LABELS: Record<ActionGroup, string> = {
  movement: 'Movement',
  combat: 'Combat',
  panels: 'Panels',
  system: 'Game',
  engine: 'Rendering (debug)',
};

const defs = {
  moveUp: { label: 'Move up', group: 'movement' },
  moveDown: { label: 'Move down', group: 'movement' },
  moveLeft: { label: 'Move left', group: 'movement' },
  moveRight: { label: 'Move right', group: 'movement' },
  sprint: { label: 'Sprint', group: 'movement' },
  walk: { label: 'Walk', group: 'movement' },
  moveTo: { label: 'Move to pointer', group: 'movement' },
  jump: { label: 'Jump', group: 'movement' },
  attack: { label: 'Attack (hold to keep swinging)', group: 'combat' },
  dodge: { label: 'Dodge roll', group: 'combat' },
  skill1: { label: 'Skill 1', group: 'combat' },
  skill2: { label: 'Skill 2', group: 'combat' },
  skill3: { label: 'Skill 3', group: 'combat' },
  skill4: { label: 'Skill 4', group: 'combat' },
  skill5: { label: 'Skill 5', group: 'combat' },
  flask1: { label: 'Life flask', group: 'combat' },
  flask2: { label: 'Mana flask', group: 'combat' },
  interact: { label: 'Interact / pick up / talk', group: 'combat' },
  inventory: { label: 'Inventory', group: 'panels' },
  tree: { label: 'Passive tree', group: 'panels' },
  character: { label: 'Character & skills', group: 'panels' },
  townPortal: { label: 'Town portal', group: 'panels' },
  menu: { label: 'Pause menu', group: 'system' },
  pause: { label: 'Freeze frame (debug)', group: 'system' },
  step: { label: 'Step 1 frame (debug)', group: 'system' },
  reset: { label: 'Restart level (debug)', group: 'system' },
  help: { label: 'Show / hide help', group: 'system' },
  stats: { label: 'Show / hide stats', group: 'system' },
  togglePixel: { label: 'Pixel / 3D', group: 'engine' },
  toggleOutlines: { label: 'Outlines', group: 'engine' },
  toggleCreases: { label: 'Crease lines', group: 'engine' },
  cyclePalette: { label: 'Next palette', group: 'engine' },
  toggleSnap: { label: 'Snap movers', group: 'engine' },
  toggleSmoothScroll: { label: 'Smooth scroll', group: 'engine' },
  toggleStepped: { label: 'Stepped animation', group: 'engine' },
  toggleDir8: { label: '8-way facing', group: 'engine' },
  toggleSilhouettes: { label: 'Silhouettes', group: 'engine' },
  toggleColliders: { label: 'Collider overlay', group: 'engine' },
  toggleShadows: { label: 'Shadow maps', group: 'engine' },
  animFps6: { label: 'Animation 6 fps', group: 'engine' },
  animFps8: { label: 'Animation 8 fps', group: 'engine' },
  animFps12: { label: 'Animation 12 fps', group: 'engine' },
  animFps24: { label: 'Animation 24 fps', group: 'engine' },
} as const satisfies Record<string, { label: string; group: ActionGroup }>;

export type Action = keyof typeof defs;
export const ACTIONS = Object.keys(defs) as Action[];
export const ACTION_INFO: Record<Action, { label: string; group: ActionGroup }> = defs;

export const isAction = (a: string): a is Action => Object.prototype.hasOwnProperty.call(defs, a);

/** Actions that matter while held (read every frame); the rest fire once per press. */
export const HOLD_ACTIONS: ReadonlySet<Action> = new Set(['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'sprint', 'walk', 'attack', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5']);

export const SKILL_ACTIONS = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5'] as const;

/** A gamepad input: a button, or one direction of an axis. */
export type PadInput = { kind: 'button'; index: number } | { kind: 'axis'; index: number; dir: 1 | -1 };

export const MAX_BINDINGS = 4;
