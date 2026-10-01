/** Control profiles, rebinding, input math and the settings store (no DOM). */
import { beforeEach, describe, expect, it } from 'vitest';
import { config, resetConfig, setConfig } from '../src/config';
import { ACTIONS, MAX_BINDINGS } from '../src/input/actions';
import {
  bindKey, bindPad, defaultSettings, normalizeProfile, normalizeSettings, profileFromTemplate, TEMPLATE_IDS, type Profile,
} from '../src/input/profile';
import { codeLabel, combine, digitalMove, length, padLabel, padValue, quantize8, stickMove } from '../src/input/resolve';
import { SettingsStore } from '../src/input/store';

beforeEach(() => resetConfig());

describe('default profiles', () => {
  it('ships one profile per template with the standard one active', () => {
    const s = defaultSettings();
    expect(s.profiles.map((p) => p.template)).toEqual(TEMPLATE_IDS);
    expect(s.active).toBe(s.profiles[0].id);
  });

  it.each(TEMPLATE_IDS)('%s: every action has a list and no key or button drives two actions', (t) => {
    const p = profileFromTemplate(t);
    for (const [kind, table] of [['keys', p.keys], ['pad', p.pad]] as const) {
      const seen = new Map<string, string>();
      for (const a of ACTIONS) {
        expect(Array.isArray(table[a])).toBe(true);
        for (const b of table[a] as unknown[]) {
          const k = JSON.stringify(b);
          expect(seen.get(k), `${kind} ${k} bound to ${seen.get(k)} and ${a}`).toBeUndefined();
          seen.set(k, a);
        }
      }
    }
  });

  it('keeps normalized defaults unchanged', () => {
    const p = profileFromTemplate('lefty', 'Lefty', 'id-1');
    expect(normalizeProfile(structuredClone(p))).toEqual(p);
  });
});

describe('normalizeProfile', () => {
  it('repairs garbage from storage or imports', () => {
    const p = normalizeProfile({
      id: 'bad id with spaces', name: '   ', template: 'nope',
      keys: { jump: ['KeyZ', 'KeyZ', 42, '<script>', 'KeyX', 'KeyC', 'KeyV', 'KeyB'], notAnAction: ['KeyQ'] },
      pad: { jump: [{ kind: 'button', index: 99 }, { kind: 'axis', index: 1, dir: -1 }, { kind: 'axis', index: 1, dir: -1 }] },
      padOptions: { deadzone: 5, stick: 'middle' },
      touch: { scale: 0, opacity: 'x', layouts: { portrait: { jump: { x: -3, y: 2, scale: 9, visible: 'yes' } } } },
      graphics: { 'render.outlines': false, 'render.targetLines': 99999, 'sim.gravity': 1, 'render.palette': 'pico8', 'render.shadows': true },
    });
    expect(p.template).toBe('standard');
    expect(p.name).toBe('Standard');
    expect(p.id).toMatch(/^[\w-]+$/);
    expect(p.keys.jump).toEqual(['KeyZ', 'KeyX', 'KeyC', 'KeyV']);
    expect(p.keys.jump.length).toBeLessThanOrEqual(MAX_BINDINGS);
    expect(p.keys).not.toHaveProperty('notAnAction');
    expect(p.pad.jump).toEqual([{ kind: 'axis', index: 1, dir: -1 }]);
    expect(p.padOptions).toMatchObject({ deadzone: 0.6, stick: 'left' });
    expect(p.touch.scale).toBe(0.6);
    expect(p.touch.opacity).toBe(0.85);
    expect(p.touch.layouts.portrait.jump).toEqual({ x: 0, y: 1, scale: 2, visible: false }); // invalid 'yes' falls back to the template (jump is hidden by default)
    // Out-of-range values and sim tuning are dropped; values equal to the default are not stored.
    expect(p.graphics).toEqual({ 'render.outlines': false, 'render.palette': 'pico8' });
  });

  it('falls back to defaults for an empty or duplicate-id settings file', () => {
    expect(normalizeSettings(null).profiles).toHaveLength(TEMPLATE_IDS.length);
    const a = profileFromTemplate('standard', 'A', 'same');
    const b = profileFromTemplate('standard', 'B', 'same');
    const s = normalizeSettings({ active: 'missing', profiles: [a, b] });
    expect(new Set(s.profiles.map((p) => p.id)).size).toBe(2);
    expect(s.active).toBe(s.profiles[0].id);
  });
});

describe('rebinding', () => {
  it('moves a key from its old action and caps bindings per action', () => {
    const p = profileFromTemplate('standard');
    expect(bindKey(p.keys, 'dodge', 'KeyW')).toEqual(['moveUp']);
    expect(p.keys.moveUp).toEqual(['ArrowUp']);
    expect(p.keys.dodge).toEqual(['Space', 'KeyW']);
    for (const c of ['KeyZ', 'KeyX', 'KeyQ']) bindKey(p.keys, 'dodge', c);
    expect(p.keys.dodge).toEqual(['KeyW', 'KeyZ', 'KeyX', 'KeyQ']);
    // Q and X were skill keys: they moved here.
    expect(p.keys.skill2).toEqual(['Digit2']);
    expect(() => bindKey(p.keys, 'dodge', 'bad code')).toThrow();
  });

  it('moves gamepad inputs the same way, telling axis directions apart', () => {
    const p = profileFromTemplate('standard');
    expect(bindPad(p.pad, 'attack', { kind: 'button', index: 0 })).toEqual(['interact']);
    expect(p.pad.interact).toEqual([]);
    bindPad(p.pad, 'walk', { kind: 'axis', index: 3, dir: 1 });
    expect(bindPad(p.pad, 'sprint', { kind: 'axis', index: 3, dir: -1 })).toEqual([]);
    expect(p.pad.walk).toContainEqual({ kind: 'axis', index: 3, dir: 1 });
  });
});

