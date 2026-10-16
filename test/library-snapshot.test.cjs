const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
(async()=>{
 const completions=[],exports={};
 const context={exports,fetch:()=>new Promise(r=>completions.push(r))};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/librarySnapshot.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
 const {readLibraryIndex:read,invalidateLibraryIndex:invalidate}=exports;
 const a=read(),b=read();assert.equal(a,b);assert.equal(completions.length,1);
 invalidate();const c=read();assert.equal(completions.length,2);
 completions[0](Response.json({images:['old.jpg']}));await a;assert.equal(read(),c);
 completions[1](Response.json({images:['new.jpg']}));assert.deepEqual((await c).images,['new.jpg']);
 const fail=read();completions[2](new Response('',{status:500}));await assert.rejects(fail);
 const retry=read();completions[3](Response.json({images:[]}));await retry;assert.equal(completions.length,4);
 let attempts=0;const retryExports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/librarySnapshot.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:retryExports,setTimeout:f=>f(),fetch:async()=>{attempts++;return attempts<3?new Response('',{status:503}):Response.json({recentlyDeleted:['old.jpg']});}});
 assert.deepEqual((await retryExports.readLibraryIndex()).recentlyDeleted,['old.jpg']);assert.equal(attempts,3);
 attempts=0;const failedExports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/librarySnapshot.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:failedExports,setTimeout:f=>f(),fetch:async()=>{attempts++;return new Response('',{status:503});}});await assert.rejects(failedExports.readLibraryIndex());assert.equal(attempts,3,'bounded metadata retry only');
 console.log('shared reads, stale completion isolation, failed request retry: passed');
})().catch(e=>{console.error(e);process.exitCode=1});
