"use strict";
const fs=require('node:fs');
const path=require('node:path');
const {digest}=require('./folder-transfer');
function selectBatch(entries,rows,done,{batchFiles=5,batchBytes=2*1024**3}={}) {
 if(!Number.isInteger(batchFiles)||batchFiles<1||batchFiles>5||!Number.isSafeInteger(batchBytes)||batchBytes<1||batchBytes>2*1024**3)throw Error('小批上限无效');
 const selected=[];let bytes=0;
 for(const entry of entries.filter(e=>e.index>=done)){
  const size=Number(rows[entry.index]?.originalSignature?.split(':')[2]);
  if(!Number.isSafeInteger(size)||size<0)throw Error('缺少文件大小，不能规划小批传输');
  if(selected.length&&(selected.length>=batchFiles||bytes+size>batchBytes))break;
  selected.push(entry);bytes+=size;
 }
 return selected;
}
function preparedResourcesComplete(j) {
 if(!j.photosPrepared||!j.photoTarget||!Array.isArray(j.photosPrepared.resources))return false;
 const extras=j.photosPrepared.verification==='system-copy'?j.photosPrepared.resources.filter(r=>r.index!==j.photosPrepared.primaryIndex):j.photosPrepared.resources.filter(r=>r.hash!==j.photosPrepared.hash||r.size!==j.photosPrepared.size);
 return !extras.length || (j.resourcesVerified===true && typeof j.resourcesDirectory==='string' && j.resourceTargetSignatures?.length===extras.length);
}
function child(root,file){return typeof file==='string' && path.isAbsolute(file) && path.dirname(file)===root;}
async function verifyEntry(job,entry,drive,signal) {
 const row=job.payload.rows[entry.index],j=entry.journal,root=job.folder.localPath;
 if(j.photosPrepared?.verification==='system-copy')throw Error('云端核验需要完整内容摘要');
 if(!j.photosPrepared||!j.photoTarget||!child(root,j.photoTarget.file)||path.basename(j.photoTarget.file)!==row.filename)throw Error('缺少已核验的原件目标，保留原件');
 const checks=[];
 const primary=await drive.verifyFile(job.payload.cloudVerifiedMove.folderId,row.filename,j.photosPrepared.size,j.photosPrepared.hash,signal);
 checks.push({file:j.photoTarget.file,size:j.photosPrepared.size,hash:j.photosPrepared.hash,remote:primary});
 const extras=j.photosPrepared.verification==='system-copy'?j.photosPrepared.resources.filter(r=>r.index!==j.photosPrepared.primaryIndex):j.photosPrepared.resources.filter(r=>r.hash!==j.photosPrepared.hash||r.size!==j.photosPrepared.size);
 if(extras.length){
  if(!j.resourcesVerified||!child(root,j.resourcesDirectory)||(j.resourceTargetSignatures||[]).length!==extras.length)throw Error('配套资源记录不完整，保留原件');
  const folder=await drive.findFolder(job.payload.cloudVerifiedMove.folderId,path.basename(j.resourcesDirectory),signal);
  const remaining=[...extras];
  for(const item of j.resourceTargetSignatures){
   if(!child(j.resourcesDirectory,item.file))throw Error('配套资源路径已变化');
   const stat=await fs.promises.lstat(item.file);
   if(!stat.isFile()||stat.isSymbolicLink())throw Error('配套资源类型已变化');
   const index=remaining.findIndex(r=>r.hash===item.hash&&r.size===stat.size);
   if(index<0)throw Error('配套资源与Photos清单不匹配');remaining.splice(index,1);
   checks.push({file:item.file,size:stat.size,hash:item.hash,remote:await drive.verifyFile(folder.id,path.basename(item.file),stat.size,item.hash,signal)});
  }
  const manifest=path.join(j.resourcesDirectory,'resources.json'),stat=await fs.promises.lstat(manifest);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('配套资源清单类型已变化');
  const hash=await digest(manifest,signal);
  checks.push({file:manifest,size:stat.size,hash,remote:await drive.verifyFile(folder.id,'resources.json',stat.size,hash,signal)});
 }
 return {verifiedAt:new Date().toISOString(),files:checks};
}
async function released(batch,drive,signal) {
 for(const entry of batch.entries){
  if(!entry.journal.cloudVerified?.files?.length)throw Error('缺少云端验证记录，不能确认释放');
  for(const file of entry.journal.cloudVerified.files){
   await drive.verifyFileById(file.remote.id,file.remote.parent,file.remote.name,file.size,file.hash,signal);
   const stat=await fs.promises.lstat(file.file);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.size)throw Error('目标文件缺失或已改变，请核对云端；不要删除同步目录中的文件');
   // Tiny manifests need not block the next batch. Never read dataless contents.
   if(file.size>65536 && stat.blocks!==0)return false;
  }
 }
 return true;
}
module.exports={selectBatch,verifyEntry,released,preparedResourcesComplete};
