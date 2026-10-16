'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createPhotoDeletion}=require('../main-lib/photo-deletion');const {digest}=require('../main-lib/folder-transfer');
const sig=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
(async()=>{const root=await fsp.mkdtemp(path.join(os.tmpdir(),'isolated-transfer-'));try{
 const out=path.join(root,'out');await fsp.mkdir(out);const rows=[];
 for(const name of ['good','missing','locked','invalid']){const source=path.join(root,name);await fsp.writeFile(source,Buffer.alloc(10000,1));rows.push({filename:name,source,originalSignature:sig(await fsp.stat(source))});}await fsp.unlink(rows[1].source);
 const job={id:'test',status:'running',done:0,total:4,payload:{mode:'move',localFolder:true,rows},folder:{localPath:out},photoBatch:{entries:rows.map((r,index)=>({index,journal:{filename:r.filename}}))}};
 const commits=[];const deletion=createPhotoDeletion({directory:path.join(root,'receipts'),bridge:async r=>{commits.push(r);return {verified:true};}});
 const ctx={fs,path,require:s=>require(s.replace('./main-lib/','../main-lib/')),driveTransfer:{},servicePendingDeletes:async()=>{},filesLocked:()=>false,assetLocks:new Set(['locked']),FILE_LOCK_ERROR:'locked',assertPhotoAssetUnlocked:s=>{if(s===rows[2].source)throw Error('locked');},loadLibrary:()=>({filenames:rows.map(r=>r.filename),sources:rows.map(r=>r.source)}),taskSignature:sig,sameOriginalIdentity:(a,b)=>a===b,getPhotoDeletion:()=>deletion,
 trashTransferredOriginal:async(view,row)=>{if(row.filename==='invalid')throw Error('bad resource');const hash=await digest(row.source);view.current.photosPrepared={id:row.filename,hash,size:10000,resources:[{hash,size:10000}],deletedBytes:10000};view.current.photoTarget={file:path.join(out,row.filename),signature:sig(await fsp.stat(path.join(out,row.filename))),hash};}};
 const src=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('async function prepareTransferredPhotoBatch('),src.indexOf('async function runTransferTask(')),ctx);
 await ctx.prepareTransferredPhotoBatch(job,()=>{},()=>false,new AbortController().signal,()=>{});
 assert.equal(commits.length,1);assert.deepEqual(commits[0].items.map(i=>i.id),['good']);assert(job.photoBatch.confirmed);
 const [good,missing,locked,invalid]=job.photoBatch.entries.map(e=>e.journal);
 assert(good.originalTrashed);assert(missing.copyError);assert(locked.remote&&locked.deferredCopy.verified&&locked.retainOriginal);assert(!locked.originalTrashed);assert.match(invalid.validationError,/bad resource/);
 assert(fs.existsSync(rows[2].source));assert(fs.existsSync(path.join(out,'locked')));
 // Round-trip persistence: confirmed subset journals must remain associated with outer entries.
 const restored=JSON.parse(JSON.stringify(job));assert(restored.photoBatch.entries[0].journal.originalTrashed);assert(!restored.photoBatch.entries[2].journal.originalTrashed);
 // A lock added after preparation must still prevent deletion at the final gate.
 const late={id:'late',status:'running',done:0,total:1,payload:{mode:'move',localFolder:true,rows:[rows[0]]},folder:{localPath:out},photoBatch:{entries:[{index:0,journal:{filename:'good',remote:good.remote,deferredCopy:good.deferredCopy}}]}};
 const originalPrepare=ctx.trashTransferredOriginal;ctx.trashTransferredOriginal=async(...args)=>{await originalPrepare(...args);ctx.assetLocks.add('good');};
 await ctx.prepareTransferredPhotoBatch(late,()=>{},()=>false,new AbortController().signal,()=>{});
 assert.equal(commits.length,1,'late lock yields no additional delete request');assert(late.photoBatch.entries[0].journal.retainOriginal);assert(late.photoBatch.confirmed);
 console.log('PASS: missing/verification failures isolated; locked file copied and verified, never submitted for deletion; healthy file committed; journals survive persistence');
}finally{await fsp.rm(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
