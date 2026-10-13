"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const signature = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
async function digest(file, signal) {
 const hash = crypto.createHash('sha256');
 for await (const chunk of fs.createReadStream(file, {signal})) hash.update(chunk);
 return hash.digest('hex');
}
async function cleanCopy(directory, filename, source, signal) {
 signal.throwIfAborted();
 if (!filename || path.basename(filename) !== filename || !source || !path.isAbsolute(source)) return {reason:'missing'};
 const target = path.join(directory, filename);
 const copy = await fs.promises.lstat(target);
 if (copy.isSymbolicLink()) return {reason:'reference'};
 if (!copy.isFile()) return {reason:'missing'};
 const original = await fs.promises.realpath(source);
 const root = await fs.promises.realpath(directory);
 if (original.startsWith(root + path.sep)) return {reason:'internal'};
 const before = await fs.promises.stat(original);
 if (!before.isFile()) return {reason:'missing'};
 if (before.size !== copy.size) return {reason:'different'};
 const [a,b] = await Promise.all([digest(original,signal),digest(target,signal)]);
 if (a !== b) return {reason:'different'};
 if (signature(before) !== signature(await fs.promises.stat(original)) || signature(copy) !== signature(await fs.promises.lstat(target))) return {reason:'changed'};
 signal.throwIfAborted();
 const link = path.join(directory, '.cleanup-' + crypto.randomUUID());
 try {
  await fs.promises.symlink(original,link);
  signal.throwIfAborted();
  // Recheck immediately before the atomic replacement; never unlink first.
  if (signature(before) !== signature(await fs.promises.stat(original)) || signature(copy) !== signature(await fs.promises.lstat(target))) return {reason:'changed'};
  await fs.promises.rename(link,target);
  return {reason:'converted',bytes:copy.size};
 } finally { await fs.promises.unlink(link).catch(error => { if(error.code !== 'ENOENT') throw error; }); }
}
function createCopyCleanup() {
 let state = {running:false,done:0,total:0,converted:0,bytes:0,reasons:{},error:'',cancelled:false};
 let controller;
 return {
  status: () => structuredClone(state),
  cancel: () => controller?.abort(),
  async run(directory, rows, shouldStop = () => false) {
   if(state.running) throw Error('副本清理正在进行');
   controller = new AbortController();
   state = {running:true,done:0,total:rows.length,converted:0,bytes:0,reasons:{},error:'',cancelled:false};
   try {
    for (const row of rows) {
     if (shouldStop()) controller.abort();
     controller.signal.throwIfAborted();
     let result;
     try { result = await cleanCopy(directory,row.filename,row.source,controller.signal); }
     catch(error) {
      if(controller.signal.aborted) throw error;
      if(['ENOSPC','EIO','EROFS'].includes(error.code)) throw error;
      result = {reason: ['EPERM','EACCES'].includes(error.code) ? 'permission' : error.code === 'ENOENT' ? 'missing' : 'failed'};
     }
     state.done++;
     if(result.reason === 'converted') {state.converted++;state.bytes += result.bytes;}
     else state.reasons[result.reason] = (state.reasons[result.reason] || 0) + 1;
    }
   } catch(error) { if(controller.signal.aborted) state.cancelled = true; else state.error = error.message; }
   finally { state.running = false; }
   return structuredClone(state);
  },
 };
}
module.exports = {cleanCopy,createCopyCleanup};
