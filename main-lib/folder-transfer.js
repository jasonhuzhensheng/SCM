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
module.exports = { copyVerified };
