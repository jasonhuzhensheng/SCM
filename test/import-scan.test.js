'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('async function scanDirForMedia');
const end = source.indexOf('\nfunction uniqueName', start);
assert(start > 0 && end > start);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-scan-test-'));
(async () => {
  fs.mkdirSync(path.join(temp, 'nested'));
  fs.writeFileSync(path.join(temp, 'a.jpg'), 'photo');
  fs.writeFileSync(path.join(temp, 'ignored.txt'), 'text');
  fs.writeFileSync(path.join(temp, 'nested', 'b.mp4'), 'video');
  fs.symlinkSync(temp, path.join(temp, 'nested', 'cycle'));
  fs.symlinkSync(path.join(temp, 'a.jpg'), path.join(temp, 'linked.jpg'));
  fs.symlinkSync(path.join(temp, 'missing.jpg'), path.join(temp, 'broken.jpg'));
  let heartbeat = 0;
  const timer = setInterval(() => heartbeat++, 1);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const context = {
    path,
    IMPORT_EXTENSIONS: new Set(['.jpg', '.mp4']),
    fs: { promises: {
      readdir: fs.promises.readdir,
      stat: async target => { if (target === temp) await blocked; return fs.promises.stat(target); },
    } },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const pending = context.expandMediaPaths([temp, path.join(temp, 'missing.jpg')]);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert(heartbeat > 0, 'event loop must remain responsive during stalled filesystem metadata reads');
  release();
  const files = Array.from(await pending).map(file => path.relative(temp, file)).sort();
  clearInterval(timer);
  assert.deepEqual(files, ['a.jpg', 'linked.jpg', 'missing.jpg', 'nested/b.mp4']);
  console.log('PASS: asynchronous scan stays responsive; recursion, symlinks, filtering and missing paths preserved');
})().finally(() => fs.rmSync(temp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
