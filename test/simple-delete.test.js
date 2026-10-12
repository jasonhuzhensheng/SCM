const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scm-delete-test-'));
 try {
  const filename='photo.jpg',original=path.join(root,'original.jpg'),managed=path.join(root,filename);fs.writeFileSync(original,'original');fs.writeFileSync(managed,'copy');
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');const a=source.indexOf('ipcMain.handle("memories:delete",'),b=source.indexOf('// Current AI-engine status',a);
  let handler,removed=false,suppressed=false,saved=false;
  const ctx={fs,path,AbortController,PHOTOS_DIR:root,driveTransfer:null,importInFlight:false,migrationState:null,ipcMain:{handle:(_,fn)=>handler=fn},loadLibrary:()=>({filenames:[filename],sources:[original]}),persistMovedSource:async file=>{assert.equal(file,original);suppressed=true;},removeLibraryRow:()=>{removed=true;assert(!fs.existsSync(managed));return true;},saveLibrary:async()=>saved=true,dropQueuedJobsFor:()=>{},BrowserWindow:{getAllWindows:()=>[]},broadcastEnrichEvent:()=>{},enrichSnapshot:()=>{},broadcastTranscribeEvent:()=>{},transcribeSnapshot:()=>{},broadcastOcrEvent:()=>{},ocrSnapshot:()=>{}};
  vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
  assert.equal((await handler({},'../original.jpg')).ok,false);assert(!removed);
  ctx.migrationState={};assert.equal((await handler({},filename)).ok,false);ctx.migrationState=null;
  ctx.driveTransfer={};assert.equal((await handler({},filename)).ok,false);ctx.driveTransfer=null;
  ctx.importInFlight=true; // An ongoing import must not disable deletion of an existing row.
  const unlink=fs.promises.unlink;const fake={...fs,promises:{...fs.promises,unlink:async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});}}};ctx.fs=fake;
  assert.equal((await handler({},filename)).ok,false);assert(!removed);assert(fs.existsSync(managed));assert.equal(ctx.driveTransfer,null);
  ctx.fs=fs;assert.equal((await handler({},filename)).ok,true);assert(removed&&saved&&suppressed);assert.equal(fs.readFileSync(original,'utf8'),'original');assert.equal(ctx.driveTransfer,null);
  fs.writeFileSync(managed,'copy');removed=false;ctx.shell={trashItem:async()=>{throw Error('denied');}};
  assert.equal((await handler({},filename,{original:true})).ok,false);assert(!removed);assert(fs.existsSync(original));assert(fs.existsSync(managed));assert.equal(ctx.driveTransfer,null);
  ctx.shell={trashItem:async file=>{assert.equal(file,original);fs.renameSync(file,path.join(root,'trashed-original'));}};
  assert.equal((await handler({},filename,{original:true})).ok,true);assert(removed);assert(!fs.existsSync(original));assert.equal(fs.readFileSync(path.join(root,'trashed-original'),'utf8'),'original');assert(!fs.existsSync(managed));
  fs.writeFileSync(managed,'copy');ctx.shell={trashItem:async()=>{throw Error('missing');}};assert.equal((await handler({},filename,{original:true})).ok,true);assert(!fs.existsSync(managed));
  console.log('PASS: deletion during import; migration/transfer guards; original-trash success/failure/missing; original preserved by library-only deletion');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
