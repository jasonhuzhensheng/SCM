const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {verifyDuplicate} = require('../main-lib/duplicate-cleanup');
(async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'duplicate-cleanup-'));
 try {
  const a=path.join(dir,'a'), b=path.join(dir,'b');
  fs.writeFileSync(a,'original'); fs.writeFileSync(b,'original');
  const hash=crypto.createHash('sha256').update('original').digest('hex');
  const library={filenames:['a','b'],sources:[a,b],hashes:[hash,hash]};
  const options={library,filename:'b',keeper:'a',isLocked:name=>name==='a'};
  await verifyDuplicate(options);
  await assert.rejects(verifyDuplicate({...options,isLocked:()=>false}));
  await assert.rejects(verifyDuplicate({...options,isLocked:()=>true}));
  await assert.rejects(verifyDuplicate({...options,keeper:'missing'}));
  library.sources[1]=a; await assert.rejects(verifyDuplicate(options)); library.sources[1]=b;
  fs.writeFileSync(b,'changed!'); await assert.rejects(verifyDuplicate(options),/内容/);
  fs.unlinkSync(b); await assert.rejects(verifyDuplicate(options));
  fs.symlinkSync(a,b); await assert.rejects(verifyDuplicate(options),/普通文件/);
  fs.unlinkSync(b); fs.linkSync(a,b); await assert.rejects(verifyDuplicate(options),/普通文件/);
  fs.unlinkSync(b); fs.writeFileSync(b,'original'); fs.unlinkSync(a); await assert.rejects(verifyDuplicate(options));
  assert.equal(fs.readFileSync(b,'utf8'),'original');
  // Exercise the actual IPC handler: failed revalidation must never reach trash or cleanup.
  const vm=require('node:vm'), source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  let handler, trashCalls=0;
  const context={fs,path,AbortController,assetLocks:{has:options.isLocked},filesLocked:()=>false,driveTransfer:null,migrationState:false,
   loadLibrary:()=>library,ipcMain:{handle:(_name,fn)=>handler=fn},
   require:()=>({verifyDuplicate}),shell:{trashItem:()=>{trashCalls++;}},persistMovedSource:()=>{throw Error('must not mutate');}};
  const start=source.indexOf('ipcMain.handle("memories:delete",');
  vm.runInNewContext(source.slice(start,source.indexOf('\n// Current AI-engine status',start)),context);
  const result=await handler(null,'b',{original:true,duplicateKeeper:'a'});
  assert.equal(result.ok,false);assert.equal(trashCalls,0);assert.equal(context.driveTransfer,null);
  assert.equal(fs.readFileSync(b,'utf8'),'original');
  console.log('PASS: fresh content verification, missing/changed original, locked target, aliases, links, unknown keeper rejected; files untouched');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
