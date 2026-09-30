/**
 * Persists settings profiles in localStorage (when available; private windows and some file://
 * contexts refuse it, then settings last for the session only) and keeps the active profile's
 * graphics overrides in sync with the live config table. Not used in ?agent mode: agents always
 * start from the documented defaults.
 */
import { config, configDefault, configListeners, setConfig } from '../config';
import {
  defaultSettings, GRAPHICS_KEYS, isGraphicsKey, newProfileId, normalizeProfile, normalizeSettings,
  profileFromTemplate, TEMPLATES, type Profile, type SettingsFile, type TemplateId,
} from './profile';

export const STORAGE_KEY = '3dpixel2d.settings.v1';

export type StoreEvent = 'select' | 'update' | 'list';

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = `${STORAGE_KEY}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export class SettingsStore {
  data: SettingsFile;
  readonly persistent: boolean;
  readonly listeners = new Set<(e: StoreEvent) => void>();
  private applying = false;
  private storage: Storage | null;

  constructor(store: Storage | null = storage()) {
    this.storage = store;
    this.persistent = !!store;
    let raw: unknown = null;
    try {
      const text = store?.getItem(STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    this.data = raw ? normalizeSettings(raw) : defaultSettings();
    configListeners.add((key) => {
      if (this.applying || !isGraphicsKey(key)) return;
      const g = this.active.graphics;
      if (config[key] === configDefault(key)) delete g[key];
      else g[key] = config[key];
      this.changed('update');
    });
  }

  get active(): Profile {
    return this.data.profiles.find((p) => p.id === this.data.active) ?? this.data.profiles[0];
  }

  get profiles(): readonly Profile[] {
    return this.data.profiles;
  }

  private save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Quota or privacy mode: keep working in memory.
    }
  }

  private changed(e: StoreEvent) {
    this.save();
    for (const fn of this.listeners) fn(e);
  }

  /** Runs config changes that must not be recorded into the profile (URL overrides). */
  transient(fn: () => void) {
    this.applying = true;
    try {
      fn();
    } finally {
      this.applying = false;
    }
  }

  /** Applies the active profile's graphics overrides on top of the defaults. */
  applyGraphics() {
    this.applying = true;
    try {
      const g = this.active.graphics;
      for (const k of GRAPHICS_KEYS) {
        const want = g[k] ?? configDefault(k);
        if (config[k] !== want) setConfig(k, want);
      }
    } finally {
      this.applying = false;
    }
  }

  select(id: string) {
    if (!this.data.profiles.some((p) => p.id === id) || id === this.data.active) return;
    this.data.active = id;
    this.applyGraphics();
    this.changed('select');
  }

  /** Mutate the active profile (bindings, layouts, prefs), then persist and notify. */
  update(fn: (p: Profile) => void) {
    fn(this.active);
    this.changed('update');
  }

  create(template: TemplateId, name?: string): Profile {
    const p = profileFromTemplate(template, name ?? this.uniqueName(TEMPLATES[template].label));
    this.data.profiles.push(p);
    this.changed('list');
    this.select(p.id);
    return p;
  }

  duplicate(id: string): Profile {
    const src = this.data.profiles.find((p) => p.id === id);
    if (!src) throw new Error(`no profile ${id}`);
    const p: Profile = { ...structuredClone(src), id: newProfileId(), name: this.uniqueName(`${src.name} copy`) };
    this.data.profiles.push(p);
    this.changed('list');
    this.select(p.id);
    return p;
  }

  rename(id: string, name: string) {
    const p = this.data.profiles.find((q) => q.id === id);
    const clean = name.trim().slice(0, 40);
    if (!p || !clean) return;
    p.name = clean;
    this.changed('list');
  }

  remove(id: string) {
    if (this.data.profiles.length <= 1) throw new Error('keep at least one profile');
    const i = this.data.profiles.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.data.profiles.splice(i, 1);
    if (this.data.active === id) {
      this.data.active = this.data.profiles[Math.max(0, i - 1)].id;
      this.applyGraphics();
    }
    this.changed('list');
  }

  /** Restores the active profile's template defaults (keeps its name and id). */
  resetActive(part: 'all' | 'keys' | 'pad' | 'touch' | 'graphics' = 'all') {
    const p = this.active;
    const fresh = profileFromTemplate(p.template, p.name, p.id);
    if (part === 'all' || part === 'keys') p.keys = fresh.keys;
    if (part === 'all' || part === 'pad') {
      p.pad = fresh.pad;
      p.padOptions = fresh.padOptions;
    }
    if (part === 'all' || part === 'touch') p.touch = fresh.touch;
    if (part === 'all') p.prefs = fresh.prefs;
    if (part === 'all' || part === 'graphics') {
      p.graphics = fresh.graphics;
      this.applyGraphics();
    }
    this.changed('update');
  }

  exportJson(id = this.data.active): string {
    const p = this.data.profiles.find((q) => q.id === id) ?? this.active;
    return JSON.stringify({ format: '3dpixel2d-profile', version: 1, profile: p }, null, 2);
  }

  /** Accepts an exported profile, a bare profile or a whole settings file. Returns the imported profiles. */
  importJson(text: string): Profile[] {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const list = Array.isArray(raw?.profiles) ? raw.profiles : [raw?.profile ?? raw];
    const imported = list.map((r) => {
      const p = normalizeProfile(r);
      p.id = newProfileId();
      p.name = this.uniqueName(p.name);
      return p;
    });
    if (!imported.length) throw new Error('no profile found in file');
    this.data.profiles.push(...imported);
    this.changed('list');
    this.select(imported[0].id);
    return imported;
  }

  private uniqueName(base: string): string {
    const names = new Set(this.data.profiles.map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }
}
