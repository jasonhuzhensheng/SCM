"use strict";
// Presentation only: never use these counters to authorize deletion or skip work.
function transferProgress(job) {
 const rows=job.payload.rows || [], live=job.transferProgress || {};
 const journals=new Map([...(job.cloudPendingEntries||[]),...(job.photoBatchHistory||[]).flatMap(b=>b.entries||[]),...(job.photoBatch?.entries || [])].filter(e=>!e.jobId || e.jobId===job.id).map(e=>[e.index,e.journal]));
 if(job.current)journals.set(job.done,job.current);
 let transferredBytes=0,totalBytes=0,copied=0,verified=0;
 const successful=new Set((job.results||[]).filter(r=>r.ok).map(r=>r.filename));
 rows.forEach((row,index)=>{
  const size=Number((row.originalSignature||'').split(':')[2])||0;
  const journal=journals.get(index);
  const complete=successful.has(row.filename);
  const copiedFile=complete || !!journal?.remote;
  const checked=complete || !!journal?.deferredCopy?.verified || !!journal?.photoTarget || (!!journal?.remote && job.payload.mode!=='move');
  totalBytes+=size;
  if(copiedFile){copied++;transferredBytes+=size;}
  else if(live.filename===row.filename)transferredBytes+=Math.min(size,live.transferredBytes||0);
  if(checked)verified++;
 });
 const skipped=new Set((job.results||[]).filter(r=>r.skipped).map(r=>r.filename));
 const issues=[...journals.entries()].filter(([index,j])=>!skipped.has(rows[index]?.filename||j.filename)).flatMap(([index,j])=>{const error=j.copyError||j.validationError||(j.retainOriginal?'文件已锁定，保留原件，不执行删除':'');return error?[{filename:rows[index]?.filename||j.filename,error,retained:!!j.retainOriginal&&!j.copyError&&!j.validationError}]:[];});
 const phase=job.photoBatch?.confirmed && job.done<job.total && live.phase!=='release-local' ? 'index-cleanup' : (job.photoBatch?.requested||job.photoBatch?.commitSubset?.requested)&&!job.photoBatch.confirmed?'deleting':live.phase||'preparing';
 return {verificationConcurrency:job.photoBatch?.verificationConcurrency,activeVerifications:job.status==='running'?(job.photoBatch?.activeVerifications||0):0,issues,moved:(job.results||[]).filter(r=>r.ok).length,taskId:job.id,done:job.done,total:job.total,filename:live.filename||job.current?.filename||'',percent:live.percent||0,
  phase,copied,verified,releaseNames:phase==='release-local'?(job.photoBatch?.entries||[]).map(e=>job.payload.rows[e.index].filename):[],cloudVerified:job.payload.cloudVerifiedMove ? [...journals.values()].filter(j=>j.cloudVerified?.files?.length).length : undefined,localReleased:(job.photoBatchHistory||[]).filter(b=>b.localReleased).reduce((n,b)=>n+b.entries.length,0),transferredBytes,totalBytes,currentBytes:live.currentBytes||0,currentTotal:live.currentTotal||0,
  overallPercent:totalBytes?Math.min(100,transferredBytes/totalBytes*100):0};
}
module.exports={transferProgress};
