/** Top-left overlay: status line, optional performance stats, and control hints built from the live bindings. */
import type { Game } from '../game';
import type { Action } from '../input/actions';
import type { Device } from '../input/controller';
import type { Profile } from '../input/profile';
import { codeLabel, padLabel } from '../input/resolve';

function keyHints(p: Profile): string[] {
  const k = (a: Action) => (p.keys[a][0] ? codeLabel(p.keys[a][0]) : '');
  const hint = (a: Action, text: string) => (k(a) ? `${k(a)} ${text}` : '');
  const dirs = (['moveUp', 'moveLeft', 'moveDown', 'moveRight'] as const).map(k);
  const move = dirs.every((d) => d.length === 1) ? `${dirs.join('')} move` : dirs.some(Boolean) ? `${dirs.join('/')} move` : '';
  const fps = [k('animFps6'), k('animFps24')].filter(Boolean).join('-');
  const lines = [
    [move, hint('sprint', 'sprint'), hint('walk', 'walk'), hint('jump', 'jump'), hint('attack', 'attack'), hint('moveTo', 'go to')],
    [hint('menu', 'settings'), hint('pause', 'pause'), hint('step', 'step'), hint('reset', 'reset'), hint('help', 'help'), hint('stats', 'stats')],
    [hint('togglePixel', 'pixel/3D'), hint('toggleOutlines', 'outlines'), hint('toggleCreases', 'creases'), hint('cyclePalette', 'palette'), hint('toggleSnap', 'snap'), hint('toggleSmoothScroll', 'smooth')],
    [hint('toggleStepped', 'stepped'), hint('toggleDir8', '8-dir'), hint('toggleSilhouettes', 'silhouettes'), hint('toggleColliders', 'colliders'), hint('toggleShadows', 'shadows'), fps ? `${fps} anim fps` : ''],
  ];
  return lines.map((l) => l.filter(Boolean).join('  ')).filter(Boolean);
}

function padHints(p: Profile): string[] {
  const b = (a: Action) => (p.pad[a][0] ? padLabel(p.pad[a][0]) : '');
  const hint = (a: Action, text: string) => (b(a) ? `${b(a)} ${text}` : '');
  const stick = p.padOptions.stick === 'left' ? 'Left stick' : 'Right stick';
  return [
    [`${stick} move`, hint('jump', 'jump'), hint('attack', 'attack'), hint('sprint', 'sprint')].filter(Boolean).join('  '),
    [hint('menu', 'settings'), hint('pause', 'pause'), hint('togglePixel', 'pixel/3D')].filter(Boolean).join('  '),
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
    else if (device === 'touch' || (device === 'none' && touchVisible)) lines.push('Stick moves • Jump / Attack / Sprint', '⚙ settings • Pixel / 3D switches rendering');
    else lines.push(...keyHints(p));
  }
  return lines.join('\n');
}
