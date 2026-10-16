const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const esbuild = require('esbuild');
const source = fs.readFileSync(path.join(__dirname, '../src/simple/SimpleApp.tsx'), 'utf8');
const bundled = esbuild.buildSync({entryPoints:[path.join(__dirname, '../src/simple/library.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const moduleFixture = {exports:{}};
vm.runInNewContext(bundled, {module:moduleFixture, exports:moduleFixture.exports});
const index = {images:['deleted.jpg','locked-deleted.jpg','burst.jpg','locked.jpg'],sources:['/a.jpg','/b.jpg','/c.jpg','/d.jpg'],sourceMtimes:[11,22,33,44],recentlyDeleted:['deleted.jpg'],lockedRecentlyDeleted:['locked-deleted.jpg']};
const assets = moduleFixture.exports.parseLibrary(index);
assert.deepEqual(Array.from(assets, a=>[a.filename,a.modifiedAt,a.recentlyDeleted]), [['locked-deleted.jpg',22,true],['burst.jpg',33,false],['locked.jpg',44,false]]);
const callbacks = ['acceptsView','filteredAssets'].map(name=>source.split('\n').find(line=>line.includes(`const ${name} =`))).join('\n');
const code = ts.transpileModule(callbacks+'\nglobalThis.filtered = filteredAssets;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for (const [view, expected] of [['all',['burst.jpg','locked.jpg']],['locked',['locked-deleted.jpg','locked.jpg']]]) {
	const context = {assets,assetsByName:new Map(assets.map(a=>[a.filename,a])),results:index.images.map(filename=>({filename,modifiedAt:1,recentlyDeleted:false})),view,useCallback:f=>f,useMemo:f=>f(),personMatches:()=>true,deviceMatches:()=>true,includesLocked:true,assetLocksReady:true,lockedFiles:new Set(['locked-deleted.jpg','locked.jpg']),filter:{matches:()=>true},filterFileSizes:{},similarReference:null,similarThreshold:0,folder:'',mapDistances:null,favoriteSet:new Set(),duplicates:{byFilename:new Map()},aiOrigins:{matches:new Map()},includeSuspectedAi:false,isVideoFile:()=>false};
	vm.runInNewContext(code,context);
	assert.deepEqual(Array.from(context.filtered,a=>a.filename),expected,'stale search results must follow the latest library and protected view');
}
assert.equal(index.images.length,4,'presentation must not remove persisted index entries');
console.log('PASS: deleted results excluded, latest state overrides stale search data, locked history and burst preserved, source ordinals aligned');
