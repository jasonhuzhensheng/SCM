'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
function detect(binary, paths, kind = "qr") {
 return new Promise((resolve, reject) => {
  const child = spawn(binary, [kind], {stdio:['pipe','pipe','pipe']});
  let output=''; let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result)};
  const timer=setTimeout(()=>{child.kill();finish(new Error('图像检测超时，请重试。'))},90000);
  child.on('error',()=>finish(new Error('图像检测器无法启动，请重新安装应用。')));
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>100000){child.kill();finish(new Error('检测输出异常。'))}});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('close',code=>{try{if(code!==0)throw Error();const rows=JSON.parse(output);if(!Array.isArray(rows)||rows.length!==paths.length)throw Error();finish(null,rows)}catch{finish(new Error('图像检测失败，请重试。'))}});
  child.stdin.end(JSON.stringify(paths));
 });
}
function createQrSearch({directory,cachePath,binary,libraryNames,run=detect,kind="qr"}) {
 let cache=new Map();try{const data=JSON.parse(fs.readFileSync(cachePath,'utf8'));if(data.version===1)cache=new Map(data.rows)}catch{}
 let pending=Promise.resolve();
 async function scan(names) {
  if(!Array.isArray(names)||names.length>32||names.some(n=>typeof n!=='string'||!n||path.basename(n)!==n))throw Error('无效的图像检测请求。');
  const allowed=new Set(libraryNames());const rows=[];const missing=[];let errors=0;
  for(const name of new Set(names)) {
   if(!allowed.has(name))continue;
   try {
    const file=path.join(directory,name);const stat=await fs.promises.stat(file);
    const key=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const cached=cache.get(name);
    const row={name,file,key,found:cached?.key===key?cached.found:undefined};rows.push(row);if(typeof row.found!=='boolean')missing.push(row);
   }catch{errors++}
  }
  if(missing.length){
   const detected=await run(binary,missing.map(r=>r.file),kind);
   for(let i=0;i<missing.length;i++) {
    const row=missing[i],answer=detected[i];
    if(typeof answer?.found!=='boolean'){errors++;continue}
    try{const stat=await fs.promises.stat(row.file);if(row.key!==`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`){errors++;continue}}catch{continue}
    row.found=answer.found;cache.set(row.name,{key:row.key,found:row.found});
   }
   const live=new Set(libraryNames());for(const name of cache.keys())if(!live.has(name))cache.delete(name);
   await fs.promises.mkdir(path.dirname(cachePath),{recursive:true});
   const temp=cachePath+'.tmp';await fs.promises.writeFile(temp,JSON.stringify({version:1,rows:[...cache]}));await fs.promises.rename(temp,cachePath);
  }
  const live=new Set(libraryNames());
  return {filenames:rows.filter(r=>r.found===true&&live.has(r.name)).map(r=>r.name),errors};
 }
 return names=>{const task=pending.then(()=>scan(names));pending=task.catch(()=>{});return task};
}
module.exports={createQrSearch,detect};
