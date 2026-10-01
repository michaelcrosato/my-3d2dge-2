/**
 * Gameplay props: a registry of kinds (collider shape, hit points, whether swords and spells hit
 * them, whether the hero can interact) plus behaviours (what a hit, an interaction or a frame
 * does). Breakables, chests and portals live here; each level mechanic registers its own kinds
 * (sim/mechanics/*.ts), so a new mechanic is a new module, not an edit to the core.
 */
import type { HitSpec, SkillDef } from '../content/skills';
import { dropContainer } from './loot';
import type { Sim } from './sim';
import type { Character, Prop } from './types';

export interface PropSpec {
  radius: number;
  height: number;
  /** Has a collider (blocks movement and projectiles). */
  solid: boolean;
  /** Strikes, projectiles and explosions affect it. */
  hittable: boolean;
  /** Monsters' attacks affect it too (kegs, totems). */
  anyTeam?: boolean;
  /** The hero can press interact on it. */
  interact?: boolean;
  hp?: number;
  navBlock?: boolean;
  dynamic?: boolean;
  ball?: boolean;
  density?: number;
  damping?: number;
  friction?: number;
  initial?: string;
  label?: string;
}

export interface PropBehaviour {
  /** A hit (or, with interact = true, the hero pressing interact). */
  hit?(sim: Sim, p: Prop, by: Character | null, s: SkillDef, hit: HitSpec | undefined, interact: boolean): void;
  step?(sim: Sim, p: Prop): void;
}

const SPECS = new Map<string, PropSpec>();
const BEHAVIOURS = new Map<string, PropBehaviour>();

export function registerProp(kind: string, spec: PropSpec, behaviour: PropBehaviour = {}) {
  SPECS.set(kind, spec);
  BEHAVIOURS.set(kind, behaviour);
}

export function propSpec(kind: string): PropSpec | undefined {
  return SPECS.get(kind);
}

export function propKinds(): string[] {
  return [...SPECS.keys()];
}

export function mechanicHit(sim: Sim, p: Prop, by: Character | null, s: SkillDef, hit: HitSpec | undefined, interact = false) {
  if (p.dead) return;
  BEHAVIOURS.get(p.kind)?.hit?.(sim, p, by, s, hit, interact);
}

export function stepProps(sim: Sim) {
  for (const p of sim.props.values()) {
    if (p.dead) continue;
    if (p.body) {
      const t = p.body.translation();
      p.vx = (t.x - p.x) / sim.dt;
      p.vz = (t.z - p.z) / sim.dt;
      p.x = t.x;
      p.z = t.z;
      p.y = t.y - (propSpec(p.kind)!.height * p.scale) / 2;
    }
    BEHAVIOURS.get(p.kind)?.step?.(sim, p);
  }
  for (const [id, p] of sim.props) if (p.dead && p.state === 'gone') sim.props.delete(id);
}

/** Breaks a breakable: collider removed, debris event, small loot. */
export function breakProp(sim: Sim, p: Prop, by: Character | null) {
  if (p.dead) return;
  p.dead = true;
  p.state = 'broken';
  sim.removePropCollider(p);
  sim.emit('prop.break', { id: p.id, kind: p.kind, x: p.x, z: p.z, by: by?.id ?? null });
  dropContainer(sim, p.x, p.z, sim.level.monsterLevel ?? 1, p.kind === 'coffin' ? 'large' : 'small');
}

const breakable = (radius: number, height: number, hp: number): [PropSpec, PropBehaviour] => [
  { radius, height, solid: true, hittable: true, hp },
  {
    hit(sim, p, by, _s, _hit, interact) {
      if (interact) return;
      p.hp -= 1;
      p.timer = 8;
      if (p.hp <= 0) breakProp(sim, p, by);
      else sim.emit('prop.hit', { id: p.id, x: p.x, z: p.z });
    },
    step(_sim, p) {
      if (p.timer > 0) p.timer--;
    },
  },
];

registerProp('urn', ...breakable(0.28, 0.75, 1));
registerProp('barrel', ...breakable(0.36, 0.9, 1));
registerProp('crate', ...breakable(0.42, 0.85, 2));
registerProp('coffin', ...breakable(0.5, 0.6, 2));

registerProp('chest', { radius: 0.5, height: 0.7, solid: true, hittable: true, interact: true, label: 'Chest' }, {
  hit(sim, p, by) {
    if (p.state === 'used' || (by && by.team !== 'hero')) return;
    p.state = 'used';
    sim.emit('chest.open', { id: p.id, x: p.x, z: p.z });
    dropContainer(sim, p.x, p.z, sim.level.monsterLevel ?? 1, p.data.big ? 'boss' : 'chest');
  },
});

registerProp('portal', { radius: 0.7, height: 2.2, solid: false, hittable: false, interact: true, label: 'Portal' }, {
  hit(sim, p, by, _s, _h, interact) {
    if (!interact || !by || by.id !== sim.heroId) return;
    sim.emit('portal.enter', { id: p.id, to: p.data.to ?? 'town', stage: p.data.stage ?? null });
  },
});

/** Town fixtures: interactive but indestructible. */
for (const [kind, label] of [['waypoint', 'Waypoint'], ['stash', 'Stash'], ['anvil', 'Anvil'], ['shrine_respec', 'Shrine of Unmaking'], ['dummy_post', 'Training Post']] as const)
  registerProp(kind, { radius: kind === 'waypoint' ? 1.1 : 0.6, height: 1.2, solid: true, hittable: false, interact: true, label }, {
    hit(sim, p, by, _s, _h, interact) {
      if (interact && by?.id === sim.heroId) sim.emit('npc.talk', { id: p.id, role: p.kind, name: label });
    },
  });
