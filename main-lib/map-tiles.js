"use strict";
const fs = require('node:fs/promises');
const path = require('node:path');
function createTileLoader(directory, fetchTile = fetch) {
 const pending = new Map();
 return async function tile(urlPath) {
  const m = /^\/map-tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(urlPath);
  if (!m) return new Response(null, { status: 400 });
  const [z, x, y] = m.slice(1).map(Number);
  if (z > 18 || x >= 2 ** z || y >= 2 ** z) return new Response(null, { status: 400 });
  const key = `${z}-${x}-${y}`, file = path.join(directory, key + '.png');
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' };
  try {
   const stat = await fs.stat(file);
   if (Date.now() - stat.mtimeMs < 7 * 86400000) return new Response(await fs.readFile(file), { headers });
  } catch {}
  if (!pending.has(key)) {
   const job = (async () => {
    try {
     const response = await fetchTile(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { 'User-Agent': 'SCM-Shiguang/0.2.7 (desktop photo map)' }, signal: AbortSignal.timeout(15000) });
     if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) throw Error('tile');
     const bytes = Buffer.from(await response.arrayBuffer());
     if (bytes.length > 2e6) throw Error('size');
     await fs.mkdir(directory, { recursive: true }); await fs.writeFile(file, bytes); return bytes;
    } catch { try { return await fs.readFile(file); } catch { return null; } }
   })().finally(() => pending.delete(key)); pending.set(key, job);
  }
  const bytes = await pending.get(key);
  return new Response(bytes, { status: bytes ? 200 : 503, headers });
 };
}
module.exports = { createTileLoader };
