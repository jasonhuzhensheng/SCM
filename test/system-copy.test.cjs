'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),vm=require('node:vm');
const {simpleCopy,copyOne}=require('../main-lib/local-copy-first');
const {createPhotoDeletion,photosOriginal,isPhotosPath,sameOriginalIdentity}=require('../main-lib/photo-deletion');
const sig=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'system-copy-'));const original=fs.createReadStream;try{
 const uuid='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',source=path.join(root,'fixture.photoslibrary','originals','a',uuid+'.jpg'),out=path.join(root,'out');fs.mkdirSync(path.dirname(source),{recursive:true});fs.mkdirSync(out);fs.writeFileSync(source,Buffer.alloc(100000,7));
 fs.createReadStream=()=>{throw Error('unexpected whole-file hashing');};
 const signal=new AbortController().signal,j={},save=()=>{},row={source,filename:'primary.jpg',originalSignature:sig(fs.statSync(source))};
 const target=await simpleCopy(source,row.filename,out,signal,()=>{},j,save);
 assert.equal(j.deferredCopy.verification,'system-copy');assert.equal(j.deferredCopy.hash,undefined);
 const restored=JSON.parse(JSON.stringify(j));await simpleCopy(source,row.filename,out,signal,()=>{},restored,save);
 await assert.rejects(simpleCopy(source,row.filename,out,signal,()=>{},{},save),/复制记录/);
 fs.writeFileSync(target,'short');await simpleCopy(source,row.filename,out,signal,()=>{},j,save);assert.equal(fs.readFileSync(j.deferredCopy.repairBackup,'utf8'),'short');assert.equal(fs.statSync(target).size,100000);
 // Old copy-first proof is usable without a new hash pass.
 const legacyTarget=path.join(out,'legacy');const legacy={deferredCopy:await copyOne(source,legacyTarget,signal,()=>{}),remote:{localPath:legacyTarget}};
 await simpleCopy(source,'legacy',out,signal,()=>{},legacy,save);assert(legacy.deferredCopy.verified);
 const requests=[];
 const deletion=createPhotoDeletion({directory:path.join(root,'receipts'),bridge:async r=>{requests.push(r);if(r.mode==='verify-delete')return {id:uuid+'/L0/001',assetVersion:'1',primaryIndex:0,resources:[{index:0,type:1,filename:'a.jpg',size:100000},{index:1,type:5,filename:'edit.aae'}]};if(r.mode==='export-resources'){const file=path.join(r.directory,'1-edit.aae');fs.writeFileSync(file,'sidecar');return {files:[{index:1,path:file,size:7}]};}return {verified:true};}});
 const code=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 const ctx={fs,path,taskSignature:sig,require:s=>require(s.replace('./main-lib/','../main-lib/')),sameOriginalIdentity,isPhotosPath,photosOriginal,filesLocked:()=>false,assetLocks:new Set(),assertPhotoAssetUnlocked:()=>{},getPhotoDeletion:()=>deletion};
 vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('async function verifiedTransferTarget('),code.indexOf('function finishTransferItem(')),ctx);
 const job={payload:{localFolder:true},folder:{localPath:out},current:j};await ctx.trashTransferredOriginal(job,row,source,signal,save,()=>false,true);
 assert.equal(j.photosPrepared.verification,'system-copy');assert.equal(j.photosPrepared.hash,undefined);assert.equal(j.photosPrepared.deletedBytes,100007);assert.equal(j.resourceTargetSignatures.length,1);assert.equal(requests[0].sourcePath,fs.realpathSync(source));assert.equal(requests[1].primaryIndex,0);
 assert(require('../main-lib/cloud-batch').preparedResourcesComplete(j));
 await assert.rejects(require('../main-lib/cloud-batch').verifyEntry({payload:{rows:[row]},folder:{localPath:out}},{index:0,journal:j},{},signal),/完整内容摘要/);
 assert(fs.existsSync(source));
 console.log('PASS: zero hash reads through local copy, persisted resume and PhotoKit preparation; changed target retained/recopied; unowned target rejected; cloud requires hash');
}finally{fs.createReadStream=original;fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
