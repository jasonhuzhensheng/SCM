'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createApplePhotos({ directory, executable, importFiles, busy, platform = process.platform, bridge }) {
  const stateFile = path.join(directory, 'apple-photos.json');
  let saved = { enabled: false, known: [] };
  try { saved = { ...saved, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const known = new Set(saved.known);
  let timer, child, running = false, stopped = false;
  let status = { supported: platform === 'darwin', enabled: !!saved.enabled, phase: 'idle', indexed: known.size, total: 0, failed: 0, error: '', limited: false, lastSync: saved.lastSync || null };
  function persist() {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify({ enabled: status.enabled, known: [...known], lastSync: status.lastSync }));
    fs.renameSync(stateFile + '.tmp', stateFile);
  }
  function call(request) {
    if (bridge) return bridge(request);
    return new Promise((resolve, reject) => {
      child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const current = child;
      let output = '', errorOutput = '';
      const timeout = setTimeout(() => current.kill(), request.mode === 'export' ? 30 * 60 * 1000 : 120000);
      current.stdout.on('data', data => { output += data; });
      current.stderr.on('data', data => { errorOutput = (errorOutput + data).slice(-2000); });
      current.stdin.on('error', () => {});
      current.on('error', error => { clearTimeout(timeout); reject(error); });
      current.on('close', code => {
        clearTimeout(timeout); if (child === current) child = null;
        try { if (code !== 0) throw new Error(errorOutput || '照片读取中断，请重试'); resolve(JSON.parse(output)); } catch (error) { reject(error); }
      });
      current.stdin.end(JSON.stringify(request));
    });
  }
  async function sync() {
    if (!status.enabled || stopped || running) return;
    if (busy()) { status.phase = 'waiting'; return; }
    running = true; status.phase = 'scanning'; status.error = ''; status.failed = 0;
    try {
      const scan = await call({ mode: 'scan', known: [...known] });
      if (!scan.ok) throw new Error(scan.error || '无法读取照片图库');
      status.total = scan.total; status.limited = !!scan.limited;
      for (let offset = 0; offset < scan.ids.length && status.enabled && !stopped; offset += 16) {
        if (busy()) { status.phase = 'waiting'; return; }
        status.phase = 'downloading';
        const staging = path.join(directory, 'Apple Photos');
        await fs.promises.rm(staging, { recursive: true, force: true });
        await fs.promises.mkdir(staging, { recursive: true });
        try {
          const batch = await call({ mode: 'export', ids: scan.ids.slice(offset, offset + 16), directory: staging });
          if (!batch.ok) throw new Error(batch.error || '无法读取原片');
          status.failed += batch.errors.length;
          if (batch.errors.length) status.error = batch.errors[0].error;
          if (!status.enabled || stopped) return;
          if (batch.files.length) {
            status.phase = 'indexing';
            const result = await importFiles(batch.files.map(file => file.path));
            // Commit only after the importer has persisted a successful batch.
            // Partial failures retry safely through its content deduplication.
            if (result.errors.length) {
              status.failed += result.errors.length;
              status.error = result.errors[0].error;
            } else {
              batch.files.forEach(file => known.add(file.id));
              status.indexed = known.size; persist();
            }
          }
        } finally { await fs.promises.rm(staging, { recursive: true, force: true }); }
      }
      status.lastSync = new Date().toISOString(); persist();
      status.phase = status.enabled ? (status.failed ? 'error' : 'idle') : 'paused';
    } catch (error) { status.error = error.message; status.phase = status.enabled ? 'error' : 'paused'; }
    finally { running = false; }
  }
  return {
    snapshot: () => ({ ...status }),
    async connect() {
      if (platform !== 'darwin') throw new Error('此功能仅支持 macOS');
      if (running) return { ...status };
      running = true;
      try {
        const permission = await call({ mode: 'authorize' });
        console.log('[apple-photos] authorization:', permission.authorization);
        if (!permission.ok) throw new Error('请在系统设置 → 隐私与安全性 → 照片中允许big2 photo访问全部照片。');
        status.enabled = true; status.error = ""; status.limited = !!permission.limited; persist();
      } catch (error) { status.error = error.message; status.phase = "error"; throw error; }
      finally { running = false; }
      void sync(); return { ...status };
    },
    pause() { status.enabled = false; status.phase = 'paused'; persist(); child?.kill(); return { ...status }; },
    sync,
    start() { if (timer) return; timer = setInterval(() => void sync(), 60000); timer.unref(); void sync(); },
    stop() { stopped = true; clearInterval(timer); child?.kill(); },
  };
}
module.exports = { createApplePhotos };
