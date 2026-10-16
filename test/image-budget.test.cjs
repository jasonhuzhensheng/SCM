const assert=require('node:assert/strict'),{imageThreads:f}=require('../native/menu-search/image-budget.cjs');
const good={requested:2,cores:12,memoryBytes:32*2**30,load:2};assert.equal(f(good),2);
for(const x of [{requested:1},{requested:99},{cores:4},{memoryBytes:8*2**30},{load:10},{load:NaN}])assert.equal(f({...good,...x}),1);
assert.equal(f(),1);console.log('PASS bounded threads and busy/low-memory fallback');
