'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {copyResumable,verifiedCopy}=require('../main-lib/folder-transfer');
(async()=>{
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'copy-evidence-')),source=path.join(root,'source'),out=path.join(root,'out');
 const original=fs.createReadStream;let reads=[];
 try{
  await fsp.mkdir(out);await fsp.writeFile(source,Buffer.alloc(200000,7));
  fs.createReadStream=function(file,...args){reads.push(file);return original.call(this,file,...args);};
  const signal=new AbortController().signal;
  const target=await copyResumable(source,'a',out,signal,()=>{},'test');
  assert.equal(reads.length,2,'new copy reads source once and target once');
  assert(await verifiedCopy(source,target));
  reads=[];await copyResumable(source,'a',out,signal,()=>{},'test');assert.equal(reads.length,0,'unchanged proof avoids repeat reads');
  const st=await fsp.stat(target);await fsp.writeFile(target,Buffer.alloc(200000,8));await fsp.utimes(target,st.atime,st.mtime);
  assert.equal(await verifiedCopy(source,target),null,'same-size edit with restored mtime invalidates proof');
  await assert.rejects(copyResumable(source,'a',out,signal,()=>{},'test'),/内容不同/);
  await fsp.copyFile(source,target);reads=[];
  await copyResumable(source,'a',out,signal,()=>{},'test');assert.equal(reads.length,2,'uncached existing target hashes both sides');
  await fsp.writeFile(source,Buffer.alloc(200000,9));assert.equal(await verifiedCopy(source,target),null);
  await fsp.unlink(target);await fsp.symlink(source,target);await assert.rejects(copyResumable(source,'a',out,signal,()=>{},'test'),/类型/);
  console.log('PASS: new copy 2 reads, reuse 0 reads, changed source/target rejected, restored mtime rejected, existing copy fallback, symlink rejected');
 }finally{fs.createReadStream=original;await fsp.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
