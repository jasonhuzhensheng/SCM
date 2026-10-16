'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {copyAll,verifyOrRepair}=require('../main-lib/local-copy-first');
const sig=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
(async()=>{const root=await fsp.mkdtemp(path.join(os.tmpdir(),'copy-first-'));const original=fs.createReadStream;try{
 const out=path.join(root,'out');await fsp.mkdir(out);const rows=[];
 for(let i=0;i<3;i++){const source=path.join(root,`source${i}`);await fsp.writeFile(source,Buffer.alloc(100000,i+1));rows.push({source,filename:`${i}.mov`,originalSignature:sig(await fsp.stat(source))});}
 const job={payload:{rows},folder:{localPath:out},photoBatch:{entries:rows.map((r,index)=>({index,journal:{filename:r.filename}}))}};
 let reads=0;fs.createReadStream=function(...args){reads++;return original.apply(this,args);};const signal=new AbortController().signal;
 await copyAll(job,()=>{},()=>false,signal,()=>{},async()=>{});assert.equal(reads,0,'all copies complete before any hashing');
 assert(job.copyFirstComplete);assert(job.photoBatch.entries.every(e=>e.journal.remote&&!e.journal.deferredCopy.verified));
 await copyAll(job,()=>{},()=>false,signal,()=>{},async()=>{});assert.equal(reads,0,'resume copied files without re-reading');
 const j=job.photoBatch.entries[1].journal,target=path.join(out,'1.mov');await fsp.writeFile(target,Buffer.alloc(100000,9));
 await verifyOrRepair(rows[1].source,'1.mov',out,signal,()=>{},'task',j,()=>{});
 assert(j.deferredCopy.verified);assert.equal(j.deferredCopy.repairs,1);assert.equal((await fsp.readFile(j.deferredCopy.repairBackup))[0],9);assert.deepEqual(await fsp.readFile(target),await fsp.readFile(rows[1].source));
 await fsp.writeFile(target,Buffer.alloc(100000,8));await assert.rejects(verifyOrRepair(rows[1].source,'1.mov',out,signal,()=>{},'task',j,()=>{}),/内容不同/);
 const prior=job.photoBatch.entries[0].journal;await fsp.writeFile(rows[0].source,Buffer.alloc(100000,4));await assert.rejects(verifyOrRepair(rows[0].source,'0.mov',out,signal,()=>{},'task',prior,()=>{}),/身份已变化/);
 // One failed file must not prevent later files from being copied.
 const out2=path.join(root,'out2');await fsp.mkdir(out2);const second={payload:{rows},folder:{localPath:out2},photoBatch:{entries:rows.map((r,index)=>({index,journal:{filename:r.filename}}))}};
 await copyAll(second,()=>{},()=>false,signal,()=>{},async()=>{});
 assert(fs.existsSync(path.join(out2,'1.mov'))&&fs.existsSync(path.join(out2,'2.mov')));assert(second.copyFirstComplete);assert.equal(second.copyFailures,1);assert(second.photoBatch.entries[0].journal.copyError);
 console.log('PASS: copy-all before hashing, resume no reads, corrupt target preserved/retransferred, bounded repair, source changes protected, failures do not block later copies');
}finally{fs.createReadStream=original;await fsp.rm(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
