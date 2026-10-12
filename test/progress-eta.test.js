const assert=require('node:assert/strict');
(async()=>{
 const {createEtaEstimator,formatRemaining}=await import('../src/simple/progressEta.ts');
 const eta=createEtaEstimator();eta.observe(10,100,'import',0);assert.equal(eta.remaining(0),null);
 eta.observe(20,100,'import',10000);assert.equal(eta.remaining(10000),80);
 assert.equal(eta.remaining(41001),null,'stalled progress must not show a stale estimate');
 eta.observe(1,100,'import',42000);assert.equal(eta.remaining(42000),null,'counter reset starts a new estimate');
 eta.observe(100,100,'import',52000);assert.equal(eta.remaining(52000),null);
 eta.observe(1,100,'migration',53000);assert.equal(eta.remaining(53000),null);
 const fast=createEtaEstimator();for(let t=0;t<=20000;t+=10)fast.observe(t,100000,'import',t);assert.equal(fast.remaining(20000),80);
 assert.equal(formatRemaining(null),'正在估算…');assert.equal(formatRemaining(7200),'约 2 小时');
 console.log('PASS: elapsed-time ETA, warmup, stall, completion, reset, task switch and high-frequency updates');
})().catch(e=>{console.error(e);process.exitCode=1});
