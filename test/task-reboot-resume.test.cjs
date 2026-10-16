'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const appRoot=process.argv[2]||path.join(__dirname,'..');
const {prepareLocalResume}=require(appRoot+'/main-lib/task-volume-identity');
const {copyAll}=require(appRoot+'/main-lib/local-copy-first');
const {createFileTasks}=require(appRoot+'/main-lib/file-tasks');
const sig=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const withDevice=(s,d)=>[d,...s.split(':').slice(1)].join(':');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reboot-resume-')),out=root+'/out';fs.mkdirSync(out);
 try{
  const source=root+'/source',target=out+'/photo.png';fs.writeFileSync(source,Buffer.alloc(8000,7));fs.copyFileSync(source,target);
  const sourceSig=sig(fs.statSync(source)),targetSig=sig(fs.statSync(target)),dev=String(fs.statSync(source).dev);
  const identify=async directory=>({uuid:directory===out?'target-uuid':'source-uuid',directory});
  const make=()=>({id:'test',done:0,payload:{localFolder:true,mode:'move',rows:[{source,filename:'photo.png',originalSignature:withDevice(sourceSig,'100')}]},folder:{localPath:out},photoBatch:{entries:[{index:0,journal:{remote:{localPath:target},deferredCopy:{sourceSignature:withDevice(sourceSig,'100'),targetSignature:withDevice(targetSig,'200')},copyError:'原件身份已变化',photosPrepared:{verification:'system-copy'}}}]},volumeIdentity:{version:1,sources:[{device:'100',uuid:'source-uuid',directory:root}],destination:{device:'200',uuid:'target-uuid',directory:out}}});
  let saves=0;const job=make();await prepareLocalResume(job,()=>saves++,null,{volumeIdentity:identify});
  assert.equal(saves,1);assert.equal(job.payload.rows[0].originalSignature,sourceSig);assert.equal(job.photoBatch.entries[0].journal.deferredCopy.targetSignature,targetSig);assert(!job.photoBatch.entries[0].journal.photosPrepared);assert(!job.photoBatch.entries[0].journal.copyError);assert.equal(job.volumeIdentity.sources[0].device,dev);
  await prepareLocalResume(job,()=>saves++,null,{volumeIdentity:identify});assert.equal(saves,1,'unchanged run does not save again');
  const changed=make(),before=JSON.stringify(changed);await assert.rejects(prepareLocalResume(changed,()=>{throw Error('unexpected save')},null,{volumeIdentity:async d=>({uuid:'replacement',directory:d})}),e=>e.retryable===false);assert.equal(JSON.stringify(changed),before);
  const edited=make();edited.photoBatch.entries[0].journal.deferredCopy.targetSignature=withDevice(targetSig,'200').replace(/:[^:]+$/,':0');const editedBefore=JSON.stringify(edited);
  await assert.rejects(prepareLocalResume(edited,()=>{},null,{volumeIdentity:identify}),/断点文件/);assert.equal(JSON.stringify(edited),editedBefore,'no partial rebasing');
  const legacy=make();delete legacy.volumeIdentity;await assert.rejects(prepareLocalResume(legacy,()=>{},null,{volumeIdentity:identify}),/核验原件内容/);
  const pending=make();pending.photoBatch.commitSubset={requested:true,receipt:'unchanged'};const pendingBefore=JSON.stringify(pending);await prepareLocalResume(pending,()=>{throw Error('must not save')},null,{stat:()=>{throw Error('must reconcile receipt only')}});assert.equal(JSON.stringify(pending),pendingBefore);
  // Crash after publishing a copy, before its checkpoint: hash and adopt, no writes.
  const originalTarget=sig(fs.statSync(target)),adopt=make();delete adopt.volumeIdentity;adopt.payload.rows[0].originalSignature=sourceSig;adopt.photoBatch.entries[0].journal={};
  await copyAll(adopt,()=>{},()=>false,new AbortController().signal,()=>{},async()=>{});assert(adopt.photoBatch.entries[0].journal.deferredCopy.recoveredHash);assert.equal(sig(fs.statSync(target)),originalTarget);
  fs.writeFileSync(target,Buffer.alloc(8000,9));const corrupt=make();corrupt.payload.rows[0].originalSignature=sourceSig;corrupt.photoBatch.entries[0].journal={};
  await copyAll(corrupt,()=>{},()=>false,new AbortController().signal,()=>{},async()=>{});assert.equal(corrupt.copyFailures,1);assert.equal(fs.readFileSync(target)[0],9,'unrelated bytes never overwritten');
  // Coalesced progress is bounded, but requested markers must be on disk first.
  const file=root+'/file-tasks.json';let release,ready;const gate=new Promise(r=>release=r),entered=new Promise(r=>ready=r);
  const store=createFileTasks(file,{transfer:async(j,save)=>{for(let i=1;i<=5000;i++){j.done=i;save({checkpoint:true});}assert.equal(JSON.parse(fs.readFileSync(file))[0].done,0);j.photoBatch={requested:true};save();assert(JSON.parse(fs.readFileSync(file))[0].photoBatch.requested);j.done=5001;save({checkpoint:true});ready();await gate;return {}; }},()=>false);
  const added=store.add('transfer',{mode:'move',rows:[]},5001);await entered;store.stop();assert.equal(JSON.parse(fs.readFileSync(file))[0].done,5001,'shutdown flush');release();await store.settle();
  console.log('PASS: reboot UUID rebinding, changed volume/metadata fail closed, legacy audit required, submitted receipts untouched, identical orphan copy reuse, corrupt copy preserved, checkpoint batching, durable requested marker, shutdown flush');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
