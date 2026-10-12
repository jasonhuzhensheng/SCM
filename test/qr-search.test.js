'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createQrSearch}=require('../main-lib/qr-search');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qr-search-'));try{
 let names=['qr.jpg','plain.jpg'];for(const name of names)fs.writeFileSync(path.join(dir,name),name);
 let calls=0;const config={directory:dir,cachePath:path.join(dir,'cache.json'),binary:'mock',libraryNames:()=>names,run:async(_binary,paths)=>{calls++;return paths.map(p=>({found:path.basename(p)==='qr.jpg'}))}};
 let scan=createQrSearch(config);
 assert.deepEqual((await scan(names)).filenames,['qr.jpg']);assert.equal(calls,1);
 scan=createQrSearch(config);assert.deepEqual((await scan(names)).filenames,['qr.jpg']);assert.equal(calls,1);
 names=['plain.jpg'];assert.deepEqual((await scan(['qr.jpg','plain.jpg'])).filenames,[]);assert.equal(calls,1);
 fs.appendFileSync(path.join(dir,'plain.jpg'),'changed');await scan(names);assert.equal(calls,2);
 await assert.rejects(scan(['../secret']));await assert.rejects(scan(Array(33).fill('plain.jpg')));
 // Deletion during an in-flight detection cannot resurrect the row.
 fs.appendFileSync(path.join(dir,'plain.jpg'),'again');
 scan=createQrSearch({...config,run:async()=>{names=[];return [{found:true}]}});
 assert.deepEqual((await scan(['plain.jpg'])).filenames,[]);
 console.log('PASS: QR-only results, cache reuse across restart, deletion and re-search returns empty, modified file recheck, path/batch validation, deletion during detection');
}finally{fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
