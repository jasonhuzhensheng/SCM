'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {identify,invalidate}=require('./photos-trash-state');
async function restoreLockedPhotos({names,library,isLocked,executable,directory,checkOnly=false,bridge}) {
 if(!Array.isArray(names)||!names.length||names.length>100||new Set(names).size!==names.length)throw Error('请明确选择 1–100 项锁定素材进行恢复。');
 const sources=new Map(library.filenames.map((name,i)=>[name,library.sources[i]]));
 const rows=names.map(filename=>{
  if(typeof filename!=='string'||!filename||path.basename(filename)!==filename||!sources.has(filename))throw Error('恢复素材不在现有索引中，未执行恢复。');
  if(!isLocked(filename))throw Error('只允许恢复已锁定素材。');
  const source=sources.get(filename),identity=identify(source);
  if(!identity||identity.filename!==filename)throw Error('无法核对原始照片身份，未执行恢复。');
  return {filename,source,id:identity.uuid+'/L0/001',library:identity.library};
 });
 if(new Set(rows.map(r=>r.id)).size!==rows.length||new Set(rows.map(r=>r.library)).size!==1)throw Error('恢复项目身份或所属图库不唯一。');
 const request={ids:rows.map(r=>r.id),checkOnly};
 const receipt={id:crypto.randomUUID(),requestedAt:new Date().toISOString(),rows,checkOnly,confirmed:false};
 let receiptFile;
 const save=()=>{fs.writeFileSync(receiptFile+'.tmp',JSON.stringify(receipt),{mode:0o600});fs.renameSync(receiptFile+'.tmp',receiptFile);};
 if(!checkOnly){fs.mkdirSync(directory,{recursive:true});receiptFile=path.join(directory,receipt.id+'.json');save();}
 const call=bridge||((input)=>new Promise((resolve,reject)=>{
  const child=spawn(executable,[],{stdio:['pipe','pipe','pipe']});let output='',stderr='';
  const timer=setTimeout(()=>{child.kill();reject(Error('恢复状态确认超时；请核验，不会重复导入。'));},120000);
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{stderr=(stderr+data).slice(-2000);});child.stdin.on('error',()=>{});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error(stderr||'恢复进程未正常结束');resolve(JSON.parse(output));}catch(e){reject(e);}});
  child.stdin.end(JSON.stringify(input));
 }));
 try {
  const result=await call(request);if(!result.ok)throw Error(result.error||'系统未确认恢复。');
  if(!checkOnly){
   if(!Array.isArray(result.verified)||result.verified.length!==request.ids.length||!request.ids.every(id=>result.verified.includes(id)))throw Error('恢复后的照片身份不匹配，请核验状态。');
   if(rows.some(r=>!isLocked(r.filename)))throw Error('恢复后锁定状态发生变化，请核验。');
   invalidate();
   receipt.confirmed=true;receipt.result=result;receipt.completedAt=new Date().toISOString();save();
  }
  return {...result,filenames:names};
 }catch(error){if(receiptFile){receipt.error=error.message;save();}throw error;}
}
module.exports={restoreLockedPhotos};
