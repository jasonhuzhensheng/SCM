"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const settings = require("../main-lib/settings");
const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sayphoto-lock-"));
settings.initSettings({userDataDir: directory});
const handlers = new Map();
const context = vm.createContext({ ...settings, assetLocks: require("../main-lib/asset-locks").createAssetLocks(path.join(directory, "locks.json")), ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, AbortController });
function load(start, end) {
 const a = source.indexOf(start), b = source.indexOf(end, a);
 assert(a >= 0 && b > a); vm.runInContext(source.slice(a, b), context);
}
(async () => {
 try {
  load('let driveTransfer = null;', 'const movedSourcesFile');
  const set = handlers.get('memories:set-file-lock'), get = handlers.get('memories:get-file-lock');
  assert.equal(get(), false);
  assert.equal(set(null, 'true').ok, false);
  assert.equal(set(null, true).ok, true);
  settings.initSettings({userDataDir: directory});
  assert.equal(get(), true, 'lock persists across settings reload');
  vm.runInContext('driveTransfer = new AbortController()', context);
  assert.equal(set(null, false).ok, false, 'in-flight mutation prevents unlock/lock races');
  vm.runInContext('driveTransfer = null', context);
  load('ipcMain.handle("memories:delete",', '\n//', );
  // Locked requests must return before reading paths, dialogs, or library state.
  assert.match((await handlers.get('memories:delete')(null, 'photo.jpg', {original:true})).error, /锁定/);
  assert.match((await handlers.get('memories:delete')(null, 'clip.mp4')).error, /锁定/);
  context.driveReply = async task => { try { return {ok:true,...await task()}; } catch(e) { return {ok:false,error:e.message}; } };
  load('ipcMain.handle("memories:drive-transfer",', '\n// App icon');
  assert.match((await handlers.get('memories:drive-transfer')(null, {mode:'move'})).error, /锁定/);
  context.migrationState = false;
  context.drive = {status: () => ({connected:false})};
  assert.match((await handlers.get('memories:drive-transfer')(null, {mode:'copy'})).error, /连接 Google Drive/, 'copy passes lock guard');
  load('ipcMain.handle("memories:copy-cleanup-start",', '\nipcMain.handle("memories:', );
  assert.match((await handlers.get('memories:copy-cleanup-start')()).error, /锁定/);
  assert.equal(set(null, false).ok, true);
  assert.equal(get(), false);
  context.writeSettings = () => {};
  assert.equal(set(null, true).ok, false, 'failed persistence must not report successful locking');
  console.log('PASS: persisted lock, input validation, busy guard, delete/move/cleanup protection, copy allowed, unlock, write failure');
 } finally { fs.rmSync(directory, {recursive:true, force:true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
