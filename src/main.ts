import { EmberGame } from "./emberGame";
import { EmberUI } from "./ui/emberUI";
import { EmberAudio } from "./render/emberAudio";
import { freshProfile, parseProfile } from "./sim/progression";
const params = new URLSearchParams(location.search);
if (params.has("demo")) void import("./demo");
else
  void boot().catch((error) => {
    console.error(error);
    document.getElementById("loading")!.textContent =
      `Cannot start: ${String(error)}`;
    Object.assign(window, { agent: { ready: false, error: String(error) } });
  });
async function boot() {
  const agentMode = params.has("agent"),
    seed = Number(params.get("seed") ?? 1);
  if (!Number.isSafeInteger(seed)) throw new Error("Seed must be an integer.");
  let profile = freshProfile();
  if (!agentMode)
    try {
      const saved = localStorage.getItem("emberdeep.profile.v1");
      if (saved) profile = parseProfile(JSON.parse(saved));
    } catch {
      /* Invalid profiles start a fresh run. */
    }
  const game = new EmberGame(
    document.getElementById("view") as HTMLCanvasElement,
    seed,
    agentMode,
    profile,
  );
  await game.init();
  game.stage.pixelMode = !params.has("plain");
  document.getElementById("toolbar")!.hidden = true;
  document.getElementById("hud")!.hidden = true;
  document.getElementById("loading")!.remove();
  document.body.classList.toggle("agent-mode", agentMode);
  Object.assign(window, { game, agent: game.api() });
  if (params.has("depth"))
    game.act({ type: "enter", depth: Number(params.get("depth")) });
  if (params.has("auto")) game.act({ type: "auto", value: true });
  const ui = agentMode ? null : new EmberUI(game),
    audio = agentMode ? null : new EmberAudio(),
    keys = new Set<string>();
  let pointerAttack = false,
    aim: { x: number; z: number } | undefined;
  const clear = () => {
    keys.clear();
    pointerAttack = false;
    if (ui) {
      ui.touchAttack = false;
      ui.touchMove = { x: 0, z: 0 };
    }
    game.run.setIntent({ x: 0, z: 0 });
  };
  if (!agentMode) {
    window.addEventListener("keydown", (e) => {
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement)?.tagName,
        )
      )
        return;
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      )
        e.preventDefault();
      keys.add(e.code);
      if (e.repeat) return;
      audio?.unlock();
      if (e.code === "Escape") {
        if (ui!.panel.hidden) ui!.show("pause");
        else ui!.hide();
        return;
      }
      if (e.code === "KeyK") ui!.show("tree");
      if (e.code === "KeyI") ui!.show("inventory");
      if (e.code === "KeyT") game.act({ type: "town" });
      if (e.code === "KeyV") {
        const modes = ["iso", "side", "top"] as const;
        game.act({
          type: "camera",
          mode: modes[(modes.indexOf(game.run.camera) + 1) % 3],
        });
      }
      if (game.paused) return;
      const intent = { ...game.run.intent };
      if (e.code === "Space" || e.code === "ShiftLeft") intent.dash = true;
      if (e.code === "KeyQ") intent.potion = true;
      if (e.code === "KeyE") intent.interact = true;
      const slot = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (slot >= 0) intent.skill = game.run.profile.slots[slot];
      game.run.setIntent(intent);
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));
    window.addEventListener("pointerdown", (e) => {
      audio?.unlock();
      if ((e.target as HTMLElement).id === "view" && e.button === 0) {
        pointerAttack = true;
        aim = game.stage.pick(e.clientX, e.clientY);
      }
    });
    window.addEventListener("pointermove", (e) => {
      if ((e.target as HTMLElement).id === "view")
        aim = game.stage.pick(e.clientX, e.clientY);
    });
    window.addEventListener("pointerup", () => (pointerAttack = false));
    window.addEventListener("pointercancel", () => (pointerAttack = false));
    window.addEventListener("contextmenu", (e) => {
      if ((e.target as HTMLElement).id === "view") e.preventDefault();
    });
    window.addEventListener("blur", () => {
      clear();
      game.paused = true;
      game.saveLocal();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clear();
        game.paused = true;
        game.saveLocal();
      }
    });
  }
  let prev = performance.now(),
    uiAt = 0,
    stopped = false;
  let previousPadButtons: boolean[] = [];
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.15, (now - prev) / 1000);
    prev = now;
    if (game.ready && !agentMode) {
      if (!game.paused && !game.run.auto) {
        let x =
            Number(keys.has("KeyD") || keys.has("ArrowRight")) -
            Number(keys.has("KeyA") || keys.has("ArrowLeft")),
          z =
            Number(keys.has("KeyS") || keys.has("ArrowDown")) -
            Number(keys.has("KeyW") || keys.has("ArrowUp"));
        x += ui!.touchMove.x;
        z += ui!.touchMove.z;
        let attack = pointerAttack || keys.has("KeyJ") || ui!.touchAttack;
        const pad = navigator.getGamepads?.()[0];
        let intent = { ...game.run.intent };
        if (pad) {
          if (Math.abs(pad.axes[0]) > 0.15) x += pad.axes[0];
          if (Math.abs(pad.axes[1]) > 0.15) z += pad.axes[1];
          attack ||= !!pad.buttons[2]?.pressed;
          const buttons = pad.buttons.map((b) => b.pressed);
          if (buttons[0] && !previousPadButtons[0]) intent.dash = true;
          if (buttons[6] && !previousPadButtons[6]) intent.potion = true;
          for (const [i, button] of [3, 4, 5, 7].entries())
            if (buttons[button] && !previousPadButtons[button])
              intent.skill = game.run.profile.slots[i];
          previousPadButtons = buttons;
        }
        const dir = game.stage.moveDirection(x, z);
        intent = { ...intent, ...dir, attack, ...(aim ? { aim } : {}) };
        game.run.setIntent(intent);
      }
      game.update(dt);
      game.stage.draw(game.run);
      audio?.update(game.run);
      if (now - uiAt > 100) {
        ui?.update();
        uiAt = now;
      }
    }
  };
  if (!agentMode) game.setLoop(frame);
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      audio?.dispose();
      game.dispose();
    },
    { once: true },
  );
}
