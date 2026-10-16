'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { photoSourceIdentity } = require('../main-lib/photo-deletion');
const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
const uuid = '918AD1FE-57E1-41A8-A8D1-AC166D55A757';
const original = `/Fixture.photoslibrary/originals/9/${uuid}.HEIC`;
const render = `/Fixture.photoslibrary/resources/renders/9/${uuid}_2_0_a.mov`;
const library = { filenames: [], sources: [] };
for (let i = 0; i < 500000; i++) {
 library.filenames.push(`image-${i}.jpg`);
 library.sources.push(original);
}
library.filenames.push('render.mov'); library.sources.push(render);
const locks = new Set(); let calls = 0, globalLock = false;
const context = { photoSourceIdentity: value => { calls++; return photoSourceIdentity(value); },
 loadLibrary: () => library, assetLocks: locks, filesLocked: () => globalLock, FILE_LOCK_ERROR: 'locked' };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function photoAssetKey('), source.indexOf('async function forgetPhotoAsset(')), context);
context.assertPhotoAssetUnlocked(original);
assert.equal(calls, 1, 'unlocked rows must not undergo source parsing');
locks.add('render.mov'); calls = 0;
assert.throws(() => context.assertPhotoAssetUnlocked(original), /locked/);
assert.equal(calls, 2, 'render alias must protect its original without parsing other rows');
locks.delete('render.mov'); context.assertPhotoAssetUnlocked(original);
locks.add('render.mov'); library.sources[library.sources.length - 1] = '/Other.photoslibrary/originals/9/' + uuid + '.HEIC';
context.assertPhotoAssetUnlocked(original);
library.sources[library.sources.length - 1] = render;
assert.throws(() => context.assertPhotoAssetUnlocked(original), /locked/, 'source changes must be visible without stale cache');
context.assertPhotoAssetUnlocked('/ordinary.jpg');
globalLock = true;
assert.throws(() => context.assertPhotoAssetUnlocked('/ordinary.jpg'), /locked/);
console.log('photo-lock-performance: 500k rows, alias locks, live mutations and global lock passed');
