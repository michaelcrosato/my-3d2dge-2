/** Top-left overlay: status line, optional performance stats, and control hints built from the live bindings. */
import type { Game } from '../game';
import type { Action } from '../input/actions';
import type { Device } from '../input/controller';
import type { Profile } from '../input/profile';
import { codeLabel, padLabel } from '../input/resolve';

function keyHints(p: Profile): string[] {
  const k = (a: Action) => (p.keys[a][0] ? codeLabel(p.keys[a][0]).replace('Left click', 'LMB').replace('Right click', 'RMB').replace('Middle click', 'MMB') : '');
  const hint = (a: Action, text: string) => (k(a) ? `${k(a)} ${text}` : '');
  const dirs = (['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map(k);
  const move = dirs.every((d) => d.length === 1) ? `${dirs.join('')} move` : dirs.some(Boolean) ? `${dirs.join('/')} move` : '';
  const skills = (['skill1', 'skill2', 'skill3', 'skill4', 'skill5'] as const).map(k).filter(Boolean).join('/');
  const lines = [
    [move, hint('attack', 'attack'), skills ? `${skills} skills` : '', hint('dodge', 'roll'), hint('interact', 'use'), hint('flask1', 'life'), hint('flask2', 'mana')],
    [hint('inventory', 'bag'), hint('tree', 'tree'), hint('character', 'char'), hint('townPortal', 'town'), hint('map', 'map'), hint('menu', 'menu'), hint('help', 'help'), hint('stats', 'stats')],
    [hint('togglePixel', 'pixel/3D'), hint('toggleOutlines', 'outlines'), hint('cyclePalette', 'palette'), hint('toggleColliders', 'colliders'), hint('pause', 'freeze'), hint('step', 'step')],
  ];
  return lines.map((l) => l.filter(Boolean).join('  ')).filter(Boolean);
}

function padHints(p: Profile): string[] {
  const b = (a: Action) => (p.pad[a][0] ? padLabel(p.pad[a][0]) : '');
  const hint = (a: Action, text: string) => (b(a) ? `${b(a)} ${text}` : '');
  const stick = p.padOptions.stick === 'left' ? 'Left stick' : 'Right stick';
  return [
    [`${stick} move`, 'other stick aims', hint('attack', 'attack'), hint('dodge', 'roll'), hint('interact', 'use')].filter(Boolean).join('  '),
    [hint('skill1', 's1'), hint('skill2', 's2'), hint('skill3', 's3'), hint('skill4', 's4'), hint('skill5', 's5'), hint('flask1', 'life'), hint('flask2', 'mana')].filter(Boolean).join('  '),
    [hint('menu', 'menu'), hint('inventory', 'bag'), hint('tree', 'tree'), hint('character', 'char'), hint('map', 'map')].filter(Boolean).join('  '),
  ];
}

export function hudText(game: Game, p: Profile, device: Device, touchVisible: boolean): string {
  const lines: string[] = [];
  const pipe = game.pipeline;
  if (p.prefs.showHelp || p.prefs.showStats) {
    lines.push(`${game.paused ? 'PAUSED  ' : ''}${game.fps} fps  frame ${game.sim.frame}  ${pipe.width - 2 * pipe.margin}x${pipe.height - 2 * pipe.margin} x${pipe.scale}`);
  }
  if (p.prefs.showStats) {
    const s = game.frameStats;
    lines.push(`${s.ms.toFixed(2)} ms cpu  ${s.calls} draw calls  ${(s.triangles / 1000).toFixed(1)}k tris`);
  }
  if (p.prefs.showHelp) {
    if (device === 'gamepad') lines.push(...padHints(p));
    else if (device === 'touch' || (device === 'none' && touchVisible)) lines.push('Stick moves • Attack, Roll and skill buttons • tap NPCs and loot', '☰ menu • Bag / Tree / Char • ⚙ settings');
    else lines.push(...keyHints(p));
  }
  return lines.join('\n');
}
