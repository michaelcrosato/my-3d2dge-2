# my-3d2dge-2

A browser game demo that renders 3D characters as pixel art, built with TypeScript, Three.js r186, Rapier 0.20 physics and Vite. Includes rebindable keyboard/mouse, gamepad and touch controls, switchable settings profiles, a plain 3D view, deterministic simulation stepping, and a self-contained HTML build.

The application lives at the repository root. Run application commands from the root. Node.js 22.12+ (Node 22 recommended) and npm are required.

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open http://localhost:5173. Default controls: WASD or arrow keys move, Shift sprints, Alt walks, Space jumps, J or left click attacks, right click walks to the pointer. Esc opens Settings (and pauses), `` ` `` pauses, R resets, P switches pixel/3D, F3 shows performance stats. Gamepads use the left stick, A to jump, X to attack, RT to sprint and Menu for Settings. Phones and tablets get an on-screen stick (or 8-way pad) with Jump, Attack and Sprint buttons.

## Settings and controls

The ⚙ button (or Esc / gamepad Menu) opens Settings. Everything is stored per **profile**; Standard, Left-handed, Performance and Smooth 3D profiles are built in, and profiles can be created from a template, duplicated, renamed, deleted, exported to JSON and imported again. Changes apply immediately and are saved in the browser's local storage when it is available.

- **Graphics**: every rendering and animation option, plus game speed.
- **Keyboard & mouse**: up to four keys or mouse buttons per action; binding a key that another action uses moves it. Sprint can hold or toggle.
- **Gamepad**: rebind buttons and stick directions, choose the movement stick, deadzone, analog speed and vibration; a live tester shows sticks and buttons. The D-pad, A, B, LB and RB navigate Settings.
- **Touch**: show controls automatically, always or never; analog stick (optionally floating) or 8-way pad; size, opacity, sprint toggle and vibration. The 9:16 portrait and 16:9 landscape layouts are separate and edited by dragging controls in the previews, or on screen with **Edit on screen**.

`?agent` mode ignores saved settings and human input so automated runs always start from the documented defaults.

## Commands

| Command (from the repository root) | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript validation |
| `npm run test` | Vitest unit tests (Rapier physics and queries, input profiles, bindings and input math) |
| `npm run check` | TypeScript validation, production build and unit tests; also runs in CI |
| `npm run build` | Build the web app into `dist/` |
| `npm run build:standalone` | Rebuild the committed single-file game |
| `npm run verify:standalone` | Exercise the offline game in Chromium, WebKit and Firefox; requires Python Playwright and installed browsers |
| `npm run assets` | Download source packs and rebuild runtime assets (requires network) |

Unit tests live in `tests/` and run in Node as part of `npm run check`. The browser interaction verifier (touch controls, settings, rebinding, rendering modes, offline loading in three engines) is separate from CI.

## Layout

- `src/sim/`: simulation, Rapier physics and queries, navigation and seeded RNG.
- `src/render/`: assets, character animation, stage and pixel rendering.
- `src/content/`: character presets and level data.
- `src/input/`: actions, settings profiles and storage, input math and the keyboard/mouse/gamepad/touch controller.
- `src/ui/`: settings dialog, touch overlay and layout editor, HUD, toasts and styles.
- `src/main.ts`, `src/game.ts`, `src/config.ts`: boot, game coordination and configuration.
- `tests/`: Vitest unit tests.
- `public/assets/`: committed runtime models, animations and manifest.
- `tools/`: asset preparation, standalone bundling and browser verification.
- `standalone/`: shareable HTML game and usage notes.

For browser automation, open `/?agent&seed=1`, wait for `window.agent.ready`, and call `window.agent.step(frames)`. This mode starts paused with human input disabled. `window.game` exposes the game object; inspect the source for supported methods. A broader agent CLI or MCP server is not implemented.

The standalone HTML embeds runtime libraries and assets; see [standalone instructions](standalone/README.md). Keep it in sync after runtime or asset changes.

## Contributing with agents

Read [AGENTS.md](AGENTS.md) first and follow the [agent coding SOP](docs/AGENTIC-CODING-SOP.md). CI checks pushes and pull requests on `main`.

Quaternius models and animations carry the included [CC0 asset notice](public/assets/LICENSE-quaternius.txt). This repository does not declare a separate license for its application source.
