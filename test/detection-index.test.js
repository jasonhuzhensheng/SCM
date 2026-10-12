'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDetectionIndex}=require('../main-lib/detection-index');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await sleep(10)}throw Error('timed out')}
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scm-index-test-'));const pics=path.join(root,'photos');fs.mkdirSync(pics);
 let foregroundBusy=false;
 let rows=[{name:'qr.jpg',text:'订单 １２３'},{name:'plain.jpg',text:''},{name:'barcode.jpg',text:null}],calls=[];
 for(const r of rows)fs.writeFileSync(path.join(pics,r.name),r.name);
 const worker={run:async file=>{calls.push(path.basename(file));return {qr:path.basename(file)==='qr.jpg',barcode:path.basename(file)==='barcode.jpg'}},stop(){}};
 const config={directory:pics,databasePath:path.join(root,'images.sqlite'),binary:'mock',worker,libraryRows:()=>rows.map(r=>({...r})),isImage:()=>true,jobDelayMs:1,intervalMs:100000,foregroundBusy:()=>foregroundBusy};
 let service;
 try{
  service=createDetectionIndex(config);service.start();await until(()=>service.status().indexed===3);
  assert.equal(calls.length,3);assert.deepEqual(service.search('qr').filenames,['qr.jpg']);assert.deepEqual(service.search('barcode').filenames,['barcode.jpg']);assert.deepEqual(service.search('text','订单123').filenames,['qr.jpg']);
  const count=calls.length;for(let i=0;i<100;i++)service.search('qr');assert.equal(calls.length,count,'search must never invoke detector');
  service.close();service=createDetectionIndex(config);service.start();await until(()=>service.status().indexed===3);assert.equal(calls.length,count,'restart reuses SQLite results');
  fs.appendFileSync(path.join(pics,'plain.jpg'),'changed');await service.reconcile(true);await until(()=>calls.length===count+1&&service.status().indexed===3);
  assert.equal(calls.at(-1),'plain.jpg','only modified image reruns');
  rows.push({name:'new.jpg',text:null});fs.writeFileSync(path.join(pics,'new.jpg'),'new');service.add(rows.at(-1));await until(()=>service.status().indexed===4);
  service.setText('new.jpg','NEW TEXT');assert.deepEqual(service.search('text','newtext').filenames,['new.jpg']);
  rows=rows.filter(r=>r.name!=='qr.jpg');service.remove('qr.jpg');assert.deepEqual(service.search('qr').filenames,[]);
  service.setPaused(true);rows.push({name:'paused.jpg',text:null});fs.writeFileSync(path.join(pics,'paused.jpg'),'paused');service.add(rows.at(-1));await until(()=>service.status().total===4);await sleep(50);const pausedCount=calls.length;
  assert(!calls.includes('paused.jpg'));service.search('qr');assert.equal(calls.length,pausedCount);service.setPaused(false);await until(()=>calls.includes('paused.jpg'));
  foregroundBusy=true;rows.push({name:'deferred.jpg',text:null});fs.writeFileSync(path.join(pics,'deferred.jpg'),'new');service.add(rows.at(-1));
  await until(()=>service.status().total===5);await sleep(50);assert(!calls.includes('deferred.jpg'),'foreground indexing owns the CPU');assert.equal(service.status().paused,false,'automatic deferral must not change user pause preference');
  foregroundBusy=false;await until(()=>calls.includes('deferred.jpg'));
  service.close();
  // Legacy caches are imported only when the file signature still matches.
  const legacyDir=path.join(root,'legacy');fs.mkdirSync(legacyDir);const stat=fs.statSync(path.join(pics,'barcode.jpg'));const key=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  for(const kind of ['qr','barcode'])fs.writeFileSync(path.join(legacyDir,`${kind}-detections.json`),JSON.stringify({version:1,rows:[['barcode.jpg',{key,found:kind==='barcode'}]]}));
  const before=calls.length;rows=[{name:'barcode.jpg',text:null}];service=createDetectionIndex({...config,databasePath:path.join(legacyDir,'index.sqlite')});service.start();await until(()=>service.status().indexed===1);assert.equal(calls.length,before);assert.deepEqual(service.search('barcode').filenames,['barcode.jpg']);service.close();
  // A deleted in-flight row may not be resurrected by its late response.
  let release;rows=[{name:'plain.jpg',text:null}];service=createDetectionIndex({...config,databasePath:path.join(root,'late.sqlite'),worker:{run:()=>new Promise(r=>release=r),stop(){}}});service.start();await until(()=>release);rows=[];service.remove('plain.jpg');release({qr:true,barcode:true});await sleep(30);assert.deepEqual(service.search('qr').filenames,[]);service.close();
  console.log('PASS: SQLite persistence, queries never detect, unchanged restart reuse, modified/new-only detection, OCR sync, deletion, pause/resume, legacy migration, late-result protection');
 }finally{service?.close();fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
