const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
function load(file){const ctx={exports:{},require:name=>load(path.resolve(path.dirname(file),name+'.ts'))};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);return ctx.exports;}
const {isScreenRecording:recording}=load(path.join(__dirname,'../src/simple/screenCapture.ts'));
for(const name of ['RPReplay_Final123.mp4','ScreenRecording_2026.mov','Screen_Recording_2026.mp4','Screenrecorder-2026.mp4','屏幕录制2026.mov','手机录屏.mp4','螢幕錄製.mov'])assert(recording(name),name);
assert(recording('renamed.mp4','C:\\Users\\me\\Videos\\Captures\\renamed.mp4'));
assert(recording('renamed.mp4','/DCIM/ScreenRecorder/renamed.mp4'));
for(const name of ['IMG_20261012.mp4','VID_20261012.mp4','movie.mov','recording.mp4','2026-10-12.mp4'])assert(!recording(name),name);
assert(!recording('movie.mov','/Videos/Camera/movie.mov'));
const {getCategory}=load(path.join(__dirname,'../src/lib/categories.ts'));
for(const name of ['Screenshot_2026.jpg','Screen Shot 2026.png','手机截图.jpg','电脑截屏.png','螢幕截圖.png'])assert.equal(getCategory({filename:name}),'Screenshots');
assert.equal(getCategory({filename:'renamed.png',screenshotHint:true}),'Screenshots');
assert.equal(getCategory({filename:'IMG_01.jpg',sourcePath:'/DCIM/Camera/IMG_01.jpg'}),'Projects');
assert.equal(getCategory({filename:'截图.jpg',override:'Projects'}),'Projects');
console.log('PASS: mobile/desktop screenshot and recording signals, renamed metadata, manual override, ordinary camera files excluded');