describe('input math', () => {
  it('applies a rescaled radial deadzone and flips the stick Y axis to screen up', () => {
    expect(stickMove(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const full = stickMove(0, -1, 0.2);
    expect(full.x).toBeCloseTo(0);
    expect(full.y).toBeCloseTo(1);
    expect(length(stickMove(0.6, 0, 0.2))).toBeCloseTo(0.5);
    expect(length(stickMove(0.3, 0, 0.2, false))).toBeCloseTo(1);
  });

  it('normalizes diagonals and never exceeds full speed when sources add up', () => {
    expect(length(digitalMove(true, false, false, true))).toBeCloseTo(1);
    expect(digitalMove(true, true, false, false)).toEqual({ x: 0, y: 0 });
    expect(length(combine([{ x: 1, y: 0 }, { x: 0, y: 1 }]))).toBeCloseTo(1);
    expect(combine([{ x: 0.3, y: 0 }])).toEqual({ x: 0.3, y: 0 });
  });

  it('snaps pad-style touch input to 8 directions', () => {
    expect(quantize8({ x: 0.9, y: 0.2 })).toEqual({ x: 1, y: 0 });
    const d = quantize8({ x: 0.5, y: 0.45 });
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('reads buttons and axis directions from a gamepad', () => {
    const pad = { buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0 }], axes: [0.8, -0.9] };
    expect(padValue(pad, { kind: 'button', index: 0 })).toBe(1);
    expect(padValue(pad, { kind: 'button', index: 1 })).toBe(0);
    expect(padValue(pad, { kind: 'button', index: 12 })).toBe(0);
    expect(padValue(pad, { kind: 'axis', index: 0, dir: 1 })).toBeCloseTo(0.8);
    expect(padValue(pad, { kind: 'axis', index: 1, dir: 1 })).toBe(0);
    expect(padValue(pad, { kind: 'axis', index: 1, dir: -1 })).toBeCloseTo(0.9);
  });

  it('labels keys and pad inputs for people', () => {
    expect(['KeyW', 'Digit3', 'ArrowUp', 'ShiftLeft', 'Mouse0', 'Numpad0', 'F3'].map((c) => codeLabel(c))).toEqual(['W', '3', '↑', 'L Shift', 'Left click', 'Num 0', 'F3']);
    expect(codeLabel('KeyQ', new Map([['KeyQ', 'a']]))).toBe('A');
    expect(padLabel({ kind: 'button', index: 0 })).toBe('A');
    expect(padLabel({ kind: 'axis', index: 1, dir: -1 })).toBe('Left stick ↑');
  });
});

describe('SettingsStore', () => {
  const make = () => new SettingsStore(null);

  it('switches profiles and applies their graphics overrides', () => {
    const s = make();
    s.applyGraphics();
    expect(config['render.pixelMode']).toBe(true);
    s.select('builtin-smooth3d');
    expect(config['render.pixelMode']).toBe(false);
    s.select('builtin-performance');
    expect(config['render.pixelMode']).toBe(true);
    expect(config['render.shadows']).toBe(false);
    expect(config['render.targetLines']).toBe(216);
  });

  it('records graphics changes into the active profile only', () => {
    const s = make();
    setConfig('render.outlines', false);
    expect(s.active.graphics['render.outlines']).toBe(false);
    setConfig('render.outlines', true);
    expect(s.active.graphics).not.toHaveProperty('render.outlines');
    setConfig('sim.gravity', 30);
    expect(s.active.graphics).not.toHaveProperty('sim.gravity');
    s.transient(() => setConfig('render.pixelMode', false));
    expect(s.active.graphics).not.toHaveProperty('render.pixelMode');
  });

  it('creates, duplicates, renames and removes profiles', () => {
    const s = make();
    const n = s.profiles.length;
    const p = s.create('lefty');
    expect(s.active.id).toBe(p.id);
    expect(p.name).toBe('Left-handed 2');
    const d = s.duplicate(p.id);
    expect(d.name).toBe('Left-handed 2 copy');
    expect(d.keys).toEqual(p.keys);
    s.rename(d.id, '  Mine  ');
    expect(d.name).toBe('Mine');
    s.remove(d.id);
    s.remove(p.id);
    expect(s.profiles).toHaveLength(n);
    for (const q of [...s.profiles].slice(1)) s.remove(q.id);
    expect(() => s.remove(s.profiles[0].id)).toThrow();
  });

  it('round-trips a profile through export and import', () => {
    const s = make();
    s.update((p: Profile) => {
      bindKey(p.keys, 'jump', 'KeyU');
      p.touch.layouts.landscape.jump.x = 0.5;
    });
    const imported = s.importJson(s.exportJson());
    expect(imported).toHaveLength(1);
    expect(s.active.id).toBe(imported[0].id);
    expect(s.active.keys.jump).toContain('KeyU');
    expect(s.active.touch.layouts.landscape.jump.x).toBe(0.5);
    expect(() => s.importJson('not json')).toThrow();
  });

  it('resets one part of a profile to its template', () => {
    const s = make();
    s.update((p) => {
      bindKey(p.keys, 'jump', 'KeyU');
      p.touch.scale = 1.4;
    });
    s.resetActive('keys');
    expect(s.active.keys.jump).toEqual(['KeyG']);
    expect(s.active.keys.dodge).toEqual(['Space']);
    expect(s.active.touch.scale).toBe(1.4);
  });
});
