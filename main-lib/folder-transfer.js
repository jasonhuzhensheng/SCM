"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
// Process-local evidence only; never trust a persisted success flag to skip hashing.
const verifiedCopies = new Map();
const signature = s => [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const contentIdentity = s => [s.dev,s.ino,s.size,s.mtimeMs].join(':');
function remember(source,target,sourceStat,targetStat,hash) {
 if(verifiedCopies.size>=1024)verifiedCopies.delete(verifiedCopies.keys().next().value);
 verifiedCopies.set(target,{source,sourceSignature:signature(sourceStat),targetSignature:signature(targetStat),hash});
}
async function verifiedCopy(source,target) {
 const proof=verifiedCopies.get(target);
 if(!proof || proof.source!==source)return null;
 try {
  const a=await fs.promises.lstat(source),b=await fs.promises.lstat(target);
  if(a.isFile()&&b.isFile()&&signature(a)===proof.sourceSignature&&signature(b)===proof.targetSignature)return {...proof};
 }catch{}
 verifiedCopies.delete(target);return null;
}
async function digest(file, signal, progress) {
 // Large sequential reads reduce filesystem/JS crossings while keeping memory bounded.
 let read=0,lastProgressAt=0,reported=-1;
 signal?.throwIfAborted();
 const hash = crypto.createHash('sha256');
 for await (const chunk of fs.createReadStream(file, { signal, highWaterMark:4*1024*1024 })) {
  hash.update(chunk);read+=chunk.length;
  const now=performance.now();
  if(progress && (reported<0 || now-lastProgressAt>=150)){progress(read);reported=read;lastProgressAt=now;}
 }
 signal?.throwIfAborted();
 if(progress && reported!==read)progress(read);
 return hash.digest('hex');
}
// Destination is a newly created batch directory chosen by the native picker.
// Never overwrite existing files, and never remove a source here.
async function copyVerified(source, filename, directory, signal, progress) {
 if (path.basename(filename) !== filename) throw Error('无效的文件名');
 const target = path.join(directory, filename);
 const before = await fs.promises.lstat(source);
 if(!before.isFile())throw Error("源文件不是普通文件");
 const handle = await fs.promises.open(target, 'wx');
 try {
  let sent = 0;
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(source), new Transform({ transform(chunk, _encoding, callback) {
   hash.update(chunk); sent += chunk.length; progress(sent, before.size, 'copying'); callback(null, chunk);
  }}), handle.createWriteStream(), { signal });
  const written = await fs.promises.open(target, "r+");
  try { await written.sync(); } finally { await written.close(); }
  const copiedHash = hash.digest('hex');
  const targetBefore=await fs.promises.lstat(target);
  progress(0, before.size, 'verifying');
  if (copiedHash !== await digest(target, signal, n=>progress(n,before.size,'verifying'))) throw Error('文件校验失败，素材库副本已保留');
  const after = await fs.promises.lstat(source),targetAfter=await fs.promises.lstat(target);
  if (signature(after)!==signature(before) || signature(targetBefore)!==signature(targetAfter)) throw Error('文件在复制校验时发生变化，请重试');
  remember(source,target,after,targetAfter,copiedHash);
  signal.throwIfAborted();
  return target;
 } catch (error) {
  await handle.close().catch(() => {});
  await fs.promises.unlink(target).catch(() => {});
  throw error;
 }
}
async function copyResumable(source, filename, directory, signal, progress, taskID) {
 if(path.basename(filename)!==filename)throw Error('无效的文件名');
 const target = path.join(directory, filename);
 const cached=await verifiedCopy(source,target);
 if(cached){signal.throwIfAborted();return target;}
 try {
  const existing = await fs.promises.lstat(target);
  if (!existing.isFile() || existing.isSymbolicLink()) throw Error('目标文件类型已改变，已保留源文件');
  const before = await fs.promises.lstat(source);
 if(!before.isFile())throw Error("源文件不是普通文件");
  if(existing.size!==before.size)throw Object.assign(Error('目标文件已存在且内容不同，未覆盖'),{code:'TARGET_MISMATCH'});
  progress(0,before.size*2,'verifying');
  const targetHash=await digest(target,signal,n=>progress(n,before.size*2,'verifying'));
  if (existing.size !== before.size || targetHash !== await digest(source,signal,n=>progress(before.size+n,before.size*2,'verifying'))) throw Object.assign(Error('目标文件已存在且内容不同，未覆盖'),{code:'TARGET_MISMATCH'});
  const after = await fs.promises.lstat(source),targetAfter=await fs.promises.lstat(target);
  if(signature(before)!==signature(after)||signature(existing)!==signature(targetAfter))throw Error('文件已改变');
  signal.throwIfAborted();remember(source,target,after,targetAfter,targetHash);
  return target;
 } catch (e) { if(e.code !== 'ENOENT') throw e; }
 const partial = '.sayphoto-' + taskID + '-' + crypto.createHash('sha256').update(filename).digest('hex') + '.partial';
 await fs.promises.unlink(path.join(directory,partial)).catch(e=>{if(e.code!=='ENOENT')throw e;});
 await copyVerified(source, partial, directory, signal, progress);
 const partialPath=path.join(directory,partial),proof=await verifiedCopy(source,partialPath),partialStat=await fs.promises.lstat(partialPath);
 if(!proof || signature(partialStat)!==proof.targetSignature)throw Error('临时目标已变化');
 // Link is exclusive; a user-created destination is never overwritten.
 await fs.promises.link(path.join(directory,partial),target);
 await fs.promises.unlink(path.join(directory,partial));
 const sourceStat=await fs.promises.lstat(source),targetStat=await fs.promises.lstat(target);
 if(signature(sourceStat)!==proof.sourceSignature||contentIdentity(targetStat)!==contentIdentity(partialStat))throw Error('发布目标时文件已变化');
 remember(source,target,sourceStat,targetStat,proof.hash);verifiedCopies.delete(partialPath);
 return target;
}
module.exports = { copyVerified, copyResumable, digest, verifiedCopy };
