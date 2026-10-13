const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/simple/SimpleApp.tsx', 'utf8');
async function run(all) {
 const names = Array.from({length:90000},(_,i)=>`photo-${i}.jpg`);
 let effect, calls=0, requested=0;
 const context={filters:{minSize:all?'1':'',maxSize:''},sort:'newest',names,displayed:names.map(filename=>({filename})),limit:90,preview:false,sizeRetry:0,performance,
 useMemo:fn=>fn(),useRef:current=>({current}),useEffect:fn=>effect=fn,setSizeError(){},setSizeProgress(){},setFileSizes(){},
 window:{memories:{async fileSizes(batch){calls++;requested+=batch.length;return batch.map(filename=>({filename,size:123}));}}}};
 const start=source.indexOf('\tconst needsAllSizes'),end=source.indexOf('\n\tconst folders =',start);
 vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 effect(); await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requested,all?90000:90); assert.equal(calls,all?900:1);
 effect(); await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requested,all?90000:90,'cached sizes must not be fetched again');
}
(async()=>{await run(false);await run(true);console.log('PASS: 90k library requests only 90 visible sizes; size filtering requests all; cache avoids duplicate reads');})().catch(e=>{console.error(e);process.exitCode=1;});
