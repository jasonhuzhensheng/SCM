const assert=require('node:assert/strict'),{vectorNorm,updateRow}=require('../native/menu-search/vector-norms.cjs');
for(const v of [new Float32Array(768),Float32Array.from({length:768},(_,i)=>Math.sin(i)),Float32Array.of(3,4)])assert.equal(vectorNorm(v),Math.sqrt(v.reduce((s,x)=>s+x*x,0)));
const v=Float32Array.of(3,4,0,12),ranking={embeddings:[v.subarray(0,2)]},norms=[5];
assert.equal(updateRow(ranking,norms,0,v.subarray(0,2)),false);assert.equal(norms[0],5);
assert.equal(updateRow(ranking,norms,0,v.subarray(2)),true);assert.equal(norms[0],12);
assert.equal(updateRow(ranking,norms,0,Float32Array.of(6,8)),true);assert.equal(norms[0],10);
console.log('PASS identical norms, unchanged view reuse, changed offset and replacement refresh');
