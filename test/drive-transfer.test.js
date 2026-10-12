'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const start=code.indexOf('ipcMain.handle("memories:drive-transfer"');
const end=code.indexOf('// App icon (Dock + BrowserWindow).',start);
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scm-move-test-'));
 try{
  let handler;const l={filenames:['a.jpg','b.jpg'],sources:['original-a','original-b']};
  for(const f of l.filenames)fs.writeFileSync(path.join(dir,f),'fixture');
  const order=[];let fail=false;
  const ctx={fs,path,AbortController,PHOTOS_DIR:dir,driveTransfer:null,importInFlight:false,migrationState:null,
   ipcMain:{handle:(_,fn)=>handler=fn},loadLibrary:()=>l,
   driveReply:async fn=>{try{return {ok:true,...await fn()};}catch(e){return {ok:false,error:e.message};}},
   drive:{status:()=>({connected:true}),createFolder:async()=>({id:'folder',webViewLink:'https://drive.google.com/drive/folders/folder'}),upload:async(file)=>{order.push('verified');if(fail)throw new Error('checksum mismatch');assert(fs.existsSync(file));return {webViewLink:'https://drive.google.com/file/d/test/view'};}},
   persistMovedSource:async()=>order.push('suppressed'),dropQueuedJobs:()=>{},dropQueuedJobsFor:()=>order.push('drop'),
   removeLibraryRow:f=>{assert(!fs.existsSync(path.join(dir,f)));order.push('remove');const i=l.filenames.indexOf(f);l.filenames.splice(i,1);l.sources.splice(i,1);return true;},
   saveLibrary:async()=>order.push('save'),BrowserWindow:{getAllWindows:()=>[]},
  };
  vm.createContext(ctx);vm.runInContext(code.slice(start,end),ctx);
  const event={sender:{isDestroyed:()=>false,send:()=>{}}};
  let result=await handler(event,{filenames:['a.jpg','a.jpg'],mode:'copy'});assert.equal(result.results.length,1);assert(fs.existsSync(path.join(dir,'a.jpg')));assert.equal(l.filenames.length,2);
  order.length=0;fail=true;result=await handler(event,{filenames:['a.jpg'],mode:'move'});assert.equal(result.results[0].ok,false);assert(fs.existsSync(path.join(dir,'a.jpg')));assert.equal(l.filenames.length,2);assert.deepEqual(order,['verified']);
  order.length=0;fail=false;result=await handler(event,{filenames:['a.jpg'],mode:'move'});assert(result.results[0].ok);assert.deepEqual(order,['verified','suppressed','drop','remove','save']);assert.deepEqual(l.filenames,['b.jpg']);
  result=await handler(event,{filenames:['../outside'],mode:'move'});assert.equal(result.ok,false);
  ctx.importInFlight=true;result=await handler(event,{filenames:['b.jpg'],mode:'move'});assert.equal(result.ok,false);assert(fs.existsSync(path.join(dir,'b.jpg')));
  ctx.importInFlight=false;
  ctx.selectedTransferFolder={directory:dir,token:'chosen'};
  ctx.require=()=>require('../main-lib/folder-transfer');
  ctx.drive.status=()=>({connected:false});
  result=await handler(event,{filenames:['b.jpg'],mode:'move',destination:'folder',folderToken:'wrong'});assert.equal(result.ok,false);assert(fs.existsSync(path.join(dir,'b.jpg')));
  result=await handler(event,{filenames:['b.jpg'],mode:'copy',destination:'folder',folderToken:'chosen'});assert.equal(result.results[0].ok,true);assert.equal(fs.readFileSync(path.join(result.folderPath,'b.jpg'),'utf8'),'fixture');assert(fs.existsSync(path.join(dir,'b.jpg')));
  result=await handler(event,{filenames:['b.jpg'],mode:'move',destination:'folder',folderToken:'chosen'});assert.equal(result.results[0].ok,true);assert.equal(fs.readFileSync(path.join(result.folderPath,'b.jpg'),'utf8'),'fixture');assert(!fs.existsSync(path.join(dir,'b.jpg')));assert.equal(l.filenames.length,0);
  console.log('PASS: local folder copy/move without OAuth, invalid picker token; copy preserves local file, move deletes only after verified upload, failure retains file/index, deduplication, path validation and busy guard');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
