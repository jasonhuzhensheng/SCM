'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('async function growPool()');
const end = source.indexOf('// Enrichment is pinned', start);
assert(start > 0 && end > start);
(async () => {
 let init;
 const primaryReady = new Promise(resolve => { init = resolve; });
 const workers = [{ dead: false, pending: new Map(), process: {} }];
 const sent = [];
 const context = { indexerReady: primaryReady, indexerWorkers: workers,
  indexerPoolTarget: 10, pickRoundRobin: 0, requestId: 0,
  setTimeout, clearTimeout,
  createIndexerWorker: () => {
   const worker = {dead: false, pending: new Map()};
   worker.process = {postMessage(message) { sent.push({worker, message}); }};
   return worker;
  }
 };
 vm.createContext(context); vm.runInContext(source.slice(start, end), context);
 const growth = context.growPool();
 await Promise.resolve(); assert.equal(workers.length, 1, 'extras wait for primary model');
 init(); await growth; assert.equal(workers.length, 10, 'ten independent workers');
 await Promise.all([context.growPool(), context.growPool()]);
 assert.equal(workers.length, 10, 'concurrent top-up never exceeds target');
 workers[0].pending.set('long-video', {});
 const requests = Array.from({length:9}, () => context.askIndexer({type:'embed-photo'}));
 assert.equal(new Set(sent.map(item => item.worker)).size, 9, 'all nine idle workers receive work');
 for (const {worker, message} of sent) {
  const request = worker.pending.get(message.id);
  worker.pending.delete(message.id); clearTimeout(request.timer); request.resolve({ok:true});
 }
 await Promise.all(requests);
 context.indexerReady = Promise.reject(new Error('model missing'));
 workers.splice(1); await context.growPool();
 assert.equal(workers.length, 1, 'failed primary does not trigger download races');
 console.log('PASS: import grows to ten processes after model readiness; least-loaded dispatch avoids busy workers');
})().catch(error => { console.error(error); process.exitCode = 1; });
