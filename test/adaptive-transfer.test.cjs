'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createResourceGate,GiB,validateTarget}=require('../main-lib/adaptive-resources');
const {createFileTasks}=require('../main-lib/file-tasks');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sayphoto-storage-recovery-'));
 let store;
 try {
  const target={directory:root,uuid:'test-volume'};let online=true,uuid=target.uuid,free=8*GiB;
  const identify=async()=>{if(!online)throw Error('等待原磁盘连接');return {...target,uuid}};
  const gate=createResourceGate({directory:root,probe:async()=>({freeBytes:free})});
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const context={Map,Number,Error,Promise,fs,resourceGate:gate,resourceSummary:()=>({count:0}),app:{getPath:()=>root},adaptiveResources:{GiB,resourcePlan:require("../main-lib/adaptive-resources").resourcePlan,probeSpace:async()=>({freeBytes:free}),validateTarget:t=>validateTarget(t,identify),createResourceGate}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const targetResourceGates ='),source.indexOf('async function runTransferTask(')),context);
  const payload={localFolder:true,destination:root,storageIdentity:target,mode:'copy',rows:[{filename:'one.jpg',signature:'1:2:1073741824:4:5'}]};
  const release=await context.reserveTransferStorage({payload,done:0});assert(gate.snapshot().reservedBytes>GiB);
  await release.check();free=GiB;await assert.rejects(release.check(),/空间恢复/);free=8*GiB;
  release();assert.equal(gate.snapshot().reservedBytes,0);
  free=GiB;await assert.rejects(context.reserveTransferStorage({payload,done:0}),/空间不足/);
  free=8*GiB;uuid='replacement';await assert.rejects(context.reserveTransferStorage({payload,done:0}),/身份/);
  uuid=target.uuid;online=false;
  let completed=0;
  const handler=async(job,save)=>{const release=await context.reserveTransferStorage(job);try{completed++;job.done=1;save();return {ok:true}}finally{release()}};
  const file=path.join(root,'file-tasks.json');store=createFileTasks(file,{transfer:handler},()=> '');
  const task=store.add('transfer',payload,1);await assert.rejects(task.promise,/原磁盘/);
  assert.equal(store.snapshot()[0].status,'waiting');assert.equal(completed,0);store.stop();await store.settle();
  // Restart with persisted identity and cursor. Make the saved retry immediately eligible.
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));saved[0].nextAttemptAt=0;fs.writeFileSync(file,JSON.stringify(saved));
  online=true;store=createFileTasks(file,{transfer:handler},()=> '');store.start();
  const deadline=Date.now()+5000;while(store.snapshot()[0].status!=='complete'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.equal(store.snapshot()[0].status,'complete');assert.equal(completed,1);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8'))[0].payload.storageIdentity.uuid,target.uuid);
  console.log('PASS: real transfer preflight, shared application-volume reservations, low-space denial, replacement volume denied, durable waiting job resumes after restart/reconnection');
 }finally{store?.stop();await store?.settle();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
