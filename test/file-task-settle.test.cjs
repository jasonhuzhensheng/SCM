'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {createFileTasks}=require('../main-lib/file-tasks');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'file-settle-'));try{
 let release,entered;const started=new Promise(r=>entered=r),checkpoint=new Promise(r=>release=r);const store=createFileTasks(path.join(dir,'file-tasks.json'),{delete:async(job,save)=>{entered();await checkpoint;job.done=1;save();return {}; }},()=>false);
 const added=store.add('delete',{rows:[{filename:'one'}]},1);await started;store.stop();let settled=false;const wait=store.settle().then(()=>settled=true);await new Promise(r=>setImmediate(r));assert.equal(settled,false);release();await wait;assert.equal(settled,true);const saved=JSON.parse(fs.readFileSync(path.join(dir,'file-tasks.json')));assert.equal(saved[0].done,1);assert.equal(saved[0].status,'queued');await store.settle();
 console.log('PASS: shutdown waits for task checkpoint before final queued state');
}finally{fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
