// Run with ELECTRON_RUN_AS_NODE=1 <packaged SCM executable> this-file <app.asar>.
const assert = require('node:assert/strict');
const path = require('node:path');
const sharp = require(path.join(process.argv[2], 'node_modules/sharp'));
const { parseGps } = require(path.join(process.argv[2], 'main-lib/photo-location'));
(async () => {
 const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } }).withMetadata({ exif: { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 13/1 49/1', GPSLongitudeRef: 'E', GPSLongitude: '121/1 28/1 25/1' } } }).jpeg().toBuffer();
 const result = parseGps((await sharp(jpeg).metadata()).exif);
 assert(result && Math.abs(result.lat - 31.2302777778) < 1e-8 && Math.abs(result.lng - 121.4736111111) < 1e-8);
 const plain = await sharp(jpeg).jpeg().toBuffer(); assert.equal(parseGps((await sharp(plain).metadata()).exif), null);
 console.log('PASS: packaged sharp / GPS module read real JPEG coordinates and reject stripped metadata');
})().catch(e => { console.error(e); process.exitCode = 1; });
