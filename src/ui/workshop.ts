/**
 * The Workshop: a Spore-style creature editor. Pick a body plan, reshape it (proportions, legs,
 * arms, head, horns, tail, spikes, plates, wings, tentacles), colour it with a palette, give it a
 * behaviour archetype and attack modules, and watch a live pixel-art preview built by the same
 * rig and pixel pipeline as the game. Stats come from the parts under a threat budget
 * (content/bestiary.ts). Designs go into the bestiary, can be test-fought in the Proving Grounds
 * and released into the depths, where they join the encounter pools.
 */
import { config } from '../config';
import { ARCHETYPES, PALETTES } from '../content/monsters';
import { DESIGN_ARCHETYPES, DESIGN_BODIES, DESIGN_SKILLS, designProblems, designStats, randomDesign, registerDesign, setReleased, THREAT_BUDGET, type SpeciesDesign } from '../content/bestiary';
import { generateGenome, planOf, speciesName, type CreatureGenome, type GenomeEdits, type HeadShape, type TailTip } from '../content/procgen/creature';
import { SKILLS } from '../content/skills';
import type { Game } from '../game';
import { CreatureStudio, type PreviewPose } from '../render/creature/studio';
import { fromShareCode, shareCode, type SaveStore } from '../save';
import { h } from './dom';

export interface WorkshopHooks {
  toast(text: string, color?: string): void;
  /** Starts a fight against the design in the Proving Grounds (only with a hero). */
  testFight(d: SpeciesDesign): void;
  closed(): void;
}

const POSES: Array<[PreviewPose, string]> = [['idle', 'Idle'], ['walk', 'Walk'], ['bite', 'Bite'], ['claw', 'Claw'], ['slam', 'Slam'], ['roar', 'Roar'], ['dead', 'Fall']];
const HEADS: HeadShape[] = ['snout', 'skull', 'beak', 'maw', 'eye', 'mandible'];
const TIPS: TailTip[] = ['none', 'club', 'stinger', 'spikes', 'fin'];
const PATTERNS: CreatureGenome['pattern'][] = ['plain', 'stripes', 'spots', 'belly'];
const ARCH_HINT: Record<string, string> = {
  brute: 'slow, tough, hits hard', skirmisher: 'hit and run, circles you', swarmer: 'big packs, weak alone', archer: 'keeps its distance',
  caster: 'casts from range', charger: 'telegraphed charges', bomber: 'runs in and explodes', summoner: 'calls minions, stays back',
  guardian: 'holds ground, protects', stalker: 'fast ambusher',
};

