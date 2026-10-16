'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/simple/SimpleApp.tsx'),'utf8');
 const code=source.slice(source.indexOf(' async function deleteBatch('),source.indexOf('\n\tconst activeProgress'));
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let removed=[],pending='',calls=0,resolve;
 const asset={filename:'other.jpg',title:'Other',sourcePath:'/other.jpg'};
 const context={assetLocksReady:true,assetLockPending:false,filesLocked:false,selectedLockedCount:0,lockedFiles:new Set(),deleting:false,driveBusy:true,searching:false,preview:false,assets:[asset],selectedFiles:new Set([asset.filename]),sequence:{current:0},closeContextMenu:()=>{},isVideoFile:()=>false,showDeleteToast:()=>{},setDeleting:value=>context.deleting=value,setDeleteProgress:value=>pending=value,setDeleteReport:()=>{},setSearching:()=>{},setTranslating:()=>{},setAssets:fn=>{removed=fn([asset]);},setResults:()=>{},setSelectedFiles:()=>{},setFavorites:()=>{},setSelected:()=>{},window:{confirm:()=>true,memories:{deleteMemory:()=>{calls++;return new Promise(r=>resolve=r);},deleteBatch:async()=>{calls++;return {ok:false,error:'文件属于未完成任务'};}}}};
 vm.createContext(context);vm.runInContext(js,context);
 const task=context.deleteAsset(asset,true);
 assert.equal(calls,1);assert(context.deleting);assert.match(pending,/等待当前文件/);
 resolve({ok:true});await task;assert.equal(context.deleting,false);assert.equal(pending,'');assert.equal(removed.length,0);
 removed=[asset];await context.deleteBatch();assert.equal(calls,2);assert.equal(removed.length,1);
 context.filesLocked=true;await context.deleteAsset(asset,true);assert.equal(calls,2);
 console.log('PASS: busy transfer permits delete IPC, pending message shown, conflicts retain rows, lock still blocks');
})().catch(error=>{console.error(error);process.exitCode=1;});
