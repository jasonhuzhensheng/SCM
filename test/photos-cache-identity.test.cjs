'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {resolveCache}=require('../main-lib/photos-cache-identity');
const {photosOriginal,createPhotoDeletion}=require('../main-lib/photo-deletion');
(async()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'photos-cache-')));
 try {
  const lib=path.join(dir,'Fixture.photoslibrary'),uuid='C2484340-19D9-4ABB-A615-1A1B572CFB8E';
  const file=path.join(lib,'resources/cpl/cloudsync.noindex/storage/filecache/AQH/cpl-test.mp4');
  const original=path.join(lib,'originals/C',uuid+'.mp4');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(path.dirname(original),{recursive:true});fs.mkdirSync(path.join(lib,'database'));
  fs.writeFileSync(file,'matching-video');fs.writeFileSync(original,'matching-video');
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(lib,'database/Photos.sqlite'));
  db.exec('CREATE TABLE ZASSET(Z_PK INTEGER,ZUUID TEXT,ZDIRECTORY TEXT,ZFILENAME TEXT,ZTRASHEDSTATE INTEGER);CREATE TABLE ZINTERNALRESOURCE(ZASSET INTEGER,ZDATALENGTH INTEGER)');
  db.prepare('INSERT INTO ZASSET VALUES(1,?,?,?,0)').run(uuid,'C',uuid+'.mp4');db.prepare('INSERT INTO ZINTERNALRESOURCE VALUES(1,?)').run(14);db.close();
  const controller=new AbortController();controller.abort();await assert.rejects(photosOriginal(file,{signal:controller.signal}),{name:'AbortError'});
  let progress=0;assert.equal((await photosOriginal(file,{progress:()=>progress++})).uuid,uuid);assert(progress>0);
  const editDb=new DatabaseSync(path.join(lib,'database/Photos.sqlite'));editDb.exec('UPDATE ZASSET SET ZTRASHEDSTATE=1');await assert.rejects(photosOriginal(file),e=>e.retryable===false&&/最近删除/.test(e.message));editDb.exec('UPDATE ZASSET SET ZTRASHEDSTATE=0');editDb.close();
  let called=false;const deletion=createPhotoDeletion({directory:dir,bridge:async request=>{called=true;assert.equal(request.verification,undefined,'cache must always use full PhotoKit content verification');assert.equal(request.hash.length,64);throw Error('fixture stops before deletion');}});
  const st=fs.statSync(file),sig=[st.dev,st.ino,st.size,st.mtimeMs,st.ctimeMs].join(':');
  await assert.rejects(deletion.remove(file,sig,{},()=>{},undefined,undefined,{verification:'system-copy'}),/fixture/);assert(called);
  fs.writeFileSync(file,'different-data');
  await assert.rejects(photosOriginal(file),e=>e.retryable===false&&/不匹配/.test(e.message));
  fs.writeFileSync(file,'matching-video');
  const uuid2='D2484340-19D9-4ABB-A615-1A1B572CFB8E';fs.mkdirSync(path.join(lib,'originals/D'));fs.writeFileSync(path.join(lib,'originals/D',uuid2+'.mp4'),'matching-video');
  await assert.rejects(resolveCache(file,async()=>[{uuid,directory:'C',filename:uuid+'.mp4'},{uuid:uuid2,directory:'D',filename:uuid2+'.mp4'}]),e=>e.retryable===false&&/多个/.test(e.message));
  const {createFileTasks}=require('../main-lib/file-tasks');let runs=0;const store=createFileTasks(path.join(dir,'tasks.json'),{transfer:async()=>{runs++;throw Object.assign(Error('需人工处理'),{retryable:false});}},()=>null);
  await assert.rejects(store.add('transfer',{mode:'copy',rows:[]},0).promise);
  assert.equal(store.snapshot()[0].status,'paused');assert.equal(store.snapshot()[0].error,'需人工处理');
  await new Promise(r=>setTimeout(r,3200));assert.equal(runs,1);store.stop();
  console.log('PASS: worker lookup, content match/mismatch, ambiguous identity rejection, mandatory PhotoKit hash and permanent pause');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
