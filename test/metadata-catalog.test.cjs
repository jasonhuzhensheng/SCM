"use strict";
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {openMetadataCatalog}=require('../main-lib/metadata-catalog');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'metadata-catalog-')),file=path.join(root,'metadata.sqlite');let catalog;
try {
 catalog=openMetadataCatalog(file);
 catalog.writeBatch([{filename:'a.jpg',source:'/a.jpg',signature:'v1',size:100,deviceMake:'Apple',deviceModel:'iPhone',latitude:30,longitude:120},{filename:'b.jpg',signature:'v1',size:50},{filename:'unknown.jpg'}],{name:'legacy',cursor:'3'});
 assert.equal(catalog.query({sort:'size'}).rows[0].filename,'b.jpg');assert.equal(catalog.query({sort:'size',descending:true}).rows[2].filename,'unknown.jpg');assert.equal(catalog.query({deviceMake:'Apple'}).count,1);assert.equal(catalog.query().bytes,150);assert.equal(catalog.query().knownSizes,2);
 catalog.putResult({filename:'a.jpg',signature:'v1',kind:'quality',modelVersion:'vision1',state:'ready',payload:{score:0.9}});
 assert.equal(catalog.result('a.jpg','quality','vision1').payload.score,0.9);assert.equal(catalog.result('a.jpg','quality','vision2'),null);
 catalog.writeBatch([{filename:'a.jpg',place:'杭州'}]);assert.equal(catalog.get('a.jpg').size,100);
 assert.throws(()=>catalog.writeBatch([{filename:'c.jpg',size:5},{filename:'../bad'}],{name:'legacy',cursor:'5'}));assert.equal(catalog.get('c.jpg'),null);assert.equal(catalog.checkpoint('legacy'),'3');
 catalog.close();catalog=openMetadataCatalog(file);assert.equal(catalog.get('a.jpg').place,'杭州');assert.equal(catalog.checkpoint('legacy'),'3');
 catalog.writeBatch([{filename:'a.jpg',source:'/a.jpg',signature:'v2',size:101}]);assert.equal(catalog.get('a.jpg').place,null);assert.equal(catalog.result('a.jpg','quality','vision1'),null);assert.throws(()=>catalog.putResult({filename:'a.jpg',signature:'v1',kind:'quality',modelVersion:'vision1',state:'ready'}),/Stale/);
 assert.throws(()=>catalog.query({sort:'size; DROP TABLE assets'}));assert.throws(()=>catalog.writeBatch([{filename:'z',latitude:91}]));
 const rows=Array.from({length:1000},(_,i)=>({filename:`sample-${i}`,size:i,signature:'1'}));catalog.writeBatch(rows);assert.equal(catalog.query({minSize:990,limit:5}).rows.length,5);assert.equal(catalog.query({minSize:990}).count,10);
 console.log('PASS: persistence, indexed sort/filter/count, unknown values, model separation, stale-result rejection, invalidation, atomic migration checkpoint and rollback, bounded batches');
} finally {catalog?.close();fs.rmSync(root,{recursive:true,force:true});}
