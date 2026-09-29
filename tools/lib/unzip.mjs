// Minimal zero-dependency ZIP reader (stored + deflate, no zip64).
// Enough for the Quaternius packs; keeps the asset pipeline portable (no system unzip/tar needed).
import zlib from 'node:zlib';

/** @returns {{name:string, method:number, compSize:number, size:number, localOff:number}[]} */
export function listZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end-of-central-directory not found (not a zip?)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, size, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(buf, entry) {
  const lh = entry.localOff;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`zip: bad local header for ${entry.name}`);
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`zip: unsupported compression method ${entry.method} (${entry.name})`);
}
