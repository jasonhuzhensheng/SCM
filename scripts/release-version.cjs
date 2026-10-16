'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const state = path.join(root, 'release-version.json');
function reserve() {
 const lock = state + '.lock';
 const fd = fs.openSync(lock, 'wx');
 try {
  const previous = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state)) : { build: 0 };
  const build = Math.max(Number(previous.build) + 1, Math.floor(Date.now() / 1000));
  const revision = Number(previous.revision || 0) + 1;
  const result = { version: `1.0.${revision}`, revision, build: String(build), createdAt: new Date().toISOString() };
  fs.writeFileSync(state + '.tmp', JSON.stringify(result, null, 2) + '\n');
  fs.renameSync(state + '.tmp', state);
  return result;
 } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function stamp(bundle, release) {
 cp.execFileSync('python3', ['-c', "import plistlib,sys\np=sys.argv[1]; d=plistlib.load(open(p,'rb')); d['CFBundleShortVersionString']=sys.argv[2]; d['CFBundleVersion']=sys.argv[3]; plistlib.dump(d,open(p,'wb'))", path.join(bundle, 'Contents/Info.plist'), release.version, release.build]);
}
module.exports = { reserve, stamp };
if (require.main === module) {
 const release = reserve();
 if (process.argv.includes('--project')) {
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file));
  pkg.version = release.version;
  pkg.build.buildVersion = release.build;
  fs.writeFileSync(file, JSON.stringify(pkg, null, '\t') + '\n');
 }
 console.log(JSON.stringify(release));
}
