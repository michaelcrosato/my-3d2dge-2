/**
 * Styles for the settings dialog, touch controls and toasts. Injected from JS so the standalone
 * single-file build (one JS bundle, no CSS asset) carries them too.
 */
const css = /* css */ `
:root {
  --ui-bg: #17151f; --ui-panel: #221f2d; --ui-raised: #2d2a3b; --ui-line: #4a4560; --ui-text: #fff4db;
  --ui-dim: #b9b0c9; --ui-accent: #ffcf5a; --ui-accent-ink: #231c05; --ui-danger: #ff7a7a; --ui-focus: #8fd3ff;
}
.ui-btn { color: var(--ui-text); background: var(--ui-raised); border: 1px solid var(--ui-line); border-radius: 10px;
  font: 600 14px/1.2 system-ui, sans-serif; min-height: 44px; min-width: 44px; padding: 8px 12px; cursor: pointer; touch-action: manipulation; }
.ui-btn:hover { border-color: var(--ui-dim); }
.ui-btn:disabled { opacity: 0.45; cursor: default; }
.ui-btn.primary { background: var(--ui-accent); color: var(--ui-accent-ink); border-color: var(--ui-accent); }
.ui-btn.danger { color: var(--ui-danger); }
.ui-btn.small { min-height: 36px; min-width: 36px; padding: 4px 10px; font-size: 13px; }
:where(#settings, #touch-edit-bar) :focus-visible, #toolbar button:focus-visible { outline: 3px solid var(--ui-focus); outline-offset: 2px; }

#settings { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; color-scheme: dark;
  background: #07060acc; padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); }
#settings[hidden] { display: none; }
#settings .sheet { display: flex; flex-direction: column; width: min(860px, 100%); max-height: 100%; height: min(760px, 100%);
  background: var(--ui-bg); color: var(--ui-text); border: 1px solid var(--ui-line); border-radius: 16px; overflow: hidden;
  font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 20px 60px #000a; }
#settings header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px 8px 16px; border-bottom: 1px solid var(--ui-line); }
#settings h2 { margin: 0; font-size: 18px; flex: 1 1 auto; }
#settings header label { display: flex; align-items: center; gap: 8px; color: var(--ui-dim); min-width: 0; }
#settings select { -webkit-appearance: none; appearance: none; color: var(--ui-text); border: 1px solid var(--ui-line); border-radius: 8px;
  min-height: 40px; padding: 4px 32px 4px 10px; font: 14px system-ui, sans-serif; max-width: 100%;
  background: var(--ui-panel) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23b9b0c9' stroke-width='2'/%3E%3C/svg%3E") no-repeat right 10px center; }
#settings .tabs { display: flex; gap: 4px; padding: 8px 12px 0; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--ui-line); flex: none; }
#settings .tabs button { flex: none; color: var(--ui-dim); background: none; border: 0; border-bottom: 3px solid transparent; border-radius: 8px 8px 0 0;
  font: 600 14px system-ui, sans-serif; min-height: 44px; padding: 8px 12px; cursor: pointer; }
#settings .tabs button[aria-selected="true"] { color: var(--ui-text); border-bottom-color: var(--ui-accent); background: var(--ui-panel); }
#settings .panel { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 12px 16px 20px; }
#settings footer { flex: none; padding: 8px 16px; border-top: 1px solid var(--ui-line); color: var(--ui-dim); font-size: 12px; }
#settings h3 { margin: 18px 0 8px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ui-accent); }
#settings h3:first-child { margin-top: 4px; }
#settings p.note { margin: 4px 0 10px; color: var(--ui-dim); font-size: 13px; }
#settings .row { display: grid; grid-template-columns: minmax(120px, 34%) 1fr; align-items: center; gap: 6px 12px; padding: 6px 0; border-bottom: 1px solid #ffffff10; }
#settings .row > .label { font-weight: 600; }
#settings .row > .label small { display: block; font-weight: 400; color: var(--ui-dim); font-size: 12px; }
#settings .row .control { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
#settings input[type="range"] { flex: 1 1 140px; min-width: 100px; accent-color: var(--ui-accent); height: 32px; }
#settings input[type="checkbox"] { width: 22px; height: 22px; accent-color: var(--ui-accent); margin: 0; }
#settings .value { min-width: 3.5em; font-variant-numeric: tabular-nums; color: var(--ui-dim); }
#settings .chip { display: inline-flex; align-items: center; gap: 2px; background: var(--ui-panel); border: 1px solid var(--ui-line); border-radius: 8px;
  padding: 0 0 0 10px; min-height: 36px; font: 600 13px ui-monospace, Consolas, monospace; white-space: nowrap; }
#settings .chip button { color: var(--ui-dim); background: none; border: 0; min-width: 32px; min-height: 34px; font-size: 16px; cursor: pointer; border-radius: 8px; }
#settings .chip button:hover { color: var(--ui-danger); }
#settings .capturing { border-color: var(--ui-accent); color: var(--ui-accent); animation: ui-pulse 1s infinite alternate; }
@keyframes ui-pulse { from { box-shadow: 0 0 0 0 #ffcf5a55; } to { box-shadow: 0 0 0 5px #ffcf5a00; } }
#settings .profile { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--ui-line); border-radius: 12px; background: var(--ui-panel); }
#settings .profile.active { border-color: var(--ui-accent); }
#settings .profile .name { flex: 1 1 160px; font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
#settings .profile .name small { display: block; font-weight: 400; color: var(--ui-dim); }
#settings .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
#settings .layouts { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
#settings .layout-card { display: flex; flex-direction: column; gap: 8px; }
#settings .layout-card .frame-wrap { position: relative; overflow: hidden; border: 1px solid var(--ui-line); border-radius: 12px;
  background: repeating-linear-gradient(45deg, #2a2536, #2a2536 10px, #2f2a3c 10px, #2f2a3c 20px); }
#settings .layout-card .frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
#settings .layout-card .edit-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 36px; }
#settings .pad-test { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px; border: 1px dashed var(--ui-line); border-radius: 12px; margin-bottom: 8px; }
#settings .pad-test .stick { position: relative; width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--ui-line); flex: none; }
#settings .pad-test .stick i { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px; border-radius: 50%; background: var(--ui-accent); }
#settings .pad-test .pressed { font: 600 13px ui-monospace, Consolas, monospace; color: var(--ui-accent); min-height: 1.4em; }
@media (max-width: 560px) {
  #settings { padding: 0; }
  #settings .sheet { height: 100%; border-radius: 0; border: 0; }
  #settings .row { grid-template-columns: 1fr; }
  #settings header label { order: 3; flex: 1 1 100%; }
  #settings header select { flex: 1 1 auto; }
}
@media (max-height: 500px) {
  #settings { padding: 0 max(8px, env(safe-area-inset-right)) 0 max(8px, env(safe-area-inset-left)); }
  #settings .sheet { height: 100%; border-radius: 0; border-top: 0; border-bottom: 0; }
  #settings header { padding: 4px 8px 4px 12px; }
  #settings h2 { font-size: 16px; }
  #settings .tabs { padding-top: 0; }
  #settings .tabs button { min-height: 40px; padding: 6px 10px; }
  #settings .panel { padding-top: 6px; }
  #settings footer { display: none; }
}

#touch { position: fixed; z-index: 10; pointer-events: none;
  inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
#touch[hidden] { display: none; }
.tc-root { position: absolute; inset: 0; pointer-events: none; }
.tc { position: absolute; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  display: flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff4db; font: 700 15px system-ui, sans-serif;
  background: #242334d9; border: 2px solid #a9a1b9; box-sizing: border-box; }
.tc.down { background: #696080; border-color: #fff4db; }
.tc.latched { border-color: var(--ui-accent); color: var(--ui-accent); }
.tc-move { background: #24233480; }
.tc-move .knob { position: absolute; left: 50%; top: 50%; width: 42%; height: 42%; border-radius: 50%; background: #fff4dbcc;
  transform: translate(-50%, -50%); box-shadow: 0 2px 8px #0008; }
.tc-move.dpad .knob { display: none; }
.tc-move .arrow { position: absolute; font-size: 1.1em; color: #fff4dbcc; }
.tc-move .arrow.on { color: var(--ui-accent); }
.tc-root.editing .tc { cursor: grab; border-style: dashed; }
.tc-root.editing .tc.selected { border-color: var(--ui-accent); border-style: solid; box-shadow: 0 0 0 3px #ffcf5a66; }
.tc-root.editing .tc.hidden-control { opacity: 0.35; }
.tc-root.preview .tc { font-size: 13px; }
#touch-edit-bar { position: fixed; z-index: 25; left: 50%; top: max(8px, env(safe-area-inset-top)); transform: translateX(-50%);
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; width: max-content; max-width: calc(100vw - 16px);
  box-sizing: border-box; padding: 8px 10px; color: var(--ui-text); background: var(--ui-bg); border: 1px solid var(--ui-accent); border-radius: 14px; font: 13px/1.3 system-ui, sans-serif; }
#touch-edit-bar[hidden] { display: none; }
#touch-edit-bar .title { flex: 1 1 100%; text-align: center; color: var(--ui-dim); }

#toast { position: fixed; z-index: 40; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; width: max-content; max-width: calc(100vw - 24px); }
#toast div { color: var(--ui-text); background: var(--ui-bg); border: 1px solid var(--ui-line); border-radius: 10px; padding: 8px 12px;
  font: 13px/1.3 system-ui, sans-serif; box-shadow: 0 6px 20px #0008; }
`;

export function installStyles() {
  if (document.getElementById('ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'ui-styles';
  style.textContent = css;
  document.head.append(style);
}
