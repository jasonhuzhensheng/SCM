const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { classifyOrigin, pngText, createAiOriginIndex } = require('../main-lib/ai-origin');
(async () => {
 assert.equal(classifyOrigin('ordinary photo', 'IMG_123.jpg').status, 'unknown');
 assert.equal(classifyOrigin('Adobe Photoshop', 'holiday.jpg').status, 'unknown');
 assert.equal(classifyOrigin('', 'chair.jpg').status, 'unknown');
 assert.equal(classifyOrigin('', 'midjourney_sunset.png').status, 'suspected');
 assert.equal(classifyOrigin('', 'Sora_2026.mp4').status, 'suspected');
 assert.equal(classifyOrigin('', 'Gemini_Generated_Image_123.png').status, 'suspected');
 assert.equal(classifyOrigin('Steps: 20, Sampler: Euler, CFG scale: 7, Seed: 123').status, 'marked');
 assert.equal(classifyOrigin('"class_type":"KSampler"').status, 'marked');
 assert.equal(classifyOrigin('<digitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</digitalSourceType>').status, 'marked');
 assert.equal(classifyOrigin('{"AIGC":{"Label":"1","ContentProducer":"test"}}').status, 'marked');
 assert.equal(classifyOrigin('{"AIGC":{"Label":"0"}}').status, 'unknown');
 for (const text of ['AIGC={"Label":"1"}', 'AIGC\0{"Label":"1"}', '<AIGC>{"Label":"1"}</AIGC>', '<x:AIGC>{&quot;Label&quot;:&quot;1&quot;}</x:AIGC>']) assert.equal(classifyOrigin(text).status, 'marked');
 for (const text of ['AIGC={"Label":"0"}', 'AIGC={"Label":"2"}', 'other={"Label":"1"}', 'notAIGC={"Label":"1"}']) assert.equal(classifyOrigin(text).status, 'unknown');
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-origin-'));
 try {
  const chunk = (type, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); return b; };
  const png = path.join(directory, 'test.png');
  await fs.writeFile(png, Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('zTXt', Buffer.concat([Buffer.from('parameters\0\0'), deflateSync('Steps: 20, Sampler: Euler, Seed: 42')]))]));
  assert.equal(classifyOrigin(await pngText(png)).status, 'marked');
  for (const type of ['zTXt', 'iTXt']) {
   const prefix = type === 'zTXt' ? Buffer.from('AIGC\0\0') : Buffer.from('AIGC\0\1\0\0\0');
   const encoded = Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk(type, Buffer.concat([prefix, deflateSync('{"Label":"1"}')]))]);
   const sample = path.join(directory, type + '.png'); await fs.writeFile(sample, encoded);
   assert.equal(classifyOrigin(await pngText(sample)).status, 'marked');
  }

  await fs.writeFile(path.join(directory, 'plain.jpg'), 'plain');
  const cachePath = path.join(directory, 'cache.json'); let reads = 0;
  const config = { directory, cachePath, metadata: async file => { reads++; return file.endsWith('.png') ? pngText(file) : ''; } };
  const items = [{ filename: 'test.png', title: 'image.png' }, { filename: 'plain.jpg', title: 'midjourney_001.jpg' }];
  let index = createAiOriginIndex(config);
  assert.deepEqual(await index(items, { cachedOnly: true }), {});
  let result = await index(items); assert.equal(result['test.png'].status, 'marked'); assert.equal(result['plain.jpg'].status, 'suspected'); assert.equal(reads, 2);
  index = createAiOriginIndex(config);
  assert.equal(Object.keys(await index(items, { cachedOnly: true })).length, 2); assert.equal(reads, 2);
  await fs.appendFile(path.join(directory, 'plain.jpg'), 'changed');
  assert.equal((await index(items, { cachedOnly: true }))['plain.jpg'], undefined);
  await index(items); assert.equal(reads, 3);
  await index(items, { refresh: true }); assert.equal(reads, 5);
  assert.deepEqual(await index([{ filename: '../escape', title: 'x' }]), {});
  assert.equal((await index([{ filename: 'missing.jpg', title: 'missing.jpg' }]))['missing.jpg'].status, 'error');
  assert.equal((await index([{ filename: 'missing.mp4', title: 'kling_1.mp4' }]))['missing.mp4'].failed, true);
  const changing = createAiOriginIndex({ ...config, cachePath: path.join(directory, 'changing.json'), metadata: async file => { await fs.appendFile(file, 'x'); return 'Steps: 20, Sampler: Euler, Seed: 42'; } });
  assert.equal((await changing([items[1]]))['plain.jpg'].failed, true);
  const source = await fs.readFile(path.join(__dirname, '../main.js'), 'utf8');
  const handlerCode = source.slice(source.indexOf('ipcMain.handle("memories:ai-origins"'), source.indexOf('const readPhotoQuality ='));
  const metadataSection = source.slice(source.indexOf('const readAiOrigins ='), source.indexOf('ipcMain.handle("memories:ai-origins"'));
  const metadataBody = metadataSection.match(/metadata: (async file => \{[\s\S]*\n \}),\n\}\);/)[1];
  const extensions = [...source.match(/const VIDEO_EXTENSIONS = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/"([^"\n]+)"/g)].map(m => m[1]);
  let videoReads = 0;
  const readMetadata = require('node:vm').runInNewContext('(' + metadataBody + ')', {
   path, VIDEO_EXTENSIONS: new Set(extensions), resolveYtDlpFfmpegLocation: () => '/test/ffmpeg',
   require: name => name === 'node:util' ? { promisify: () => async () => { videoReads++; return { stdout: 'test video metadata' }; } } : name === 'node:child_process' ? { execFile() {} } : () => ({ metadata: async () => ({}) }),
  });
  for (const extension of extensions) assert.equal(await readMetadata('/test/file' + extension), 'test video metadata');
  assert.equal(videoReads, extensions.length);
  let handler, received;
  require('node:vm').runInNewContext(handlerCode, { ipcMain: { handle: (_channel, fn) => { handler = fn; } }, path, loadLibrary: () => ({ filenames: ['hash.png'], sources: ['/photos/midjourney_1.png'] }), readAiOrigins: async (items, options) => { received = { items, options }; return {}; } });
  await handler(null, ['hash.png', 'unlisted.png', 'hash.png'], { cachedOnly: true });
  assert.equal(received.items.length, 1); assert.equal(received.items[0].title, 'midjourney_1.png');
  assert.equal(received.options.cachedOnly, true);
  await assert.rejects(handler(null, ['../outside.png']));
  await assert.rejects(handler(null, Array(11).fill('hash.png')));
  console.log('AI origin: markers, false positives, PNG compression, cache restart/invalidation, refresh, path safety and changed files passed');
 } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
