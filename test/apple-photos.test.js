'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplePhotos } = require('../main-lib/apple-photos');
(async () => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fly-photos-test-'));
 let authorized = false, blocked = false, importFail = false, reads = [], imports = [], ids = ['a','b'];
 let downloadedFail = new Set(['b']);
 const bridge = async request => {
  if (request.mode === 'authorize') return { ok: authorized };
  if (request.mode === 'scan') { reads.push(request.known); return { ok:true, total:ids.length, ids:ids.filter(id=>!request.known.includes(id)) }; }
  return { ok:true, files:request.ids.filter(id=>!downloadedFail.has(id)).map(id=>({id,path:path.join(request.directory,id+'.jpg')})), errors:request.ids.filter(id=>downloadedFail.has(id)).map(id=>({id,error:'download failed'})) };
 };
 const options = { directory, platform:'darwin', bridge, busy:()=>blocked, importFiles:async paths=> { imports.push(paths); return { errors:importFail ? [{error:'disk full'}] : [], added:paths, skipped:[] }; } };
 const controller = createApplePhotos(options);
 try {
  await assert.rejects(controller.connect(), /允许.*访问全部照片/);
  assert.equal(controller.snapshot().enabled,false);
  authorized = true; blocked = true;
  await controller.connect(); assert.equal(controller.snapshot().phase,'waiting');
  blocked = false; await controller.sync();
  assert.equal(controller.snapshot().indexed,1); assert.equal(controller.snapshot().failed,1);
  downloadedFail.clear(); importFail = true; await controller.sync();
  assert.equal(controller.snapshot().indexed,1,'failed imports must not advance checkpoint');
  importFail = false; await controller.sync(); assert.equal(controller.snapshot().indexed,2);
  const recovered = createApplePhotos(options); ids.push('c');
  await recovered.sync(); assert.deepEqual(reads.at(-1),['a','b']); assert.equal(recovered.snapshot().indexed,3);
  recovered.pause(); const before=imports.length; await recovered.sync(); assert.equal(imports.length,before);
  controller.stop(); recovered.stop();
  console.log('PASS: permission denial, busy deferral, download/import retry, durable resume, new assets, pause');
 } finally { fs.rmSync(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
