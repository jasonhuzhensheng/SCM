'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const fragment=source.slice(source.indexOf('const manualImportStateFile ='),source.indexOf('async function pickAndImport('));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-import-queue-'));
const tick=()=>new Promise(r=>setImmediate(r));
function context(overrides={}){
 const c={fs,path,require,console,DATA_DIR:dir,importInFlight:false,migrationState:false,startupModelPending:false,driveTransfer:false,isQuitting:true,setTimeout:(cb)=>setTimeout(cb,5),importPaths:async()=>({added:[],skipped:[],errors:[]}),...overrides};
 vm.createContext(c);vm.runInContext(fragment,c);return c;
}
(async()=>{try{
 const first=context();
 const a=first.enqueueManualImport(['/tmp/a.jpg'],{wait:false});
 const b=first.enqueueManualImport(['/tmp/b.jpg'],{wait:false});
 assert.equal(a.queued,true);assert.equal(typeof a.then,'undefined','enqueue responds immediately');assert.equal(b.pendingJobs,2);
 const persisted=JSON.parse(fs.readFileSync(path.join(dir,'pending-manual-imports.json')));assert.equal(persisted.jobs.length,2);
 assert.throws(()=>first.enqueueManualImport(['relative.jpg'],{wait:false}));
 const calls=[],resolvers=[];
 const restarted=context({isQuitting:false,driveTransfer:true,importPaths:async(paths)=>{calls.push(paths[0]);return new Promise(r=>resolvers.push(r));}});
 const running=restarted.drainManualImports();await tick();assert.equal(calls.length,0,'transfer blocks execution, not enqueue');
 restarted.driveTransfer=false;await new Promise(r=>setTimeout(r,15));assert.deepEqual(calls,['/tmp/a.jpg']);
 resolvers[0]({added:['a'],skipped:[],errors:[]});await tick();assert.deepEqual(calls,['/tmp/a.jpg','/tmp/b.jpg']);
 resolvers[1]({added:['b'],skipped:[],errors:[]});await running;
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'pending-manual-imports.json'))).jobs.length,0);
 restarted.isQuitting=true;
 const legacy=restarted.enqueueManualImport(['/tmp/c.jpg']);assert.equal(typeof legacy.then,'function');
 restarted.isQuitting=false;const drain=restarted.drainManualImports();await tick();resolvers[2]({added:['c']});assert.equal((await legacy).added[0],'c');await drain;
 const broken=context({fs:{...fs,writeFileSync(){throw Error('disk full');}}});
 assert.throws(()=>broken.enqueueManualImport(['/tmp/d.jpg'],{wait:false}),/disk full/);
 assert.equal(vm.runInContext('manualImportJobs.length',broken),0,'failed persistence rolls back queue');
 console.log('PASS: immediate durable enqueue, multiple batches, restart recovery, transfer wait, serial execution, legacy result, failed save rollback');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
