'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFileTasks}=require('../main-lib/file-tasks');
const {assertAvailable}=require('../main-lib/task-conflicts');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sayphoto-interleave-'));
 const stores=[];
 try {
  const entered=gate(),release=gate(),events=[];
  let store;
  store=createFileTasks(path.join(root,'tasks.json'),{
   transfer:async(job,save,stopped)=>{events.push('transfer-start');entered.resolve();await release.promise;await store.runPendingDeletes(job.id);assert(!stopped());events.push('transfer-resumed');job.done=1;save();return {results:[]};},
   delete:async(job,save)=>{events.push('delete');job.results.push({filename:'other',ok:true});job.done=1;save();return {results:job.results};}
  },()=> '');stores.push(store);
  const transfer=store.add('transfer',{rows:[{filename:'moving',source:'/moving'}],mode:'move'},1);
  await entered.promise;
  assert.throws(()=>store.add('delete',{rows:[{filename:'moving',source:'/moving'}]},1),/未完成/);
  const deletion=store.add('delete',{rows:[{filename:'other',source:'/other'}]},1);
  assert.deepEqual(events,['transfer-start']);release.resolve();
  await Promise.all([transfer.promise,deletion.promise]);
  assert.deepEqual(events,['transfer-start','delete','transfer-resumed']);
  assert(store.snapshot().every(j=>j.status==='complete'));
  const persisted=JSON.parse(fs.readFileSync(path.join(root,'tasks.json')));assert(persisted.every(j=>j.done===1));
  // Failure in the foreground is durable and does not break the background job.
  const entered2=gate(),release2=gate();let resumed=false;
  let failing;failing=createFileTasks(path.join(root,'fail.json'),{
   transfer:async(job)=>{entered2.resolve();await release2.promise;await failing.runPendingDeletes(job.id);resumed=true;return {};},
   delete:async()=>{throw Error('temporary failure');}
  },()=> '');stores.push(failing);
  const t=failing.add('transfer',{rows:[{filename:'a'}]},1);await entered2.promise;
  const d=failing.add('delete',{rows:[{filename:'b'}]},1);const rejection=assert.rejects(d.promise,/temporary failure/);release2.resolve();await Promise.all([t.promise,rejection]);
  assert(resumed);assert.equal(failing.snapshot().find(j=>j.kind==='delete').status,'waiting');
  // Alias/Photos/target-folder and paused-job reservations are protected.
  const source='/Pictures/A.photoslibrary/originals/a/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.jpg';
  const job={kind:'transfer',status:'paused',done:0,payload:{rows:[{filename:'a',source,originalSignature:'1:2:3:4:5'}]},folder:{localPath:'/target'}};
  for(const row of [{filename:'alias',source},{filename:'live',source:source.replace('.jpg','.mov')},{filename:'hardlink',source:'/alias',originalSignature:'1:2:8:9:10'},{filename:'target',source:'/target/resources/raw.dng'}]){
   assert.throws(()=>assertAvailable([job],'delete',{rows:[row]}),/未完成/);
  }
  assert.doesNotThrow(()=>assertAvailable([job],'delete',{rows:[{filename:'unrelated',source:'/target-other/x'}]}));
  assert.throws(()=>assertAvailable([job],'delete',{rows:[{filename:'b'}],protectedRows:[{filename:'a'}]}),/未完成/);
  assert.throws(()=>assertAvailable([{...job,status:'cancelled',photoBatch:{requested:true}}],'delete',{rows:[{filename:'a'}]}),/未完成/);
  assert.throws(()=>assertAvailable([{...job,id:'active',status:'cancelled'}],'delete',{rows:[{filename:'a'}]},new Set(['active'])),/未完成/);
  assert.doesNotThrow(()=>assertAvailable([{...job,status:'complete'}],'delete',{rows:[{filename:'a'}]}));
  // Real handoff wrapper restores controller and task identity even on failure.
  const vm=require('node:vm');
  const main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const wrapper=main.slice(main.indexOf('async function servicePendingDeletes('),main.indexOf('async function prepareTransferredPhotoBatch('));
  const controller=new AbortController();
  const context={driveTransfer:controller,activeFileTaskID:'parent',getFileTasks:()=>({runPendingDeletes:async id=>{assert.equal(id,'parent');assert.equal(context.driveTransfer,null);context.activeFileTaskID='child';throw Error('failure');}})};
  vm.createContext(context);vm.runInContext(wrapper+';this.service=servicePendingDeletes;',context);
  await assert.rejects(context.service({id:'parent'},controller),/failure/);
  assert.equal(context.driveTransfer,controller);assert.equal(context.activeFileTaskID,'parent');
  // Pausing a parent while a nested delete runs must not cancel the child.
  const entered3=gate(),release3=gate();let parentStopped=false,childCompleted=false;
  let pausing;pausing=createFileTasks(path.join(root,'pause.json'),{
   transfer:async(job,save,stopped)=>{entered3.resolve();await release3.promise;await pausing.runPendingDeletes(job.id);parentStopped=stopped();return {};},
   delete:async(job,save,stopped)=>{pausing.pause(parent.id);assert(!stopped());childCompleted=true;return {};}
  },()=> '');stores.push(pausing);
  const parent=pausing.add('transfer',{rows:[{filename:'parent'}]},1);await entered3.promise;
  const child=pausing.add('delete',{rows:[{filename:'child'}]},1);release3.resolve();await Promise.all([parent.promise,child.promise]);
  assert(parentStopped&&childCompleted);assert.equal(pausing.snapshot().find(j=>j.id===parent.id).status,'paused');
  const transferController=new AbortController(),deleteController=new AbortController();
  const handlers={};let pausedId;
  const ipcContext={activeTransferTask:{id:'background',controller:transferController},activeFileTaskID:'foreground',driveTransfer:deleteController,ipcMain:{handle:(name,handler)=>handlers[name]=handler},getFileTasks:()=>({pause:id=>pausedId=id,cancel:()=>{}})};
  vm.createContext(ipcContext);
  vm.runInContext(main.slice(main.indexOf('ipcMain.handle("memories:drive-pause"'),main.indexOf('ipcMain.handle("memories:drive-transfer"')),ipcContext);
  handlers['memories:drive-pause']();assert.equal(pausedId,'background');assert(transferController.signal.aborted);assert(!deleteController.signal.aborted);
  console.log('PASS: interleaved delete precedes transfer completion, errors persist, transfer resumes, conflicts protected');
 }finally{for(const store of stores)store.stop();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
