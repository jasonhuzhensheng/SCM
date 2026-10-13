const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { createPhotoQualityIndex } = require('../main-lib/photo-quality');
(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sayphoto-quality-test-'));
 try {
  for (const n of ['a.jpg','b.jpg','bad.jpg']) await fs.writeFile(path.join(root,n),n);
  let calls=0;
  const options={directory:root,cachePath:path.join(root,'cache.json'),evaluate:async files=>{calls++;return files.map(f=>path.basename(f)==='bad.jpg'?{error:'bad'}:{score:path.basename(f)==='a.jpg'?0.9:-0.5});}};
  let read=createPhotoQualityIndex(options);
  const first=await read(['a.jpg','b.jpg','bad.jpg','missing.jpg']);
  assert.equal(first['a.jpg'].score,.9);assert(first['bad.jpg'].error);assert(first['missing.jpg'].error);
  await read(['a.jpg','b.jpg']);assert.equal(calls,1);
  read=createPhotoQualityIndex(options);await read(['a.jpg']);assert.equal(calls,1);
  await fs.appendFile(path.join(root,'a.jpg'),'changed');await read(['a.jpg']);assert.equal(calls,2);
  await assert.rejects(read(['../outside']));await assert.rejects(read(Array(17).fill('a.jpg')));
  await read(['bad.jpg']);assert.equal(calls,3);
  const changing=createPhotoQualityIndex({...options,cachePath:path.join(root,'changing.json'),evaluate:async files=>{await fs.appendFile(files[0],'x');return [{score:1}];}});
  assert((await changing(['a.jpg']))['a.jpg'].error);
  const invalid=createPhotoQualityIndex({...options,cachePath:path.join(root,'invalid.json'),evaluate:async()=>[{score:NaN}]});
  assert((await invalid(['a.jpg']))['a.jpg'].error);
  const failing=createPhotoQualityIndex({...options,cachePath:path.join(root,'fail.json'),evaluate:async()=>{throw Error('unavailable');}});
  await assert.rejects(failing(['a.jpg']),/unavailable/);
  await fs.writeFile(path.join(root,'corrupt.json'),'bad');
  await assert.rejects(createPhotoQualityIndex({...options,cachePath:path.join(root,'corrupt.json')})(['a.jpg']),/缓存/);
  const ctx={exports:{}};
  vm.runInNewContext(ts.transpileModule(await fs.readFile(path.join(__dirname,'../src/simple/qualityRanking.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx);
  const records={high:{score:.9},low:{score:-1},zero:{score:0},bad:{error:'failed'},invalid:{score:NaN},equal:{score:.9}};
  assert.deepEqual(['low','pending','zero','high','bad','invalid','equal'].sort((a,b)=>ctx.exports.comparePhotoQuality(a,b,records)),['equal','high','zero','low','bad','invalid','pending']);
  assert.deepEqual(['low','pending','zero','high','bad','invalid','equal'].sort((a,b)=>ctx.exports.comparePhotoQuality(a,b,records,true)),['low','zero','equal','high','bad','invalid','pending']);
  assert.equal(ctx.exports.qualityLabel({score:-1}),'AI 优选 0.0 分');
  console.log('PASS quality: cache/restart/invalidation, failures/retry, changed files, bounds/path validation, ascending/descending scores and unknowns last');
 } finally {await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
