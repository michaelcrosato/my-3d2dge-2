import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import sharp from "sharp";
async function visibleShot(page, destination) {
  const size = page.viewportSize();
  for (let attempt = 0; attempt < 15; attempt++) {
    const buffer = await page.screenshot();
    const stats = await sharp(buffer)
      .extract({
        left: Math.floor(size.width * 0.3),
        top: Math.floor(size.height * 0.35),
        width: Math.floor(size.width * 0.4),
        height: Math.floor(size.height * 0.3),
      })
      .stats();
    if (stats.channels.slice(0, 3).some((c) => c.stdev > 8)) {
      await writeFile(destination, buffer);
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("The scene is blank.");
}
const root = fileURLToPath(new URL("../", import.meta.url)),
  module = process.env.GAME_PLAYWRIGHT_MODULE;
const pw = await import(
    module ? pathToFileURL(module).href : "playwright-core"
  ),
  output = process.env.GAME_OUTPUT || "/tmp/emberdeep-verify";
await mkdir(output, { recursive: true });
let server;
const offline = process.env.GAME_OFFLINE === "1";
let base = process.env.GAME_URL;
if (!base) {
  server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5181",
    ],
    { cwd: root, stdio: "ignore" },
  );
  base = "http://127.0.0.1:5181/";
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
}
const reports = [];
try {
  for (const engine of (process.env.GAME_ENGINES || "chromium").split(",")) {
    const launch = {
      timeout: 20000,
      executablePath: process.env[engine.toUpperCase() + "_PATH"] || undefined,
      headless: process.env[engine.toUpperCase() + "_HEADLESS"] !== "0",
    };
    if (engine === "chromium")
      launch.args = [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ];
    const browser = await pw[engine].launch(launch);
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        offline: offline && engine !== "webkit",
      });
      const page = await context.newPage(),
        errors = [],
        external = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("request", (r) => {
        if (offline && r.url().startsWith("http")) external.push(r.url());
      });
      if (offline) await context.route(/^https?:/, (r) => r.abort());
      const agentURL = new URL(base);
      agentURL.search = "?agent&seed=32";
      await page.goto(agentURL.href);
      await page.waitForFunction(() => window.agent?.ready, null, {
        timeout: 45000,
      });
      const contract = await page.evaluate(() => ({
        schema: agent.schema(),
        content: agent.content(),
      }));
      assert.equal(contract.content.tree.length, 54);
      const checkpoint = await page.evaluate(() => {
        const act = (c) => {
          const r = agent.act(c);
          if (!r.ok) throw new Error(r.error);
        };
        act({ type: "learn", id: "blade_0_0" });
        act({ type: "learn", id: "blade_1_0" });
        act({ type: "enter", depth: 4 });
        act({
          type: "input",
          value: { x: 1, z: -0.3, attack: true, dash: true },
        });
        agent.step(80);
        const cp = agent.checkpoint();
        agent.step(180);
        const expected = agent.observe().hash;
        agent.restore(JSON.parse(JSON.stringify(cp)));
        agent.step(180);
        return {
          expected,
          actual: agent.observe().hash,
          replay: agent.replay(
            JSON.parse(JSON.stringify(agent.exportReplay())),
          ),
        };
      });
      assert.equal(checkpoint.expected, checkpoint.actual);
      assert(checkpoint.replay.matches);
      const combat = await page.evaluate(() => {
        const p = agent.save();
        p.level = 1;
        p.xp = 0;
        p.kills = 0;
        p.inventory = [];
        p.equipped = { weapon: null, armor: null, charm: null };
        p.deepest = 1;
        agent.load(p);
        agent.act({ type: "enter", depth: 1 });
        agent.act({
          type: "tune",
          values: { playerDamage: 4, enemyHealth: 0.2, enemyDamage: 0.2 },
        });
        agent.act({ type: "auto", value: true });
        const state = agent.step(3000);
        const replay = agent.replay(
          JSON.parse(JSON.stringify(agent.exportReplay())),
        );
        return {
          depth: state.depth,
          kills: state.profile.kills,
          items: state.profile.inventory.length,
          hash: state.hash,
          replay: replay.matches,
        };
      });
      assert(combat.depth > 2);
      assert(combat.kills > 20);
      assert(combat.items > 0);
      assert(combat.replay);
      assert.equal(
        await page.evaluate(
          () => agent.act({ type: "input", value: { x: NaN, z: 0 } }).ok,
        ),
        false,
      );
      assert.equal(
        await page.evaluate(
          () => agent.act({ type: "camera", mode: "bad" }).ok,
        ),
        false,
      );
      for (const depth of [2, 3, 4, 12, 33, 102, 1000])
        await page.evaluate((d) => {
          agent.act({ type: "enter", depth: d });
          agent.step(20);
        }, depth);
      await page.evaluate(() => {
        agent.act({ type: "enter", depth: 4 });
        agent.act({ type: "auto", value: false });
        agent.act({ type: "input", value: { x: 0, z: 0, skill: "whirlwind" } });
        agent.step(4);
      });
      for (const mode of ["iso", "side", "top"]) {
        await page.evaluate(
          (m) => agent.act({ type: "camera", mode: m }),
          mode,
        );
        await visibleShot(page, path.join(output, `${engine}-${mode}.png`));
      }
      const ui = await context.newPage();
      ui.on("pageerror", (e) => errors.push(e.message));
      ui.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      const viewports = [
        [320, 568],
        [375, 667],
        [768, 1024],
        [1280, 720],
        [1920, 1080],
      ];
      for (const [width, height] of viewports) {
        await ui.setViewportSize({ width, height });
        await ui.goto(base);
        await ui.waitForFunction(() => window.agent?.ready, null, {
          timeout: 45000,
        });
        await ui.waitForFunction(() => !!document.querySelector(".ember-ui"));
        assert(
          await ui.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await visibleShot(
          ui,
          path.join(output, `${engine}-${width}x${height}.png`),
        );
        await ui.getByRole("button", { name: "Skills", exact: true }).click();
        assert(await ui.locator(".ember-card").isVisible());
        await ui.screenshot({
          path: path.join(output, `${engine}-tree-${width}.png`),
        });
        assert(
          await ui.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await ui.getByRole("button", { name: "×", exact: true }).click();
      }
      await ui.getByRole("button", { name: "Pause", exact: true }).click();
      await ui.getByLabel("playerDamage", { exact: true }).evaluate((el) => {
        el.value = "2.5";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      assert.equal(await ui.evaluate(() => game.run.tuning.playerDamage), 2.5);
      await ui
        .getByRole("button", { name: "Resume descent", exact: true })
        .click();
      assert.equal(await ui.evaluate(() => game.paused), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      const report = {
        engine,
        offline,
        checkpoint: true,
        combat,
        viewports: viewports.length,
        perspectives: 3,
        deepestChecked: 1000,
        errors,
      };
      reports.push(report);
      console.log(JSON.stringify(report));
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server?.kill("SIGTERM");
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(reports, null, 2),
  );
}
