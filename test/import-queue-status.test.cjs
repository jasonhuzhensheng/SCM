'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'queue-status-'));
try{
const handlers={};let paused=false;
const ctx={fs,path,require,console,DATA_DIR:dir,isQuitting:true,importInFlight:false,migrationState:false,startupModelPending:false,driveTransfer:{},setTimeout,ipcMain:{handle:(key,fn)=>handlers[key]=fn},importControl:{snapshot:()=>({type:'import',active:false,phase:'done',done:0,total:0}),setPaused:value=>{paused=value;return {active:false,phase:'done'};}}};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const manualImportStateFile ='),source.indexOf('async function pickAndImport(')),ctx);
vm.runInContext(source.slice(source.indexOf('ipcMain.handle("memories:import-state"'),source.indexOf('ipcMain.handle("memories:pick"')),ctx);
ctx.enqueueManualImport(['/tmp/one'],{wait:false});ctx.enqueueManualImport(['/tmp/two'],{wait:false});
let state=handlers['memories:import-state']();assert.equal(state.phase,'waiting');assert.equal(state.pendingJobs,2);assert.match(state.waitingReason,/传输或删除/);
handlers['memories:import-pause']({},true);assert.equal(handlers['memories:import-state']().paused,true);
handlers['memories:import-pause']({},false);assert.equal(paused,false);assert.equal(handlers['memories:import-state']().phase,'waiting','resume does not bypass transfer guard');
ctx.importControl.snapshot=()=>({active:true,phase:'embedding',done:3,total:10});state=handlers['memories:import-state']();assert.equal(state.done,3);assert.equal(state.pendingJobs,2);assert.equal(state.phase,'embedding');
console.log('PASS: durable queue snapshot, waiting reason, pause/resume during transfer, active progress plus queued batches');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
