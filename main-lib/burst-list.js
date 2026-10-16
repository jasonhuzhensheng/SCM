'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const path=require('node:path');
function identify(source){const m=/^(.*\.photoslibrary)\/originals\/[0-9a-f]\/([0-9a-f-]{36})(?:_\d+)?\.[^/]+$/i.exec(source||'');return m?{library:m[1],uuid:m[2].toUpperCase()}:null;}
if(!isMainThread){
 const {DatabaseSync}=require('node:sqlite'),items=[],errors=[],libraries=new Map();
 for(const row of workerData){const id=identify(row.source);if(!id)continue;if(!libraries.has(id.library))libraries.set(id.library,[]);libraries.get(id.library).push({...row,...id});}
 for(const [library,rows]of libraries){let db;try{db=new DatabaseSync(path.join(library,'database/Photos.sqlite'),{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2000');const bursts=new Map(db.prepare("SELECT ZUUID uuid,ZAVALANCHEUUID burst FROM ZASSET WHERE ZTRASHEDSTATE=0 AND ZAVALANCHEUUID IS NOT NULL AND ZAVALANCHEUUID<>''").all().map(r=>[r.uuid.toUpperCase(),r.burst]));for(const row of rows)if(bursts.has(row.uuid))items.push({filename:row.filename,source:row.source,group:library+'/'+bursts.get(row.uuid)});}catch(e){errors.push(library+'：无法读取连拍分类（'+e.message+'）');}finally{db?.close();}}
 items.sort((a,b)=>a.group.localeCompare(b.group)||a.filename.localeCompare(b.filename));parentPort.postMessage({items,errors});
}else{
 let pending;
 module.exports={identify,list(rows){if(pending)return pending;pending=new Promise((resolve,reject)=>{const worker=new Worker(__filename,{workerData:rows});const timer=setTimeout(()=>{void worker.terminate();reject(Error('连拍扫描超时，请重试'));},30000);worker.once('message',r=>{clearTimeout(timer);resolve(r);});worker.once('error',e=>{clearTimeout(timer);reject(e);});worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('连拍扫描中断'));});}).finally(()=>{pending=null;});return pending;}};
}
