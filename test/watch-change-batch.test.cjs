const assert=require('node:assert/strict'),{createChangeBatch,resolveChanges}=require('../main-lib/watch-change-batch.js');
(async()=>{const b=createChangeBatch('/photos',2);b.add('a.jpg');b.add('a.jpg');b.add('sub/b.jpg');assert.deepEqual(b.drain(),['/photos/a.jpg','/photos/sub/b.jpg']);assert.equal(b.drain(),null);
for(const x of [undefined,'../escape','/other/file','']){b.add(x);assert.equal(b.drain(),null)}
b.add('a');b.add('b');b.add('c');assert.equal(b.drain(),null);
assert.deepEqual(await resolveChanges('/photos',['/photos/a.jpg'],async()=>({isFile:()=>true})),['/photos/a.jpg']);
for(const stat of [async()=>({isFile:()=>false}),async()=>{throw Error('offline')}])assert.deepEqual(await resolveChanges('/photos',['/photos/a'],stat),['/photos']);
assert.deepEqual(await resolveChanges('/photos',['/elsewhere/a'],async()=>({isFile:()=>true})),['/photos']);console.log('PASS bounded dedupe, overflow, unknown/rename/directory/offline fallback, path containment');})().catch(e=>{console.error(e);process.exitCode=1});
