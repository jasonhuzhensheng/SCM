const assert=require('assert/strict'),{loadSnapshot}=require('../native/menu-search/index-snapshot.cjs');
const paths=['index','meta','bin','phrase'],data=['{"ocr":"old"}','{"count":1}',Buffer.from('vector'),Buffer.from('phrase')],versions=[1,1,1,1];let reads=[];
const io={statSync(p){return {dev:1,ino:paths.indexOf(p)+1,size:20,mtimeMs:versions[paths.indexOf(p)],ctimeMs:1}},readFileSync(p){reads.push(p);return data[paths.indexOf(p)]}};
let a=loadSnapshot(paths,null,io);assert.equal(reads.length,4);reads=[];assert.equal(loadSnapshot(paths,a,io),a);assert.equal(reads.length,0);
versions[0]++;data[0]='{"ocr":"new"}';const b=loadSnapshot(paths,a,io);assert.deepEqual(reads,['index']);assert.equal(b.bin,a.bin);assert.equal(b.phraseBin,a.phraseBin);assert.equal(b.index.ocr,'new');
versions[2]++;data[2]=Buffer.from('changed');reads=[];const c=loadSnapshot(paths,b,io);assert.deepEqual(reads,['bin']);assert.notEqual(c.bin,b.bin);
versions[0]++;const race={...io,readFileSync(p){versions[0]++;return io.readFileSync(p)}};assert.throws(()=>loadSnapshot(paths,c,race),/正在更新/);assert.equal(c.index.ocr,'new');
console.log('PASS unchanged reuse, metadata refresh without vector reads, vector replacement, racing writes rejected');
