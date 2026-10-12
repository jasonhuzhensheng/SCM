'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createDetectionWorker}=require('./detection-worker');
const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const searchable=text=>/[\p{L}\p{N}]/u.test(String(text||''))?normalize(text):'';
const signature=s=>`${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const delay=()=>new Promise(resolve=>setImmediate(resolve));
function createDetectionIndex({directory,databasePath,binary,libraryRows,isImage,worker=createDetectionWorker(binary),intervalMs=300000,jobDelayMs=30,foregroundBusy=()=>false}) {
 fs.mkdirSync(path.dirname(databasePath),{recursive:true});
 const db=new DatabaseSync(databasePath);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS images(name TEXT PRIMARY KEY, signature TEXT, verified INTEGER NOT NULL DEFAULT 0, qr INTEGER, barcode INTEGER, text TEXT, text_norm TEXT, ocr_source TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT);
 CREATE INDEX IF NOT EXISTS qr_hits ON images(qr,verified);
 CREATE INDEX IF NOT EXISTS barcode_hits ON images(barcode,verified);
 CREATE INDEX IF NOT EXISTS detection_pending ON images(retry_at)
 WHERE verified=1 AND (qr IS NULL OR barcode IS NULL) AND attempts<3;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
 UPDATE images SET verified=0;`);
 if(!db.prepare('PRAGMA table_info(images)').all().some(c=>c.name==='ocr_source'))db.exec('ALTER TABLE images ADD COLUMN ocr_source TEXT');
 const get=db.prepare('SELECT * FROM images WHERE name=?');
 const entries=new Map(), dirty=new Set();
 let closed=false,paused=db.prepare("SELECT value FROM settings WHERE key='paused'").get()?.value==='1',reconciling=false,running=false,scheduled=null,watcher=null,interval=null,started=false;
 let legacy={};for(const kind of ['qr','barcode']){try{const json=JSON.parse(fs.readFileSync(path.join(path.dirname(databasePath),`${kind}-detections.json`),'utf8'));if(json.version===1)legacy[kind]=new Map(json.rows)}catch{}}
 const textValue=text=>typeof text==='string'?text:null;
 function add(entry){if(closed||!entry||!isImage(entry.name)||path.basename(entry.name)!==entry.name)return;
  entries.set(entry.name,{...entry});dirty.add(entry.name);schedule();
 }
 function remove(name){if(closed)return;entries.delete(name);dirty.delete(name);db.prepare('DELETE FROM images WHERE name=?').run(name)}
 function setText(name,text){if(closed)return;const entry=entries.get(name);if(entry)entry.text=text;db.prepare('UPDATE images SET text=?,text_norm=?,ocr_source=? WHERE name=?').run(textValue(text),text==null?null:searchable(text),textValue(text),name)}
 async function syncOne(name){
  const entry=entries.get(name);if(!entry)return;
  const before=get.get(name);
  try{
   const stat=await fs.promises.stat(path.join(directory,name));if(closed||entries.get(name)!==entry)return;
   if(!stat.isFile())throw Error('图片文件不可用');
   const key=signature(stat);
   if(before?.signature===key){db.prepare('UPDATE images SET verified=1 WHERE name=? AND signature=?').run(name,key);if(before.ocr_source!==textValue(entry.text))setText(name,entry.text);return}
   const qr=legacy.qr?.get(name),barcode=legacy.barcode?.get(name);
   // Changed content invalidates every old detection, including OCR.
   const text=before?null:textValue(entry.text);
   db.prepare(`INSERT INTO images(name,signature,verified,qr,barcode,text,text_norm,ocr_source) VALUES(?,?,1,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET signature=excluded.signature,verified=1,qr=excluded.qr,barcode=excluded.barcode,text=excluded.text,text_norm=excluded.text_norm,ocr_source=excluded.ocr_source,attempts=0,retry_at=0,error=NULL`).run(name,key,qr?.key===key&&typeof qr.found==='boolean'?Number(qr.found):null,barcode?.key===key&&typeof barcode.found==='boolean'?Number(barcode.found):null,text,text==null?null:searchable(text),textValue(entry.text));
  }catch(error){if(closed||entries.get(name)!==entry)return;db.prepare(`INSERT INTO images(name,verified,error,attempts) VALUES(?,0,?,3) ON CONFLICT(name) DO UPDATE SET verified=0,error=excluded.error,attempts=3`).run(name,'图片文件暂不可读取');}
 }
 async function reconcile(verifyAll=false){
  if(closed||reconciling)return;reconciling=true;
  try{
   const rows=libraryRows(),live=new Set(rows.filter(r=>isImage(r.name)).map(r=>r.name));
   for(const row of db.prepare('SELECT name FROM images').all())if(!live.has(row.name))remove(row.name);
   for(let i=0;i<rows.length;i++){
    if(closed)return;const entry=rows[i];if(!live.has(entry.name))continue;
    const old=entries.get(entry.name);entries.set(entry.name,{...entry});
    if(verifyAll||!get.get(entry.name))dirty.add(entry.name);
    else if(!old||old.text!==entry.text)setText(entry.name,entry.text);
    if(i%128===0){schedule();await delay()}
   }
  }catch(error){if(!closed)console.warn("[detection-index] reconcile:",error.message)}finally{reconciling=false;schedule()}
 }
 function schedule(waitMs=jobDelayMs){if(closed||scheduled)return;scheduled=setTimeout(()=>{scheduled=null;void tick()},waitMs);scheduled.unref?.()}
 async function tick(){
  if(closed||running)return;running=true;
  try{
   // Metadata checks are bounded; searching never waits for this queue.
   for(let i=0;i<32&&dirty.size;i++){const name=dirty.values().next().value;dirty.delete(name);await syncOne(name);if(closed)return}
   if(!dirty.size&&!reconciling)legacy={};
   if(paused||foregroundBusy())return;
   const row=db.prepare('SELECT * FROM images INDEXED BY detection_pending WHERE verified=1 AND (qr IS NULL OR barcode IS NULL) AND attempts<3 AND retry_at<=? LIMIT 1').get(Date.now());
   if(!row)return;
   try{
    const file=path.join(directory,row.name);const result=await worker.run(file);
    if(closed)return;
    const current=get.get(row.name);if(!current||current.signature!==row.signature||!entries.has(row.name))return;
    const stat=await fs.promises.stat(file);if(closed)return;
    if(signature(stat)!==row.signature){dirty.add(row.name);db.prepare('UPDATE images SET verified=0 WHERE name=?').run(row.name);return}
    if(typeof result.qr!=='boolean'||typeof result.barcode!=='boolean')throw Error('检测失败');
    db.prepare('UPDATE images SET qr=?,barcode=?,error=NULL,attempts=0,retry_at=0 WHERE name=? AND signature=?').run(Number(result.qr),Number(result.barcode),row.name,row.signature);
   }catch(error){if(!closed&&!paused)db.prepare('UPDATE images SET attempts=attempts+1,retry_at=?,error=? WHERE name=? AND signature=?').run(Date.now()+60000,'图像检测失败，后台将有限次重试',row.name,row.signature)}
  }catch(error){if(!closed)console.warn('[detection-index]',error.message)}
  finally{running=false;if(!closed&&(dirty.size||(!paused&&db.prepare('SELECT 1 FROM images INDEXED BY detection_pending WHERE verified=1 AND (qr IS NULL OR barcode IS NULL) AND attempts<3 AND retry_at<=? LIMIT 1').get(Date.now()))))schedule(foregroundBusy()?1000:jobDelayMs)}
 }
 function status(kind='qr'){
  const column=kind==='text'?'text':kind;const row=db.prepare(`SELECT count(*) total, coalesce(sum(verified=1 AND ${column} IS NOT NULL),0) completed, coalesce(sum(${kind==='text'?'0':`error IS NOT NULL AND ${column} IS NULL`}),0) failed FROM images`).get();
  const total=Math.max(entries.size,Number(row.total));return {total,indexed:Number(row.completed),pending:Math.max(0,total-Number(row.completed)),failed:Number(row.failed),paused,reconciling:reconciling||dirty.size>0};
 }
 function search(kind,query=''){
  if(!['qr','barcode','text'].includes(kind))throw Error('无效的索引类型');
  const rows=kind==='text'?db.prepare("SELECT name FROM images WHERE verified=1 AND text_norm IS NOT NULL AND text_norm<>'' AND instr(text_norm,?)>0").all(normalize(query)):db.prepare(`SELECT name FROM images WHERE verified=1 AND ${kind}=1`).all();
  return {filenames:rows.map(r=>r.name),status:status(kind)};
 }
 function setPaused(value){paused=!!value;db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('paused',?)").run(paused?'1':'0');if(paused)worker.stop();else schedule();return status()}
 function start(){if(started)return;started=true;void reconcile(true);try{watcher=fs.watch(directory,(_event,name)=>{const value=String(name||'');if(entries.has(value)){dirty.add(value);db.prepare('UPDATE images SET verified=0 WHERE name=?').run(value);schedule()}});watcher.on("error",()=>{watcher?.close();watcher=null})}catch{}
  interval=setInterval(()=>{void reconcile(true)},intervalMs);interval.unref?.();
 }
 function close(){if(closed)return;closed=true;clearTimeout(scheduled);clearInterval(interval);watcher?.close();worker.stop();db.close()}
 return {start,search,status,add,remove,setText,setPaused,close,reconcile};
}
module.exports={createDetectionIndex,normalize};
