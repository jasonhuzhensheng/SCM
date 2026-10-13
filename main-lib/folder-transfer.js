"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
async function digest(file, signal) {
 const hash = crypto.createHash('sha256');
 for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk);
 return hash.digest('hex');
}
// Destination is a newly created batch directory chosen by the native picker.
// Never overwrite existing files, and never remove a source here.
async function copyVerified(source, filename, directory, signal, progress) {
 if (path.basename(filename) !== filename) throw Error('无效的文件名');
 const target = path.join(directory, filename);
 const before = await fs.promises.stat(source);
 const handle = await fs.promises.open(target, 'wx');
 try {
  let sent = 0;
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(source), new Transform({ transform(chunk, _encoding, callback) {
   hash.update(chunk); sent += chunk.length; progress(sent, before.size); callback(null, chunk);
  }}), handle.createWriteStream(), { signal });
  const written = await fs.promises.open(target, "r+");
  try { await written.sync(); } finally { await written.close(); }
  const copiedHash = hash.digest('hex');
  if (copiedHash !== await digest(target, signal) || copiedHash !== await digest(source, signal)) throw Error('文件校验失败，素材库副本已保留');
  const after = await fs.promises.stat(source);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw Error('源文件在复制时发生变化，请重试');
  signal.throwIfAborted();
  return target;
 } catch (error) {
  await handle.close().catch(() => {});
  await fs.promises.unlink(target).catch(() => {});
  throw error;
 }
}
async function copyResumable(source, filename, directory, signal, progress, taskID) {
 const target = path.join(directory, filename);
 try {
  const existing = await fs.promises.lstat(target);
  if (!existing.isFile() || existing.isSymbolicLink()) throw Error('目标文件类型已改变，已保留源文件');
  const before = await fs.promises.stat(source);
  if (existing.size !== before.size || await digest(target,signal) !== await digest(source,signal)) throw Error('目标文件已存在且内容不同，未覆盖');
  const after = await fs.promises.stat(source);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw Error('源文件已改变');
  return target;
 } catch (e) { if(e.code !== 'ENOENT') throw e; }
 const partial = '.sayphoto-' + taskID + '-' + crypto.createHash('sha256').update(filename).digest('hex') + '.partial';
 await fs.promises.unlink(path.join(directory,partial)).catch(e=>{if(e.code!=='ENOENT')throw e;});
 await copyVerified(source, partial, directory, signal, progress);
 // Link is exclusive; a user-created destination is never overwritten.
 await fs.promises.link(path.join(directory,partial),target);
 await fs.promises.unlink(path.join(directory,partial));
 return target;
}
module.exports = { copyVerified, copyResumable, digest };
