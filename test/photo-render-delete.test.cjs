'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {photoSourceIdentity,photosOriginal,createPhotoDeletion}=require('../main-lib/photo-deletion');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'photo-render-delete-'));
 try {
  const uuid='918AD1FE-57E1-41A8-A8D1-AC166D55A757';
  const library=path.join(root,'Fixture.photoslibrary');
  const render=path.join(library,'resources/renders/9',uuid+'_2_0_a.mov');
  const original=path.join(library,'originals/9',uuid+'.HEIC');
  fs.mkdirSync(path.dirname(render),{recursive:true});fs.writeFileSync(render,'edited-video');
  assert.deepEqual(photoSourceIdentity(render),photoSourceIdentity(original));
  assert.equal((await photosOriginal(render)).uuid,uuid);
  for(const file of [render.replace('/renders/','/thumbnails/'),render.replace('_2_0_a','_bogus'),render.replace(uuid,'bad-id')]) {
   assert.equal(photoSourceIdentity(file),null);
  }
  const stat=fs.lstatSync(render),sig=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  let reject=true,confirmed=false;const calls=[];
  const deletion=createPhotoDeletion({directory:root,bridge:async request=>{
   calls.push(request.mode);
   if(request.mode==='verify-delete') {
    assert.equal(request.uuid,uuid);
    if(reject)throw Error('Apple照片资源与原文件内容不一致，未删除');
    return {ok:true,id:uuid+'/L0/001',resources:[{size:12,hash:request.hash},{size:20,hash:'original'}]};
   }
   return {ok:true,verified:confirmed};
  }});
  let journal={};
  await assert.rejects(deletion.remove(render,sig,journal,()=>{}),/内容不一致/);
  assert.equal(journal.photos,undefined);assert.deepEqual(calls,['verify-delete']);
  reject=false;
  await assert.rejects(deletion.remove(render,sig,journal,()=>{}),/结果还需核对/);
  assert.equal(journal.photos.requested,true);
  // Successful PhotoKit commits can remove the entire renders directory before
  // the app resumes. Recovery must consult its receipt without resolving it.
  fs.rmSync(path.dirname(render),{recursive:true});confirmed=true;
  assert.equal((await deletion.remove(render,sig,journal,()=>{})).size,32);
  assert.equal(calls.at(-1),'delete-outcome');
  assert.equal(calls.filter(x=>x==='delete-verified').length,1);

  fs.mkdirSync(path.dirname(render),{recursive:true});fs.writeFileSync(render,'edited-video');
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const names=['render.mov','original.heic','unrelated.jpg'];
  const sources=[render,original,path.join(root,'unrelated.jpg')];
  let removed=[],suppressed=[],saves=0,allow=false;
  const ctx={fs,path,AbortController,photoSourceIdentity,photosOriginal,isPhotosPath:s=>s.includes('.photoslibrary/'),
   PHOTOS_DIR:path.join(root,'references'),assetLocks:new Set(),filesLocked:()=>false,driveTransfer:null,migrationState:null,
   loadLibrary:()=>({filenames:names,sources}),persistMovedSource:async s=>suppressed.push(s),
   removeLibraryRow:n=>{removed.push(n);const i=names.indexOf(n);if(i<0)return false;names.splice(i,1);sources.splice(i,1);return true;},
   saveLibrary:async()=>saves++,dropQueuedJobsFor:()=>{},BrowserWindow:{getAllWindows:()=>[]},
   broadcastEnrichEvent:()=>{},enrichSnapshot:()=>{},broadcastTranscribeEvent:()=>{},transcribeSnapshot:()=>{},broadcastOcrEvent:()=>{},ocrSnapshot:()=>{},
   shell:{trashItem:()=>{throw Error('must never directly trash a Photos file');}},
   getPhotoDeletion:()=>({remove:async(s,signature,j,save,signal,hash,options)=>{
    await options.beforeDelete({resources:[{},{}]});
    assert.deepEqual(removed,[]);assert.deepEqual(suppressed,[]);
    if(!allow)throw Error('system denied deletion');
    j.photos={requested:true};return {size:32,count:2};
   }})};
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('function photoAssetKey('),source.indexOf('async function verifiedTransferTarget(')),ctx);
  vm.runInContext(source.slice(source.indexOf('async function performDelete('),source.indexOf('async function createDeleteTask(')),ctx);
  assert.equal((await ctx.performDelete('render.mov',{original:true},{},()=>{})).ok,false);
  assert.deepEqual(removed,[]);assert.deepEqual(suppressed,[]);assert.equal(saves,0);
  allow=true;ctx.assetLocks.add('original.heic');
  assert.equal((await ctx.performDelete('render.mov',{original:true},{},()=>{})).ok,false);
  assert.deepEqual(removed,[]);ctx.assetLocks.clear();
  assert.equal((await ctx.performDelete('render.mov',{original:true},{},()=>{})).ok,true);
  assert.deepEqual(removed,['render.mov','original.heic']);assert.deepEqual(names,['unrelated.jpg']);assert.equal(saves,1);
  // The same deletion handler must use the system Trash for folder files,
  // including a file with a Photos-like name exported outside the library.
  removed=[];suppressed=[];saves=0;
  const ordinary=path.join(root,uuid+'_2_0_a.mov');
  names.splice(0,names.length,'export.mov');sources.splice(0,sources.length,ordinary);
  fs.writeFileSync(ordinary,'exported-content');
  ctx.getPhotoDeletion=()=>{throw Error('ordinary files must not use PhotoKit');};
  let trashCalls=0;
  ctx.shell={trashItem:async file=>{trashCalls++;assert.equal(file,ordinary);throw Error('trash denied');}};
  assert.equal((await ctx.performDelete('export.mov',{original:true},{},()=>{})).ok,false);
  assert.deepEqual(removed,[]);assert.deepEqual(suppressed,[]);assert(fs.existsSync(ordinary));
  ctx.shell={trashItem:async file=>{
   trashCalls++;assert.equal(file,ordinary);assert.deepEqual(removed,[]);
   fs.renameSync(file,path.join(root,'simulated-trash.mov'));
  }};
  assert.equal((await ctx.performDelete('export.mov',{original:true},{},()=>{})).ok,true);
  assert.equal(trashCalls,2);assert(!fs.existsSync(ordinary));
  assert.equal(fs.readFileSync(path.join(root,'simulated-trash.mov'),'utf8'),'exported-content');
  assert.deepEqual(removed,['export.mov']);assert.equal(saves,1);
  console.log('PASS: renders identity, unsafe paths, content mismatch, uncertain outcome, receipt recovery, linked locks, success-only related cleanup, folder Trash routing and failure preservation');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
