'use strict';
const fs=require('node:fs'),path=require('node:path');
const {volumeIdentity}=require('./task-volume-identity');
const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const blocked=()=>Object.assign(Error('磁盘或文件确实发生变化，已保留原件，请重新选择。'),{retryable:false});
function context(deps={}){
 const identify=deps.volumeIdentity||volumeIdentity,stat=deps.stat||fs.promises.lstat,realpath=deps.realpath||fs.promises.realpath,volumes=new Map();
 async function identity(file,s){
  const canonical=await realpath(file),key=String(s.dev);
  if(!volumes.has(key))volumes.set(key,identify(path.dirname(canonical)));
  const volume=await volumes.get(key);return {version:1,volumeUUID:volume.uuid,path:canonical};
 }
 async function capture(source,originalStat,cache,cacheStat){
  return {original:originalStat?.isFile()?await identity(source,originalStat):null,cache:cacheStat?.isFile()?await identity(cache,cacheStat):null};
 }
 return {identity,capture,stat,realpath};
}
async function resume(job,save,deps={}){
 const ctx=context(deps),changes=[],seen=new Set();
 async function rebind(object,key,file,proof){
  if(!object?.[key]||!proof?.volumeUUID)return;
  const before=object[key],parts=before.split(':');if(parts.length!==5)throw blocked();
  let current;try{current=await ctx.stat(file)}catch(e){if(e.code==='ENOENT')return;throw e}
  const actual=await ctx.identity(file,current);
  if(actual.volumeUUID!==proof.volumeUUID||actual.path!==proof.path)throw blocked();
  if(String(current.dev)===parts[0])return;
  if(!current.isFile()||actual.volumeUUID!==proof.volumeUUID||actual.path!==proof.path||signature(current).split(':').slice(1).join(':')!==parts.slice(1).join(':'))throw blocked();
  changes.push([object,key,signature(current)]);
 }
 const submittedIndices=new Set();
 for(const batch of [job.photoBatch,job.photoBatch?.commitSubset,job.selectionDeleteBatch]){
  if(!batch?.requested)continue;
  if(!Array.isArray(batch.entries))return {rebound:0};
  for(const e of batch.entries)if(!e.jobId||e.jobId===job.id)submittedIndices.add(e.index);
 }
 const byIndex=new Map();for(const e of job.photoBatch?.entries||[])if(!e.jobId||e.jobId===job.id){const list=byIndex.get(e.index)||[];list.push(e);byIndex.set(e.index,list);}
 for(let i=job.done||0;i<job.payload.rows.length;i++){
  if(submittedIndices.has(i))continue;
  const row=job.payload.rows[i],proof=row.stableIdentity;if(!proof)continue;
  const entries=byIndex.get(i)||[];
  const journals=[...entries.map(e=>e.journal),job.deleteChecks?.[i],job.current?.filename===row.filename?job.current:null].filter(Boolean);
  // Submitted transactions are exclusively recovered from their original receipt.
  if(journals.some(j=>j.photos?.requested||j.originalTrashed||j.trashed))continue;
  await rebind(row,'originalSignature',row.source,proof.original);
  if(proof.cache)await rebind(row,'signature',proof.cache.path,proof.cache);
  for(const j of journals){
   if(seen.has(j))continue;seen.add(j);
   await rebind(j,'originalSignature',row.source,proof.original);
   await rebind(j.deferredCopy,'sourceSignature',row.source,proof.original);
   const destination=job.volumeIdentity?.destination;
   if(destination?.uuid&&job.folder?.localPath===destination.directory){
    const targets=[...(j.resourceTargetSignatures||[]),j.photoTarget].filter(Boolean);
    if(j.deferredCopy?.targetSignature)targets.push({object:j.deferredCopy,key:'targetSignature',file:path.join(job.folder.localPath,row.filename)});
    for(const t of targets){
     const file=t.file;
     if(!path.isAbsolute(file)||!file.startsWith(destination.directory+path.sep))throw blocked();
     await rebind(t.object||t,t.key||'signature',file,{volumeUUID:destination.uuid,path:file});
    }
   }
  }
 }
 // Do not partially update state if any check fails. No copy/delete operation here.
 for(const [object,key,value]of changes)object[key]=value;
 if(changes.length)save();return {rebound:changes.length};
}
module.exports={context,resume};
