"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const start=source.indexOf('async function importPathsInner('),end=source.indexOf('// Video posters are generated',start);
assert(start>=0&&end>start);
const prefix=source.slice(start,end)+'return {count:uniquePaths.length,concurrency,result};}';
(async()=>{
 let releases,spawns=0,grows=0;
 const context={resourceSummary:()=>({}),resourceGate:{reason:()=>""},importPerformance:()=>({effective:10}),readSettings:()=>({}),activeImportProcesses:null,indexerPoolTarget:1,
  trimIndexerPool(){},spawnIndexer(){spawns++;},async growPool(){grows++;},
  importControl:{update(){}},expandMediaPaths:()=>new Promise(resolve=>{releases=resolve;}),
  fs:{promises:{stat:async()=>({isDirectory:()=>false})}},addWatchedFolder:()=>false,path,
  loadLibrary:()=>({filenames:['old.jpg'],sources:['/old.jpg'],hashes:['hash']}),
  require:()=>({readStats:async names=>new Map(names.map(n=>[n,{}]))}),
  isKnownImportFailure:()=>false,sortPathsByMtime:names=>names};
 vm.createContext(context);vm.runInContext(prefix,context);
 let job=context.importPathsInner(['/old.jpg'],{fromWatch:true});
 await Promise.resolve();assert.equal(spawns,0,'scan must not prewarm models');releases(['/old.jpg']);
 let result=await job;assert.equal(result.count,0);assert.equal(spawns,0);assert.equal(grows,0);assert.equal(context.activeImportProcesses,0);
 job=context.importPathsInner(['/new.jpg']);releases(['/new.jpg']);result=await job;
 assert.equal(result.concurrency,1);assert.equal(context.indexerPoolTarget,1);assert.equal(spawns,1);assert.equal(grows,1);
 job=context.importPathsInner(['/folder']);releases(Array.from({length:25},(_,i)=>`/${i}.jpg`));result=await job;
 assert.equal(result.concurrency,10);assert.equal(context.indexerPoolTarget,10);
 context.isKnownImportFailure=()=>true;
 job=context.importPathsInner(['/bad.jpg'],{fromWatch:true});releases(['/bad.jpg']);await job;assert.equal(grows,2,'known failures do not grow pool');
 console.log('PASS: no model pool before scan, no growth for duplicate/failed/empty scans, small-batch cap and configured upper bound');
})().catch(error=>{console.error(error);process.exitCode=1;});
