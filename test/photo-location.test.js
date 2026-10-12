'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseGps, createLocationIndex } = require('../main-lib/photo-location');
function fixture(little, south = false) {
 const b = Buffer.alloc(128); b.write(little ? 'II' : 'MM');
 const w16 = (n, p) => little ? b.writeUInt16LE(n, p) : b.writeUInt16BE(n, p);
 const w32 = (n, p) => little ? b.writeUInt32LE(n, p) : b.writeUInt32BE(n, p);
 w16(42, 2); w32(8, 4); w16(1, 8);
 function entry(p, tag, type, count, value) { w16(tag, p); w16(type, p + 2); w32(count, p + 4); w32(value, p + 8); }
 entry(10, 0x8825, 4, 1, 26); w16(4, 26);
 entry(28, 1, 2, 2, 0); b.write(south ? 'S' : 'N', 36);
 entry(40, 2, 5, 3, 80);
 entry(52, 3, 2, 2, 0); b.write(south ? 'W' : 'E', 60);
 entry(64, 4, 5, 3, 104);
 [31, 13, 49, 121, 28, 25].forEach((n, i) => { w32(n, 80 + i * 8); w32(1, 84 + i * 8); }); return b;
}
(async () => {
 for (const little of [true, false]) for (const south of [false, true]) {
  const b = fixture(little, south), gps = parseGps(Buffer.concat([Buffer.from('Exif\0\0'), b]));
  const sign = south ? -1 : 1;
  assert(Math.abs(gps.lat - sign * (31 + 13 / 60 + 49 / 3600)) < 1e-8);
  assert(Math.abs(gps.lng - sign * (121 + 28 / 60 + 25 / 3600)) < 1e-8);
 }
 for (let n = 0; n < 128; n++) assert.equal(parseGps(fixture(true).subarray(0, n)), null);
 const zero = fixture(true); zero.writeUInt32LE(0, 84); assert.equal(parseGps(zero), null);
 const invalid = fixture(true); invalid.writeUInt32LE(91, 80); assert.equal(parseGps(invalid), null);
 assert.equal(parseGps(Buffer.alloc(200)), null); assert.equal(parseGps(undefined), null);
 const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scm-gps-'));
 try {
  await fs.writeFile(path.join(tmp, 'a.jpg'), 'one'); await fs.writeFile(path.join(tmp, 'b.jpg'), 'two');
  let reads = 0; const options = { directory: tmp, cachePath: path.join(tmp, 'cache.json'), metadata: async file => { reads++; return { exif: file.endsWith('a.jpg') ? fixture(true) : undefined }; } };
  let index = createLocationIndex(options);
  let result = await index(['a.jpg', 'b.jpg', '../outside.jpg', 'missing.jpg']); assert.equal(result.locations.length, 1); assert.deepEqual(result.errors, ['missing.jpg']); assert.equal(reads, 2);
  index = createLocationIndex(options); await index(['a.jpg', 'b.jpg']); assert.equal(reads, 2, 'persistent cache includes no-GPS photos');
  await fs.writeFile(path.join(tmp, 'a.jpg'), 'changed'); await index(['a.jpg']); assert.equal(reads, 3, 'changed photo reread');
  await fs.unlink(path.join(tmp, 'a.jpg')); result = await index(['a.jpg']); assert.equal(result.locations.length, 0, 'deleted photo not returned');
 } finally { await fs.rm(tmp, { recursive: true, force: true }); }
 const ts = require('typescript'), vm = require('node:vm');
 const source = await fs.readFile(path.join(__dirname, '../src/simple/geo.ts'), 'utf8');
 const context = { exports: {} }; vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
 const { distanceKm, project, unproject } = context.exports;
 assert.equal(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
 assert(Math.abs(distanceKm({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }) - 22.239) < .01);
 assert(Math.abs(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }) - 20015.1) < .1);
 for (const p of [{ lat: 31.23, lng: 121.47 }, { lat: -34, lng: -58 }, { lat: 80, lng: 179.9 }]) { const xy = project(p, 12), q = unproject(xy.x, xy.y, 12); assert(distanceKm(p, q) < 1e-7); }
 console.log('GPS endian, corruption, cache invalidation, deletion and geographic distance tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
