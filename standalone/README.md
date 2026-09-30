# Standalone phone build

`3dpixel2d.html` is the complete game (about 23 MiB). Copy or share that one file to your phone and open it in a browser that supports WebGL 2. No asset folders, package installation, CDN, or development server are needed by the game. A file preview that does not execute JavaScript cannot play it; open it as a web page instead. The same file can also be served by any static web host.

Drag the on-screen stick to move, hold Sprint while moving, and tap Jump or Attack. Pixel / 3D switches rendering; Pause, Reset and ⚙ Settings are at the top. Settings holds switchable profiles, graphics options, and rebindable keyboard/mouse, gamepad and touch controls, including separate portrait (9:16) and landscape (16:9) touch layouts that you can drag into place. Keyboard, mouse and gamepads work on desktop.

Rebuild from the project directory with `npm run build:standalone`. This embeds all 14 models, animation libraries, the manifest, Three.js and Rapier's WebAssembly into the HTML.

Verification: `python3 tools/verify-standalone.py` uses the machine's installed Playwright browsers. It opens the local HTML with network access disabled or HTTP(S) requests blocked and exercises touch movement/release, jump, combat, rebinding a key in Settings, the on-screen layout editor, pause/reset/resume, both rendering modes and every model. WebKit's offline emulation rejects file navigation, so that engine uses request blocking instead. Viewport screenshots can be generated with `viewport-matrix file:///ABSOLUTE/PATH/standalone/3dpixel2d.html -o /tmp/pixel-standalone-matrix`.

Browser emulation covers Chromium, Firefox and WebKit, including phone and tablet layouts. Real phone hardware and iOS file-opening behavior have not been tested.
