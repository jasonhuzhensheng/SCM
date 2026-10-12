const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 // Run the compiled TS function with fake bridge calls; no filesystem deletions.
 const ts=require('typescript');const source=fs.readFileSync(require('node:path').join(__dirname,'../src/simple/SimpleApp.tsx'),'utf8');
 const start=source.indexOf(' async function deleteBatch()'),end=source.indexOf(' async function deleteAsset(',start);
 const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let assets=[{filename:'a',title:'A',sourcePath:'/a'},{filename:'b',title:'B',sourcePath:'/b'},{filename:'c',title:'C',sourcePath:'/c'}],results=assets,selection=new Set(['a','b']),favorites=['a','b'],report='',confirmations=0;const calls=[];
 const ctx={assets,selectedFiles:selection,deleting:false,driveBusy:false,preview:false,sequence:{current:0},window:{confirm:()=>{confirmations++;return true;},memories:{deleteMemory:async(name,options)=>{assert.equal(options.original,true);calls.push(name);return name==='a'?{ok:true}:{ok:false,error:'denied'};}}},setDeleting:v=>ctx.deleting=v,setDeleteReport:v=>report=v,setDeleteProgress:()=>{},setSearching:()=>{},setTranslating:()=>{},setAssets:fn=>assets=fn(assets),setResults:fn=>results=fn(results),setSelectedFiles:fn=>selection=fn(selection),setFavorites:fn=>favorites=fn(favorites)};
 vm.createContext(ctx);vm.runInContext(js,ctx);await ctx.deleteBatch();
 assert.equal(confirmations,1);assert.deepEqual(calls,['a','b']);assert.deepEqual(assets.map(a=>a.filename),['b','c']);assert.deepEqual([...selection],['b']);assert.deepEqual(favorites,['b']);assert(report.includes('失败 1'));assert.equal(ctx.deleting,false);
 console.log('PASS: batch confirmation once, selected only, original deletion explicit, partial failure retained, progress released');
})().catch(e=>{console.error(e);process.exitCode=1;});
