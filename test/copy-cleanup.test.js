const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCopyCleanup}=require('../main-lib/copy-cleanup');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-'));const dir=path.join(root,'photos');fs.mkdirSync(dir);
 try {
  const original=path.join(root,'original');fs.writeFileSync(original,'abc');
  fs.writeFileSync(path.join(dir,'same'),'abc');fs.writeFileSync(path.join(dir,'different'),'xyz');fs.writeFileSync(path.join(dir,'missing'),'abc');fs.symlinkSync('/missing-original',path.join(dir,'offline'));
  const manager=createCopyCleanup();const rows=[['same',original],['different',original],['missing','/missing-original'],['offline','/missing-original']].map(([filename,source])=>({filename,source}));
  const result=await manager.run(dir,rows);assert.equal(result.converted,1);assert.equal(result.bytes,3);assert.equal(result.reasons.different,1);assert.equal(result.reasons.missing,1);assert.equal(result.reasons.reference,1);assert.equal(fs.readFileSync(original,'utf8'),'abc');assert(fs.lstatSync(path.join(dir,'same')).isSymbolicLink());assert.equal(fs.readFileSync(path.join(dir,'different'),'utf8'),'xyz');
  const again=await manager.run(dir,rows);assert.equal(again.converted,0);
  const cancelled=await manager.run(dir,rows,()=>true);assert(cancelled.cancelled);assert.equal(cancelled.done,0);
  console.log('PASS: full-content mismatch preserved, originals preserved, missing/offline entries preserved, reruns and cancellation');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
