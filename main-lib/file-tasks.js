"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function createFileTasks(file, handlers, canRun) {
 let jobs = [], loaded = false, running = false, stopped = false, timer, activeId = null;
 const waiters = new Map();
 const executing = new Set();
 const idleWaiters = [];
 let lastSaveAt = 0, checkpointDirty = false;
 const historyFile=path.join(path.dirname(file),'deletion-space-history.json');
 let history={};
 const fields=['trashedCount','trashedBytes'];
 function updateHistory(){
  for(const job of jobs){
   if(job.kind!=='delete' && !(job.kind==='transfer' && job.payload.mode==='move'))continue;
   const totals=Object.fromEntries(fields.map(key=>[key,(job.space?.[key]||0)+(job.current?.space?.[key]||0)]));
   if(!totals.trashedCount)continue;
   const old=history[job.id];
   history[job.id]={id:job.id,kind:job.kind,startedAt:old?.startedAt||job.createdAt||new Date().toISOString(),updatedAt:job.updatedAt||old?.updatedAt||new Date().toISOString(),...totals};
  }
 }
 function saveHistory(){
  updateHistory();
  fs.writeFileSync(historyFile+'.tmp',JSON.stringify(history));fs.renameSync(historyFile+'.tmp',historyFile);
 }
 function load() {
  if (loaded) return;
  try { jobs = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(jobs)) throw Error('文件任务记录无效'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  try{history=JSON.parse(fs.readFileSync(historyFile,'utf8'));if(!history||typeof history!=='object'||Array.isArray(history))throw Error('删除空间记录无效');}catch(e){if(e.code!=='ENOENT')throw e;}
  updateHistory();
  for (const job of jobs) {
   if (job.status === 'running') job.status = 'queued';
   if (job.status === 'pausing' || (job.kind === 'transfer' && job.status === 'cancelled' && !job.ended)) job.status = 'paused';
  }
  loaded = true;
 }
 function save(options) {
  // Coalesce repeatable copy/preflight progress only. Default saves remain an
  // immediate barrier, especially the requested marker BEFORE PhotoKit commit.
  if(options?.checkpoint){checkpointDirty=true;if(Date.now()-lastSaveAt<2000)return;}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd=fs.openSync(file+'.tmp','w');
  try{fs.writeFileSync(fd,JSON.stringify(jobs));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(file + '.tmp', file);
  const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  saveHistory();
  checkpointDirty=false;lastSaveAt=Date.now();
 }
 function schedule() { if (!stopped) { clearTimeout(timer); timer = setTimeout(() => void drain().catch(e => console.warn('[file-tasks]', e.message)), 3000); timer.unref(); } }
 async function execute(job) {
  const previousActiveId = activeId;
  executing.add(job.id);
  job.status = 'running'; job.error = ''; activeId = job.id; save();
  try {
   const result = await handlers[job.kind](job, options => save(options), () => stopped || ['cancelled','pausing','paused'].includes(job.status));
   if (stopped) { if(job.status==='pausing')job.status='paused';else if(!['cancelled','paused'].includes(job.status))job.status='queued'; save(); return; }
   if (['pausing','paused'].includes(job.status)) { job.status='paused';save();waiters.get(job.id)?.resolve({paused:true,results:job.results});return; }
   if (job.status !== 'cancelled') job.status = 'complete';
   job.result = result; save(); waiters.get(job.id)?.resolve(result);
  } catch (e) {
   if (['pausing','paused'].includes(job.status)) {job.status='paused';job.error='';save();waiters.get(job.id)?.resolve({paused:true,results:job.results});}
   else {
    if(job.status!=='cancelled') {job.status=e.retryable===false?'paused':'waiting';job.error=e.message;job.nextAttemptAt=e.retryable===false?0:Date.now()+30000;}
    save(); e.results=job.results; waiters.get(job.id)?.reject(e);
   }
  } finally { executing.delete(job.id); activeId = previousActiveId; waiters.delete(job.id); if(!executing.size)for(const resolve of idleWaiters.splice(0))resolve(); }
 }
 async function drain() {
  if (running || stopped) return;
  load(); running = true;
  try {
   for (const job of jobs) {
    if (stopped) break;
    if (!['queued','waiting','running'].includes(job.status)) continue;
    if(job.nextAttemptAt>Date.now())continue;
    const reason = canRun(job);
    if (reason) { if(job.error!==reason||job.status!=='waiting'){job.status='waiting';job.error=reason;save();} continue; }
    await execute(job);
   }
  } finally { running = false; schedule(); }
 }
 return {
  start() { load(); schedule(); },
  async runPendingDeletes(parentId) {
   if (!running || activeId !== parentId || stopped) return;
   // Bound foreground work so the transfer cannot be starved.
   for (const job of jobs.filter(j => j.kind === 'delete' && ['queued','waiting'].includes(j.status))) {
    if (stopped || ['paused','pausing','cancelled'].includes(jobs.find(j => j.id === parentId)?.status)) break;
    if (job.nextAttemptAt > Date.now()) continue;
    if (canRun(job)) continue;
    await execute(job);
   }
  },
  stop() { stopped = true; clearTimeout(timer); if(checkpointDirty)save(); },
  settle() { return executing.size ? new Promise(resolve=>idleWaiters.push(resolve)) : Promise.resolve(); },
  spaceHistory() {load();updateHistory();const records=Object.values(history).filter(row=>['delete','transfer'].includes(row.kind)&&row.trashedCount>0).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));return {totals:Object.fromEntries(fields.map(key=>[key,records.reduce((sum,row)=>sum+(row[key]||0),0)]))};},
  photoBatchJobs(job) {
   load();const ids=job.payload.photoBatchGroup;
   if(!ids)return [job];
   if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('无效的照片批次任务组');
   return ids.map(id=>{
    const member=jobs.find(item=>item.id===id);
    if(!member||member.kind!=='transfer'||member.payload.mode!=='move'||member.payload.photosDeleteVersion!==1||JSON.stringify(member.payload.photoBatchGroup)!==JSON.stringify(ids))throw Error('照片批次任务组不一致');
    return member;
   });
  },
  snapshot() { load(); return jobs.map(({id,kind,status,done,total,error,summary,payload,current,folder,results,...rest})=>({id,kind,status,done,total,error,summary,...(kind === "delete" ? {verificationConcurrency:rest.verificationConcurrency,activeVerifications:rest.activeVerifications,checkedCount:rest.checkedCount||0,deleteSubmitted:!!rest.selectionDeleteBatch?.requested} : {}),...(kind === "transfer" ? {cloudVerifiedMove:!!payload.cloudVerifiedMove,progress:require("./transfer-progress").transferProgress({id,kind,status,done,total,payload,current,results,...rest}),mode:payload.mode,filename:current?.filename || "",destination:folder?.localPath || payload.destination || "Google Drive",repairOriginals:!!payload.repairOriginals,succeeded:(results || []).filter(row=>row.ok).length,skipped:(results || []).filter(row=>row.skipped).length,failed:(results || []).filter(row=>!row.ok&&!row.skipped).length} : {})})); },
  add(kind, payload, total) {
   load(); if(!handlers[kind])throw Error('无效文件任务');
   if(jobs.some(j=>j.kind===kind&&!['complete','cancelled'].includes(j.status)&&JSON.stringify(j.payload)===JSON.stringify(payload)))throw Error('相同任务已保留，请在文件任务中查看进度');
   require('./task-conflicts.js').assertAvailable(jobs, kind, payload, executing);
   const job = {id:crypto.randomUUID(),createdAt:new Date().toISOString(),kind,payload,status:'queued',done:0,total,error:'',results:[]};
   jobs = jobs.filter(j=>!['complete','cancelled'].includes(j.status)).concat(jobs.filter(j=>['complete','cancelled'].includes(j.status)).slice(-19));
   jobs.push(job); save();
   const promise = new Promise((resolve,reject)=>waiters.set(job.id,{resolve,reject}));
   void drain().catch(e=>{waiters.get(job.id)?.reject(e);waiters.delete(job.id);});
   return {id:job.id,promise};
  },
  repairMovedOriginals(ids) {
   load();
   for (const id of ids) {
    const source = jobs.find(job => job.id === id);
    const repairId = `repair-move-${id}`;
    if (jobs.some(job => job.id === repairId) || history[repairId]) continue;
    if (!source || source.kind !== 'transfer' || source.payload.mode !== 'move' || source.status !== 'complete' || !source.payload.localFolder || !source.folder?.localPath) throw Error('原移动记录或本地目标路径不可用，未补删');
    if (source.space?.trashedCount) throw Error('该移动任务已有原文件删除记录，未重复补删');
    const successful = new Set(source.results.filter(result => result.ok).map(result => result.filename));
    const rows = source.payload.rows.filter(row => successful.has(row.filename));
    if (!rows.length) continue;
    jobs.push({id:repairId,createdAt:new Date().toISOString(),kind:'transfer',payload:{...source.payload,rows,repairOriginals:true},folder:source.folder,status:'queued',done:0,total:rows.length,error:'',results:[]});
    save();
   }
   schedule();
  },
  pause(id) {load();const job=jobs.find(j=>j.id===id);if(job?.kind==='transfer'&&['running','queued','waiting'].includes(job.status)){job.status=executing.has(id)?'pausing':'paused';job.error='';save();if(job.status==='paused'){waiters.get(id)?.resolve({paused:true,results:job.results});waiters.delete(id);}}},
  resume(id) {load();const job=jobs.find(j=>j.id===id);if(job?.kind==='transfer'&&job.status==='paused'){job.status='queued';job.error='';job.nextAttemptAt=0;save();schedule();}},
  cancel(id) { load(); const job=jobs.find(j=>j.id===id); if(job?.kind==='delete'&&job.selectionDeleteBatch?.requested)throw Error('系统删除已提交，正在确认结果并清理索引，无法取消'); if(job&&!['complete','cancelled'].includes(job.status)){job.status='cancelled';job.ended=true;save();waiters.get(id)?.resolve({canceled:true,results:job.results});waiters.delete(id);} },
  retry(id) {load();const job=jobs.find(j=>j.id===id);if(job?.status==='waiting'){job.status='queued';job.error='';save();schedule();}},
 };
}
module.exports = {createFileTasks};
