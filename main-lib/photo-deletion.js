"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { digest } = require('./folder-transfer.js');
const signature = stat => [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
const sameOriginalIdentity = (a,b) => typeof a==='string' && typeof b==='string' && a.split(':').slice(0,4).join(':')===b.split(':').slice(0,4).join(':');
const isPhotosPath = file => typeof file === 'string' && /\.photoslibrary(?:\/|$)/i.test(file);
// A filename is only a candidate identity. PhotoKit must also match its full
// content hash to an asset resource before any deletion can be submitted.
function photoSourceIdentity(file) {
 if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file) return null;
 const uuid = '([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})';
 const original = new RegExp('^(.*\\.photoslibrary)/originals/[0-9a-f]/' + uuid + '(?:_[0-9]+)?\\.[^/]+$', 'i').exec(file);
 const rendered = new RegExp('^(.*\\.photoslibrary)/resources/renders/[0-9a-f]/' + uuid + '(?:_[0-9]+)+(?:_[a-z])?\\.[^/]+$', 'i').exec(file);
 const match = original || rendered;
 return match ? {library:match[1],uuid:match[2].toUpperCase()} : require('./photos-cache-identity').knownIdentity(file);
}
async function photosOriginal(file, options = {}) {
 const parent = await fs.promises.realpath(path.dirname(file));
 const canonical = path.join(parent,path.basename(file));
 if (!isPhotosPath(canonical)) return null;
 const cacheResource = /\/resources\/cpl\//i.test(canonical);
 const identity = cacheResource ? await require('./photos-cache-identity').resolveCache(canonical, undefined, options) : photoSourceIdentity(canonical);
 if (!identity) throw require('./photos-cache-identity').blocked('无法安全对应此 Apple 照片内部文件');
 return {source:canonical,uuid:identity.uuid,cacheResource,requiresContentVerification:cacheResource || /\/originals\/[^/]+\/[^/]+_[0-9]+\.[^/]+$/i.test(canonical)};
}
function createPhotoDeletion({executable,directory,bridge}) {
 function call(request, signal) {
  signal?.throwIfAborted();
  if (bridge) return bridge(request);
  return new Promise((resolve,reject) => {
   const child=spawn(executable,[],{stdio:['pipe','pipe','pipe']});let out='',err='';
   const committing=['delete-verified','delete-batch'].includes(request.mode);
   const cancellable=signal && ['verify-delete','export-resources'].includes(request.mode);
   const abort=()=>child.kill();
   if(cancellable){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
   const cleanup=()=>{clearTimeout(timer);if(cancellable)signal.removeEventListener('abort',abort);};
   const timer=committing?null:setTimeout(()=>{child.kill();},30*60*1000);
   child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err=(err+d).slice(-4000);});
   child.stdin.on('error',()=>{});child.on('error',e=>{cleanup();reject(e);});
   child.on('close',code=>{cleanup();try {if(cancellable)signal.throwIfAborted();if(code!==0)throw Error(err||'照片操作中断，结果需要核对');const value=JSON.parse(out);if(!value.ok)throw Error(value.error||'Apple照片操作未完成');resolve(value);}catch(e){reject(e);}});
   child.stdin.end(JSON.stringify(request));
  });
 }
 async function remove(source, expectedSignature, journal, save, signal, expectedHash, options = {}) {
  if(journal.photos?.requested) {
   let result;
   if(journal.photos.batchReceipt){
    const receipt=journal.photos.batchReceipt;
    if(path.dirname(receipt)!==path.resolve(directory))throw Error('批量删除回执路径无效');
    const record=JSON.parse(await fs.promises.readFile(receipt,'utf8'));
    const {requested,batchReceipt,...expected}=journal.photos;
    const item=record.items?.find(item=>item.id===expected.id);
    if(!item || item.uuid!==expected.uuid || item.hash!==expected.hash || item.size!==expected.size || !require('node:util').isDeepStrictEqual(item.resources,expected.resources))throw Error('批量删除回执与素材不一致');
    result=await call({mode:'delete-batch-outcome',receipt,items:record.items});
   }else result=await call({mode:'delete-outcome',...journal.photos});
   if(!result.verified)throw Error('Apple照片删除结果未确认，保留任务等待核对');
   return {size:journal.photos.deletedBytes ?? journal.photos.size,count:journal.photos.resources?.length || 1,id:journal.photos.id};
  }
  const original=await photosOriginal(source, {signal});
  if(!original)throw Error('不是Apple照片原件');
  const before=await fs.promises.lstat(original.source);
  if(!before.isFile()||!sameOriginalIdentity(signature(before),expectedSignature))throw Error('原文件已变化，未删除Apple照片');
  const simple=options.verification==='system-copy' && !original.requiresContentVerification;
  const hash=simple?undefined:expectedHash||await digest(original.source,signal);
  const previous=journal.photosPrepared;
  const reusable=!simple && previous?.uuid===original.uuid && previous.hash===hash && previous.size===before.size && typeof previous.id==='string' && Array.isArray(previous.resources) && previous.resources.length>0;
  // Export validates resource descriptors and output hashes; commit revalidates the asset.
  const verified=reusable ? previous : await call({mode:'verify-delete',uuid:original.uuid,hash,size:before.size,...(simple?{verification:'system-copy',sourcePath:original.source}:{})},signal);
  const request={id:verified.id,uuid:original.uuid,hash,size:before.size,resources:verified.resources,...(simple?{verification:'system-copy',assetVersion:verified.assetVersion,sourcePath:original.source,primaryIndex:verified.primaryIndex}:{})};
  if(!Array.isArray(verified.resources)||!verified.resources.length)throw Error('照片资源清单为空，未删除');
  let deletedBytes=0;
  await options.beforeDelete?.(request);
  if(options.backup) await options.backup(request, directory => call({mode:'export-resources',...request,directory},signal));
  await options.beforeDelete?.(request);
  const after=await fs.promises.lstat(original.source);
  if(!sameOriginalIdentity(signature(after),expectedSignature))throw Error('核对期间原文件已变化，未删除');
  if(!simple && signature(after)!==expectedSignature && await digest(original.source,signal)!==hash)throw Error('原件元数据变化后的内容复核失败');
  if(simple && signature(after)!==signature(before))throw Error('原件状态已变化，未删除');
  if(request.resources.some(r=>!Number.isSafeInteger(r.size)||r.size<0))throw Error('照片资源尚未完整导出');
  deletedBytes=request.resources.reduce((total,item)=>total+item.size,0);
  signal?.throwIfAborted();
  if (options.prepareOnly) {
   journal.photosPrepared={...request,deletedBytes};save();
   return {prepared:true};
  }
  await fs.promises.mkdir(directory,{recursive:true});
  journal.photos={...request,deletedBytes,receipt:path.join(directory,crypto.randomUUID()+'.json'),requested:true};save();
  // Do not kill PhotoKit during its commit. Pause waits for this result and receipt.
  const result=await call({mode:'delete-verified',...journal.photos});
  if(!result.verified)throw Error('Apple照片已响应，但删除结果还需核对；不会重复删除');
  return {size:deletedBytes,count:verified.resources.length,id:verified.id};
 }
 async function inspect(source, signal) {
  const original=await photosOriginal(source, {signal});if(!original)throw Error("保留原图必须有可核对的完整Apple照片资源");
  const before=await fs.promises.lstat(original.source);if(!before.isFile())throw Error("保留原图不可读取");
  const hash=await digest(original.source,signal);
  const result=await call({mode:"verify-delete",uuid:original.uuid,hash,size:before.size},signal);
  if(signature(await fs.promises.lstat(original.source))!==signature(before))throw Error("保留原图已变化");
  signal?.throwIfAborted();return result;
 }
 async function commitBatch(batch, save, signal, validate) {
  if (!batch.requested) {
   signal?.throwIfAborted();
   // Reject before persisting a submitted marker. Outcome-only recovery below
   // must never be converted into a new request, even for an oversized record.
   require('./selection-limit').assertSelectionLimit(batch.entries.length);
   const guards=await validate();
   signal?.throwIfAborted();
   if (!batch.entries.length && batch.allowEmpty){batch.confirmed=true;save();return;}
   if (!batch.entries.length || batch.entries.some(entry=>!entry.journal.photosPrepared)) throw Error('批量照片资源尚未核对完整');
   await fs.promises.mkdir(directory,{recursive:true});
   batch.requests=batch.entries.map(entry=>entry.journal.photosPrepared);
   batch.receipt=path.join(directory,crypto.randomUUID()+'.json');
   batch.requested=true;save();
   const result=await call({mode:'delete-batch',items:batch.requests,receipt:batch.receipt,guards});
   if (!result.verified) throw Error('批量删除结果未确认，禁止重复提交');
  } else {
   const result=await call({mode:'delete-batch-outcome',items:batch.requests,receipt:batch.receipt});
   if (!result.verified) throw Error('批量删除结果未确认，禁止重复提交');
  }
  const counted=new Set();
  for (const entry of batch.entries) {
   const request=entry.journal.photosPrepared;
   const duplicate=counted.has(request.id);counted.add(request.id);
   entry.journal.photos={...request,requested:true,batchReceipt:batch.receipt};
   entry.journal.originalTrashed=true;entry.journal.trashed=true;
   entry.journal.stage='removing';
   entry.journal.space={trashedCount:duplicate?0:request.resources.length,trashedBytes:duplicate?0:request.deletedBytes};
  }
  batch.confirmed=true;save();
 }
 return {remove,inspect,commitBatch};
}
module.exports={photoSourceIdentity,isPhotosPath,photosOriginal,createPhotoDeletion,sameOriginalIdentity};
