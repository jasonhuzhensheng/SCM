const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTileLoader } = require('../main-lib/map-tiles');
(async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scm-tile-')); let requests = 0;
 try {
  const loader = createTileLoader(dir, async (url, options) => { requests++; assert.equal(url, 'https://tile.openstreetmap.org/2/1/1.png'); assert.match(options.headers['User-Agent'], /SCM-Shiguang/); return new Response('tile', { headers: { 'Content-Type': 'image/png' } }); });
  for (const p of ['/map-tiles/19/0/0.png', '/map-tiles/2/4/0.png', '/map-tiles/../../x']) assert.equal((await loader(p)).status, 400);
  assert.equal(requests, 0); const result = await Promise.all([loader('/map-tiles/2/1/1.png'), loader('/map-tiles/2/1/1.png')]); assert.equal(requests, 1); assert.equal(await result[0].text(), 'tile');
  await loader('/map-tiles/2/1/1.png'); assert.equal(requests, 1);
  const offline = createTileLoader(dir, async () => { throw Error('offline'); }); assert.equal((await offline('/map-tiles/2/0/0.png')).status, 503);
  await fs.utimes(path.join(dir, '2-1-1.png'), new Date(0), new Date(0)); assert.equal(await (await offline('/map-tiles/2/1/1.png')).text(), 'tile');
 } finally { await fs.rm(dir, { recursive: true, force: true }); }
 console.log('Map tile bounds, identification, cache, deduplication and offline tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
