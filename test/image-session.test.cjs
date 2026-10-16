const assert=require('node:assert/strict'),{createImageSession}=require('../native/menu-search/image-session.cjs');
(async()=>{let loads=0,disposals=0;const s=createImageSession(async()=>{loads++;const fn=async x=>{if(x==='bad')throw Error('bad');return x};fn.dispose=async()=>{disposals++};return fn},20);
assert.equal((await s.use(1)).result,1);await s.use(2);assert.equal(loads,1);
await new Promise(r=>setTimeout(r,50));assert.equal(disposals,1);
await s.use(3);assert.equal(loads,2);await s.release();assert.equal(disposals,2);
await assert.rejects(s.use('bad'));assert.equal(disposals,3);
await s.use(4);await s.release();assert.equal(loads,4);console.log('PASS reuse, idle release, explicit release and failure recovery');})().catch(e=>{console.error(e);process.exitCode=1});
