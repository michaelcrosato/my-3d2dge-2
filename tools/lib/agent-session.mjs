/**
 * A headless game session for agent tooling (shared by tools/agent-cli.mjs and
 * tools/mcp-server.mjs): starts the game in Chromium in `?agent` mode and calls the in-game tool
 * registry (`window.agent.call`). Images come back as PNG data URLs and are written to an output
 * folder.
 *
 * Targets, in order of preference:
 *   url         an already running server (e.g. `npm run dev` -> http://127.0.0.1:5173/)
 *   standalone  the single-file build (standalone/3dpixel2d.html, no server needed)
 *   default     starts Vite in-process from the repository root (always the current source)
 *
 * Browser: playwright-core's Chromium with SwiftShader WebGL (works headless without a GPU).
 * `CHROMIUM_PATH` overrides the executable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class AgentSession {
  /**
   * @param {{ url?: string, standalone?: boolean, seed?: number, out?: string, headed?: boolean,
   *   width?: number, height?: number, log?: (msg: string) => void }} o
   */
  constructor(o = {}) {
    this.o = { seed: 1, out: path.join(ROOT, '.agent', 'out'), width: 960, height: 540, log: () => {}, ...o };
    this.browser = null;
    this.page = null;
    this.vite = null;
    this.ready = null;
    this.errors = [];
    this.counter = 0;
  }

  /** Boots once; concurrent callers share the same promise. */
  start() {
    this.ready ??= this.boot().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async boot() {
    const t0 = Date.now();
    let base = this.o.url;
    if (!base && this.o.standalone) {
      const file = path.join(ROOT, 'standalone', '3dpixel2d.html');
      if (!fs.existsSync(file)) throw new Error('standalone/3dpixel2d.html is missing: run npm run build:standalone');
      base = pathToFileURL(file).href;
    }
    if (!base) {
      const { createServer } = await import('vite');
      this.vite = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'error', server: { port: 5190, strictPort: false, host: '127.0.0.1' } });
      await this.vite.listen();
      base = this.vite.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5190/';
    }
    const url = new URL(base);
    url.searchParams.set('agent', '');
    url.searchParams.set('seed', String(this.o.seed));
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.launch({
      headless: !this.o.headed,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    });
    this.page = await this.browser.newPage({ viewport: { width: this.o.width, height: this.o.height } });
    this.page.on('pageerror', (e) => {
      this.errors.push(e.message);
      this.o.log(`page error: ${e.message}`);
    });
    this.page.on('console', (m) => m.type() === 'error' && this.o.log(`console: ${m.text().slice(0, 400)}`));
    this.page.on('crash', () => {
      this.o.log('page crashed; the next call restarts the game');
      this.ready = null;
    });
    await this.page.goto(url.href);
    await this.page.waitForFunction(() => window.agent?.ready || window.agent?.error, null, { timeout: 180000 });
    const err = await this.page.evaluate(() => window.agent.error ?? null);
    if (err) throw new Error(`game failed to boot: ${err}`);
    this.o.log(`game ready in ${((Date.now() - t0) / 1000).toFixed(1)} s at ${url.href}`);
  }

  async tools() {
    await this.start();
    return this.page.evaluate(() => window.agent.tools());
  }

  /**
   * Calls a tool. Returns { ok, data | error, images: [{ name, path, width, height, base64 }], ms }.
   * Image references in `data` ("image:<name>") are replaced by the written file paths.
   */
  async call(name, args = {}) {
    await this.start();
    const r = await this.page.evaluate(([n, a]) => window.agent.call(n, a), [name, args]);
    const images = [];
    if (r.ok && r.images?.length) {
      fs.mkdirSync(this.o.out, { recursive: true });
      const stamp = `${String(++this.counter).padStart(3, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}`;
      const refs = {};
      for (const im of r.images) {
        const base64 = im.png.split(',')[1];
        const file = path.join(this.o.out, `${stamp}-${im.name}.png`);
        fs.writeFileSync(file, Buffer.from(base64, 'base64'));
        refs[`image:${im.name}`] = file;
        images.push({ name: im.name, path: file, width: im.width, height: im.height, base64 });
      }
      r.data = JSON.parse(JSON.stringify(r.data ?? null), (_k, v) => (typeof v === 'string' && refs[v] ? refs[v] : v));
    }
    delete r.images;
    return { ...r, images };
  }

  async close() {
    await this.browser?.close().catch(() => {});
    await this.vite?.close().catch(() => {});
    this.browser = this.page = this.vite = null;
    this.ready = null;
  }
}

/** Parses CLI-style arguments: a JSON object, or key=value pairs (values parsed as JSON when possible). */
export function parseArgs(parts) {
  if (!parts.length) return {};
  const joined = parts.join(' ').trim();
  if (joined.startsWith('{')) return JSON.parse(joined);
  const out = {};
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) throw new Error(`expected key=value or a JSON object, got "${p}"`);
    const k = p.slice(0, i), v = p.slice(i + 1);
    try {
      out[k] = JSON.parse(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}
