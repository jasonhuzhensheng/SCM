const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
(async () => {
 const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
 const start = source.indexOf('function copyFileWithWatchdog(');
 const end = source.indexOf('// C-01 Wave 2', start);
 const ctx = { fs, setInterval, clearInterval, Date }; vm.createContext(ctx); vm.runInContext(source.slice(start,end),ctx);
 const root = fs.mkdtempSync(path.join(os.tmpdir(),'scm-clone-test-'));
 try {
  const src = path.join(root,'source'), dst = path.join(root,'copy');
  fs.writeFileSync(src,Buffer.alloc(1024*1024,7));
  await ctx.copyFileWithWatchdog(src,dst);
  assert.deepEqual(fs.readFileSync(src),fs.readFileSync(dst));
  fs.writeFileSync(src,'changed'); assert.equal(fs.statSync(dst).size,1024*1024);
  fs.unlinkSync(src); assert.equal(fs.statSync(dst).size,1024*1024);
  await assert.rejects(ctx.copyFileWithWatchdog(src,path.join(root,'missing')));
  console.log('PASS: fast import copy preserves bytes, independent content and lifetime; errors propagate');
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
