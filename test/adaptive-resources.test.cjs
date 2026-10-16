'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { GiB, resourcePlan, probeSpace, volumeIdentity, validateTarget, createResourceGate } = require('../main-lib/adaptive-resources');
const { importPerformance } = require('../main-lib/import-performance');
const { createImportControl } = require('../main-lib/import-control');
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sayphoto-resources-'));
 try {
  assert.equal(resourcePlan().count, null);
  assert.equal(resourcePlan({count:0,freeBytes:0}).deficitBytes, 2*GiB);
  assert(resourcePlan({count:10000000}).reserveBytes > 100*GiB);
  assert.equal(resourcePlan({count:100}).recommendedExternalBytes, null, 'unknown source sizes never guessed from photo count');
  assert.equal((await probeSpace(path.join(root,'missing'))).freeBytes,null);
  assert((await probeSpace(root)).freeBytes > 0);
  const hardware={cores:12,memoryBytes:96*GiB,count:500000};
  assert.equal(importPerformance({},hardware).effective,2);
  assert.equal(importPerformance({importProcesses:10},hardware).effective,10,'legacy manual setting retained');
  assert.equal(importPerformance({resourceMode:'economy',importProcesses:10},hardware).effective,1);
  const target={directory:root,uuid:'original-volume'};
  await validateTarget(target,async()=>target);
  await assert.rejects(validateTarget(target,async()=>({...target,uuid:'other-volume'})),/身份/);
  await assert.rejects(validateTarget(target,async()=>{throw Error('offline')}),/offline/);
  await validateTarget(JSON.parse(JSON.stringify(target)),async()=>target);
  let free=4*GiB, time=0, calls=0;
  const gate=createResourceGate({directory:root,now:()=>time,probe:async()=>{calls++;return {freeBytes:free};}});
  await Promise.all([gate.refresh(),gate.refresh()]);assert.equal(calls,1,'coalesced probes');
  const a=gate.acquire(GiB),b=gate.acquire(GiB);assert(a&&b);assert.equal(gate.acquire(1),null,'shared reservations prevent overcommit');
  a();a();assert.equal(gate.snapshot().reservedBytes,GiB,'idempotent release');b();await gate.refresh();
  const end=gate.queryStarted();assert.equal(gate.acquire(1),null);end();end();time+=501;assert(gate.acquire(0));
  free=GiB;await gate.refresh();assert.equal(gate.acquire(1),null);
  free=8*GiB;await gate.refresh();assert(gate.acquire(0),'resume when space returns');
  const invalid=createResourceGate({directory:root,probe:async()=>({freeBytes:NaN})});await invalid.refresh();assert.equal(invalid.acquire(0),null);
  const unknown=createResourceGate({directory:root,probe:async()=>{throw Error('denied')}});await unknown.refresh();assert.equal(unknown.acquire(0),null);

  // Exercise actual importer dispatch and ordered completion, no Electron/model/original files.
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const start=source.indexOf('\tconst inflight = new Set();',source.indexOf('async function importPathsInner'));
  const endAt=source.indexOf('\n\tfor (const p of skippedPaths)',start);
  let jobs=[],cursor=0,timers=[],checkpoints=0;
  const pendingResults=new Map(),control=createImportControl();control.begin();
  free=GiB;await gate.refresh();
  const context={resourceGate:gate,managedCopy:false,sourceStats:new Map(),concurrency:2,total:3,next:0,uniquePaths:['a','b','c'],path,console,pendingResults,importControl:control,
   setTimeout:fn=>{timers.push(fn);return fn},clearTimeout:fn=>{timers=timers.filter(x=>x!==fn)},
   posterJobs:[],importPacer:{close(){}},processOne:seq=>new Promise(resolve=>jobs.push({seq,resolve})),
   flushResults:()=>{while(pendingResults.has(cursor))pendingResults.delete(cursor++)},
   sendImport:()=>{},saveLibrary:async()=>{checkpoints++}};
  const running=vm.runInNewContext('(async()=>{'+source.slice(start,endAt)+'})()',context);
  assert.equal(jobs.length,0);assert.match(control.snapshot().waitingReason,/空间不足/);assert.equal(timers.length,1,'one bounded retry');
  free=8*GiB;await gate.refresh();timers.shift()();assert.equal(jobs.length,2);
  free=GiB;await gate.refresh();jobs[1].resolve('b');jobs[0].resolve('a');await tick();
  assert.equal(cursor,2,'in-flight results safely commit');assert.equal(jobs.length,2,'no new dispatch under pressure');
  control.setPaused(true);free=8*GiB;await gate.refresh();timers.shift()();assert.equal(jobs.length,2,'resource recovery does not override user pause');
  control.setPaused(false);assert.equal(jobs.length,3);jobs[2].resolve('c');await running;
  assert.equal(cursor,3);assert.equal(gate.snapshot().reservedBytes,0);
  console.log('PASS: plans, auto/manual budgets, unknown space, shared reservations, query priority, volume mismatch/offline/reconnect, real pump resource wait/drain/resume and user pause');
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1});
