'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const perf=require('../indexer/index-performance');
const {buildFilenamePhrase}=require('../indexer/memory-embedding-utils');
const {applyRequestedIndexModel}=require('../main-lib/index-startup');
const uuid='ab1d56ef-9283-4455-9012-abc123456789.jpeg';
(async()=>{
 for(const name of [uuid,uuid.replace('.jpeg',' (2).jpeg'),'a1'.repeat(16)+'.png','IMG_20261011223344.jpg'])assert(!perf.filenameNeedsEmbedding(name),name);
 for(const name of ['beach.jpg','北京夜景.jpg','2024.jpg','cafe.jpg','IMG_0001.jpg','report-20261011.jpg','beach-'+uuid])assert(perf.filenameNeedsEmbedding(name),name);
 const src=fs.readFileSync(require.resolve('../indexer/indexer'),'utf8');let vision=0,text=0;
 const state={dim:2,tokenizer:{},textModel:{}};
 const context={require:n=>n==='./index-performance.js'?perf:require(n),MODEL_CONFIG:{inputSize:224},ensureModel:async()=>state,buildFilenamePhrase,textPair:()=>({}),core:{decodeToRaw:async()=>({}),embedRawImage:async()=>{vision++;return new Float32Array([1,0])},gifMiddlePage:async()=>null,embedText:async()=>{text++;return new Float32Array([0,1])},centerOrRaw:v=>v}};
 vm.createContext(context);vm.runInContext(src.slice(src.indexOf('const { createPhotoPrefetch'),src.indexOf('async function embedVideo')),context);
 const anonymous=await context.embedPhoto('unused',uuid);assert.deepEqual([...anonymous.vec],[1,0]);assert.deepEqual([...anonymous.phrase],[0,0]);assert.equal(text,0);assert.equal(vision,1);
 const named=await context.embedPhoto('unused','beach.jpg');assert.deepEqual([...named.vec],[1,0]);assert.deepEqual([...named.phrase],[0,1]);assert.equal(text,1);assert.equal(vision,2);
 // Intentional zeros survive restart healing, real missing text still heals.
 const main=fs.readFileSync(require.resolve('../main'),'utf8');const library={filenames:[uuid,'beach.jpg'],embeddings:[new Float32Array([1,0]),new Float32Array([1,0])],phrases:[new Float32Array(2),new Float32Array(2)],dim:2};let healedNames=[];
 const healing={migrationState:null,loadLibrary:()=>library,filenameNeedsEmbedding:perf.filenameNeedsEmbedding,askIndexer:async m=>{healedNames.push(m.filename);return{vec:[0,1]}},saveLibrary:async()=>{},console};
 vm.createContext(healing);vm.runInContext(main.slice(main.indexOf('async function healPhraseBin()'),main.indexOf('// Indexer worker pool')),healing);
 await healing.healPhraseBin();assert.deepEqual(healedNames,['beach.jpg']);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scm-fast-index-'));const store=require('../main-lib/library-store');store.initLibraryStore({userDataDir:dir});
 try{await store.writeBins('test',library.embeddings,[new Float32Array(2),new Float32Array(2)],2,2,{filenames:library.filenames});const plan=store.planDeltaReuse('test',2,library.filenames);assert.equal(plan.reused,1);assert.deepEqual(plan.missing,['beach.jpg']);}finally{fs.rmSync(dir,{recursive:true,force:true})}
 let clock=0;const checkpoint=perf.createCheckpointGate(613167,()=>clock);let saves=0;for(let i=1;i<=613167;i++)if(checkpoint(i))saves++;assert.equal(saves,39);clock=300000;assert(checkpoint(613167));assert(!checkpoint(613167));
 let settings={requestedIndexModel:'fast'},events=[];const params={readSettings:()=>settings,writeSettings:patch=>{events.push('clear');Object.assign(settings,patch)},getModel:id=>id==='fast',reembedToModel:async()=>{events.push('switch');return{modelId:'fast'}},migrationSettled:async()=>{events.push('settled')}};
 await applyRequestedIndexModel(params);assert.deepEqual(events,['switch','settled','clear']);assert.equal(settings.requestedIndexModel,null);
 settings.requestedIndexModel='fast';await assert.rejects(applyRequestedIndexModel({...params,reembedToModel:async()=>{throw Error('failed')}}));assert.equal(settings.requestedIndexModel,'fast');
 settings.requestedIndexModel='unknown';await assert.rejects(applyRequestedIndexModel(params));assert.equal(settings.requestedIndexModel,'unknown');
 console.log('PASS: skip opaque-name inference without changing vision, preserve captions, healing/delta reuse, bounded checkpoints, one-shot model switch and failure retention');
})().catch(e=>{console.error(e);process.exitCode=1});
