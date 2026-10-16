'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {writeIndexCheckpoint,recoverIndexCheckpoint}=require('../main-lib/index-checkpoint');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'index-checkpoint-'));try{
 const names=['memory-embeddings-test.bin','memory-phrase-embeddings-test.bin','memory-embed-meta-test.json','memories-index.json'];
 const baseline=()=>names.forEach((n,i)=>fs.writeFileSync(path.join(root,n),'old-'+i));
 const old=()=>names.forEach((n,i)=>assert.equal(fs.readFileSync(path.join(root,n),'utf8'),'old-'+i));
 baseline();await writeIndexCheckpoint(root,names.map((n,i)=>[n,Buffer.from('new-'+i)]));names.forEach((n,i)=>assert.equal(fs.readFileSync(path.join(root,n),'utf8'),'new-'+i));assert(!fs.existsSync(path.join(root,'.index-checkpoint')));
 baseline();const rename=fs.promises.rename;let failed=false;
 fs.promises.rename=async(a,b)=>{if(!failed&&a.endsWith('new-'+names[1])){failed=true;throw Error('injected disk failure')}return rename(a,b)};
 try{await assert.rejects(writeIndexCheckpoint(root,names.map(n=>[n,'changed'])),/injected/);}finally{fs.promises.rename=rename;}
 old();assert(!fs.existsSync(path.join(root,'.index-checkpoint')));
 // Emulate a process dying after only the first destination was replaced.
 const dir=path.join(root,'.index-checkpoint');fs.mkdirSync(dir);names.forEach(n=>fs.copyFileSync(path.join(root,n),path.join(dir,'old-'+n)));fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({state:'prepared',files:names.map(name=>({name,existed:true}))}));fs.writeFileSync(path.join(root,names[0]),'partial');recoverIndexCheckpoint(root);old();recoverIndexCheckpoint(root);
 // A durable commit marker must keep the new complete generation.
 fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({state:'committed',files:names.map(name=>({name,existed:true}))}));names.forEach(n=>fs.writeFileSync(path.join(root,n),'committed'));recoverIndexCheckpoint(root);names.forEach(n=>assert.equal(fs.readFileSync(path.join(root,n),'utf8'),'committed'));
 // Fail before manifest: originals must never be touched.
 baseline();fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'new-'+names[0]),'incomplete');recoverIndexCheckpoint(root);old();
 console.log('PASS: atomic checkpoint success, failed swap rollback, interrupted save recovery, committed recovery and incomplete staging');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
