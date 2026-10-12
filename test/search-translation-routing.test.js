'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../main.js'),'utf8');
const start=source.indexOf('async function embedRankQuery(');
const end=source.indexOf('// Single-round-trip variant',start);
let embedded, ranked;
const context={
 translateSearchQuery:async text=>text==='美女'?'beautiful woman':text,
 spawnIndexer:()=>{},indexerReady:Promise.resolve(),migrationState:null,startupModelPending:false,
 askIndexer:async message=>{embedded=message.text;return {vec:[1,0]};},
 loadLibrary:()=>({filenames:['中文名字.jpg'],embeddings:[[1,0]],dim:2,modelId:'clip'}),
 thresholdsFor:()=>({}),libraryNorms:()=>[1],
 scoreLibrary:(library,text,vec)=>{ranked=text;assert.equal(vec[0],1);return [{filename:library.filenames[0]}];},
};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
(async()=>{
 const results=await context.rankSearch('美女',24);
 assert.equal(embedded,'beautiful woman'); assert.equal(ranked,'美女');
 assert.equal(results[0].filename,'中文名字.jpg');
 context.migrationState={done:10,total:20};
 await assert.rejects(context.rankSearch('护照',24),/正在更新搜索索引/);
 context.migrationState=null; context.startupModelPending=true;
 await assert.rejects(context.rankSearch('passport',24),/正在更新搜索索引/);
 console.log('PASS: search embeds English, keeps Chinese literal matching, and returns ranked results');
})().catch(e=>{console.error(e);process.exitCode=1;});
