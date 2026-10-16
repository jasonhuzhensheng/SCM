'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const {selectBatch,verifyEntry,released,preparedResourcesComplete}=require('../main-lib/cloud-batch');
const {createGoogleDrive}=require('../main-lib/google-drive');
(async()=>{
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'cloud-batch-'));
 try{
  const rows=Array.from({length:8},(_,i)=>({filename:`${i}.mp4`,originalSignature:`1:2:${1024**3}:4:5`}));const entries=rows.map((_,index)=>({index,journal:{}}));
  assert.equal(selectBatch(entries,rows,0).length,2);assert.equal(selectBatch(entries,rows,3,{batchFiles:1}).at(0).index,3);
  assert.equal(selectBatch(entries,[{...rows[0],originalSignature:'1:2:9999999999:4:5'},...rows.slice(1)],0).length,1);
  await fsp.writeFile(path.join(root,'google-drive.enc'),JSON.stringify({refresh_token:'test',access_token:'test',expires_at:Date.now()+999999,scope:'https://www.googleapis.com/auth/drive.metadata.readonly'}));
  let corrupt=false,duplicate=false,trashed=false,missing=false;
  const sha='a'.repeat(64);
  const drive=createGoogleDrive({userDataDir:root,safeStorage:{isEncryptionAvailable:()=>true,decryptString:b=>b.toString()},openExternal:async()=>{},fetchImpl:async url=>{
   if(url.includes('/files?'))return Response.json({files:missing?[]:duplicate?[{id:'f'},{id:'g'}]:[{id:'f'}]});
   return Response.json({id:'f',name:'video.mp4',parents:['parent'],size:'123',sha256Checksum:corrupt?'b'.repeat(64):sha,trashed,mimeType:'video/mp4'});
  }});
  assert.equal(drive.status().metadataConnected,true);
  assert.equal((await drive.verifyFile('parent','video.mp4',123,sha)).id,'f');
  corrupt=true;await assert.rejects(drive.verifyFile('parent','video.mp4',123,sha),/校验/);corrupt=false;
  duplicate=true;await assert.rejects(drive.verifyFile('parent','video.mp4',123,sha),/同名/);duplicate=false;
  missing=true;await assert.rejects(drive.verifyFile('parent','video.mp4',123,sha),/等待 Google Drive 上传/);missing=false;
  trashed=true;await assert.rejects(drive.verifyFile('parent','video.mp4',123,sha),/校验/);trashed=false;
  await assert.rejects(drive.verifyFileById('f','wrong-parent','video.mp4',123,sha),/校验/);
  const source=path.join(root,'source.mp4'),target=path.join(root,'video.mp4');await fsp.writeFile(source,Buffer.alloc(100000,1));await fsp.copyFile(source,target);
  const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');const hash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const row={filename:'video.mp4',source,originalSignature:signature(fs.statSync(source))};
  const journal={filename:row.filename,remote:{localPath:target},photoTarget:{file:target,signature:signature(fs.statSync(target)),hash},photosPrepared:{id:'asset',hash,size:100000,resources:[{index:0,hash,size:100000}]}};
  assert.equal(preparedResourcesComplete(journal),true);
  const incomplete=structuredClone(journal);incomplete.photosPrepared.resources.push({index:1,size:10,hash:'b'.repeat(64)});
  assert.equal(preparedResourcesComplete(incomplete),false);
  incomplete.resourcesVerified=true;incomplete.resourcesDirectory=root;incomplete.resourceTargetSignatures=[];
  assert.equal(preparedResourcesComplete(incomplete),false);
  incomplete.resourceTargetSignatures=[{file:path.join(root,'extra'),hash:'b'.repeat(64)}];
  assert.equal(preparedResourcesComplete(incomplete),true);
  const entry={index:0,journal};const job={id:'job',total:1,done:0,status:'running',payload:{rows:[row],mode:'move',localFolder:true,cloudVerifiedMove:{version:1,folderId:'parent'}},folder:{localPath:root},photoBatch:{entries:[entry]},cloudPendingEntries:[entry]};
  let remoteReady=false,committed=0;
  const mockDrive={status:()=>({metadataConnected:true}),verifyFolder:async()=>{},verifyFile:async(parent,name,size,hash)=>{if(!remoteReady)throw Error('not synced');return {id:'f',parent,name,size,sha256Checksum:hash};},verifyFileById:async()=>{}};
  const code=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');const fragment=code.slice(code.indexOf('async function prepareTransferredPhotoBatch('),code.indexOf('async function runTransferTask('));
  const context={require:specifier=>specifier.startsWith('./main-lib/')?require('../'+specifier.slice(2)):require(specifier),fs,path,drive:mockDrive,driveTransfer:{},servicePendingDeletes:async()=>{},filesLocked:()=>false,assetLocks:new Set(),assertPhotoAssetUnlocked:()=>{},loadLibrary:()=>({filenames:[row.filename],sources:[row.source]}),taskSignature:signature,sameOriginalIdentity:(a,b)=>a===b,photoAssetKey:()=>null,getPhotoDeletion:()=>({commitBatch:async(batch,save,signal,validate)=>{await validate();committed++;}})};
  vm.createContext(context);vm.runInContext(fragment,context);
  await assert.rejects(context.prepareTransferredPhotoBatch(job,()=>{},()=>false,new AbortController().signal,()=>{}),/not synced/);assert.equal(committed,0);assert(fs.existsSync(source));
  remoteReady=true;await context.prepareTransferredPhotoBatch(job,()=>{},()=>false,new AbortController().signal,()=>{});assert.equal(committed,1);assert(journal.cloudVerified.files.length===1);
  // Local recovery must reuse complete unchanged preparation without copy/export.
  const localJob=structuredClone(job);delete localJob.payload.cloudVerifiedMove;
  const localJournal=localJob.photoBatch.entries[0].journal;
  localJournal.photosPrepared.verification='system-copy';localJournal.photosPrepared.primaryIndex=0;
  localJournal.deferredCopy={sourceSignature:row.originalSignature,targetSignature:journal.photoTarget.signature,verified:true,verification:'system-copy'};
  remoteReady=false;
  await context.prepareTransferredPhotoBatch(localJob,()=>{},()=>false,new AbortController().signal,()=>{});
  assert.equal(committed,2);committed=1;
  // A changed destination must leave the reuse path and run normal preparation.
  const changed=structuredClone(localJob);delete changed.photoBatch.confirmed;delete changed.photoBatch.commitSubset;changed.photoBatch.entries[0].journal.photoTarget.signature='changed';
  let fallback=0;context.trashTransferredOriginal=async()=>{fallback++;throw Error('normal preparation required');};
  await context.prepareTransferredPhotoBatch(changed,()=>{},()=>false,new AbortController().signal,()=>{});
  assert.match(changed.photoBatch.entries[0].journal.validationError,/normal preparation required/);
  assert.equal(fallback,1);delete context.trashTransferredOriginal;
  remoteReady=false;await assert.rejects(context.prepareTransferredPhotoBatch(job,()=>{},()=>false,new AbortController().signal,()=>{}),/not synced/);assert.equal(committed,1);remoteReady=true;
  assert.equal(await released(job.photoBatch,mockDrive,new AbortController().signal),false);assert(fs.existsSync(target));
  job.photoBatch.confirmed=true;job.done=1;
  await assert.rejects(context.prepareTransferredPhotoBatch(job,()=>{},()=>false,new AbortController().signal,()=>{}),/移除下载/);assert.equal(job.photoBatchHistory,undefined);
  const originalLstat=fsp.lstat;
  try {
   fsp.lstat=async(...args)=>{const stat=await originalLstat(...args);if(args[0]===target)stat.blocks=0;return stat;};
   await context.prepareTransferredPhotoBatch(job,()=>{},()=>false,new AbortController().signal,()=>{});
   assert.equal(job.photoBatch,null);assert.equal(job.photoBatchHistory[0].localReleased,true);
  }finally{fsp.lstat=originalLstat;}
  job.photoBatch=job.photoBatchHistory[0];

  await fsp.unlink(target);await assert.rejects(released(job.photoBatch,mockDrive,new AbortController().signal));assert(fs.existsSync(source));
  journal.photosPrepared.resources.push({index:1,size:10,hash:'b'.repeat(64)});await assert.rejects(verifyEntry(job,entry,mockDrive,new AbortController().signal),/配套资源/);
  console.log('PASS: bounded batches, cloud checksum/size/parent/trash/ambiguity checks, cloud failure prevents commit, complete cloud proof gates commit, local copies never unlinked, missing resources block');
 }finally{await fsp.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
