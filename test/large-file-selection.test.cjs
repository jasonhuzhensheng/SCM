'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const asarPath=process.argv[2];
const source=asarPath?require('@electron/asar').extractFile(asarPath,'main.js').toString():fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const sourceLimit=asarPath?require('@electron/asar').extractFile(asarPath,'main-lib/selection-limit.js').toString():fs.readFileSync(path.join(__dirname,'../main-lib/selection-limit.js'),'utf8');
const limitModule={exports:{}};vm.runInNewContext(sourceLimit,{module:limitModule});const limit=limitModule.exports;
(async()=>{
 let captured=0,adds=0,handler,hidden=new Set(),mutate=false;
 const library={filenames:[],sources:[]};for(let i=0;i<100000;i++){library.filenames.push(`file-${i}.jpg`);library.sources.push(`/originals/${i}.jpg`);}
 const context={require:n=>n.includes('selection-limit')?limit:{trashed:async()=>{if(mutate){library.filenames.shift();library.sources.shift();}return hidden;}},path,fs:{promises:{stat:async()=>({}),lstat:async()=>({})}},PHOTOS_DIR:'/refs',loadLibrary:()=>library,assetLocks:new Set(),filesLocked:()=>false,FILE_LOCK_ERROR:'locked',driveTransfer:null,selectedTransferFolder:{token:'chosen',directory:'/out',identity:'same'},drive:{status:()=>({connected:true})},taskSignature:()=> 'sig',ipcMain:{handle:(n,h)=>handler=h},driveReply:async fn=>{try{return {ok:true,...await fn()};}catch(e){return {ok:false,error:e.message};}},getFileTasks:()=>({add:(kind,payload,total)=>{adds++;captured=total;return {promise:Promise.resolve({total})};}})};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('async function captureTaskRows('),source.indexOf('async function assertTaskRow(')),context);
 vm.runInContext(source.slice(source.indexOf('ipcMain.handle("memories:drive-transfer"'),source.indexOf('function photoAssetKey(')),context);
 const request=names=>handler(null,{mode:'move',destination:'folder',folderToken:'chosen',filenames:names});
 for(const n of [1,9999,10000]){const r=await request(library.filenames.slice(0,n));assert.equal(r.ok,true);assert.equal(captured,n);}
 let before=adds,r;for(const n of [10001,22424,100000]){r=await request(library.filenames.slice(0,n));assert.equal(r.ok,false);assert.match(r.error,/10,000/);assert.equal(adds,before);}
 context.assetLocks.add('file-1.jpg');r=await request(['file-1.jpg']);assert.equal(r.ok,false);assert.match(r.error,/locked/);context.assetLocks.clear();
 for(const names of [['../outside'],[''],[null],['missing.jpg']]){r=await request(names);assert.equal(r.ok,false);}
 hidden=new Set(['file-2.jpg']);r=await request(['file-2.jpg']);assert.equal(r.ok,false);assert.match(r.error,/最近删除/);assert.equal(adds,before);
 hidden=new Set();mutate=true;const rows=await context.captureTaskRows(['file-0.jpg','file-1.jpg']);assert.deepEqual(Array.from(rows,r=>r.source),['/originals/0.jpg','/originals/1.jpg'],'selection identities stay paired across library updates');
 console.log('PASS: 1 / 9,999 / 10,000 accepted; 10,001 / 22,424 / 100,000 explicit limit; locked, trashed, invalid and stale selections refused; source identity stable. No real file operations.');
})().catch(e=>{console.error(e);process.exitCode=1;});