let installed = false;
function installStyles() {
  if (installed) return;
  installed = true;
  const css = `
.gp.workshop .sheet { width: min(1100px, 100%); height: min(780px, 100%); }
.workshop .body { align-items: flex-start; }
.workshop .preview { flex: 1 1 260px; max-width: 420px; position: sticky; top: 0; }
.workshop .controls { flex: 2 1 340px; }
.workshop canvas.pv { width: min(100%, 320px); aspect-ratio: 1; image-rendering: pixelated; display: block; margin: 0 auto; background: radial-gradient(circle at 50% 60%, #2c2838, #12101a 70%); border: 1px solid var(--gp-line); }
.workshop .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
.workshop .chip { min-height: 32px; padding: 4px 9px; font: 700 12px system-ui; color: var(--gp-text); background: var(--gp-raised); border: 1px solid var(--gp-line); border-radius: 4px; cursor: pointer; }
.workshop .chip[aria-pressed="true"] { background: #4a3a14; border-color: #ffcf5a; color: #ffe9b8; }
.workshop .chip.sw { width: 34px; padding: 0; }
.workshop .chip.sw[aria-pressed="true"] { outline: 2px solid #ffcf5a; outline-offset: 1px; }
.workshop label.sl { display: grid; grid-template-columns: 7.5em 1fr 3.2em; align-items: center; gap: 6px; font-size: 12px; color: var(--gp-dim); min-height: 30px; }
.workshop label.sl input { width: 100%; accent-color: #ffcf5a; }
.workshop label.sl output { color: var(--gp-text); font: 12px ui-monospace, monospace; text-align: right; }
.workshop details { border-top: 1px solid var(--gp-line); padding: 4px 0; }
.workshop summary { cursor: pointer; font: 800 12px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #ffcf5a; min-height: 32px; display: flex; align-items: center; }
.workshop .bars { display: grid; grid-template-columns: 4.5em 1fr 3em; gap: 4px 8px; align-items: center; font: 12px ui-monospace, monospace; margin: 8px 0; }
.workshop .bars i { display: block; height: 8px; background: #0b0a10; border: 1px solid var(--gp-line); }
.workshop .bars i b { display: block; height: 100%; }
.workshop .name { display: flex; gap: 6px; margin: 8px 0 4px; }
.workshop .name input { flex: 1; min-width: 0; min-height: 34px; background: #0b0a10; color: var(--gp-text); border: 1px solid var(--gp-line); padding: 4px 8px; font: 700 14px system-ui; }
.workshop .best { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid #ffffff10; flex-wrap: wrap; }
.workshop .best b { flex: 1 1 120px; }
.workshop select { min-height: 32px; background: var(--gp-raised); color: var(--gp-text); border: 1px solid var(--gp-line); }
@media (max-width: 720px) {
  .workshop .preview { position: static; max-width: none; }
  .workshop canvas.pv { width: min(62vw, 240px); }
}
@media (max-height: 520px) and (min-width: 600px) {
  .workshop canvas.pv { width: min(42vh, 220px); }
}
`;
  document.head.append(h('style', {}, css));
}

export class Workshop {
  readonly el: HTMLElement;
  private sheet: HTMLElement;
  private header = h('header');
  private body = h('div', { class: 'body' });
  private canvas = h('canvas', { class: 'pv', width: 128, height: 128, 'aria-label': 'Creature preview' }) as HTMLCanvasElement;
  private statsBox = h('div');
  private design: SpeciesDesign = randomDesign(1);
  private studio: CreatureStudio | null = null;
  private pose: PreviewPose = 'walk';
  private spin = true;
  private yaw = 0.8;
  private raf = 0;
  private last = 0;
  private t = 0;
  private wasPaused = false;
  private rollSeed = Date.now() % 100000;

