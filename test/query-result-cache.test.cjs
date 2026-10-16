"use strict";
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {openQueryResultCache}=require('../main-lib/query-result-cache');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'query-cache-'));let cache,time=1000;
const ctx={libraryId:'test',libraryRevision:'1',modelVersion:'m1',searchVersion:'s1',mode:'semantic',filters:{type:'photo',locked:false},sort:'relevance',page:0};
try {
 const file=path.join(root,'queries.sqlite');const options={maxEntries:2,maxBytes:4096,ttlMs:100,now:()=>time};cache=openQueryResultCache(file,options);
 assert.equal(cache.lookup('海边',ctx).hit,false);cache.store('海边',ctx,[{filename:'a',score:0.9}]);cache.close();cache=openQueryResultCache(file,options);
 assert.equal(cache.lookup(' 海边 ',{...ctx,filters:{locked:false,type:'photo'}}).result[0].filename,'a');
 for(const key of ['libraryId','libraryRevision','modelVersion','searchVersion','mode','sort','page'])assert.equal(cache.lookup('海边',{...ctx,[key]:key==='page'?1:'different'}).hit,false);
 assert.equal(cache.lookup('不是海边',ctx).hit,false);assert.equal(cache.lookup('海边',{...ctx,filters:{type:'video'}}).hit,false);
 time++;cache.store('山',ctx,[]);time++;cache.lookup('海边',ctx);time++;cache.store('城市',ctx,[]);assert.equal(cache.lookup('山',ctx).hit,false);assert.equal(cache.lookup('城市',ctx).hit,true);
 assert.throws(()=>cache.store('bad',{},[]));assert.throws(()=>cache.store('bad',ctx,{score:NaN}));assert.equal(cache.store('large',ctx,'x'.repeat(5000)).stored,false);
 time=1200;assert.equal(cache.lookup('海边',ctx).hit,false);cache.clear();assert.equal(cache.lookup('城市',ctx).hit,false);
 console.log('PASS: persistent results, context/version isolation, no semantic conflation, empty hits, expiration, LRU bounds and validation');
}finally{cache?.close();fs.rmSync(root,{recursive:true,force:true});}
