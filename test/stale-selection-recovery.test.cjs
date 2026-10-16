const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'../src/simple/DriveTransfer.tsx'),'utf8');
(async()=>{
 let hidden=new Set(['old']),stats=0;const ctx={Object,loadLibrary:()=>({filenames:['old','good','locked','burst'],sources:['/old','/good','/locked','/burst']}),path,require:n=>n.includes('selection-limit')?require('../main-lib/selection-limit'):{trashed:async()=>hidden},assetLocks:new Set(['locked']),PHOTOS_DIR:'/refs',taskSignature:()=>'',fs:{promises:{stat:async()=>{stats++;return{};},lstat:async()=>{stats++;return{};}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function captureTaskRows('),source.indexOf('async function assertTaskRow(')),ctx);
 await assert.rejects(ctx.captureTaskRows(['old','good']),e=>JSON.stringify(e.staleFilenames)==='["old"]');assert.equal(stats,0);
 await assert.rejects(ctx.captureTaskRows(['absent','good']),e=>JSON.stringify(e.staleFilenames)==='["absent"]');
 hidden=new Set(['locked']);assert.equal((await ctx.captureTaskRows(['locked','burst'])).length,2,'locked history and burst not treated as stale');
 const reply=source.slice(source.indexOf('const driveReply ='),source.indexOf('ipcMain.handle("memories:restore-locked-photos"'));vm.runInContext(reply+'\nglobalThis.reply=driveReply;',ctx);const err=Object.assign(Error('expired'),{staleFilenames:['old']});assert.deepEqual(Array.from((await ctx.reply(()=>{throw err})).staleFilenames),['old']);
 const transfer=ui.slice(ui.indexOf(' async function transfer()'),ui.indexOf(' const label ='));
 for(const batch of [['old'],['old','good','burst']]){
  const state={};let calls=0;const c={filesLocked:false,mode:'move',batch,folderName:'test',destination:'folder',folder:{token:'t'},localTransfer:{current:false},window:{memories:{driveTransfer:async()=>{calls++;return{ok:false,staleFilenames:['old'],error:'expired'};}}},onBusy:v=>state.busy=v,onComplete:(removed,notice)=>{state.removed=removed;state.notice=notice;},Set,Error};for(const n of ['Busy','Error','Started','Open','Progress','Batch','Report','RecoveredOpen'])c['set'+n]=v=>state[n]=v;
  vm.createContext(c);vm.runInContext(ts.transpileModule(transfer,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);await c.transfer();assert.equal(calls,1,'no automatic retry');assert.deepEqual(Array.from(state.Batch),batch.filter(x=>x!=='old'));assert.deepEqual(Array.from(state.removed),['old']);assert.equal(state.Open,batch.length>1);assert.equal(state.Started,false);assert.equal(state.busy,false);assert.equal(c.localTransfer.current,false);assert.match(state.notice,/未执行本次传输/);
 }
 console.log('PASS stale and mixed selections: precise removal, locked/burst retained, no file operations, single request, no retry, modal closes when empty');
})().catch(e=>{console.error(e);process.exitCode=1});