  constructor(private game: Game, private saves: SaveStore, private hooks: WorkshopHooks) {
    installStyles();
    this.sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Creature Workshop' }, this.header, this.body);
    this.el = h('div', { class: 'gp workshop', hidden: true }, this.sheet);
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && this.close());
    this.sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    document.body.append(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  show(d?: SpeciesDesign) {
    if (d) this.design = structuredClone(d);
    if (!this.open) {
      this.wasPaused = this.game.paused;
      this.game.paused = true;
    }
    this.el.hidden = false;
    this.render();
    this.body.scrollTop = 0;
    this.loop(performance.now());
    (this.sheet.querySelector<HTMLElement>('button') ?? this.sheet).focus({ preventScroll: true });
  }

  close() {
    if (!this.open) return;
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    this.game.paused = this.wasPaused;
    this.game.needsRender = true;
    this.hooks.closed();
  }

  // ---------------------------------------------------------------- preview

  private loop = (now: number) => {
    if (!this.open) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    // Sprite cadence: 12 poses a second, like the game.
    if (Math.floor(this.t * 12) === Math.floor((this.t - dt) * 12) && this.t > dt) return;
    if (this.spin) this.yaw += dt * 0.6;
    this.draw();
  };

  /** Studio sized to the creature: small ones fill the frame, long ones still fit. */
  private studioFor(d: SpeciesDesign): CreatureStudio {
    const g = this.genome();
    const extent = (Math.max(g.length + g.tail.length * 0.8 + g.neck.length + g.head.length, g.height * 1.8 + g.float, g.wings ? g.wings.span * 1.1 : 0) + 0.5) * d.size;
    const cell = Math.min(224, Math.max(80, Math.ceil((extent * config['render.pixelsPerMeter']) / 16) * 16));
    if (!this.studio || this.studio.size !== cell) {
      this.studio?.dispose();
      this.studio = new CreatureStudio(this.game.renderer, this.game.pipeline, this.game.stage.basis, cell);
      this.canvas.width = this.canvas.height = cell;
    }
    return this.studio;
  }

  private draw() {
    if (!this.open) return;
    const d = this.design;
    try {
      const s = this.studioFor(d);
      s.setSubject({ plan: d.body, seed: d.seed, palette: d.palette, genome: d.genome, scale: d.size });
      const dur = this.pose === 'walk' || this.pose === 'idle' ? 1.2 : 0.9;
      const u = (this.t % dur) / dur;
      // Turn in 8 steps like the in-game facing.
      const yaw = Math.round(this.yaw / (Math.PI / 4)) * (Math.PI / 4) + Math.PI * 0.75;
      const img = s.render(this.pose, this.pose === 'dead' ? Math.min(1, u * 1.5) : u, yaw);
      const g = this.canvas.getContext('2d')!;
      g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    } catch (e) {
      console.warn('workshop preview', e);
    }
  }

  // ---------------------------------------------------------------- editing

  private genome(): CreatureGenome {
    return generateGenome(this.design.body, this.design.seed, this.design.genome);
  }

  /** Sets one genome field (group.field or a top-level field). */
  private edit(path: string, v: unknown) {
    const g = { ...(this.design.genome ?? {}) } as Record<string, unknown>;
    const [a, b] = path.split('.');
    if (b) g[a] = { ...((g[a] as Record<string, unknown>) ?? {}), [b]: v };
    else g[a] = v;
    this.design.genome = g as GenomeEdits;
    this.refreshStats();
  }

  private set<K extends keyof SpeciesDesign>(k: K, v: SpeciesDesign[K], rerender = true) {
    this.design[k] = v;
    if (rerender) this.render();
    else this.refreshStats();
  }

  private refreshStats() {
    const st = designStats(this.design);
    const bar = (label: string, v: number, max: number, color: string) => [h('span', {}, label), h('i', {}, h('b', { style: { width: `${Math.min(100, (v / max) * 100)}%`, background: color } })), h('span', {}, v.toFixed(2))];
    const arch = ARCHETYPES[this.design.archetype];
    this.statsBox.replaceChildren(
      h('div', { class: 'bars' },
        ...bar('Life', st.life, 2.4, 'var(--gp-life)'), ...bar('Damage', st.damage, 1.9, '#ff9a3d'), ...bar('Speed', st.speed, 7.5, '#5ad06a'), ...bar('Threat', st.threat, THREAT_BUDGET, '#b388ff')),
      h('p', { class: 'note' }, `${arch?.label ?? this.design.archetype}: ${ARCH_HINT[this.design.archetype] ?? ''}. Attacks: ${this.design.skills.map((k) => SKILLS[k]?.name ?? k).join(', ') || 'none'}.`),
      ...st.notes.map((n) => h('p', { class: 'note' }, n)),
    );
  }

  private slider(label: string, value: number, min: number, max: number, step: number, onInput: (v: number) => void) {
    const out = h('output', {}, String(Math.round(value * 100) / 100));
    const input = h('input', {
      type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label,
      oninput: () => {
        const v = Number(input.value);
        out.textContent = String(Math.round(v * 100) / 100);
        onInput(v);
      },
    });
    return h('label', { class: 'sl' }, label, input, out);
  }

  private chip(label: string, on: boolean, fn: () => void, extra: Record<string, unknown> = {}) {
    return h('button', { class: 'chip', 'aria-pressed': String(on), onclick: fn, ...extra }, label);
  }

  private toggle(label: string, on: boolean, fn: (on: boolean) => void) {
    return this.chip(`${on ? '☑' : '☐'} ${label}`, on, () => {
      fn(!on);
      this.render();
    });
  }

  // ---------------------------------------------------------------- layout

  render() {
    const d = this.design;
    const g = this.genome();
    const plan = planOf(d.body);
    this.header.replaceChildren(
      h('h2', {}, 'Creature Workshop'),
      h('span', { class: 'wallet' }, `${this.saves.file.bestiary.length} in bestiary`),
      h('button', { class: 'ui-btn small', 'aria-label': 'Close', onclick: () => this.close() }, '✕'),
      h('p', { class: 'quote' }, '“Every beast in the depths began as an idea. Bring me yours.” Shape a species, test it, then release it below.'),
    );
    const nameInput = h('input', { value: d.name, maxlength: '32', 'aria-label': 'Species name', oninput: () => (this.design.name = nameInput.value.slice(0, 32)) }) as HTMLInputElement;
    const preview = h('section', { class: 'preview' },
      this.canvas,
      h('div', { class: 'chips', style: { justifyContent: 'center' } },
        ...POSES.map(([p, label]) => this.chip(label, this.pose === p, () => {
          this.pose = p;
          this.render();
        })),
        this.chip('⟲', false, () => (this.yaw -= Math.PI / 4), { 'aria-label': 'Turn left' }),
        this.chip('⟳', false, () => (this.yaw += Math.PI / 4), { 'aria-label': 'Turn right' }),
        this.chip(this.spin ? 'Spin ☑' : 'Spin ☐', this.spin, () => {
          this.spin = !this.spin;
          this.render();
        }),
      ),
      h('div', { class: 'name' }, nameInput, h('button', { class: 'ui-btn small', title: 'New name', onclick: () => this.set('name', speciesName(plan, (this.rollSeed = this.rollSeed * 16807 % 2147483647))) }, '🎲')),
      this.statsBox,
      h('div', { class: 'actions' },
        h('button', { class: 'ui-btn primary', onclick: () => this.save() }, 'Save to bestiary'),
        h('button', { class: 'ui-btn', onclick: () => this.randomize() }, 'Randomize'),
        h('button', { class: 'ui-btn', onclick: () => this.set('genome', undefined) }, 'Reset shape'),
        h('button', { class: 'ui-btn', title: 'Copy a line of text that recreates this species: paste it to a friend', onclick: () => void this.share() }, 'Copy share code'),
        h('button', { class: 'ui-btn', title: 'Paste a species someone shared', onclick: () => this.importCode() }, 'Import share code…'),
        this.game.hero && this.game.mode !== 'title' ? h('button', { class: 'ui-btn', onclick: () => this.fight() }, 'Test fight') : null,
      ),
    );
    const sl = (label: string, path: string, v: number, min: number, max: number, step = 0.01) => this.slider(label, v, min, max, step, (x) => this.edit(path, x));
    const group = (title: string, open: boolean, ...kids: Array<Node | null>) => h('details', open ? { open: true } : {}, h('summary', {}, title), ...kids.filter((x): x is Node => !!x));
    const controls = h('section', { class: 'controls' },
      group('Body', true,
        h('div', { class: 'chips' }, ...DESIGN_BODIES.map((b) => this.chip(b, d.body === b, () => {
          this.design.body = b;
          this.design.genome = undefined;
          this.render();
        }))),
        h('div', { class: 'chips' },
          this.chip('◀', false, () => this.set('seed', Math.max(1, d.seed - 1)), { 'aria-label': 'Previous seed' }),
          h('span', { class: 'note', style: { alignSelf: 'center' } }, `Seed ${d.seed}`),
          this.chip('▶', false, () => this.set('seed', d.seed + 1), { 'aria-label': 'Next seed' }),
          this.chip('🎲 seed', false, () => this.set('seed', 1 + ((this.rollSeed = this.rollSeed * 48271 % 2147483647) % 99999))),
        ),
        this.slider('Size', d.size, 0.6, 1.8, 0.05, (v) => this.set('size', v, false)),
        sl('Length', 'length', g.length, 0.3, 3),
        sl('Height', 'height', g.height, 0.1, 2.2),
        sl('Girth', 'girth', g.girth, 0.06, 0.9),
        sl('Taper', 'taper', g.taper, 0.4, 2.5),
        sl('Hump', 'hump', g.hump, 0, 0.6),
      ),
      group('Legs & arms', false,
        sl('Leg pairs', 'legs.pairs', g.legs.pairs, 0, 6, 1),
        sl('Leg length', 'legs.length', g.legs.length, 0.1, 1.6),
        sl('Leg thickness', 'legs.thickness', g.legs.thickness, 0.02, 0.25),
        h('div', { class: 'chips' },
          this.toggle('Arms', !!g.arms, (on) => this.edit('arms', on ? { length: 0.5, thickness: 0.08, pincer: false } : null)),
          g.arms ? this.toggle('Pincers', !!g.arms.pincer, (on) => this.edit('arms.pincer', on)) : null,
        ),
        g.arms ? sl('Arm length', 'arms.length', g.arms.length, 0.1, 1.4) : null,
      ),
      group('Head', false,
        h('div', { class: 'chips' }, ...HEADS.map((x) => this.chip(x, g.head.shape === x, () => {
          this.edit('head.shape', x);
          this.render();
        }))),
        sl('Head size', 'head.size', g.head.size, 0.06, 0.7),
        sl('Eyes', 'head.eyes', g.head.eyes, 0, 8, 1),
        sl('Neck', 'neck.length', g.neck.length, 0, 1.2),
        sl('Horns', 'horns.count', g.horns.count, 0, 6, 1),
        sl('Horn length', 'horns.length', g.horns.length, 0.05, 1),
        h('div', { class: 'chips' }, this.toggle('Jaw', g.head.jaw, (on) => this.edit('head.jaw', on))),
      ),
      group('Tail & armour', false,
        sl('Tail segments', 'tail.segments', g.tail.segments, 0, 12, 1),
        sl('Tail length', 'tail.length', g.tail.length, 0, 2.6),
        h('div', { class: 'chips' }, ...TIPS.map((x) => this.chip(`tip: ${x}`, g.tail.tip === x, () => {
          this.edit('tail.tip', x);
          this.render();
        }))),
        sl('Spikes', 'spikes.count', g.spikes.count, 0, 16, 1),
        sl('Spike size', 'spikes.size', g.spikes.size, 0.03, 0.45),
        h('div', { class: 'chips' },
          this.toggle('Plates', g.plates, (on) => this.edit('plates', on)),
          this.toggle('Wings', !!g.wings, (on) => this.edit('wings', on ? { span: 1.6 } : null)),
          this.toggle('Tentacles', !!g.tentacles, (on) => this.edit('tentacles', on ? { count: 4, length: 0.8 } : null)),
        ),
        g.wings ? sl('Wing span', 'wings.span', g.wings.span, 0.4, 3.6) : null,
        g.tentacles ? sl('Tentacles', 'tentacles.count', g.tentacles.count, 1, 12, 1) : null,
      ),
      group('Colour', true,
        h('div', { class: 'chips' }, ...Object.values(PALETTES).map((p) => this.chip('', d.palette === p.id, () => this.set('palette', p.id), {
          class: 'chip sw', title: `${p.name}${p.element ? ` (${p.element})` : ''}`, 'aria-label': p.name, style: { background: `linear-gradient(135deg, ${p.primary} 0 50%, ${p.glow} 50% 100%)` },
        }))),
        h('div', { class: 'chips' }, ...PATTERNS.map((x) => this.chip(x, g.pattern === x, () => {
          this.edit('pattern', x);
          this.render();
        }))),
      ),
      group('Behaviour & attacks', true,
        h('div', { class: 'chips' }, ...DESIGN_ARCHETYPES.map((a) => this.chip(ARCHETYPES[a].label, d.archetype === a, () => this.set('archetype', a), { title: ARCH_HINT[a] ?? '' }))),
        h('p', { class: 'note' }, 'Attacks (up to three):'),
        h('div', { class: 'chips' }, ...DESIGN_SKILLS.map((k) => this.chip(SKILLS[k].name, d.skills.includes(k), () => {
          const on = d.skills.includes(k);
          if (!on && d.skills.length >= 3) return this.hooks.toast('Three attacks at most', '#ff9a9a');
          this.set('skills', on ? d.skills.filter((x) => x !== k) : [...d.skills, k]);
        }, { title: SKILLS[k].desc }))),
      ),
      group(`Bestiary (${this.saves.file.bestiary.length})`, this.saves.file.bestiary.length > 0,
        ...(this.saves.file.bestiary.length ? this.saves.file.bestiary.map((b) => h('div', { class: 'best' },
          h('b', {}, b.name), h('small', { class: 'note' }, `${b.body} · threat ${designStats(b).threat}`),
          h('button', { class: 'ui-btn small', onclick: () => this.show(b) }, 'Edit'),
          h('button', { class: `ui-btn small${b.released ? ' primary' : ''}`, title: 'Released species join the encounter pools of the depths', onclick: () => this.release(b) }, b.released ? 'Released' : 'Release'),
          h('button', { class: 'ui-btn small danger', onclick: () => this.remove(b) }, 'Delete'),
        )) : [h('p', { class: 'note' }, 'Saved species appear here. Release one and it starts appearing in the depths.')]),
      ),
    );
    this.body.replaceChildren(preview, controls);
    this.refreshStats();
    this.draw();
  }

  // ---------------------------------------------------------------- actions

  private randomize() {
    this.rollSeed = (this.rollSeed * 16807) % 2147483647;
    const keepId = this.saves.file.bestiary.some((b) => b.id === this.design.id) ? null : this.design.id;
    this.design = randomDesign(this.rollSeed);
    if (keepId) this.design.id = keepId;
    this.render();
  }

  private uniqueId(): string {
    const base = this.design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'species';
    const taken = new Set(this.saves.file.bestiary.filter((b) => b.id !== this.design.id).map((b) => b.id));
    let id = base, n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    return id;
  }

  private save(): boolean {
    const existing = this.saves.file.bestiary.find((b) => b.id === this.design.id);
    if (!existing) this.design.id = this.uniqueId();
    const problems = designProblems(this.design);
    if (problems.length) {
      this.hooks.toast(problems[0], '#ff8a8a');
      return false;
    }
    const err = this.saves.saveDesign(this.design);
    if (err) {
      this.hooks.toast(err, '#ff8a8a');
      return false;
    }
    registerDesign(this.design);
    setReleased(this.saves.file.bestiary);
    this.hooks.toast(`${this.design.name} saved to the bestiary`, '#ffe9b8');
    this.render();
    return true;
  }

  private async share() {
    const code = shareCode(this.design);
    try {
      await navigator.clipboard.writeText(code);
      this.hooks.toast(`Share code for ${this.design.name} copied`, '#7ab8ff');
    } catch {
      // No clipboard access (some browsers, file:// pages): show it for copying by hand.
      prompt('Copy this share code:', code);
    }
  }

  private importCode() {
    const text = prompt('Paste a species share code (starts with DW-SPECIES:)');
    if (!text) return;
    const d = fromShareCode(text);
    if (!d) return this.hooks.toast('That is not a valid species share code', '#ff8a8a');
    // Opens in the editor as a new, unsaved species (Save to bestiary keeps it).
    this.design = { ...d, id: '' };
    this.design.id = this.uniqueId();
    this.hooks.toast(`${d.name} loaded: Save to bestiary to keep it`, '#7ab8ff');
    this.render();
  }

  private release(b: SpeciesDesign) {
    b.released = !b.released;
    this.saves.saveDesign(b);
    registerDesign(b);
    setReleased(this.saves.file.bestiary);
    if (this.design.id === b.id) this.design.released = b.released;
    this.hooks.toast(b.released ? `${b.name} now roams the depths (from depth 2)` : `${b.name} recalled`, b.released ? '#7ab8ff' : undefined);
    this.render();
  }

  private remove(b: SpeciesDesign) {
    if (!confirm(`Delete ${b.name} from the bestiary?`)) return;
    this.saves.deleteDesign(b.id);
    setReleased(this.saves.file.bestiary);
    this.render();
  }

  private fight() {
    if (!this.save()) return;
    const d = structuredClone(this.design);
    this.close();
    this.hooks.testFight(d);
  }

  dispose() {
    this.studio?.dispose();
  }
}
