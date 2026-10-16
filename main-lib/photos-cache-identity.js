'use strict';
const fs = require('node:fs'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { digest } = require('./folder-transfer');
const cache = new Map();
const signature = s => [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
function blocked(message) {
 return Object.assign(new Error(message + '；任务已暂停，不会自动重试。可改为复制，或从 Apple 照片导出原件后重新选择。'), { code: 'PHOTOS_IDENTITY_REQUIRED', retryable: false });
}
function knownIdentity(file) { return cache.get(file)?.identity || null; }
function candidates(database, size) {
 return new Promise((resolve,reject) => {
  const worker = new Worker(path.join(__dirname,'photos-cache-worker.js'), { workerData: {database,size} });
  const timer = setTimeout(() => { void worker.terminate(); reject(blocked('照片资源查询超时')); },15000);
  worker.once('message', result => { clearTimeout(timer); if(result.error)reject(blocked('无法读取照片资源对应关系'));else if(!result.rows.length && result.trashedCandidates)reject(blocked('同大小的照片候选已在最近删除，无法确认可移动原件'));else resolve(result.rows); });
  worker.once('error', () => { clearTimeout(timer); reject(blocked('照片资源查询不可用')); });
  worker.once('exit', code => { clearTimeout(timer); if(code)reject(blocked('照片资源查询中断')); });
 });
}
async function resolveCache(file, lookup = candidates, {signal, progress} = {}) {
 signal?.throwIfAborted();
 const match = /^(.*\.photoslibrary)\/resources\/cpl\/cloudsync\.noindex\/storage\/filecache\/[^/]+\/[^/]+$/i.exec(file);
 if(!match)throw blocked('无法安全对应此 Apple 照片内部文件');
 const before = await fs.promises.lstat(file);
 if(!before.isFile() || before.isSymbolicLink())throw blocked('照片缓存不是可核对的普通文件');
 const prior=cache.get(file);
 const library=match[1], rows=await lookup(path.join(library,'database','Photos.sqlite'),before.size);
 if(!rows.length || rows.length>32){cache.delete(file);throw blocked('照片缓存没有唯一可核对的原件候选');}
 // A cached byte match must never revive an asset now in Recently Deleted.
 if(prior?.signature===signature(before) && rows.some(row=>row.uuid.toUpperCase()===prior.identity.uuid))return {...prior.identity,hash:prior.hash};
 cache.delete(file);
 signal?.throwIfAborted();
 const hash=await digest(file,signal,n=>progress?.(n,before.size)), matches=[];
 for(const row of rows) {
  signal?.throwIfAborted();
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.uuid) || !/^[0-9a-f]$/i.test(row.directory))continue;
  const directory=path.join(library,'originals',row.directory);
  let names;
  try { names=await fs.promises.readdir(directory); } catch { throw blocked('原件目录暂时无法读取'); }
  const pattern=new RegExp('^'+row.uuid+'(?:_[0-9]+)?\\.[^/]+$','i');
  const resources=names.filter(n=>pattern.test(n));
  if(resources.length>32)throw blocked('单项照片资源过多，需要人工核对');
  for(const name of resources) {
   signal?.throwIfAborted();
   const original=path.join(directory,name);
   try {
    if(await fs.promises.realpath(original)!==original)continue;
    const a=await fs.promises.lstat(original);
    if(!a.isFile() || a.size!==before.size)continue;
    if(await digest(original,signal,n=>progress?.(n,before.size))===hash && signature(a)===signature(await fs.promises.lstat(original)))matches.push(row.uuid.toUpperCase());
   } catch(error) { signal?.throwIfAborted();if(error.code!=='ENOENT')throw blocked('原件暂时无法读取核对'); }
  }
 }
 if(signature(before)!==signature(await fs.promises.lstat(file)))throw blocked('核对期间照片缓存发生变化');
 const ids=[...new Set(matches)];
 if(ids.length!==1)throw blocked(ids.length?'多个照片原件内容相同，无法确定要移动哪一项':'照片缓存与原件内容不匹配');
 const identity={library,uuid:ids[0]};
 if(cache.size>=128)cache.delete(cache.keys().next().value);
 cache.set(file,{identity,hash,signature:signature(before)});
 return {...identity,hash};
}
module.exports={resolveCache,knownIdentity,blocked};
