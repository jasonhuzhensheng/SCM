"use strict";
const fs = require("node:fs");
const path = require("node:path");
const DIR = ".index-checkpoint";
function syncDirectory(dir) {
 const fd = fs.openSync(dir, "r");
 try { fs.fsyncSync(fd); } catch (error) { if (!["EINVAL", "ENOTSUP"].includes(error.code)) throw error; }
 finally { fs.closeSync(fd); }
}
function readManifest(dir) {
 const value = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
 if (!Array.isArray(value.files) || !value.files.length || value.files.some(f => !/^memor(?:ies-index\.json|y-(?:embeddings|phrase-embeddings|embed-meta)-[\w.-]+\.(?:bin|json))$/.test(f.name) || typeof f.existed !== "boolean") || !["prepared", "committed"].includes(value.state)) throw Error("索引检查点记录无效，保留原文件等待恢复");
 return value;
}
function recoverIndexCheckpoint(root) {
 const dir = path.join(root, DIR);
 if (!fs.existsSync(dir)) return;
 if (!fs.existsSync(path.join(dir, "manifest.json"))) { fs.rmSync(dir, { recursive: true }); return; }
 const manifest = readManifest(dir);
 if (manifest.state !== "committed") {
  // Backups are copied, never consumed: a second crash during rollback is retryable.
  for (const item of manifest.files) {
   const target = path.join(root, item.name);
   if (item.existed) {
    const restore = path.join(dir, "restore");
    fs.copyFileSync(path.join(dir, "old-" + item.name), restore, fs.constants.COPYFILE_FICLONE);
    const fd=fs.openSync(restore,"r");try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(restore, target);
   } else { try { fs.unlinkSync(target); } catch(error) {if(error.code!=="ENOENT")throw error;} }
  }
  syncDirectory(root);
 }
 fs.rmSync(dir, { recursive: true });
 syncDirectory(root);
}
async function writeIndexCheckpoint(root, files) {
 recoverIndexCheckpoint(root);
 const dir = path.join(root, DIR);
 fs.mkdirSync(dir);
 let committed=false;
 const durableWrite=async(file,data)=>{const fd=await fs.promises.open(file,"w");try {await fd.writeFile(data);await fd.sync();} finally {await fd.close();}};
 const manifest={state:"prepared",files:[]};
 try {
  for (const [name,data] of files) {
   if(path.basename(name)!==name)throw Error("Invalid checkpoint filename");
   const target=path.join(root,name),existed=fs.existsSync(target);
   if(existed){const old=path.join(dir,"old-"+name);await fs.promises.copyFile(target,old,fs.constants.COPYFILE_FICLONE);const fd=await fs.promises.open(old,"r");try {await fd.sync();}finally{await fd.close();}}
   await durableWrite(path.join(dir,"new-"+name),data);
   manifest.files.push({name,existed});
  }
  await durableWrite(path.join(dir,"manifest.next"),JSON.stringify(manifest));
  await fs.promises.rename(path.join(dir,"manifest.next"),path.join(dir,"manifest.json"));
  syncDirectory(dir);syncDirectory(root);
  for(const {name} of manifest.files)await fs.promises.rename(path.join(dir,"new-"+name),path.join(root,name));
  syncDirectory(root);
  manifest.state="committed";
  await durableWrite(path.join(dir,"manifest.next"),JSON.stringify(manifest));
  await fs.promises.rename(path.join(dir,"manifest.next"),path.join(dir,"manifest.json"));
  syncDirectory(dir);committed=true;
 } catch(error) {
  try {recoverIndexCheckpoint(root);}catch(restoreError){throw new AggregateError([error,restoreError],"索引保存与回退未完成，已保留检查点备份");}
  throw error;
 }
 if(committed){try {recoverIndexCheckpoint(root);}catch(error){console.warn("[index-checkpoint] backup cleanup deferred:",error.message);}}
}
module.exports={recoverIndexCheckpoint,writeIndexCheckpoint};
