"use strict";
const fs = require("node:fs");
const path = require("node:path");
exports.createAssetLocks = file => {
 let cache;
 const read = () => {
  if (cache) return cache;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; data = []; }
  if (!Array.isArray(data) || data.some(name => typeof name !== "string" || path.basename(name) !== name)) throw Error("素材锁定记录损坏，请恢复记录后重试。");
  return cache = new Set(data);
 };
 return {
  has: name => read().has(name),
  list: () => [...read()],
  set(names, locked) {
   const next = new Set(read());
   for (const name of names) { if (typeof name !== "string" || !name || path.basename(name) !== name) throw Error("无效素材"); locked ? next.add(name) : next.delete(name); }
   fs.mkdirSync(path.dirname(file), {recursive:true});
   const temp = file + ".tmp";
   try { fs.writeFileSync(temp, JSON.stringify([...next]), {mode:0o600}); fs.renameSync(temp, file); }
   finally { try { fs.unlinkSync(temp); } catch {} }
   cache = next;
   return [...next];
  },
 };
};
