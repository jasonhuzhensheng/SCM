'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
(async()=>{
 const routing=await import('../src/simple/detectionQuery.ts');
 const source=fs.readFileSync(path.join(__dirname,'../src/simple/SimpleApp.tsx'),'utf8');const start=source.indexOf('const runSearch = useCallback('),end=source.indexOf('const liveRefreshNeeded',start);
 const script=ts.transpileModule(source.slice(start,end).replace('const runSearch =','var runSearch ='),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let result,progress,requests=[];
 const noop=()=>{};
 const context={...routing,preview:false,migration:null,assets:[{filename:'a.jpg',ocr:'订单123'},{filename:'b.jpg',ocr:''}],mode:'files',sequence:{current:0},useCallback:fn=>fn,Set,Error,
  setSimilarReference:noop,setQrProgress:v=>progress=v,setIndexedSearch:noop,setDraft:noop,setQuery:noop,setMode:noop,setLimit:noop,setSearchFailure:noop,setTranslatedQuery:noop,setTranslating:noop,setResults:v=>result=v,setSearching:noop,setRecent:noop,setIndexPaused:noop,
  indexSummary:s=>`${s.indexed}/${s.total}`,
  prewarm:()=>{throw Error('must not load semantic index')},search:()=>{throw Error('must not use semantic search')},searchScenes:noop,searchDialogue:noop,searchOcr:noop,
  window:{memories:{detectionSearch:async(kind,query)=>{requests.push({kind,query});return {ok:true,filenames:['a.jpg'],status:{total:20000,indexed:50,pending:19950,failed:0,paused:false}}}}}
 };
 vm.createContext(context);vm.runInContext(script,context);
 await context.runSearch('二维码');assert.equal(result.length,1);assert.equal(result[0].detectedLabel,'检测到二维码');assert.equal(progress,'50/20000');
 await context.runSearch('条形码');await context.runSearch('图片文字：订单编号');
 assert.deepEqual(requests,[{kind:'qr',query:''},{kind:'barcode',query:''},{kind:'text',query:'订单编号'}]);
 assert.equal(result[0].detectedLabel,'已识别图片文字');
 console.log('PASS: UI queries SQLite once per search, displays partial indexed results immediately, never launches scan or semantic search');
})().catch(e=>{console.error(e);process.exitCode=1});
