const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createFaceGroups}=require('../main-lib/face-groups'),{createFaceThumbnails}=require('../main-lib/face-thumbnails');
(async()=>{
 const [imageA,imageB,video]=process.argv.slice(2);assert(imageA&&imageB&&video,'Provide two people images and first-person video');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sayphoto-corrections-native-'));const names=['a.png','a-copy.png','b.jpg','a-video.mov'];
 for(const [source,name]of [[imageA,names[0]],[imageA,names[1]],[imageB,names[2]],[video,names[3]]])await fs.copyFile(source,path.join(root,name));
 const stateDir=path.join(root,'people');const thumbs=createFaceThumbnails({directory:root,root:path.join(stateDir,'face-thumbs'),ffmpeg:()=>'/Applications/SayPhoto.app/Contents/Resources/ffmpeg'});
 const make=()=>createFaceGroups({directory:root,root:stateDir,binary:process.env.FACE_GROUPS_BINARY||path.join(process.cwd(),'main-lib/native/face-groups'),getNames:()=>names,readThumbnail:thumbs});
 const finish=async api=>{let s;do{await new Promise(r=>setTimeout(r,100));s=await api.status();}while(s.running);assert.equal(s.phase,'complete',s.error);return s;};
 let api=make();await api.start();let status=await finish(api);assert.equal(status.people.length,2);const a=status.people.find(p=>p.files.includes('a.png')),b=status.people.find(p=>p.files.includes('b.jpg'));await api.shutdown();
 // Simulate the previously shipped v1 file without per-face details.
 const old=JSON.parse(await fs.readFile(path.join(stateDir,'people.json'),'utf8'));old.people.forEach(p=>delete p.faces);delete old.manual;await fs.writeFile(path.join(stateDir,'people.json'),JSON.stringify(old));api=make();
 const originalB=await api.faces(b.id);assert.equal(originalB.total,1);await api.rename(a.id,'测试甲');await api.rename(b.id,'测试乙');
 const merged=await api.merge([a.id,b.id],a.id);assert.equal(merged.people.length,1);assert.equal(merged.people[0].files.length,4);
 const page=await api.faces(a.id),bad=page.faces.filter(f=>f.filename==='b.jpg');assert.equal(bad.length,1);
 const moved=await api.moveFaces(a.id,bad.map(f=>f.key));await api.rename(moved.movedTo,'测试乙（纠正）');assert(!moved.people.find(p=>p.id===a.id).files.includes('b.jpg'));
 const videoFace=(await api.faces(a.id)).faces.find(f=>f.video);assert(videoFace);
 const jpg=await api.thumbnail(a.id,videoFace.key);assert(jpg.startsWith('data:image/jpeg;base64,'));const metadata=await require('sharp')(Buffer.from(jpg.split(',')[1],'base64')).metadata();assert.equal(metadata.width,128);assert.equal(metadata.height,128);
 const photo=await api.thumbnail(moved.movedTo,bad[0].key);assert(photo.startsWith('data:image/jpeg;base64,'));
 await api.shutdown();api=make();await api.start();status=await finish(api);assert.equal(status.people.length,2);assert.equal(status.people.find(p=>p.id===a.id).files.length,3);assert.equal(status.people.find(p=>p.id===moved.movedTo).name,'测试乙（纠正）');await api.shutdown();
 await fs.writeFile('/private/tmp/sayphoto-people-corrections-native-result.json',JSON.stringify({root,status},null,2));console.log('PASS real Apple v1 hydration, manual merge/remove, photo/video face crops, restart and native regroup persistence:',root);
})().catch(e=>{console.error(e);process.exitCode=1;});
