'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCheckpointGate}=require('../indexer/index-performance');
const source=fs.readFileSync(require.resolve('../main'),'utf8');
const implementation=source.slice(source.indexOf('async function reembedToModel('),source.indexOf('// Delta switch (Option A)'));
const vec=()=>new Float32Array([1,0]);
async function run(failAt,reuse=0){
 const n=600,lib={modelId:'old',dim:2,filenames:Array.from({length:n},(_,i)=>`image-${i}.jpg`),embeddings:Array.from({length:n},vec),phrases:Array.from({length:n},vec)};
 const calls=[],writes=[];let saved=0;
 const ctx={console,createLiveSearchIndex:require("../main-lib/live-search-index").createLiveSearchIndex,driveTransfer:null,getModel:()=>({dim:2}),importInFlight:false,loadLibrary:()=>lib,migrationState:null,migrationFillGeneration:0,workerModelId:null,BrowserWindow:{getAllWindows:()=>[]},stopIndexerPool(){},spawnIndexer(){},indexerReady:Promise.resolve({dim:2}),binInfo:()=>({rows:n,dim:2}),readEmbedMeta:()=>({incomplete:true}),readBin(){throw Error('incomplete bins must not use instant switch')},planDeltaReuse:()=>({usable:reuse>0,reused:reuse,reusedEmbeddings:Array.from({length:n},(_,i)=>i<reuse?vec():null),reusedPhrases:Array.from({length:n},(_,i)=>i<reuse?vec():null)}),createCheckpointGate,MIGRATE_CONCURRENCY:2,isVideo:()=>false,rowSourcePath:i=>String(i),setEmbedIncomplete(){},askIndexer:async m=>{if(m.type==='get-text-mean')return{ok:true,textMean:[0,1]};const i=Number(m.path);calls.push(i);if(i===failAt)throw Error('denied source');return{vec:[1,0],phrase:[0,1]}},writeBins:async(...args)=>writes.push(args),saveLibrary:async()=>{saved++},calibrateThresholds:async()=>{},backfillEnrichment(){},backfillTranscription(){},isZeroVector:v=>!v||!v.some(x=>x!==0)};
 vm.createContext(ctx);vm.runInContext(implementation,ctx);
 if(failAt!==null){await assert.rejects(ctx.reembedToModel('fast',{requireComplete:true}),/original index preserved/);assert.equal(lib.modelId,'old');assert.equal(saved,0);assert(calls.length<=failAt+2);assert.equal(writes.at(-1).at(-1).incomplete,true);assert.equal(ctx.migrationState,null)}
 else{await ctx.reembedToModel('fast',{requireComplete:true});assert.equal(lib.modelId,'fast');assert.equal(saved,1);assert.equal(calls.length,n-reuse);assert.equal(calls[0],reuse);assert(lib.embeddings.every(Boolean))}
}
(async()=>{await run(424);await run(null,424);console.log('PASS: large migration abort preserves active index; incomplete cache cannot flip early; successful retry reuses completed rows')})().catch(e=>{console.error(e);process.exitCode=1});
