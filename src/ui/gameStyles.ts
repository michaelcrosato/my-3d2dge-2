/**
 * Styles for the game UI (HUD, panels, tooltips, title and pause menus). Injected from JS so the
 * single-file standalone build carries them. Pixel-flavoured: hard borders, no blur, crisp
 * `image-rendering: pixelated` icons, readable on 320 px phones and 4K screens.
 */
const css = /* css */ `
:root { --gp-bg: #14121bf2; --gp-panel: #1e1b28; --gp-raised: #2a2638; --gp-line: #4a4560; --gp-text: #f3ead6; --gp-dim: #a99fb8;
  --gp-gold: #ffd84a; --gp-life: #d6283a; --gp-mana: #3a6aff; --gp-xp: #b388ff; --gp-normal: #e8e4da; --gp-magic: #8888ff; --gp-rare: #ffff77; --gp-unique: #ff9a3d; }
.pix { image-rendering: pixelated; image-rendering: crisp-edges; }

/* ---- HUD */
#ghud { position: fixed; inset: 0; pointer-events: none; z-index: 6; font: 600 12px/1.25 ui-monospace, Consolas, monospace; color: var(--gp-text); }
#ghud[hidden] { display: none; }
#ghud .title { position: absolute; left: max(10px, env(safe-area-inset-left)); top: max(8px, env(safe-area-inset-top)); text-shadow: 0 1px 0 #000, 1px 0 0 #000; }
#ghud .title b { display: block; font-size: 15px; color: #ffe9b8; letter-spacing: 0.04em; }
#ghud .title small { color: var(--gp-dim); }
#ghud .bars { display: none; position: absolute; left: max(10px, env(safe-area-inset-left)); top: max(48px, calc(env(safe-area-inset-top) + 40px)); width: min(42vw, 220px); flex-direction: column; gap: 3px; }
.gbar { position: relative; height: 12px; background: #0b0a10cc; border: 1px solid #000; box-shadow: inset 0 0 0 1px #ffffff18; }
.gbar > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--c); }
.gbar > span { position: absolute; inset: 0; font-size: 10px; line-height: 12px; text-align: center; text-shadow: 0 1px 0 #000; }
.gbar.xp { height: 6px; }
#ghud .bottom { position: absolute; left: 50%; bottom: max(8px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; align-items: flex-end; gap: 8px; }
.orb { width: 64px; height: 64px; border-radius: 50%; position: relative; overflow: hidden; border: 2px solid #000; box-shadow: 0 0 0 2px #6a5a3a, inset 0 0 12px #000; background: #0b0a10; }
.orb > i { position: absolute; left: 0; right: 0; bottom: 0; background: var(--c); }
.orb > span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; text-shadow: 0 1px 0 #000, 0 0 3px #000; }
.hotbar { display: flex; gap: 4px; pointer-events: auto; }
.slot { width: 44px; height: 44px; position: relative; background: #0b0a10d8; border: 2px solid #3a3448; display: flex; align-items: center; justify-content: center; }
.slot img, .slot canvas { width: 36px; height: 36px; }
.slot .key { position: absolute; left: 1px; top: 0; font-size: 9px; color: #fff4db; text-shadow: 0 1px 0 #000; }
.slot .cd { position: absolute; left: 0; right: 0; bottom: 0; background: #000a; }
.slot .num { position: absolute; right: 2px; bottom: 0; font-size: 10px; text-shadow: 0 1px 0 #000; }
.slot.nomana { border-color: #3a6aff; }
.slot.empty { opacity: 0.55; }
#ghud .xpline { position: absolute; left: 50%; transform: translateX(-50%); bottom: max(78px, calc(env(safe-area-inset-bottom) + 70px)); width: min(520px, 70vw); }
#ghud .buffs { position: absolute; left: max(10px, env(safe-area-inset-left)); top: max(104px, calc(env(safe-area-inset-top) + 96px)); display: flex; flex-wrap: wrap; gap: 3px; max-width: 40vw; }
#ghud .buffs span { padding: 1px 4px; border: 1px solid var(--c); color: var(--c); background: #0b0a10cc; font-size: 10px; }
#ghud .boss { position: absolute; left: 50%; top: max(8px, env(safe-area-inset-top)); transform: translateX(-50%); width: min(460px, 60vw); text-align: center; }
#ghud .boss b { display: block; color: #ffb84d; text-shadow: 0 1px 0 #000; font-size: 13px; }
#ghud .boss .gbar { height: 10px; }
#ghud .banner { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); text-align: center; text-shadow: 0 2px 0 #000, 0 0 8px #000; pointer-events: none; transition: opacity 0.4s; }
#ghud .banner b { display: block; font-size: clamp(22px, 5vw, 40px); color: #ffe9b8; letter-spacing: 0.06em; }
#ghud .banner span { font-size: clamp(12px, 2.5vw, 16px); color: var(--gp-dim); }
#ghud .banner em { display: block; margin-top: 6px; font-style: normal; font-size: 12px; color: #b8e0ff; max-width: 80vw; }
#ghud .debug { position: absolute; left: max(10px, env(safe-area-inset-left)); bottom: max(8px, env(safe-area-inset-bottom)); white-space: pre; font-size: 10px; color: #cfc6b0; text-shadow: 0 1px 0 #000; }
#gbtns { position: fixed; z-index: 16; right: max(8px, env(safe-area-inset-right)); top: calc(max(8px, env(safe-area-inset-top)) + 84px); display: flex; flex-direction: column; gap: 6px; }
#gbtns[hidden] { display: none; }
#gbtns button { min-width: 44px; min-height: 40px; padding: 4px 8px; font: 700 12px system-ui; border-radius: 8px; }
#gbtns .dot { position: relative; }
#gbtns .dot::after { content: ''; position: absolute; right: 4px; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--gp-gold); }
body.touchui #ghud .bottom { display: none; }
body.touchui #ghud .bars { display: flex; }
body.touchui #ghud .xpline { bottom: auto; top: max(80px, calc(env(safe-area-inset-top) + 76px)); left: max(10px, env(safe-area-inset-left)); transform: none; width: min(42vw, 220px); }
body.touchui #ghud .buffs { top: max(92px, calc(env(safe-area-inset-top) + 88px)); }
@media (max-width: 520px) { #ghud .title b { font-size: 13px; } #ghud .boss { top: max(92px, calc(env(safe-area-inset-top) + 84px)); } }

/* ---- toasts in the middle top */
#gtoast { position: fixed; z-index: 40; left: 50%; top: max(70px, env(safe-area-inset-top)); transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; max-width: calc(100vw - 24px); }
#gtoast div { font: 700 13px/1.3 system-ui, sans-serif; padding: 5px 10px; background: #14121be0; border: 1px solid var(--gp-line); color: var(--gp-text); text-shadow: 0 1px 0 #000; }

/* ---- panels */
.gp { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: #07060a99; padding: max(6px, env(safe-area-inset-top)) max(6px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(6px, env(safe-area-inset-left)); color-scheme: dark; }
.gp[hidden] { display: none; }
.gp .sheet { display: flex; flex-direction: column; width: min(980px, 100%); max-height: 100%; height: min(720px, 100%); background: var(--gp-bg); color: var(--gp-text); border: 2px solid #5a4a30; box-shadow: 0 0 0 2px #000, 0 20px 60px #000c; font: 14px/1.4 system-ui, sans-serif; overflow: hidden; }
.gp header { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--gp-line); flex-wrap: wrap; }
.gp header h2 { margin: 0; font: 800 17px system-ui; letter-spacing: 0.05em; color: #ffe9b8; flex: 1 1 auto; }
.gp header .wallet { color: var(--gp-gold); font: 700 13px ui-monospace, monospace; }
.gp header .quote { flex: 1 1 100%; color: var(--gp-dim); font-style: italic; font-size: 12px; margin: 0; }
.gp .tabs { display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--gp-line); overflow-x: auto; flex: none; }
.gp .tabs button { flex: none; color: var(--gp-dim); background: none; border: 0; border-bottom: 3px solid transparent; font: 700 13px system-ui; min-height: 40px; padding: 6px 12px; cursor: pointer; border-radius: 0; }
.gp .tabs button[aria-selected="true"] { color: var(--gp-text); border-bottom-color: #ffcf5a; background: var(--gp-panel); }
.gp .body { flex: 1 1 auto; overflow: auto; overscroll-behavior: contain; padding: 10px 14px 16px; display: flex; gap: 14px; flex-wrap: wrap; align-content: flex-start; }
.gp .body > section { flex: 1 1 300px; min-width: 0; }
.gp h3 { margin: 6px 0 8px; font: 800 12px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #ffcf5a; }
.gp .note { color: var(--gp-dim); font-size: 12px; margin: 4px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); gap: 3px; }
.cell { aspect-ratio: 1; min-width: 40px; position: relative; background: #0b0a10; border: 1px solid #3a3448; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.cell img { width: 88%; height: 88%; }
.cell.sel { outline: 2px solid #ffcf5a; outline-offset: -1px; }
.cell.r-magic { border-color: #5a5abf; } .cell.r-rare { border-color: #bfbf4a; } .cell.r-unique { border-color: #c4702a; background: #1a0f08; }
.cell .up { position: absolute; right: 2px; top: 0; font: 900 12px system-ui; color: #5ad06a; text-shadow: 0 1px 0 #000, 0 0 3px #000; pointer-events: none; }
.cell .lbl { position: absolute; left: 2px; top: 1px; font: 9px ui-monospace, monospace; color: var(--gp-dim); pointer-events: none; }
.doll { display: grid; grid-template-columns: repeat(4, minmax(46px, 64px)); gap: 4px; justify-content: start; }
.tip { border: 1px solid var(--gp-line); background: #0b0a10; padding: 8px 10px; font: 12px/1.45 ui-monospace, Consolas, monospace; }
.tip .name { font: 800 14px system-ui; }
.tip .base { color: var(--gp-dim); }
.tip .implicit { color: #bfeaff; border-bottom: 1px solid #ffffff18; padding-bottom: 2px; margin-bottom: 2px; }
.tip .affix { color: #8fa8ff; }
.tip .unique { color: #ffb070; }
.tip .flavour { color: #c0904a; font-style: italic; }
.tip .req { color: var(--gp-dim); font-size: 11px; }
.tip .cmp { margin-top: 6px; border-top: 1px dashed #ffffff30; padding-top: 4px; }
.tip .better { color: #6af08a; } .tip .worse { color: #ff6a6a; }
.gp .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.gp .pacts { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
.gp .row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #ffffff10; flex-wrap: wrap; }
.gp .row > .grow { flex: 1 1 160px; min-width: 0; }
.gp .stat { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; font: 12px ui-monospace, monospace; }
.gp .stat span:nth-child(odd) { color: var(--gp-dim); }
.skillcard { display: flex; gap: 8px; align-items: center; padding: 6px; border: 1px solid var(--gp-line); background: var(--gp-panel); margin-bottom: 4px; }
.skillcard canvas { width: 36px; height: 36px; flex: none; }
.skillcard .d { flex: 1 1 auto; min-width: 0; font-size: 12px; }
.skillcard .d b { font-size: 13px; }
.skillcard .slots { display: flex; gap: 3px; flex-wrap: wrap; }
.skillcard .slots button { min-width: 34px; min-height: 32px; padding: 2px 6px; font-size: 12px; }
.skillcard.locked { opacity: 0.5; }
.stagelist .row b { color: #ffe9b8; }
.stagelist .row small { color: var(--gp-dim); }
.mech { display: inline-block; padding: 0 5px; margin: 1px 2px; border: 1px solid #6a8aff; color: #b8d0ff; font-size: 11px; }

/* ---- passive tree */
.treebox { position: relative; flex: 1 1 100%; min-height: 300px; height: 100%; display: flex; flex-direction: column; }
.treebox canvas { flex: 1 1 auto; width: 100%; min-height: 240px; background: #0a0910; touch-action: none; cursor: grab; display: block; }
.treebox .tbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 4px 0; }
.treebox .tbar input { flex: 1 1 120px; min-height: 36px; background: #0b0a10; color: var(--gp-text); border: 1px solid var(--gp-line); padding: 4px 8px; font: 13px system-ui; }
.treebox .tinfo { position: absolute; right: 8px; bottom: 8px; max-width: min(320px, 70%); pointer-events: auto; }
.gp.treep .body { padding: 6px 10px 10px; }

/* ---- menus */
#gmenu { position: fixed; inset: 0; z-index: 28; display: flex; align-items: center; justify-content: center; background: #07060ab0; color-scheme: dark; padding: 10px; }
#gmenu[hidden] { display: none; }
#gmenu .box { width: min(460px, 100%); max-height: 100%; overflow: auto; background: var(--gp-bg); border: 2px solid #5a4a30; box-shadow: 0 0 0 2px #000; padding: 14px; color: var(--gp-text); font: 14px system-ui; }
#gmenu h2 { margin: 0 0 10px; text-align: center; font: 800 20px system-ui; letter-spacing: 0.08em; color: #ffe9b8; }
#gmenu .stack { display: flex; flex-direction: column; gap: 6px; }
#gmenu .stack .ui-btn { width: 100%; }
#gmenu .tune { margin-top: 10px; border-top: 1px solid var(--gp-line); padding-top: 8px; }
#gmenu .tune label { display: grid; grid-template-columns: 1fr 1.4fr 3.2em; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; }
#gmenu .tune input[type="range"] { width: 100%; accent-color: #ffcf5a; }
#gtitle { position: fixed; inset: 0; z-index: 27; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 16px; color: var(--gp-text); font: 14px system-ui; background: radial-gradient(ellipse at 50% 30%, #2a1f3a00, #07060acc 70%); }
#gtitle[hidden] { display: none; }
#gtitle h1 { margin: 0; font: 900 clamp(30px, 7vw, 64px)/1 system-ui; letter-spacing: 0.1em; color: #ffe9b8; text-shadow: 0 4px 0 #000, 0 0 20px #ff9a3d55; text-align: center; }
#gtitle .sub { color: var(--gp-dim); text-align: center; margin-top: -6px; }
#gtitle .slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; width: min(760px, 100%); }
#gtitle .slotcard { background: var(--gp-bg); border: 2px solid #5a4a30; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
#gtitle .slotcard b { color: #ffe9b8; }
#gtitle .slotcard small { color: var(--gp-dim); }
#gtitle .more { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
@media (max-width: 560px) { .gp { padding: 0; } .gp .sheet { height: 100%; border: 0; } .doll { grid-template-columns: repeat(4, 1fr); } }
@media (max-height: 480px) { .gp { padding: 0; } .gp .sheet { height: 100%; } .gp header .quote { display: none; } #gtitle { justify-content: flex-start; overflow: auto; } }
`;

export function installGameStyles() {
  if (document.getElementById('game-styles')) return;
  const style = document.createElement('style');
  style.id = 'game-styles';
  style.textContent = css;
  document.head.append(style);
}
