/**
 * Pinnacle bosses: every tenth depth ends in a named boss assembled from the same parts as
 * everything else (a humanoid preset or a creature genome, a palette, an attack kit, an add type).
 * They fight in three phases, call adds at each phase change, enrage late and always drop a unique
 * plus rares: long-term goals for players who push deep. Past the list they cycle, scaled by depth.
 */
import { MONSTERS, type MonsterBody, type MonsterDef } from './monsters';

interface PinnacleSpec {
  id: string;
  name: string;
  title: string;
  body: MonsterBody;
  palette: string;
  skills: string[];
  adds: string;
  size: number;
}

const SPECS: PinnacleSpec[] = [
  { id: 'hollow_king', name: 'The Hollow King', title: 'Crown of Dust', body: { kind: 'humanoid', preset: 'boss_reaver' }, palette: 'bone', skills: ['b_sweep', 'm_charge', 'b_quake', 'm_leap'], adds: 'hollow', size: 2 },
  { id: 'cinder_mother', name: 'Mother of Cinders', title: 'Ash on Every Wing', body: { kind: 'creature', plan: 'drake', seed: 4410, genome: { horns: { count: 4 }, wings: { span: 2.6 }, spikes: { count: 8 } } }, palette: 'ember', skills: ['m_bite', 'b_meteors', 'b_barrage', 'm_leap'], adds: 'bombling', size: 2.4 },
  { id: 'glass_choir', name: 'The Glass Choir', title: 'Many Eyes, One Song', body: { kind: 'creature', plan: 'eye', seed: 913, genome: { head: { eyes: 7 }, tentacles: { count: 8, length: 1.4 } } }, palette: 'storm', skills: ['m_bolt', 'b_barrage', 'm_nova', 'm_spray'], adds: 'sp:wisp:913', size: 2.2 },
  { id: 'vael_unbound', name: 'Vael Unbound', title: 'The Rift Made Flesh', body: { kind: 'humanoid', preset: 'boss_cult' }, palette: 'void', skills: ['m_bolt', 'b_barrage', 'b_meteors', 'm_groundfire'], adds: 'minion', size: 1.9 },
  { id: 'grull_mountain', name: 'Grull the Mountain', title: 'Powder and Stone', body: { kind: 'humanoid', preset: 'boss_golem' }, palette: 'ash', skills: ['m_punch', 'b_quake', 'm_slam', 'b_meteors'], adds: 'golem', size: 2.3 },
  { id: 'brood_tyrant', name: 'The Brood Tyrant', title: 'Ten Thousand Legs', body: { kind: 'creature', plan: 'scorpion', seed: 7777, genome: { legs: { pairs: 5 }, spikes: { count: 12 }, tail: { segments: 7 } } }, palette: 'venom', skills: ['m_spit', 'm_charge', 'b_quake', 'm_bite'], adds: 'sp:spider:7777', size: 2.4 },
  // Added later: they join the cycle from depth 70, so depths 10-60 keep their bosses.
  { id: 'frostshell', name: 'The Frostshell Matriarch', title: 'A Cold That Walks Sideways', body: { kind: 'creature', plan: 'crab', seed: 3131, genome: { spikes: { count: 10 }, head: { eyes: 5 } } }, palette: 'frost', skills: ['m_charge', 'm_nova', 'b_quake', 'm_scratch'], adds: 'sp:crab:3131', size: 2.4 },
  { id: 'rot_colossus', name: 'The Rot Colossus', title: 'It Grew Here First', body: { kind: 'creature', plan: 'brute', seed: 9090, genome: { spikes: { count: 8 }, horns: { count: 1 } } }, palette: 'venom', skills: ['m_punch', 'b_sweep', 'm_slam', 'm_groundfire'], adds: 'sporeling', size: 2.5 },
];

export const PINNACLE_IDS = SPECS.map((s) => `pinnacle_${s.id}`);

for (const s of SPECS) {
  const def: MonsterDef = {
    id: `pinnacle_${s.id}`, name: s.name, family: 'pinnacle', body: s.body, archetype: 'boss', skills: s.skills,
    life: 1.9, damage: 1.15, speed: 3.8, size: s.size, xp: 2, palette: s.palette,
    boss: { title: s.title, phases: 3, enrageAt: 0.2, adds: 3, pinnacle: true }, minion: s.adds,
  };
  MONSTERS[def.id] = def;
}

/** True for depths that end in a pinnacle boss. */
export const isPinnacleDepth = (n: number) => n > 0 && n % 10 === 0;

/** The pinnacle boss for a depth (cycling through the list). */
export function pinnacleFor(n: number): { def: string; palette: string } {
  const s = SPECS[(Math.floor(n / 10) - 1) % SPECS.length];
  return { def: `pinnacle_${s.id}`, palette: s.palette };
}
