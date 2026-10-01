# Emberdeep validation · 2026-10-01

## Executed checks

| Check | Result |
| --- | --- |
| `npm run check` | Typecheck and production build pass; 36 tests pass |
| `npm run build:standalone` | Single 23.9 MiB HTML file; code, WASM and retained demo assets embedded |
| Kernel regression tests | Twelve mechanic introductions, bounded seeded generation through depth 1,000,000, skill prerequisites, XP/gear/profile validation, enemy damage, roll stamina, combat rewards, exact mid-combat restore, atomic tuning validation |
| Chromium 154 headless shell | Command contract, JSON checkpoint restore, exact replay, autonomous progression, loot, deep rooms, three cameras and five viewport sizes pass; no console/page errors |
| WebKit 26.5 | Same game checks pass; no console/page errors |
| Automated combat fixture | Seed 32, 3,000 steps, player damage 4×, enemy health/damage 0.2×: reaches depth 8, kills 118 enemies, collects 48 items in both tested engines |
| Whole-game replay | Chromium hash `457e27c7`; WebKit hash `1161354a`; each replay matches its own browser’s recorded hash |
| Visible scene checks | Central screenshot pixels must show scene variation; screenshots inspected at 320×568, 375×667, 768×1024, 1280×720, and 1920×1080 |
| Skill and pause UI | Tree opens and closes without horizontal overflow; individual player damage tuning takes effect; resume clears pause |
| Offline original demo | Chromium and WebKit pass movement/release, jump, attacks, settings rebind/layout, pause/reset/resume, pixel/plain views; all 14 models load; zero HTTP requests or errors |
| Agent CLI | Four JSON operations against the standalone; 120 steps; exported replay matches |
| Renderer recovery | Injected renderer loss recreates the canvas and GL2 renderer; tick 80, player health and position remain unchanged; no errors |

Game screenshots and browser reports are external test artifacts. They are not committed. Runtime source and the offline deliverable are tracked. The same-repository PR workflow rebuilds the standalone, runs the build/unit gate, and pushes the result to the PR branch before merge.

## Platform limits

The two tested browser engines use software WebGL2 in this environment. The WebGPU-first renderer, common TSL shaders and loss recovery are implemented; physical hardware WebGPU and real iOS Safari are not verified here.

Native Firefox cannot complete its browser/display startup in this restricted environment. The virtual display also reports blocked local socket creation. Firefox runtime checks therefore remain unverified; do not infer a pass from the other engines. Chromium’s normal desktop build is blocked by its process-singleton socket; its matching headless shell works. The `agent-browser` daemon has the same startup restriction, so runtime evidence comes from direct Playwright checks.

Rapier snapshots and seeded simulation restore exactly in the tested engine. JavaScript math differs slightly across engines, so complete combat hashes can differ even when progression outcomes agree. Do not use a hash recorded in one browser as the reference for another.

WebKit’s browser-level offline flag rejects local file navigation. Its offline checks instead abort every HTTP/HTTPS request and assert that no external request occurs, matching the preserved demo verifier.
