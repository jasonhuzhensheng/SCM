'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const identity=s=>s.split(':').slice(0,4).join(':');
// Copy only: native/APFS copy when possible, no content reads for verification.
async function copyOne(source,target,signal,progress) {
 const before=await fs.promises.lstat(source);
 if(!before.isFile())throw Error('原件不是普通文件');
 const partial=path.join(path.dirname(target),`.sayphoto-copy-${crypto.randomUUID()}.partial`);
 let timer;
 try {
  signal.throwIfAborted();progress(0,before.size);
  timer=setInterval(()=>{void fs.promises.lstat(partial).then(s=>progress(Math.min(s.size,before.size),before.size)).catch(()=>{});},500);timer.unref();
  await fs.promises.copyFile(source,partial,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE);
  clearInterval(timer);
  signal.throwIfAborted();
  const handle=await fs.promises.open(partial,'r+');try{await handle.sync();}finally{await handle.close();}
  const after=await fs.promises.lstat(source),copied=await fs.promises.lstat(partial);
  if(signature(before)!==signature(after)||!copied.isFile()||copied.size!==before.size)throw Error('复制期间文件发生变化');
  await fs.promises.link(partial,target);await fs.promises.unlink(partial);
  const final=await fs.promises.lstat(target);
  progress(before.size,before.size);
  return {sourceSignature:signature(after),targetSignature:signature(final),verified:false};
 }finally{clearInterval(timer);await fs.promises.unlink(partial).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function copyAll(job,save,stopped,signal,emit,guard) {
 const errors=[];
 for(const entry of job.photoBatch.entries){
  signal.throwIfAborted();if(stopped())throw Error('复制已暂停');
  const row=job.payload.rows[entry.index],j=entry.journal;
  if(j.originalTrashed)continue;
  try{
   await guard(row);
   const source=await fs.promises.lstat(row.source);
   if(!source.isFile()||identity(signature(source))!==identity(row.originalSignature))throw Error('原件身份已变化');
   const target=path.join(job.folder.localPath,row.filename);
   if(path.basename(row.filename)!==row.filename)throw Error('无效目标文件名');
   let existing;try{existing=await fs.promises.lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(existing){
    if(!existing.isFile()||existing.isSymbolicLink())throw Error('目标类型已变化');
    if(!j.remote&&!j.deferredCopy&&!j.photoTarget){
     // A power loss can publish a copy after the last coalesced checkpoint.
     // Adopt only a byte-identical, independent target; never overwrite it.
     if(source.dev===existing.dev&&source.ino===existing.ino)throw Error('目标与原文件相同');
     if(source.size!==existing.size)throw Error('目标缺少任务复制记录且大小不同，未覆盖');
     const {digest}=require('./folder-transfer');
     const sourceHash=await digest(row.source,signal),targetHash=await digest(target,signal);
     if(sourceHash!==targetHash||signature(await fs.promises.lstat(row.source))!==signature(source)||signature(await fs.promises.lstat(target))!==signature(existing))throw Error('目标缺少任务复制记录且内容或身份不一致，未覆盖');
     j.deferredCopy={sourceSignature:signature(source),targetSignature:signature(existing),verified:false,recoveredHash:sourceHash};
    }
    // Existing files are candidates, not verified copies. Read content in phase two.
    if(!j.remote)j.remote={localPath:target};
    if(!j.deferredCopy)j.deferredCopy={sourceSignature:signature(source),targetSignature:j.photoTarget?.signature||signature(existing),verified:!!j.photoTarget};
   }else{
    emit({filename:row.filename,phase:'copying-first',percent:0,currentBytes:0,currentTotal:source.size,transferredBytes:0});
    const disk=await fs.promises.statfs(job.folder.localPath);
    if(disk.bavail*disk.bsize<source.size+2*1024**3)throw Error('磁盘空间不足，原件保留');
    const repairState=j.deferredCopy ? {repairs:j.deferredCopy.repairs,repairBackup:j.deferredCopy.repairBackup} : {};
    const copiedProof=await copyOne(row.source,target,signal,(sent,size)=>emit({filename:row.filename,phase:'copying-first',percent:size?Math.floor(sent/size*100):100,currentBytes:sent,currentTotal:size,transferredBytes:sent}));
    j.deferredCopy={...copiedProof,...repairState};
    j.remote={localPath:target};delete j.photoTarget;j.resourcesVerified=false;
   }
   delete j.copyError;save({checkpoint:true});
  }catch(e){if(signal.aborted||stopped())throw e;j.copyError=e.message;errors.push(`${row.filename}：${e.message}`);save({checkpoint:true});}
 }
 job.copyFailures=errors.length;
 job.copyFirstComplete=true;save();emit({filename:'',phase:'verifying',percent:0,currentBytes:0,currentTotal:0});
}
// System-copy policy: metadata checks only, never a content hash claim.
async function simpleCopy(source,filename,directory,signal,progress,journal,save) {
 if(path.basename(filename)!==filename)throw Error('无效目标文件名');
 const target=path.join(directory,filename);
 signal.throwIfAborted();
 const src=await fs.promises.lstat(source);
 if(!src.isFile())throw Error('原件不是普通文件');
 let dst;try{dst=await fs.promises.lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 const proof=journal.deferredCopy;
 const recorded=proof?.targetSignature || journal.photoTarget?.signature;
 if(dst){
  if(!dst.isFile() || (src.dev===dst.dev && src.ino===dst.ino))throw Error('目标不是独立普通文件');
  if(!recorded || journal.remote?.localPath!==target)throw Error('目标缺少系统复制记录，未覆盖');
  if(proof && identity(signature(src))!==identity(proof.sourceSignature))throw Error('原件身份已变化');
  if(dst.size!==src.size || identity(signature(dst))!==identity(recorded)){
   // Retain a changed destination. Never overwrite an unrelated replacement.
   if(signature(dst).split(':').slice(0,2).join(':')!==recorded.split(':').slice(0,2).join(':'))throw Error('目标身份已变化');
   const backup=target+'.failed-'+crypto.randomUUID();
   journal.deferredCopy={...proof,repairBackup:backup};save();
   await fs.promises.rename(target,backup);dst=null;
  }
 }
 if(!dst){
  const copied=await copyOne(source,target,signal,(n,total)=>progress(n,total,'copying'));
  journal.deferredCopy={...copied,repairBackup:journal.deferredCopy?.repairBackup};
  journal.remote={localPath:target};save();
 }
 const a=await fs.promises.lstat(source),b=await fs.promises.lstat(target);
 if(signature(a)!==signature(src)||!b.isFile()||a.size!==b.size||signature(b)!==(dst?signature(dst):journal.deferredCopy.targetSignature))throw Error('系统复制检查失败，原件保留');
 journal.deferredCopy={...journal.deferredCopy,sourceSignature:signature(a),targetSignature:signature(b),verified:true,verification:'system-copy'};save();
 signal.throwIfAborted();progress(a.size,a.size,'verifying');return target;
}
async function verifyOrRepair(source,filename,directory,signal,progress,taskID,journal,save) {
 const {copyResumable}=require('./folder-transfer');
 const target=path.join(directory,filename);
 try{
  const result=await copyResumable(source,filename,directory,signal,progress,taskID);
  if(journal.deferredCopy){journal.deferredCopy.verified=true;save();}return result;
 }catch(e){
  if(e.code!=='TARGET_MISMATCH'||!journal.deferredCopy||journal.deferredCopy.repairs>=1)throw e;
  signal.throwIfAborted();
  const src=await fs.promises.lstat(source),dst=await fs.promises.lstat(target);
  if(signature(src)!==journal.deferredCopy.sourceSignature||!dst.isFile()||[dst.dev,dst.ino].join(':')!==journal.deferredCopy.targetSignature.split(':').slice(0,2).join(':'))throw Error('原件或目标身份已变化，未自动重传');
  const backup=target+'.failed-'+crypto.randomUUID();
  journal.deferredCopy.repairs=1;journal.deferredCopy.repairBackup=backup;save();
  await fs.promises.rename(target,backup); // Preserve the failed bytes, never overwrite.
  delete journal.remote;delete journal.photoTarget;save();
  const proof=await copyOne(source,target,signal,(sent,size)=>progress(sent,size,'recopying'));
  journal.deferredCopy={...proof,repairs:1,repairBackup:backup};journal.remote={localPath:target};save();
  const result=await copyResumable(source,filename,directory,signal,progress,taskID);
  journal.deferredCopy.verified=true;save();return result;
 }
}
module.exports={copyAll,copyOne,verifyOrRepair,simpleCopy};
