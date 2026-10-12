'use strict';
const assert = require('node:assert/strict');
const { readStats, createPhotoPrefetch, createPhraseCache } = require('../indexer/index-performance');
(async () => {
 let active = 0, peak = 0;
 const stats = await readStats(Array.from({ length: 40 }, (_, i) => i), async i => {
  active++; peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 2)); active--;
  if (i === 3) throw Error('missing'); return { mtimeMs: 40 - i };
 }, 4);
 assert.equal(peak, 4); assert.equal(stats.size, 39); assert.equal(stats.get(39).mtimeMs, 1);
 const calls = []; const prefetch = createPhotoPrefetch(async file => { calls.push(file); if (file === 'bad') throw Error('broken'); return file; });
 const a = { type: 'embed-photo', path: 'a' }, b = { type: 'embed-photo', path: 'b' };
 prefetch.prime(a); prefetch.prime(b); assert.equal(await prefetch.take(a), 'a'); assert.deepEqual(calls, ['a']);
 prefetch.prime(b); assert.equal(await prefetch.take(b), 'b');
 prefetch.prime({type:'embed-video',path:'video'}); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, ['a','b']);
 const bad = { type: 'embed-photo', path: 'bad' }; prefetch.prime(bad);
 await new Promise(resolve => setImmediate(resolve)); await assert.rejects(prefetch.take(bad), /broken/);
 const cache = createPhraseCache(2), state = {}, nextModel = {}; let computed = 0;
 const compute = async () => { computed++; return new Float32Array([1,2]); };
 const value = await cache(state, 'beach', compute); value[0] = 99;
 assert.deepEqual([...await cache(state, 'beach', compute)], [1,2]); assert.equal(computed,1);
 await cache(nextModel, 'beach', compute); assert.equal(computed,2);
 await cache(state,'forest',compute); await cache(state,'sky',compute); await cache(state,'beach',compute); assert.equal(computed,5);
 // Exercise the actual worker integration with controlled inference, not just helpers.
 const fs = require('node:fs'), vm = require('node:vm');
 const source = fs.readFileSync(require.resolve('../indexer/indexer.js'),'utf8');
 let decodes = 0, textRuns = 0;
 const model = { sharp:{}, dim:2, tokenizer:{}, textModel:{}, textMean:null };
 const context = { require, MODEL_CONFIG:{inputSize:224}, ensureModel:async()=>model,
  buildFilenamePhrase:()=> 'same phrase', textPair:()=>({}),
  core:{ decodeToRaw:async()=>{decodes++;return {};},embedRawImage:async()=>new Float32Array([1,0]),gifMiddlePage:async()=>null,embedText:async()=>{textRuns++;return new Float32Array([0,1]);},centerOrRaw:v=>v },
 };
 context.require = name => name === './index-performance.js' ? require('../indexer/index-performance') : require(name);
 vm.createContext(context); vm.runInContext(source.slice(source.indexOf('const { createPhotoPrefetch'),source.indexOf('async function embedVideo')),context);
 const first = await context.embedPhoto('a','a.jpg'), second = await context.embedPhoto('b','b.jpg');
 assert.equal(JSON.stringify(first),JSON.stringify(second)); assert.equal(decodes,2); assert.equal(textRuns,1);
 console.log('PASS: bounded concurrent stats, one-photo prefetch, decode failure handling, isolated bounded cache, unchanged worker vectors');
})().catch(e=>{console.error(e);process.exitCode=1;});
