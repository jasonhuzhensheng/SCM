'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {restoreLockedPhotos}=require('../main-lib/photos-restore');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'photos-restore-test-'));
 try{
  const name='45183D47-DA7A-4E35-B9F7-538D28D40947.jpeg',id=name.split('.')[0]+'/L0/001',source='/test.photoslibrary/originals/4/'+name;
  const library={filenames:[name],sources:[source]},original=JSON.stringify(library),locks=new Set([name]);let calls=0;
  const args={names:[name],library,isLocked:n=>locks.has(n),directory:root,bridge:async r=>{calls++;assert.deepEqual(r.ids,[id]);return {ok:true,restored:r.ids,verified:r.ids};}};
  const r=await restoreLockedPhotos(args);assert.deepEqual(r.restored,[id]);assert.equal(JSON.stringify(library),original);assert(locks.has(name));assert.equal(JSON.parse(fs.readFileSync(path.join(root,fs.readdirSync(root)[0]))).confirmed,true);
  const receiptCount=fs.readdirSync(root).length;await restoreLockedPhotos({...args,checkOnly:true});assert.equal(fs.readdirSync(root).length,receiptCount);
  const before=calls;for(const names of [[],['missing'],[name,name],['../x']])await assert.rejects(restoreLockedPhotos({...args,names}));locks.clear();await assert.rejects(restoreLockedPhotos(args),/锁定/);assert.equal(calls,before);
  locks.add(name);await assert.rejects(restoreLockedPhotos({...args,bridge:async()=>({ok:false,error:'权限不足'})}),/权限不足/);
  await assert.rejects(restoreLockedPhotos({...args,bridge:async()=>({ok:true,verified:['another']})}),/身份不匹配/);
  assert.equal(JSON.stringify(library),original);assert(locks.has(name));
  console.log('PASS: exact locked identity only, audit receipt, check-only has no mutation, malformed/unlocked/foreign ID/permission failure refused; index and locks untouched.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
