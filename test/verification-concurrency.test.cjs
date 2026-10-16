'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createPhotoDeletion,photosOriginal,isPhotosPath,sameOriginalIdentity}=require('../main-lib/photo-deletion');
const sig=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'verify-processes-'));try{
 const executable=path.join(root,'bridge.cjs'),log=path.join(root,'events.jsonl');
 fs.writeFileSync(executable,`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const r=JSON.parse(input),log=path.join(__dirname,'events.jsonl');const emit=event=>fs.appendFileSync(log,JSON.stringify({event,pid:process.pid,mode:r.mode})+'\\n');emit('start');process.on('SIGTERM',()=>{emit('aborted');process.exit(0);});setTimeout(()=>{emit('end');const bad=r.uuid?.endsWith('000003');process.stdout.write(JSON.stringify(bad?{ok:false,error:'fixture rejected'}:r.mode==='verify-delete'?{ok:true,id:r.uuid+'/L0/001',primaryIndex:0,assetVersion:'1',resources:[{index:0,type:1,filename:'original.jpg',size:r.size}]}:{ok:true,verified:true}));},r.mode==='verify-delete'?250:1);});`);fs.chmodSync(executable,0o755);
 const rows=[];for(let i=0;i<23;i++){const uuid=`AAAAAAAA-AAAA-AAAA-AAAA-${String(i).padStart(12,'0')}`,source=path.join(root,'test.photoslibrary','originals','a',uuid+'.jpg');fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,Buffer.alloc(20,i));rows.push({source,filename:uuid+'.jpg',originalSignature:sig(fs.statSync(source))});}
 const events=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const live=()=>events().reduce((n,e)=>n+(e.event==='start'?1:-1),0);
 const deletion=createPhotoDeletion({executable,directory:path.join(root,'receipts')});
 const ctx={fs,path,require:s=>require(s.replace('./main-lib/','../main-lib/')),taskSignature:sig,sameOriginalIdentity,photosOriginal,isPhotosPath,filesLocked:()=>false,assetLocks:new Set(),assertPhotoAssetUnlocked:()=>{},FILE_LOCK_ERROR:'locked',getPhotoDeletion:()=>deletion,loadLibrary:()=>({filenames:rows.map(r=>r.filename),sources:rows.map(r=>r.source)}),servicePendingDeletes:async()=>assert.equal(live(),0,'foreground deletion only between drained waves'),driveTransfer:{},photoAssetKey:s=>s};
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('async function verifiedTransferTarget('),source.indexOf('function finishTransferItem(')),ctx);
 vm.runInContext(source.slice(source.indexOf('async function prepareTransferredPhotoBatch('),source.indexOf('async function runTransferTask(')),ctx);
 function job(name){const localPath=path.join(root,name);fs.mkdirSync(localPath);return {id:name,status:'running',done:0,total:rows.length,payload:{mode:'move',localFolder:true,rows},folder:{localPath},photoBatch:{entries:rows.map((r,index)=>({index,journal:{filename:r.filename}}))}};}
 const j=job('out');let active=0,peak=0;
 await ctx.prepareTransferredPhotoBatch(j,()=>{},()=>false,new AbortController().signal,()=>{});
 for(const e of events()){if(e.mode==='delete-batch'&&e.event==='start')assert.equal(active,0);active+=e.event==='start'?1:-1;peak=Math.max(peak,active);assert(active<=10);}
 assert.equal(peak,10);assert.equal(active,0);assert.equal(j.photoBatch.preparedCount,22);assert.equal(j.photoBatch.activeVerifications,0);assert.equal(j.photoBatch.commitSubset.entries.length,22);assert.equal(events().filter(e=>e.mode==='delete-batch'&&e.event==='start').length,1);assert.match(j.photoBatch.entries[3].journal.validationError,/fixture rejected/);
 fs.writeFileSync(log,'');const paused=job('paused'),controller=new AbortController();let timer;
 const run=ctx.prepareTransferredPhotoBatch(paused,()=>{},()=>false,controller.signal,()=>{});
 timer=setInterval(()=>{if(events().filter(e=>e.event==='start').length>=10)controller.abort();},5);
 try{await assert.rejects(run,{name:'AbortError'});}finally{clearInterval(timer);}
 assert.equal(live(),0,'pause waits for all children to exit');assert.equal(paused.photoBatch.activeVerifications,0);assert.equal(events().filter(e=>e.event==='start').length,10);assert(!events().some(e=>e.mode==='delete-batch'));assert(!paused.photoBatch.requested);assert(rows.every(r=>fs.existsSync(r.source)));
 console.log('PASS: 10 real child processes, bounded concurrency, single commit after drain, independent failure, pause kills read-only children and starts no further wave');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
