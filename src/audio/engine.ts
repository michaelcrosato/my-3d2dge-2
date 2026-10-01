/**
 * Procedural audio: plays the synthesized sounds of content/sounds.ts with WebAudio. Game events
 * become cues (soundFor), placed relative to the hero (quieter with distance, panned along the
 * screen's horizontal axis), with per-sound voice limits so a whirlwind through a pack stays
 * crisp. Each dungeon theme has a quiet drone that crossfades on level changes. The context starts
 * on the first user gesture (browser autoplay rules); nothing runs in ?agent mode.
 */
import { config, configListeners } from '../config';
import { composeBar, MOODS, THEME_MOOD, type Mood } from '../content/music';
import { SOUNDS, soundFor, THEME_AMBIENCE, type SoundCue, type SoundDef } from '../content/sounds';
import { hashSeed } from '../sim/rng';
import type { Game, GameEvent } from '../game';
import type { SimEvent } from '../sim/sim';

let noiseCache: WeakMap<BaseAudioContext, AudioBuffer> = new WeakMap();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  // Deterministic white noise (xorshift), identical in every context.
  let s = 0x9e3779b9;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  noiseCache.set(ctx, b);
  return b;
}

/** Schedules one sound into `out` at `when`; returns when it ends. Works on Offline contexts too. */
export function scheduleSound(ctx: BaseAudioContext, out: AudioNode, def: SoundDef, when: number, pitch = 1, gain = 1): number {
  let end = when;
  for (const l of def.layers) {
    const t0 = when + (l.delay ?? 0);
    const t1 = t0 + l.dur;
    end = Math.max(end, t1);
    const env = ctx.createGain();
    const peak = Math.max(0.0002, l.gain * gain * (def.gain ?? 1));
    const attack = Math.min(l.attack ?? 0.004, l.dur * 0.5);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    let src: AudioScheduledSourceNode;
    if (l.wave === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      n.loop = true;
      n.playbackRate.value = pitch;
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = l.wave;
      o.frequency.setValueAtTime(Math.max(1, l.f0 * pitch), t0);
      if (l.f1 !== undefined && l.f1 !== l.f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, l.f1 * pitch), t1);
      src = o;
    }
    let head: AudioNode = src;
    if (l.filter) {
      const f = ctx.createBiquadFilter();
      f.type = l.filter.type;
      f.Q.value = l.filter.q ?? 0.8;
      f.frequency.setValueAtTime(l.filter.f0 * pitch, t0);
      if (l.filter.f1 !== undefined && l.filter.f1 !== l.filter.f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, l.filter.f1 * pitch), t1);
      src.connect(f);
      head = f;
    }
    head.connect(env);
    env.connect(out);
    src.start(t0);
    src.stop(t1 + 0.02);
  }
  return end;
}

/** Schedules one bar of a mood's generated score. */
export function scheduleMoodBar(ctx: BaseAudioContext, out: AudioNode, mood: Mood, seed: number, bar: number, start: number, barLen = 240 / mood.bpm) {
  const stepLen = barLen / 16;
  for (const n of composeBar(mood, seed, bar)) {
    const voice = n.voice === 'pulse' ? mood.pulse! : mood[n.voice];
    const dur = n.voice === 'pad' ? barLen * 0.98 : Math.min(voice.length, n.voice === 'bass' && mood.bass.pattern.length > 2 ? stepLen * 1.8 : voice.length);
    const def: SoundDef = { layers: [{ wave: voice.wave, f0: n.freq, f1: n.freq, dur, attack: voice.attack, gain: voice.gain, filter: { type: 'lowpass', f0: voice.cutoff, q: 0.6 } }] };
    scheduleSound(ctx, out, def, start + n.step * stepLen);
  }
}

