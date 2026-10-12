const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { copyVerified } = require('../main-lib/folder-transfer');
(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scm-copy-test-'));
 try {
  const source = path.join(root, 'source'); const out = path.join(root, 'out'); await fs.mkdir(out);
  await fs.writeFile(source, Buffer.alloc(200000, 7));
  const control = new AbortController(); let progress = 0;
  const target = await copyVerified(source, 'photo.jpg', out, control.signal, sent => progress = sent);
  assert.deepEqual(await fs.readFile(target), await fs.readFile(source)); assert.equal(progress, 200000);
  await assert.rejects(copyVerified(source, 'photo.jpg', out, control.signal, () => {}), { code: 'EEXIST' });
  assert.equal((await fs.stat(target)).size, 200000);
  await assert.rejects(copyVerified(source, '../escape', out, control.signal, () => {}));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(copyVerified(source, 'canceled.jpg', out, aborted.signal, () => {}));
  await assert.rejects(fs.stat(path.join(out, 'canceled.jpg')), { code: 'ENOENT' });
  let changed = false;
  await assert.rejects(copyVerified(source, 'changed.jpg', out, control.signal, () => { if (!changed) { changed = true; require('node:fs').writeFileSync(source, 'changed'); } }));
  await assert.rejects(fs.stat(path.join(out, 'changed.jpg')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(source, 'utf8'), 'changed');
  console.log('folder transfer: verified copy, no overwrite, cancellation, source changes PASS');
 } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
