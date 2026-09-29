// Downloads the free ("Standard") upload of a name-your-own-price itch.io page,
// following the same steps as the site's "No thanks, just take me to the downloads" flow.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function downloadItchStandard({ creator, slug, outFile, match = /standard/i, log = console.error }) {
  const base = `https://${creator}.itch.io/${slug}`;
  const jar = new Map();
  const request = async (url, init = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: {
        'user-agent': 'Mozilla/5.0 (3dpixel2d asset pipeline)',
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.headers || {}),
      },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    if (!res.ok) throw new Error(`itch: ${init.method || 'GET'} ${url} -> HTTP ${res.status}`);
    return res;
  };
  const csrfOf = (html) => {
    const m = /name="csrf_token" value="([^"]+)"/.exec(html);
    if (!m) throw new Error('itch: csrf token not found (page layout changed?)');
    return m[1];
  };
  const post = (url, csrf) => request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
    body: new URLSearchParams({ csrf_token: csrf }),
  }).then((r) => r.json());

  log(`[itch] ${slug}: opening download page`);
  const purchaseHtml = await (await request(`${base}/purchase`)).text();
  const { url: downloadPage } = await post(`${base}/download_url`, csrfOf(purchaseHtml));
  const pageHtml = await (await request(downloadPage)).text();

  const re = /data-upload_id="(\d+)"[\s\S]*?title="([^"]+)"/g;
  let m;
  let upload = null;
  while ((m = re.exec(pageHtml))) if (match.test(m[2])) { upload = { id: m[1], name: m[2] }; break; }
  if (!upload) throw new Error(`itch: no upload matching ${match} on ${slug}`);

  const file = await post(`${base}/file/${upload.id}?source=game_download`, csrfOf(pageHtml));
  if (!file.url) throw new Error(`itch: no file url for ${upload.name}: ${JSON.stringify(file)}`);
  log(`[itch] ${slug}: downloading "${upload.name}"`);
  const res = await fetch(file.url);
  if (!res.ok || !res.body) throw new Error(`itch: download failed HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, outFile);
  return { upload: upload.name, bytes: fs.statSync(outFile).size };
}
