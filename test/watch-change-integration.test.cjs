'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const root=fs.mkdtempSync('/private/tmp/sayphoto-watch-test-');
(async()=>{
 const a=path.join(root,'a.jpg');fs.writeFileSync(a,'fixture');
 const calls=[],timers=[];let notify;
 const context={require:n=>require('../'+n.slice(2)),fs:{promises:fs.promises,watch:(_p,...args)=>{notify=args.at(-1);return {on(){}}}},console,
 watchedFolders:[root],importInFlight:false,migrationState:null,driveTransfer:null,folderWatchers:new Map(),watchFailedFolders:new Set(),watchDebounceTimers:new Map(),WATCH_DEBOUNCE_MS:3000,
 setTimeout:f=>{timers.push(f);return f},clearTimeout:f=>{const i=timers.indexOf(f);if(i>=0)timers.splice(i,1)},importPaths:async(paths,options)=>calls.push({paths:Array.from(paths),options})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function syncWatchedFolder('),source.indexOf('// Load the persisted list, arm every watcher')),context);
 context.watchFolder(root);notify('change','a.jpg');notify('change','a.jpg');assert.equal(timers.length,1);timers.shift()();await new Promise(r=>setTimeout(r,30));assert.deepEqual(calls.pop().paths,[a]);
 context.importInFlight=true;await context.syncWatchedFolder(root,[a]);assert.equal(calls.length,0);context.importInFlight=false;await timers.shift()();assert.deepEqual(calls.pop().paths,[a]);
 await context.syncWatchedFolder(root);assert.deepEqual(calls.pop().paths,[root],'startup/poll stays full scan');
 fs.unlinkSync(a);await context.syncWatchedFolder(root,[a]);assert.deepEqual(calls.pop().paths,[root],'rename/missing falls back');
 context.watchedFolders=[];await context.syncWatchedFolder(root,[a]);assert.equal(calls.length,0,'unwatch prevents retry');
 context.watchedFolders=[root];fs.rmdirSync(root);await context.syncWatchedFolder(root);assert.equal(calls.length,0,'offline never imports or deletes');
 console.log('PASS actual watcher functions: deduped event, busy retry, startup/poll, missing file, unwatch, offline');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
