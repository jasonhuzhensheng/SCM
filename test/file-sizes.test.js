const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'scm-sizes-test-'));
 try {
  fs.writeFileSync(path.join(directory,'a.jpg'),'12345');fs.mkdirSync(path.join(directory,'folder'));
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),start=source.indexOf('ipcMain.handle("memories:file-sizes",'),end=source.indexOf('ipcMain.handle("memories:photo-locations",',start);
  let handler;const context={fs,path,PHOTOS_DIR:directory,ipcMain:{handle:(_,fn)=>handler=fn},loadLibrary:()=>({filenames:['a.jpg','missing.jpg','folder']}),require:()=>require('../indexer/index-performance')};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const rows=await handler({},['a.jpg','a.jpg','missing.jpg','folder','not-in-library.jpg']);
  assert.equal(JSON.stringify(rows),JSON.stringify([{filename:'a.jpg',size:5},{filename:'missing.jpg',size:null},{filename:'folder',size:null}]));
  await assert.rejects(handler({},['../outside.jpg']));await assert.rejects(handler({},Array(101).fill('a.jpg')));await assert.rejects(handler({},[null]));
  console.log('PASS: real managed-file sizes, deduplication, missing/unknown files, directory exclusion, traversal and batch bounds');
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
