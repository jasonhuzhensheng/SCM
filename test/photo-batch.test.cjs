'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createPhotoDeletion,sameOriginalIdentity,isPhotosPath}=require('../main-lib/photo-deletion');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sayphoto-photo-batch-'));
 try{
  const uuid='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
  const photo=path.join(directory,'fixture.photoslibrary','originals','a',uuid+'.jpg');
  fs.mkdirSync(path.dirname(photo),{recursive:true});fs.writeFileSync(photo,'fixture');
  const stat=fs.lstatSync(photo),signature=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const prepareCalls=[];let backups=0,checks=0;
  const preparer=createPhotoDeletion({directory,bridge:async r=>{prepareCalls.push(r);return {ok:true,id:uuid+'/L0/001',resources:[{size:7,hash:r.hash}]};}});
  const journal={};const preparedResult=await preparer.remove(photo,signature,journal,()=>{},new AbortController().signal,undefined,{prepareOnly:true,beforeDelete:async()=>{checks++;},backup:async()=>{backups++;}});
  assert(preparedResult.prepared);assert(journal.photosPrepared);assert.equal(journal.photos,undefined);
  assert.equal(prepareCalls.length,1);assert.equal(prepareCalls[0].mode,'verify-delete');assert.equal(backups,1);assert.equal(checks,2);assert(fs.existsSync(photo));
  const beforeResume=prepareCalls.length;
  await preparer.remove(photo,signature,journal,()=>{},new AbortController().signal,journal.photosPrepared.hash,{prepareOnly:true,backup:async()=>{backups++;}});
  assert.equal(prepareCalls.length,beforeResume,'resume companion preparation reuses existing primary proof');
  const changedProof=structuredClone(journal);changedProof.photosPrepared.hash='0'.repeat(64);
  await preparer.remove(photo,signature,changedProof,()=>{},new AbortController().signal,journal.photosPrepared.hash,{prepareOnly:true});
  assert.equal(prepareCalls.length,beforeResume+1,'mismatched proof requires PhotoKit verification');
  const metadataSignature=signature.split(':').slice(0,4).concat('0').join(':');
  const metadataJournal={};await preparer.remove(photo,metadataSignature,metadataJournal,()=>{},signalForMetadata(),undefined,{prepareOnly:true});
  function signalForMetadata(){return new AbortController().signal;}
  assert(metadataJournal.photosPrepared);assert.equal(metadataJournal.photos,undefined);
  const wrongIdentity=metadataSignature.replace(/^\d+:/,'999:');
  await assert.rejects(preparer.remove(photo,wrongIdentity,{},()=>{},undefined,undefined,{prepareOnly:true}),/已变化/);
  const calls=[];let verified=true;
  const deletion=createPhotoDeletion({directory,bridge:async request=>{calls.push(request);return {ok:true,verified};}});
  const request=id=>({id,hash:'a'.repeat(64),size:10,deletedBytes:15,resources:[{size:10},{size:5}]});
  const batch={entries:['a','b','a'].map(id=>({journal:{photosPrepared:request(id)}}))};
  let saves=0;
  await deletion.commitBatch(batch,()=>saves++,new AbortController().signal,async()=>{});
  assert.equal(calls.filter(x=>x.mode==='delete-batch').length,1);
  assert.equal(batch.entries.reduce((n,e)=>n+e.journal.space.trashedBytes,0),30);
  assert.equal(batch.entries.reduce((n,e)=>n+e.journal.space.trashedCount,0),4);
  await deletion.commitBatch(batch,()=>saves++,undefined,()=>{throw Error('must not revalidate deleted source');});
  assert.equal(calls.at(-1).mode,'delete-batch-outcome');
  assert.equal(calls.filter(x=>x.mode==='delete-batch').length,1);
  const changed={entries:[{journal:{photosPrepared:request('c')}}]};
  await assert.rejects(deletion.commitBatch(changed,()=>{},undefined,async()=>{throw Error('target changed');}),/target changed/);
  assert.equal(changed.requested,undefined);
  verified=false;
  const uncertain={entries:[{journal:{photosPrepared:request('d')}}]};
  await assert.rejects(deletion.commitBatch(uncertain,()=>{},undefined,async()=>{}),/未确认/);
  assert.equal(uncertain.requested,true);assert.equal(uncertain.confirmed,undefined);
  const before=calls.filter(x=>x.mode==='delete-batch').length;
  await assert.rejects(deletion.commitBatch(uncertain,()=>{},undefined,async()=>{}),/未确认/);
  assert.equal(calls.filter(x=>x.mode==='delete-batch').length,before);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(deletion.commitBatch(changed,()=>{},aborted.signal,async()=>{}),{name:'AbortError'});

  // Exercise the actual main-process orchestration with isolated rows and target checks.
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const code=source.slice(source.indexOf('async function prepareTransferredPhotoBatch('),source.indexOf('async function runTransferTask('));
  let prepared=[],commits=0,failSecond=false,locked=false,changeTarget=false;
  const stats=new Map(['/a','/b','/target/a','/target/b'].map(p=>[p,{isFile:()=>true,token:p}]));
  const context={require:specifier=>require("../"+specifier.slice(2)),path,sameOriginalIdentity,fs:{promises:{lstat:async p=>stats.get(p)}},photoAssetKey:s=>s,photosOriginal:async s=>s==='ordinary'?null:{source:s},filesLocked:()=>locked,assetLocks:new Set(),FILE_LOCK_ERROR:'locked',assertPhotoAssetUnlocked:()=>{},taskSignature:s=>s.token,
   trashTransferredOriginal:async(view,row,file,signal,save,stopped,prepareOnly)=>{assert(prepareOnly);prepared.push(row.source);if(failSecond&&row.source==='/b')throw Error('mismatch');if(changeTarget&&row.source==='/b')stats.get('/target/a').token='changed';view.current.photosPrepared=request(row.source);view.current.photoTarget={file:'/target/'+row.filename,signature:'/target/'+row.filename};},
   getPhotoDeletion:()=>({commitBatch:async(b,save,signal,validate)=>{await validate();commits++;b.confirmed=true;}})};
  context.servicePendingDeletes=async()=>{};context.driveTransfer=new AbortController();
  vm.createContext(context);vm.runInContext(code+'\nthis.run=prepareTransferredPhotoBatch;',context);
  const job=()=>({done:0,total:2,payload:{mode:'move',repairOriginals:true,localFolder:true,rows:[{filename:'a',source:'/a',originalSignature:'/a'},{filename:'b',source:'/b',originalSignature:'/b'}]},folder:{localPath:'/target'}});
  const signal=new AbortController().signal;
  const good=job();await context.run(good,()=>{},()=>false,signal,()=>{});
  assert.equal(commits,1);assert.deepEqual(prepared,['/a','/b']);assert.equal(good.done,0,'prepared rows are not completed');
  await context.run(good,()=>{},()=>false,signal,()=>{});assert.equal(commits,1);
  prepared=[];failSecond=true;await assert.rejects(context.run(job(),()=>{},()=>false,signal,()=>{}),/mismatch/);assert.equal(commits,1);
  failSecond=false;locked=true;await assert.rejects(context.run(job(),()=>{},()=>false,signal,()=>{}),/locked/);assert.equal(commits,1);
  locked=false;await assert.rejects(context.run(job(),()=>{},()=>true,signal,()=>{}),/暂停/);
  changeTarget=true;await assert.rejects(context.run(job(),()=>{},()=>false,signal,()=>{}),/已变化/);assert.equal(commits,1);changeTarget=false;stats.get('/target/a').token='/target/a';
  const legacy=job();legacy.current={photos:{requested:true}};await context.run(legacy,()=>{},()=>false,signal,()=>{});assert.equal(legacy.photoBatch,undefined);
  const trashCode=source.slice(source.indexOf('async function trashTransferredOriginal('),source.indexOf('function finishTransferItem('));
  const targetFile=path.join(directory,'target.jpg');fs.copyFileSync(photo,targetFile);
  const transferJournal={remote:{localPath:targetFile},resourceTargetSignatures:[{file:'/old-partial',signature:'old'}]};
  const transferJob={payload:{localFolder:true},current:transferJournal};
  const transferContext={fs,path,sameOriginalIdentity,isPhotosPath,taskSignature:st=>[st.dev,st.ino,st.size,st.mtimeMs,st.ctimeMs].join(':'),require:()=>({digest:async()=> 'verified',verifiedCopy:async()=>null}),verifiedTransferTarget:async p=>{const st=fs.lstatSync(p);return [st.dev,st.ino,st.size,st.mtimeMs,st.ctimeMs].join(':');},filesLocked:()=>false,assetLocks:new Set(),photosOriginal:async()=>({}),assertPhotoAssetUnlocked:()=>{},getPhotoDeletion:()=>({remove:async(a,b,c,d,e,f,options)=>{assert.equal(c.resourceTargetSignatures.length,0);await options.beforeDelete();return {prepared:true};}})};
  vm.createContext(transferContext);vm.runInContext(trashCode+';this.trash=trashTransferredOriginal;',transferContext);
  await transferContext.trash(transferJob,{source:photo,originalSignature:signature,filename:'a'},photo,signal,()=>{},()=>false,true);
  assert(fs.existsSync(photo));assert.equal(transferJournal.originalTrashed,undefined);
  // Actual copy evidence must reach move preparation without a second hash pass.
  const copies=require('../main-lib/folder-transfer');
  const evidenceTarget=await copies.copyResumable(photo,'evidence.jpg',directory,signal,()=>{},'test');
  transferContext.require=()=>({verifiedCopy:copies.verifiedCopy,digest:async()=>{throw Error('redundant source hash');}});
  transferContext.verifiedTransferTarget=async()=>{throw Error('redundant target hash');};
  const evidenceJob={payload:{localFolder:true},current:{remote:{localPath:evidenceTarget}}};
  await transferContext.trash(evidenceJob,{source:photo,originalSignature:signature,filename:'a'},photo,signal,()=>{},()=>false,true);
  assert(evidenceJob.current.photoTarget.hash);assert(fs.existsSync(photo));
  const targetCode=source.slice(source.indexOf('async function verifiedTransferTarget('),source.indexOf('async function backupPhotoResources('));
  let metadataReads=0,targetHash='expected';
  const targetContext={fs:{promises:{lstat:async()=>({isFile:()=>true,dev:1,ino:2,size:3,mtimeMs:4,ctimeMs:++metadataReads})}},require:()=>({digest:async()=>targetHash}),taskSignature:st=>[st.dev,st.ino,st.size,st.mtimeMs,st.ctimeMs].join(':')};
  vm.createContext(targetContext);vm.runInContext(targetCode+';this.verify=verifiedTransferTarget;',targetContext);
  assert.equal(await targetContext.verify('/cloud','expected',signal),'1:2:3:4:2');
  targetHash='different';await assert.rejects(targetContext.verify('/cloud','expected',signal),/内容校验失败/);
  // Two existing jobs keep their counters and destinations but share one commit.
  const left=job(),right=job();left.id='left';right.id='right';
  left.payload.rows=[left.payload.rows[0]];right.payload.rows=[right.payload.rows[1]];
  left.total=right.total=1;
  left.payload.photoBatchGroup=right.payload.photoBatchGroup=['left','right'];
  context.getFileTasks=()=>({photoBatchJobs:()=>[left,right]});
  const previousCommits=commits;
  await assert.rejects(context.run(right,()=>{},()=>false,signal,()=>{}),/等待合并批次/);
  await context.run(left,()=>{},()=>false,signal,()=>{});
  assert.equal(commits,previousCommits+1);assert.equal(left.photoBatch.entries.length,2);
  assert.deepEqual(Array.from(left.photoBatch.entries,e=>e.jobId),['left','right']);
  await context.run(right,()=>{},()=>false,signal,()=>{});
  assert.equal(right.photoBatch.entries.length,1);assert.equal(right.photoBatch.entries[0].jobId,'right');
  assert.equal(commits,previousCommits+1);assert.equal(left.done,0);assert.equal(right.done,0);
  // A verified subset keeps final validation but never prepares deferred rows.
  const subset=job();subset.photoBatch={preparedOnly:true,partial:true,entries:[{index:0,journal:{photosPrepared:request('/a'),photoTarget:{file:'/target/a',signature:'/target/a'}}}]};
  prepared=[];await context.run(subset,()=>{},()=>false,signal,()=>{});assert.equal(prepared.length,0);assert(subset.photoBatch.confirmed);
  const runnerCode=source.slice(source.indexOf('async function cleanupConfirmedTransferBatch('),source.indexOf('// App icon (Dock'));
  const runnerContext={require:s=>require("../"+s.slice(2)),AbortController,BrowserWindow:{getAllWindows:()=>[]},prepareTransferredPhotoBatch:async()=>{},servicePendingDeletes:async()=>{},driveTransfer:null,activeFileTaskID:null};
  vm.createContext(runnerContext);vm.runInContext(runnerCode+';this.run=runTransferTask;',runnerContext);
  const deferred=job();deferred.photoBatch={confirmed:true,partial:true,entries:[]};
  await runnerContext.run(deferred,()=>{},()=>deferred.status==='paused');assert.equal(deferred.status,'paused');assert.equal(deferred.done,0);assert.equal(deferred.current,undefined);
  console.log('Photo batch: single commit, deduplication, recovery, uncertain result, target failure, lock, pause and legacy guard passed');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
