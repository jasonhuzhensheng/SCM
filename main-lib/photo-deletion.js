"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { digest } = require('./folder-transfer.js');
const signature = stat => [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
const isPhotosPath = file => typeof file === 'string' && /\.photoslibrary(?:\/|$)/i.test(file);
async function photosOriginal(file) {
 const parent = await fs.promises.realpath(path.dirname(file));
 const canonical = path.join(parent,path.basename(file));
 if (!isPhotosPath(canonical)) return null;
 const match = /^(.*\.photoslibrary)\/originals\/[0-9a-f]\/([0-9a-f-]{36})\.[^/]+$/i.exec(canonical);
 if (!match || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(match[2])) throw Error('无法安全对应Apple照片原件，未执行删除');
 return {source:canonical,uuid:match[2].toUpperCase()};
}
function createPhotoDeletion({executable,directory}) {
 function call(request) {
  return new Promise((resolve,reject) => {
   const child=spawn(executable,[],{stdio:['pipe','pipe','pipe']});let out='',err='';
   const timer=setTimeout(()=>{child.kill();},30*60*1000);
   child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err=(err+d).slice(-4000);});
   child.stdin.on('error',()=>{});child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{clearTimeout(timer);try {if(code!==0)throw Error(err||'照片操作中断，结果需要核对');const value=JSON.parse(out);if(!value.ok)throw Error(value.error||'Apple照片操作未完成');resolve(value);}catch(e){reject(e);}});
   child.stdin.end(JSON.stringify(request));
  });
 }
 async function remove(source, expectedSignature, journal, save, signal, expectedHash, options = {}) {
  const original=await photosOriginal(source);
  if(!original)throw Error('不是Apple照片原件');
  if(journal.photos?.requested) {
   const result=await call({mode:'delete-outcome',...journal.photos});
   if(!result.verified)throw Error('Apple照片删除结果未确认，保留任务等待核对');
   return {size:journal.photos.deletedBytes ?? journal.photos.size,count:journal.photos.resources?.length || 1,id:journal.photos.id};
  }
  const before=await fs.promises.lstat(original.source);
  if(!before.isFile()||signature(before)!==expectedSignature)throw Error('原文件已变化，未删除Apple照片');
  const hash=expectedHash||await digest(original.source,signal);
  const verified=await call({mode:'verify-delete',uuid:original.uuid,hash,size:before.size});
  const request={id:verified.id,uuid:original.uuid,hash,size:before.size,resources:verified.resources};
  if(!Array.isArray(verified.resources)||!verified.resources.length)throw Error('照片资源清单为空，未删除');
  const deletedBytes=verified.resources.reduce((total,item)=>total+item.size,0);
  await options.beforeDelete?.(request);
  if(options.backup) await options.backup(request, directory => call({mode:'export-resources',...request,directory}));
  await options.beforeDelete?.(request);
  if(signature(await fs.promises.lstat(original.source))!==expectedSignature)throw Error('核对期间原文件已变化，未删除');
  signal?.throwIfAborted();
  await fs.promises.mkdir(directory,{recursive:true});
  journal.photos={...request,deletedBytes,receipt:path.join(directory,crypto.randomUUID()+'.json'),requested:true};save();
  // Do not kill PhotoKit during its commit. Pause waits for this result and receipt.
  const result=await call({mode:'delete-verified',...journal.photos});
  if(!result.verified)throw Error('Apple照片已响应，但删除结果还需核对；不会重复删除');
  return {size:deletedBytes,count:verified.resources.length,id:verified.id};
 }
 async function inspect(source, signal) {
  const original=await photosOriginal(source);if(!original)throw Error("保留原图必须有可核对的完整Apple照片资源");
  const before=await fs.promises.lstat(original.source);if(!before.isFile())throw Error("保留原图不可读取");
  const hash=await digest(original.source,signal);
  const result=await call({mode:"verify-delete",uuid:original.uuid,hash,size:before.size});
  if(signature(await fs.promises.lstat(original.source))!==signature(before))throw Error("保留原图已变化");
  signal?.throwIfAborted();return result;
 }
 return {remove,inspect};
}
module.exports={isPhotosPath,photosOriginal,createPhotoDeletion};
