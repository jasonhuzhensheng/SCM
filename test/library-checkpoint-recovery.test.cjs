'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),cp=require('child_process');
const store=require('../main-lib/library-store');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'library-checkpoint-'));try{
 store.initLibraryStore({userDataDir:root});const l=store.loadLibrary();l.dim=768;
 for(let i=0;i<60;i++){l.filenames.push('file'+i+'.jpg');l.sources.push('/original/'+i);l.embeddings.push(Float32Array.from({length:768},()=>i+1));l.phrases.push(Float32Array.from({length:768},()=>i+100));}
 await store.saveLibrary({strict:true});
 const dir=path.join(root,'library'),files=fs.readdirSync(dir).filter(n=>n.endsWith('.bin')||n==='memories-index.json'||n.startsWith('memory-embed-meta'));
 const before=Object.fromEntries(files.map(n=>[n,fs.readFileSync(path.join(dir,n))]));
 // Exit a child during the second file swap, leaving a mixed on-disk generation.
 const script=`const fs=require('fs');const {writeIndexCheckpoint}=require(${JSON.stringify(require.resolve('../main-lib/index-checkpoint'))});const rename=fs.promises.rename;let swaps=0;fs.promises.rename=async(a,b)=>{if(a.includes('/new-')&&++swaps===2)process.exit(77);return rename(a,b)};writeIndexCheckpoint(${JSON.stringify(dir)},${JSON.stringify(files)}.map(n=>[n,Buffer.from('interrupted')]));`;
 const child=cp.spawnSync(process.execPath,['-e',script]);assert.equal(child.status,77);
 store.resetLibraryCaches();const recovered=store.loadLibrary();assert.equal(recovered.filenames.length,60);assert.equal(recovered.embeddings[19][0],20);assert.equal(recovered.phrases[19][0],119);for(const n of files)assert(before[n].equals(fs.readFileSync(path.join(dir,n))));
 for(const k of ['filenames','sources','embeddings','phrases'])recovered[k].splice(0,25);
 await store.saveLibrary({strict:true});store.resetLibraryCaches();const compacted=store.loadLibrary();assert.equal(compacted.filenames.length,35);assert.equal(compacted.filenames[0],'file25.jpg');assert.equal(compacted.embeddings[0][0],26);assert.equal(compacted.phrases[0][0],125);
 const rename=fs.promises.rename;let injected=false;fs.promises.rename=async(a,b)=>{if(!injected&&a.includes('/new-')){injected=true;throw Error('write failure')}return rename(a,b)};
 try{await assert.rejects(store.saveLibrary({strict:true}),/write failure/);}finally{fs.promises.rename=rename;}
 store.resetLibraryCaches();assert.equal(store.loadLibrary().filenames.length,35);
 console.log('PASS: real child interrupted checkpoint recovered by loadLibrary; filename/source/vector alignment, batched reload, strict error propagation');
}finally{store.resetLibraryCaches();fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
