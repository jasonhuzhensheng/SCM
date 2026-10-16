'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createImportControl}=require('../main-lib/import-control');
const source=fs.readFileSync(require('node:path').join(__dirname,'../main.js'),'utf8');
const start=source.indexOf('\tconst inflight = new Set();', source.indexOf('async function importPathsInner'));
const end=source.indexOf('\n\tfor (const p of skippedPaths)',start);
assert(start>0&&end>start);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 let states=[],jobs=[],flushed=[],checkpoints=0;
 const control=createImportControl(state=>states.push(state));
 control.begin();
 const pendingResults=new Map(); let cursor=0;
 const context={resourceGate:{acquire:()=>()=>{},reason:()=>""},managedCopy:false,sourceStats:new Map(),setTimeout,clearTimeout,fromWatch:false,concurrency:2,total:5,importControl:control,pendingResults,next:0,uniquePaths:['0','1','2','3','4'],path:require('node:path'),console,
 posterJobs:[],importPacer:{close(){}},
 processOne:seq=>new Promise(resolve=>jobs.push({seq,resolve})),
 flushResults:()=>{while(pendingResults.has(cursor)){flushed.push(pendingResults.get(cursor));pendingResults.delete(cursor++);}},
 sendImport:phase=>control.update({phase,done:cursor,total:5}),saveLibrary:async()=>{checkpoints++;}};
 control.setPaused(true);
 assert.equal(await control.prepareCleanup(),false,"scanning is not safe for cleanup");
 const running=vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
 assert.equal(jobs.length,0,'pause during scan prevents first dispatch');
 control.setPaused(false);assert.equal(jobs.length,2);
 control.setPaused(true);
 assert.equal(await control.prepareCleanup(),false,"in-flight processing prevents cleanup");
 jobs[1].resolve('one');await tick();assert.equal(flushed.length,0,'ordered flush waits for first file');
 jobs[0].resolve('zero');await tick();
 assert.equal(jobs.length,2,'no new dispatch while paused');assert.equal(checkpoints,1);
 assert.equal(control.snapshot().done,2);assert.equal(control.snapshot().paused,true);
 let finishPoster;context.posterJobs.push(new Promise(resolve=>{finishPoster=resolve;}));
 let ready=false;const cleanup=control.prepareCleanup().then(value=>{ready=value;});
 await tick();assert.equal(ready,false,"cleanup waits for posters");
 finishPoster();await cleanup;assert.equal(ready,true);assert.equal(checkpoints,2,"cleanup saves before proceeding");
 const count=jobs.length;control.snapshot();assert.equal(jobs.length,count,'refresh is read-only');
 control.setPaused(false);assert.equal(await control.prepareCleanup(),false,"running import blocks cleanup");assert.equal(jobs.length,4);
 jobs[2].resolve('two');jobs[3].resolve('three');await tick();jobs[4].resolve('four');await running;
 assert.deepEqual(flushed,['zero','one','two','three','four']);
 control.finish();assert.equal(control.snapshot().active,false);assert.equal(control.snapshot().paused,false);
 assert.throws(()=>control.setPaused('yes'),/布尔/);
 control.begin();assert.equal(control.snapshot().done,0,'next import starts clean');
 // Background pipeline overlaps two files, with a bounded reorder window.
 context.fromWatch=true;context.next=0;pendingResults.clear();cursor=0;jobs=[];flushed=[];
 control.begin();
 const automatic=vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
 assert.equal(jobs.length,2,'two background slots overlap reads and inference');
 jobs[1].resolve(1);await tick();
 jobs[2].resolve(2);await tick();
 jobs[3].resolve(3);await tick();
 assert.equal(jobs.length,4,'slow first file bounds outstanding results to four');
 assert.equal(flushed.length,0);
 control.setPaused(true);jobs[0].resolve(0);await tick();
 assert.equal(jobs.length,4,'pause still stops dispatch with buffered results');
 assert.deepEqual(flushed,[0,1,2,3]);
 control.setPaused(false);assert.equal(jobs.length,5);
 jobs[4].resolve(4);await automatic;control.finish();
 // Production concurrency: ten actual file jobs, bounded buffering, one failure
 // cannot prevent the remaining jobs from settling and being committed.
 context.concurrency=10;context.total=25;context.next=0;
 context.uniquePaths=Array.from({length:25},(_,i)=>String(i));
 pendingResults.clear();cursor=0;jobs=[];flushed=[];control.begin();
 const ten=vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
 assert.equal(jobs.length,10,'ten independent files start immediately');
 jobs[1].resolve({kind:'error',filename:'1'});await tick();
 assert.equal(jobs.length,11,'failure frees a slot without stopping peers');
 for(let i=2;i<20;i++){jobs[i].resolve(i);await tick();}
 assert.equal(jobs.length,20,'a slow first file bounds the reorder buffer');
 jobs[0].resolve(0);await tick();
 for(let i=20;i<25;i++){jobs[i].resolve(i);await tick();}
 await ten;assert.equal(flushed.length,25);control.finish();
 const publications=[];const throttled=createImportControl(state=>publications.push(state));
 throttled.begin();
 for(let i=0;i<1000;i++)throttled.update({phase:'embedding',done:i});
 assert.equal(throttled.snapshot().done,999,'snapshot stays current while publication is throttled');
 assert.equal(publications.length,1,'rapid updates do not flood IPC');
 throttled.setPaused(true);assert.equal(publications.at(-1).paused,true,'pause publishes immediately');
 throttled.finish();assert.equal(publications.at(-1).active,false);
 await new Promise(resolve=>setTimeout(resolve,280));
 assert.equal(publications.length,3,'no stale progress appears after completion');
 console.log('PASS: real import pump pauses before/after dispatch, drains and checkpoints, resumes in order, refresh never restarts, new task resets');
})().catch(error=>{console.error(error);process.exitCode=1;});
