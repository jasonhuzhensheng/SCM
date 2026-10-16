'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const transferCode=source.slice(source.indexOf('async function cleanupConfirmedTransferBatch('),source.indexOf('async function runTransferTask('));
const deleteCode=source.slice(source.indexOf('async function runDeleteTask('),source.indexOf('// Current AI-engine status'));
function fixture(size=60){return {filenames:Array.from({length:size},(_,i)=>'file'+i),sources:Array.from({length:size},(_,i)=>'source'+i),embeddings:Array.from({length:size},(_,i)=>[i,100+i])};}
function remove(lib,name){const i=lib.filenames.indexOf(name);if(i<0)return false;for(const k of ['filenames','sources','embeddings'])lib[k].splice(i,1);return true;}
(async()=>{
 let lib=fixture(),taskWrites=0,writes=0,disk=clone(lib),locked=new Set(),fail=false;
 const rows=lib.filenames.map((filename,i)=>({filename,source:lib.sources[i]}));
 const job={id:'move',done:0,total:60,payload:{mode:'move',rows},results:[],photoBatch:{confirmed:true,entries:rows.map((r,index)=>({index,journal:{photos:{requested:true},originalTrashed:true}}))}};
 const ctx={Set,setImmediate,filesLocked:()=>false,assetLocks:locked,FILE_LOCK_ERROR:'locked',loadLibrary:()=>lib,photoAssetKey:x=>x,persistMovedSources:async sources=>{assert(Array.isArray(sources));},dropQueuedJobsFor:()=>{},removeLibraryRow:name=>remove(lib,name),saveLibrary:async options=>{assert(options.strict);if(fail)throw Error('disk full');disk=clone(lib);writes++;},finishTransferItem:(j,name,save)=>{assert(!disk.filenames.includes(name),'index durable before progress');j.results.push({filename:name});j.done++;j.current=null;save();}};
 vm.createContext(ctx);vm.runInContext(transferCode,ctx);
 locked.add('file3');await assert.rejects(ctx.cleanupConfirmedTransferBatch(job,()=>{},()=>false,()=>{}),/locked/);assert.equal(lib.filenames.length,60);locked.clear();
 fail=true;await assert.rejects(ctx.cleanupConfirmedTransferBatch(job,()=>{},()=>false,()=>{}),/disk full/);assert.equal(job.done,0);assert.equal(disk.filenames.length,60);
 // Restart from old disk plus unchanged confirmed batch; no delete API exists in this fixture.
 lib=clone(disk);fail=false;while(job.done<60)assert(await ctx.cleanupConfirmedTransferBatch(job,()=>taskWrites++,()=>false,()=>{}));assert.equal(writes,1);assert.equal(taskWrites,1);assert.equal(job.done,60);assert.equal(disk.filenames.length,0);
 assert.equal(await ctx.cleanupConfirmedTransferBatch({...job,done:0},()=>{},()=>true,()=>{}),false);
 // Generic deletion: journals remain durable while progress waits for index flush.
 async function runDelete({size=60,stopAt=Infinity,saveFailure=false,restore}={}){
  let library=restore?clone(restore.disk):fixture(size),persisted,checkpoint=restore?clone(restore.disk):clone(library),saves=0,calls=0,captured,stop=false;
  const task=restore?clone(restore.job):{id:'delete',done:0,total:size,payload:{rows:library.filenames.map((filename,i)=>({filename,source:library.sources[i],options:{original:false}}))},results:[]};
  const context={require:n=>{if(n==="./main-lib/stable-task-identity")return require("../main-lib/stable-task-identity");throw Error(n)},commitDeleteSelection:async j=>{for(let i=j.done;i<j.payload.rows.length;i++)j.deleteChecks[i]||={filename:j.payload.rows[i].filename};},fs,activeFileTaskID:null,BrowserWindow:{getAllWindows:()=>[]},prepareDeleteChecks:async(j,save,_stopped,start)=>{for(let i=start;i<Math.min(start+10,size);i++)j.deleteChecks[i]||={filename:j.payload.rows[i].filename};return start+10;},assertTaskRow:async row=>library.filenames.includes(row.filename),getPhotoDeletion:()=>({remove:async()=>({count:1,size:10})}),forgetPhotoAsset:async()=>{},saveLibrary:async({strict})=>{assert(strict);if(saveFailure)throw Error('checkpoint failure');checkpoint=clone(library);saves++;},performDelete:async(name,_options,journal,save,opts)=>{assert(opts.deferIndexSave);if(!journal.photos?.requested){calls++;journal.photos={requested:true};journal.trashed=true;save();}remove(library,name);if(calls===12&&!captured)captured={job:clone(persisted),disk:clone(checkpoint)};if(calls>=stopAt)stop=true;return {ok:true};}};
  vm.createContext(context);vm.runInContext(deleteCode,context);
  let error;try{await context.runDeleteTask(task,()=>{persisted=clone(task);if(task.done)assert(task.results.every(r=>!checkpoint.filenames.includes(r.filename)));},()=>stop);}catch(e){error=e;}
  return {task,persisted,checkpoint,saves,calls,captured,error};
 }
 const all=await runDelete();assert(!all.error,all.error?.stack);assert.equal(all.saves,3);assert.equal(all.task.done,60);
 const paused=await runDelete({stopAt:7});assert.equal(paused.task.done,7);assert.equal(paused.saves,1);assert.equal(paused.checkpoint.filenames.length,53);
 const failed=await runDelete({saveFailure:true});assert.match(failed.error.message,/checkpoint failure/);assert.equal(failed.task.done,0);assert.equal(failed.checkpoint.filenames.length,60);assert.equal(Object.keys(failed.persisted.deleteChecks).length,60); // Whole selection prepared; 25 attempted index removals.
 const restarted=await runDelete({restore:all.captured});assert(!restarted.error,restarted.error?.stack);assert.equal(restarted.task.done,60);assert.equal(restarted.calls,48,'first 12 confirmed deletes recover from receipts rather than resubmit');assert.equal(restarted.checkpoint.filenames.length,0);
 console.log('PASS: transfer 60 rows / 1 index and 1 task save; delete 60 rows / 3 saves, durable-before-progress, failed save retains progress and receipts, pause flush, restart after 12 confirmed deletes');
})().catch(e=>{console.error(e);process.exitCode=1});
