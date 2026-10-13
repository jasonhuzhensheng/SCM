"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fingerprint = async file => {
 const hash = crypto.createHash("sha256");
 for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
 return hash.digest("hex");
};
exports.verifyDuplicate = async ({library, filename, keeper, isLocked}) => {
 const row = library.filenames.indexOf(filename), keepRow = library.filenames.indexOf(keeper);
 if (row < 0 || keepRow < 0 || filename === keeper || !isLocked(keeper) || isLocked(filename)) throw Error("请先锁定同组中要保留的原图，再清理多余文件。");
 const target = library.sources[row], retained = library.sources[keepRow];
 if (!target || !retained || !path.isAbsolute(target) || !path.isAbsolute(retained) || path.resolve(target) === path.resolve(retained)) throw Error("原图路径无效或指向同一文件，已跳过。");
 const hash = library.hashes?.[row];
 if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || hash.toLowerCase() !== library.hashes?.[keepRow]?.toLowerCase()) throw Error("重复分组已变化，请刷新后重试。");
 const before = await Promise.all([fs.promises.lstat(target), fs.promises.lstat(retained)]);
 if (before.some(stat => !stat.isFile()) || (before[0].dev === before[1].dev && before[0].ino === before[1].ino)) throw Error("路径不是独立普通文件，已跳过。");
 // A second library record may lock the target through another path.
 for (let i = 0; i < library.filenames.length; i++) {
  if (!isLocked(library.filenames[i]) || !library.sources[i]) continue;
  if (path.resolve(library.sources[i]) === path.resolve(target)) throw Error("该原文件已有锁定记录，已跳过。");
 }
 const hashes = await Promise.all([fingerprint(target), fingerprint(retained)]);
 const after = await Promise.all([fs.promises.lstat(target), fs.promises.lstat(retained)]);
 if (before.some((stat, i) => ['dev','ino','size','mtimeMs','ctimeMs'].some(key => stat[key] !== after[i][key]))) throw Error("校验期间文件发生变化，已跳过。");
 if (hashes.some(value => value !== hash.toLowerCase())) throw Error("文件内容已改变或与锁定原图不同，已跳过。");
};
