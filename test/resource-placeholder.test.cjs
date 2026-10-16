'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'resource-placeholder-'));try{
 const old=path.join(root,'old');fs.mkdirSync(old);const placeholder=path.join(old,'1-extra');fs.writeFileSync(placeholder,'');fs.truncateSync(placeholder,695);assert.equal(fs.statSync(placeholder).blocks,0);
 const job={payload:{localFolder:true},folder:{localPath:root},current:{resourcesDirectory:old}};
 const request={uuid:'asset',id:'asset',hash:'primary',size:20,resources:[{index:0,hash:'primary',size:20},{index:1,hash:'extra',size:695}]};
 const code=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');const start=code.indexOf('async function backupPhotoResources('),end=code.indexOf('async function trashTransferredOriginal(',start);
 const c={fs,path,verifiedTransferTarget:async()=> 'signature'};vm.createContext(c);vm.runInContext(code.slice(start,end),c);
 await c.backupPhotoResources(job,{filename:'primary'},request,async dir=>{assert.notEqual(dir,old);const file=path.join(dir,'1-extra');fs.writeFileSync(file,Buffer.alloc(695,1));return {files:[{index:1,path:file}]};},new AbortController().signal,()=>{});
 assert(job.current.resourcesVerified);assert(fs.existsSync(placeholder));assert.equal(job.current.previousResourceDirectories[0],old);assert.equal(job.current.resourceTargetSignatures.length,1);
 console.log('PASS: evicted companion re-exported to fresh directory; old placeholder retained; resource verified');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
