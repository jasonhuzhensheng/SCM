const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {transferProgress}=require('../main-lib/transfer-progress');
const {copyResumable}=require('../main-lib/folder-transfer');
const {createFileTasks}=require('../main-lib/file-tasks');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'transfer-progress-'));
 try {
  const job={id:'a',kind:'transfer',status:'paused',done:0,total:3,payload:{mode:'move',rows:[0,1,2].map(i=>({filename:`${i}.mp4`,originalSignature:'1:2:100:4:5'}))},photoBatch:{entries:[{index:0,journal:{remote:{},photoTarget:{}}}]},transferProgress:{filename:'1.mp4',phase:'copying',transferredBytes:40,currentBytes:40,currentTotal:100,percent:40}};
  let p=transferProgress(job);assert.equal(p.copied,1);assert.equal(p.verified,1);assert.equal(p.transferredBytes,140);assert.equal(p.done,0);
  await fs.writeFile(path.join(root,'tasks.json'),JSON.stringify([job]));
  const tasks=createFileTasks(path.join(root,'tasks.json'),{},()=>false);
  assert.deepEqual(tasks.snapshot()[0].progress,p);
  job.photoBatch.entries.push({index:1,journal:{remote:{}}});p=transferProgress(job);assert.equal(p.transferredBytes,200);assert.equal(p.verified,1);
  job.done=1;job.results=[{filename:'0.mp4',ok:true}];assert.equal(transferProgress(job).transferredBytes,200);
  job.photoBatch.verificationConcurrency=10;job.photoBatch.activeVerifications=7;
  assert.equal(transferProgress(job).activeVerifications,0,'paused task has no live workers');
  job.status='running';assert.equal(transferProgress(job).activeVerifications,7);assert.equal(transferProgress(job).verificationConcurrency,10);
  job.photoBatch.commitSubset={requested:true};assert.equal(transferProgress(job).phase,'deleting');
  job.photoBatch.confirmed=true;assert.equal(transferProgress(job).phase,'index-cleanup');
  const skippedJob={id:'skip',kind:'transfer',status:'complete',done:2,total:2,payload:{mode:'move',rows:[{filename:'deleted.jpg'},{filename:'failed.jpg'}]},results:[{filename:'deleted.jpg',ok:false,skipped:true},{filename:'failed.jpg',ok:false}],photoBatch:{entries:[{index:0,journal:{validationError:'已在最近删除'}},{index:1,journal:{copyError:'目标文件不可写'}}]}};
  const skippedBefore=JSON.stringify(skippedJob);
  assert.deepEqual(transferProgress(skippedJob).issues,[{filename:'failed.jpg',error:'目标文件不可写',retained:false}]);
  assert.equal(JSON.stringify(skippedJob),skippedBefore,'presentation must preserve original journals');
  const source=path.join(root,'source'),dest=path.join(root,'dest');await fs.mkdir(dest);await fs.writeFile(source,Buffer.alloc(300000,9));
  for(let attempt=0;attempt<2;attempt++){
   const events=[];await copyResumable(source,'out',dest,new AbortController().signal,(sent,size,phase)=>events.push({sent,size,phase}),'a');
   const checking=events.filter(e=>e.phase==='verifying');
   if(attempt===0){assert(checking.length>=2);assert.equal(checking.at(-1).sent,300000);assert.equal(checking.at(-1).size,300000);}
   else assert.equal(events.length,0,'unchanged process-local evidence needs no repeated hash progress');
   assert.equal(events.some(e=>e.phase==='copying'),attempt===0);
  }
  console.log('PASS: byte totals, verification counts, paused snapshot, no double counting, delete phase, copy and resume hash progress');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
