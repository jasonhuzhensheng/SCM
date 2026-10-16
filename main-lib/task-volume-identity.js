'use strict';
const fs=require('node:fs'),path=require('node:path');
const {promisify}=require('node:util');
const run=promisify(require('node:child_process').execFile);
const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const blocked=message=>Object.assign(Error(message+'；任务已暂停，原件和已有副本保留'),{retryable:false});
// st_dev is a session-local number on macOS. Persist the APFS volume UUID.
async function volumeIdentity(directory){
 const canonical=await fs.promises.realpath(directory);
 const {stdout:usage}=await run('/bin/df',['-P',canonical],{timeout:5000,maxBuffer:128*1024});
 const device=usage.match(/^\/dev\/\S+/m)?.[0];if(!device)throw blocked('无法确认磁盘身份');
 const {stdout}=await run('/usr/sbin/diskutil',['info','-plist',device],{timeout:5000,maxBuffer:128*1024});
 const uuid=stdout.match(/<key>VolumeUUID<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
 if(!uuid)throw blocked('磁盘缺少稳定标识');
 return {uuid,directory:canonical};
}
function submitted(job){
 const b=job.photoBatch;
 return !!(b?.requested||b?.confirmed||b?.commitSubset?.requested||job.current?.photos?.requested||job.current?.originalTrashed||b?.entries?.some(e=>e.journal.photos?.requested||e.journal.originalTrashed));
}
async function prepare(job,save,signal,deps={}){
 const p=job.payload;
 if(!p.localFolder||p.mode!=='move'||p.cloudVerifiedMove||p.photoBatchGroup||p.repairOriginals||submitted(job))return;
 const stat=deps.stat||fs.promises.lstat,identify=deps.volumeIdentity||volumeIdentity;
 const samples=new Map();for(const row of p.rows){const dev=row.originalSignature?.split(':')[0];if(!dev)throw blocked('原件缺少身份记录');if(!samples.has(dev))samples.set(dev,row.source);}
 const prior=job.volumeIdentity, sources=[];
 for(const [device,file] of samples){
  signal?.throwIfAborted();const current=await stat(file),identity=await identify(path.dirname(file));
  const saved=prior?.sources?.find(v=>v.device===device);
  if(prior&&(!saved||saved.uuid!==identity.uuid||saved.directory!==identity.directory))throw blocked('原件磁盘已更换或路径已变化');
  if(!prior&&String(current.dev)!==device)throw blocked('旧任务的磁盘编号已变化，需要核验原件内容后恢复');
  sources.push({...identity,device:String(current.dev),previousDevice:device});
 }
 const targetStat=await stat(job.folder.localPath),target=await identify(job.folder.localPath),oldTarget=prior?.destination;
 if(prior&&(!oldTarget||oldTarget.uuid!==target.uuid||oldTarget.directory!==target.directory))throw blocked('目标磁盘已更换或路径已变化');
 const destination={...target,device:String(targetStat.dev)};
 const changes=[];
 async function rebind(object,key,file,oldDevice,newDevice){
  if(!object?.[key]||oldDevice===newDevice)return;
  signal?.throwIfAborted();const expected=object[key],parts=expected.split(':'),present=await stat(file);
  if(parts[0]!==oldDevice||String(present.dev)!==newDevice||!present.isFile()||signature(present).split(':').slice(1).join(':')!==parts.slice(1).join(':'))throw blocked('断点文件身份、大小或时间已变化');
  changes.push([object,key,signature(present)]);
 }
 const journals=new Map((job.photoBatch?.entries||[]).map(e=>[e.index,e.journal]));if(job.current)journals.set(job.done,job.current);
 for(let i=0;i<p.rows.length;i++){
  const row=p.rows[i],dev=row.originalSignature.split(':')[0],v=sources.find(s=>s.previousDevice===dev),j=journals.get(i);
  await rebind(row,'originalSignature',row.source,dev,v.device);
  if(j?.deferredCopy)await rebind(j.deferredCopy,'sourceSignature',row.source,dev,v.device);
  const targetDevice=oldTarget?.device||destination.device;
  if(j?.deferredCopy)await rebind(j.deferredCopy,'targetSignature',path.join(job.folder.localPath,row.filename),targetDevice,destination.device);
  for(const item of [j?.photoTarget,...(j?.resourceTargetSignatures||[])])if(item)await rebind(item,'signature',item.file,targetDevice,destination.device);
 }
 // Apply only after every candidate passes. Never alter a submitted transaction.
 for(const [object,key,value] of changes)object[key]=value;
 if(changes.length)for(const j of journals.values()){
  delete j.photosPrepared;j.resourcesVerified=false;
  if(j.deferredCopy)j.deferredCopy.verified=false;
  if(j.copyError==='原件身份已变化')delete j.copyError;
 }
 const state={version:1,sources:sources.map(({previousDevice,...v})=>v),destination};
 if(!prior||changes.length){job.volumeIdentity=state;save();}
 return {rebound:changes.length};
}
async function prepareLocalResume(...args){
 try{return await prepare(...args);}catch(error){if(error.name!=='AbortError')error.retryable=false;throw error;}
}
module.exports={prepareLocalResume,volumeIdentity,submitted};
