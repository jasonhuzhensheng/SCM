"use strict";
const fs = require('node:fs/promises');
const path = require('node:path');
// EXIF TIFF GPS fields. Reject malformed offsets, rational values and coordinates.
function parseGps(exif) {
 try {
  if (!Buffer.isBuffer(exif)) return null;
  const b = exif.subarray(exif.subarray(0, 6).equals(Buffer.from('Exif\0\0')) ? 6 : 0);
  const order = b.toString('ascii', 0, 2); if (order !== 'II' && order !== 'MM') return null;
  const u16 = p => order === 'II' ? b.readUInt16LE(p) : b.readUInt16BE(p);
  const u32 = p => order === 'II' ? b.readUInt32LE(p) : b.readUInt32BE(p);
  if (u16(2) !== 42) return null;
  function entries(offset) {
   if (offset < 8) throw Error('offset');
   const n = u16(offset); if (n > 1024 || offset + 2 + n * 12 + 4 > b.length) throw Error('bounds');
   const result = new Map();
   for (let i = 0; i < n; i++) { const p = offset + 2 + i * 12; result.set(u16(p), { type: u16(p + 2), count: u32(p + 4), p: p + 8 }); }
   return result;
  }
  const pointer = entries(u32(4)).get(0x8825);
  if (!pointer || pointer.type !== 4 || pointer.count !== 1) return null;
  const gps = entries(u32(pointer.p));
  function coordinate(valueTag, refTag, positive, negative, max) {
   const v = gps.get(valueTag), r = gps.get(refTag);
   if (!v || v.type !== 5 || v.count !== 3 || !r || r.type !== 2 || r.count !== 2) throw Error('type');
   const ref = b.toString('ascii', r.p, r.p + 1); if (ref !== positive && ref !== negative) throw Error('ref');
   const at = u32(v.p); const parts = [0, 8, 16].map(off => { const den = u32(at + off + 4); if (!den) throw Error('denominator'); return u32(at + off) / den; });
   if (parts[1] >= 60 || parts[2] >= 60) throw Error('minutes');
   const value = parts[0] + parts[1] / 60 + parts[2] / 3600;
   if (!Number.isFinite(value) || value > max) throw Error('range');
   return value * (ref === negative ? -1 : 1);
  }
  return { lat: coordinate(2, 1, 'N', 'S', 90), lng: coordinate(4, 3, 'E', 'W', 180) };
 } catch { return null; }
}
function createLocationIndex({ directory, cachePath, metadata }) {
 let cache, queue = Promise.resolve();
 return (names) => {
  const job = queue.then(async () => {
   if (!cache) { try { cache = JSON.parse(await fs.readFile(cachePath, 'utf8')); } catch { cache = {}; } }
   const locations = [], errors = [];
   for (const filename of names) {
    if (path.basename(filename) !== filename || !/\.(jpe?g|png|webp|tiff?|heic|heif|avif)$/i.test(filename)) continue;
    try {
     const file = path.join(directory, filename), stat = await fs.stat(file);
     const key = `${stat.size}:${stat.mtimeMs}`;
     if (!cache[filename] || cache[filename].key !== key) cache[filename] = { key, location: parseGps((await metadata(file)).exif) };
     if (cache[filename].location) locations.push({ filename, ...cache[filename].location });
    } catch { errors.push(filename); }
   }
   await fs.mkdir(path.dirname(cachePath), { recursive: true });
   await fs.writeFile(cachePath + '.tmp', JSON.stringify(cache)); await fs.rename(cachePath + '.tmp', cachePath);
   return { locations, errors };
  });
  queue = job.catch(() => {}); return job;
 };
}
module.exports = { parseGps, createLocationIndex };
