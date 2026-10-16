"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const brokers = new Map();
// Shared worker for device/quality caches; requests and responses are bounded pages.
function broker(file) {
 let instance = brokers.get(file);
 if (instance) return instance;
 const worker = new Worker(path.join(__dirname, "metadata-cache-worker.js"), { workerData: { file } });
 const pending = new Map();
 let sequence = 0, dead = false;
 const fail = error => {
  if (dead) return;
  dead = true;
  if (brokers.get(file) === instance) brokers.delete(file);
  for (const job of pending.values()) job.reject(error);
  pending.clear();
 };
 worker.on("error", fail);
 worker.on("exit", code => fail(Error(`元数据缓存工作线程已退出 (${code})`)));
 worker.on("message", ({ id, result, error }) => {
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  if (error) job.reject(Error(error)); else job.resolve(result);
  if (!pending.size) worker.unref();
 });
 instance = {
  request(message) {
   if (dead) return Promise.reject(Error("元数据缓存不可用，请重试"));
   if (pending.size >= 64) return Promise.reject(Error("元数据读取队列已满，请稍后重试"));
   worker.ref();
   return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ ...message, id }); }
    catch (error) { pending.delete(id); reject(error); if (!pending.size) worker.unref(); }
   });
  },
  async close() {
   if (pending.size) throw Error("元数据缓存仍有在途请求");
   await instance.request({ action: "close" });
   fail(Error("元数据缓存已关闭"));
   await worker.terminate();
  },
 };
 brokers.set(file, instance);
 worker.unref();
 return instance;
}
function createMetadataCache({ cachePath, kind, version = "v1" }) {
 if (!["device", "quality"].includes(kind)) throw Error("Invalid metadata kind");
 const legacyPath = path.resolve(cachePath);
 const file = path.join(path.dirname(legacyPath), "metadata-cache.sqlite");
 const config = { legacyPath, kind, version, namespace: `${kind}:${path.basename(legacyPath)}:${version}` };
 return {
  file,
  async get(names) {
   const result = Object.create(null);
   for (let i = 0; i < names.length; i += 1000) Object.assign(result, await broker(file).request({ action: "get", config, names: names.slice(i, i + 1000) }));
   return result;
  },
  async put(rows) {
   for (let i = 0; i < rows.length; i += 1000) await broker(file).request({ action: "put", config, rows: rows.slice(i, i + 1000) });
  },
 };
}
async function closeMetadataCaches() { for (const instance of [...brokers.values()]) await instance.close(); }
module.exports = { createMetadataCache, closeMetadataCaches };
