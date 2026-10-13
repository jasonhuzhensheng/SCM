'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createReference, entryExists} = require('../main-lib/reference-storage');
(async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'references-'));
 try {
  const source = path.join(root, 'original.jpg'), directory = path.join(root, 'photos');
  fs.mkdirSync(directory); fs.writeFileSync(source, 'original bytes');
  const target = path.join(directory, 'a.jpg');
  await createReference(source, target);
  assert(fs.lstatSync(target).isSymbolicLink());
  assert.equal(fs.readFileSync(target, 'utf8'), 'original bytes');
  await assert.rejects(createReference(source, target));
  fs.unlinkSync(target); assert.equal(fs.readFileSync(source, 'utf8'), 'original bytes');
  await createReference(source, target);
  fs.unlinkSync(source); assert(entryExists(target)); assert(!fs.existsSync(target));
  fs.writeFileSync(path.join(directory, 'internal.jpg'), 'x');
  await assert.rejects(createReference(path.join(directory, 'internal.jpg'), path.join(directory, 'b.jpg')));
  assert(!entryExists(path.join(directory, 'missing')));
  console.log('PASS: references read originals, unlink preserves originals, offline references survive pruning, internal references rejected');
 } finally { fs.rmSync(root, {recursive:true, force:true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
