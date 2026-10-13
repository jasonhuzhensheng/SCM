const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
(async () => {
 let effect, state={}, calls=[], complete;
 const finished=new Promise(resolve=>complete=resolve);
 let slot=0;
 const react={useMemo:fn=>fn(),useEffect:fn=>effect=fn,useState:initial=>{const i=slot++;return [initial,update=>{if(i===0){state=typeof update==='function'?update(state):update;if(Object.keys(state).length===95002)complete();}}];}};
 const context={exports:{},require:name=>name==='react'?react:{},setTimeout,window:{memories:{captureDevices:async(names,options)=>{
  calls.push({count:names.length,cached:!!options?.cachedOnly});
  return Object.fromEntries(names.filter(n=>!options?.cachedOnly||!n.startsWith('new')).map(n=>[n,{brand:'索尼',model:'A',status:'confirmed'}]));
 }}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/simple/CaptureDevices.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
 context.exports.useCaptureDevices([...Array.from({length:95000},(_,i)=>({filename:`${i}.jpg`})),{filename:'new1.jpg'},{filename:'new2.jpg'}],true);
 const stop=effect();await finished;stop();
 assert.equal(calls.filter(c=>c.cached).length,96);
 assert.deepEqual(calls.filter(c=>!c.cached),[{count:2,cached:false}]);
 assert.equal(Object.keys(state).length,95002);
 console.log('PASS hook simulation: 95,000 cached results restored in 96 batches; only two new assets read');
})().catch(e=>{console.error(e);process.exitCode=1;});