/** Renders `bars` bars of a mood offline (agents look at the score as a spectrogram). */
export async function renderMood(id: string, bars = 4, seed = 1, sampleRate = 22050): Promise<Float32Array> {
  const mood = MOODS[id];
  if (!mood) throw new Error(`unknown mood "${id}". Moods: ${Object.keys(MOODS).join(', ')}`);
  const barLen = 240 / mood.bpm;
  const ctx = new OfflineAudioContext(1, Math.ceil((bars * barLen + 1) * sampleRate), sampleRate);
  for (let b = 0; b < bars; b++) scheduleMoodBar(ctx, ctx.destination, mood, seed, b, b * barLen, barLen);
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

/** Renders a sound to PCM offline (agents inspect sounds as waveforms and spectrograms). */
export async function renderSound(id: string, sampleRate = 22050): Promise<Float32Array> {
  const def = SOUNDS[id];
  if (!def) throw new Error(`unknown sound "${id}"`);
  const dur = Math.max(...def.layers.map((l) => (l.delay ?? 0) + l.dur)) + 0.05;
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);
  scheduleSound(ctx, ctx.destination, def, 0);
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

interface Ambience {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private voices = new Map<string, number[]>();
  private last = new Map<string, number>();
  private ambience: Ambience | null = null;
  private ambienceTheme = '';
  private wantTheme = '';
  private music!: GainNode;
  private mood = '';
  private moodGain: GainNode | null = null;
  private moodSeed = 1;
  private bar = 0;
  private nextBar = 0;

  constructor(private game: Game) {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, unlock, { passive: true });
    configListeners.add((key) => key.startsWith('audio.') && this.applyVolume());
    game.listeners.add((e) => this.onEvent(e));
    setInterval(() => this.tickMusic(), 120);
  }

  /** Creates or resumes the context (must run inside a user gesture the first time). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.amb = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.amb.connect(this.master);
      this.music.connect(this.master);
      // A gentle limiter keeps big fights from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.applyVolume();
      if (this.wantTheme) this.setAmbience(this.wantTheme);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = config['audio.mute'] ? 0 : 1;
    this.master.gain.setTargetAtTime(on * config['audio.master'], t, 0.03);
    this.sfx.gain.setTargetAtTime(config['audio.sfx'], t, 0.03);
    this.amb.gain.setTargetAtTime(config['audio.ambience'], t, 0.2);
    this.music.gain.setTargetAtTime(config['audio.music'], t, 0.2);
  }

  // ---------------------------------------------------------------- music

  /** The mood the game is in right now: town, the level's theme, or a boss fight. */
  private wantedMood(): string {
    const g = this.game;
    if (g.mode === 'town' || g.mode === 'title') return 'town';
    if (g.mode !== 'dungeon' || !g.sim) return '';
    const hero = g.sim.player;
    if (hero) for (const c of g.sim.characters.values()) {
      if (c.monster?.boss && c.state !== 'dead' && c.ai.awake && Math.hypot(c.pos.x - hero.pos.x, c.pos.z - hero.pos.z) < 18) return 'boss';
    }
    return THEME_MOOD[g.level.theme ?? ''] ?? 'dungeon';
  }

  private tickMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const want = this.wantedMood();
    if (want !== this.mood) this.switchMood(want);
    const mood = MOODS[this.mood];
    if (!mood || !this.moodGain) return;
    const barLen = 240 / mood.bpm;
    while (this.nextBar < ctx.currentTime + 0.8) {
      this.scheduleBar(mood, this.nextBar, barLen);
      this.nextBar += barLen;
      this.bar++;
    }
  }

  private switchMood(id: string) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const old = this.moodGain;
    if (old) {
      old.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => old.disconnect(), 4000);
    }
    this.mood = id;
    this.moodGain = null;
    if (!MOODS[id]) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(1, t, id === 'boss' ? 0.3 : 1.2);
    g.connect(this.music);
    this.moodGain = g;
    this.moodSeed = hashSeed('music', id, this.game.level.theme ?? '', this.game.stageNo);
    this.bar = 0;
    this.nextBar = t + 0.1;
  }

  private scheduleBar(mood: Mood, start: number, barLen: number) {
    scheduleMoodBar(this.ctx!, this.moodGain!, mood, this.moodSeed, this.bar, start, barLen);
  }

  play(cue: SoundCue) {
    const ctx = this.ctx;
    const def = SOUNDS[cue.id];
    if (!ctx || ctx.state !== 'running' || !def) return;
    const now = ctx.currentTime;
    if (def.gap && now - (this.last.get(cue.id) ?? -1) < def.gap) return;
    const live = (this.voices.get(cue.id) ?? []).filter((e) => e > now);
    if (live.length >= (def.max ?? 4)) return;
    let gain = cue.gain ?? 1, pan = 0;
    const hero = this.game.sim?.player;
    if (cue.x !== undefined && cue.z !== undefined && hero) {
      const dx = cue.x - hero.pos.x, dz = cue.z - hero.pos.z;
      const d = Math.hypot(dx, dz);
      gain *= Math.pow(Math.min(1, Math.max(0, 1 - (d - 5) / 20)), 1.5);
      if (gain < 0.02) return;
      const r = this.game.stage.basis.right;
      pan = Math.max(-0.8, Math.min(0.8, (dx * r.x + dz * r.z) / 12));
    }
    const vary = def.vary ?? 0;
    const pitch = (cue.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx);
    const end = scheduleSound(ctx, p, def, now + 0.005, pitch, gain);
    live.push(end);
    this.voices.set(cue.id, live);
    this.last.set(cue.id, now);
    setTimeout(() => p.disconnect(), (end - now + 0.2) * 1000);
  }

  /** Crossfades to a theme's drone ('' = silence). */
  setAmbience(theme: string) {
    this.wantTheme = theme;
    const ctx = this.ctx;
    if (!ctx || theme === this.ambienceTheme) return;
    this.ambienceTheme = theme;
    const t = ctx.currentTime;
    const old = this.ambience;
    if (old) {
      old.gain.gain.setTargetAtTime(0, t, 0.5);
      setTimeout(() => old.nodes.forEach((n) => n.stop()), 3000);
    }
    this.ambience = null;
    const a = THEME_AMBIENCE[theme];
    if (!a) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(1, t, 1.2);
    g.connect(this.amb);
    const nodes: AudioScheduledSourceNode[] = [];
    const droneGain = ctx.createGain();
    droneGain.gain.value = a.droneGain;
    droneGain.connect(g);
    a.drone.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = a.wave;
      o.frequency.value = f;
      o.detune.value = (i % 2 ? 1 : -1) * 6;
      o.connect(droneGain);
      nodes.push(o);
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = a.lfo;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = a.droneGain * 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(droneGain.gain);
    nodes.push(lfo);
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = a.noise.type;
    f.frequency.value = a.noise.f;
    f.Q.value = a.noise.q;
    const ng = ctx.createGain();
    ng.gain.value = a.noise.gain;
    n.connect(f);
    f.connect(ng);
    ng.connect(g);
    nodes.push(n);
    nodes.forEach((x) => x.start());
    this.ambience = { gain: g, nodes };
  }

  private onEvent(e: GameEvent | SimEvent) {
    if (e.type === 'mode') {
      const level = this.game.level;
      this.setAmbience(e.mode === 'town' ? 'town' : e.mode === 'dungeon' ? level.theme ?? 'crypt' : '');
    }
    if (!this.ctx) return;
    const sim = this.game.sim;
    const hero = sim?.heroId ?? 'player';
    const cue = soundFor(e as { type: string; [k: string]: unknown }, hero, (id) => id === hero || sim?.characters.get(id)?.owner === hero);
    if (cue) this.play(cue);
  }
}

/** Resets cached noise (tests / context churn). */
export function resetAudioCaches() {
  noiseCache = new WeakMap();
}
