'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {digest}=require('../main-lib/folder-transfer');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'digest-check-'));
 try{
  const file=path.join(root,'data'),data=crypto.randomBytes(9*1024*1024+17);
  await fs.writeFile(file,data);
  const progress=[];
  assert.equal(await digest(file,new AbortController().signal,n=>progress.push(n)),crypto.createHash('sha256').update(data).digest('hex'));
  assert.equal(progress.at(-1),data.length);
  assert(progress.every((n,i)=>!i||n>progress[i-1]));
  const controller=new AbortController();
  await assert.rejects(digest(file,controller.signal,()=>controller.abort()),{name:'AbortError'});
  await fs.writeFile(file,'');
  const empty=[];
  assert.equal(await digest(file,undefined,n=>empty.push(n)),crypto.createHash('sha256').digest('hex'));
  assert.deepEqual(empty,[0]);
  await assert.rejects(digest(file,controller.signal),{name:'AbortError'});
  console.log('PASS: multi-block SHA-256, exact final progress, mid-read cancellation, empty file and pre-abort');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
