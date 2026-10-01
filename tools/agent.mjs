/** JSON in/out client. No UI selectors are needed to control the game. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const argv = process.argv.slice(2),
  get = (key, fallback) => {
    const i = argv.indexOf(key);
    return i < 0 ? fallback : argv[i + 1];
  };
const module = process.env.GAME_PLAYWRIGHT_MODULE;
const { chromium } = await import(
  module ? pathToFileURL(module).href : "playwright-core"
);
const seed = get("--seed", "1"),
  url = new URL(get("--url", "http://127.0.0.1:5173/"));
url.searchParams.set("agent", "");
url.searchParams.set("seed", seed);
const operations = JSON.parse(
  get("--file", null)
    ? await readFile(get("--file"), "utf8")
    : get("--commands", '[{"op":"observe"}]'),
);
const args = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args,
});
try {
  const page = await browser.newPage();
  await page.goto(url.href);
  await page.waitForFunction(() => window.agent?.ready, null, {
    timeout: 30000,
  });
  for (const operation of operations) {
    const result = await page.evaluate((op) => {
      const a = window.agent;
      switch (op.op) {
        case "schema":
          return a.schema();
        case "content":
          return a.content();
        case "observe":
          return a.observe();
        case "step":
          return a.step(op.frames ?? 1);
        case "events":
          return a.events(op.after ?? 0);
        case "save":
          return a.save();
        case "load":
          return a.load(op.profile);
        case "replay":
          return a.replay(op.tape);
        case "replayCheck":
          return a.replay(a.exportReplay());
        case "act":
          return a.act(op.command);
        default:
          throw new Error("Unknown operation");
      }
    }, operation);
    console.log(JSON.stringify(result));
  }
  if (get("--screenshot", null))
    await page.screenshot({ path: get("--screenshot") });
} finally {
  await browser.close();
}
