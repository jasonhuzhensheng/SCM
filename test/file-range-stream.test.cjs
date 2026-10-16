'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');

(async () => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sayphoto-range-'));
 const file = path.join(directory, 'fixture');
 const bytes = Buffer.alloc(1024 * 1024, 73);
 fs.writeFileSync(file, bytes);
 const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
 const code = source.slice(source.indexOf('function openFileStreamRange('), source.indexOf('\nasync function handleAppRequest'));
 const realClose = fs.close;
 let replacement;
 const handles = [];
 const wrappedFs = { ...fs, promises: { ...fs.promises } };
 wrappedFs.promises.open = async (...args) => {
  const handle = await fs.promises.open(...args);
  handles.push(handle);
  return handle;
 };
 const context = { fs: wrappedFs, Readable };
 vm.createContext(context);
 vm.runInContext(code, context);
 try {
  const normal = await context.openFileStreamRange(file, 7, 123);
  const received = [];
  for await (const chunk of normal) received.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(received), bytes.subarray(7, 124));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handles[0].fd, -1, 'EOF releases the handle');

  // Force descriptor reuse between a raw stream close and its close event.
  // The old raw-fd + FileHandle implementation closes this unrelated fd.
  fs.close = (fd, callback) => realClose(fd, error => {
   if (!error && replacement === undefined) replacement = fs.openSync(file, 'r');
   callback(error);
  });
  const reader = (await context.openFileStreamRange(file, 0, bytes.length - 1)).getReader();
  await reader.read();
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 20));
  if (replacement !== undefined) assert.equal(fs.fstatSync(replacement).size, bytes.length, 'cancellation must not close a reused descriptor');
  assert.equal(handles[1].fd, -1, 'cancellation releases the handle');
  await assert.rejects(context.openFileStreamRange(path.join(directory, 'missing'), 0, 1), { code: 'ENOENT' });
  console.log('file-range-stream: EOF, cancellation, descriptor reuse and missing file passed');
 } finally {
  fs.close = realClose;
  if (replacement !== undefined) { try { fs.closeSync(replacement); } catch {} }
  await Promise.all(handles.map(handle => handle.close().catch(() => {})));
  fs.rmSync(directory, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
