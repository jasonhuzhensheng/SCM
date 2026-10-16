'use strict';
// Read-only Photos classification. Never authorizes deletion or modifies a library.
const path=require('node:path'),{Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
function identify(source){
 if(typeof source!=='string'||!path.isAbsolute(source)||path.normalize(source)!==source)return null;
 const m=/^(.*\.photoslibrary)\/originals\/([0-9a-f])\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:_\d+)?\.[^/]+$/i.exec(source);
 return m?{library:m[1],uuid:m[3].toUpperCase(),directory:m[2],filename:path.basename(source)}:null;
}
if(!isMainThread && workerData?.photosTrashState){
 let db;try{const {DatabaseSync}=require('node:sqlite');db=new DatabaseSync(path.join(workerData.library,'database/Photos.sqlite'),{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2000');parentPort.postMessage({rows:db.prepare('SELECT ZUUID uuid,ZDIRECTORY directory,ZFILENAME filename FROM ZASSET WHERE ZTRASHEDSTATE=1').all()});}catch(e){parentPort.postMessage({error:e.message});}finally{db?.close();}
}else{
 const cache=new Map();
 async function read(library,fresh=false){
  const old=cache.get(library);if(old?.pending)return old.pending;if(!fresh&&old&&Date.now()-old.at<10000)return old.rows;
  const pending=new Promise((resolve,reject)=>{const w=new Worker(__filename,{workerData:{photosTrashState:true,library}});const timer=setTimeout(()=>{void w.terminate();reject(Error('照片状态读取超时'));},10000);w.once('message',m=>{clearTimeout(timer);if(m.error)reject(Error(m.error));else resolve(new Map(m.rows.map(r=>[r.uuid.toUpperCase(),r])));});w.once('error',e=>{clearTimeout(timer);reject(e);});w.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('照片状态读取中断'));});});
  cache.set(library,{pending});try{const rows=await pending;cache.set(library,{rows,at:Date.now()});return rows;}catch(e){cache.delete(library);throw e;}
 }
 async function trashed(rows,{fresh=false,strict=false}={}){
  const groups=new Map(),found=new Set();for(const row of rows){const id=identify(row.source);if(!id)continue;if(!groups.has(id.library))groups.set(id.library,[]);groups.get(id.library).push({...row,...id});}
  for(const [library,items] of groups){let states;try{states=await read(library,fresh);}catch(error){if(strict)throw error;continue;}for(const row of items){const state=states.get(row.uuid);if(state&&state.directory===row.directory&&state.filename===row.filename)found.add(row.filenameKey??row.filename);}}
  return found;
 }
 async function filterPaths(paths){const hidden=await trashed(paths.map(source=>({source,filenameKey:source})));return paths.filter(p=>!hidden.has(p));}
 module.exports={identify,trashed,filterPaths,invalidate:()=>cache.clear()};
}
