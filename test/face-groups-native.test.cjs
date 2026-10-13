const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createFaceGroups}=require('../main-lib/face-groups');
(async()=>{
const [imageA,imageB,video]=process.argv.slice(2);if(!imageA||!imageB||!video)throw Error('Usage: node test/face-groups-native.test.cjs <person-a-image> <person-b-image> <person-a-video>');
const root=path.join(require('node:os').tmpdir(),'sayphoto-people-integration-'+Date.now());await fs.mkdir(root,{recursive:true});
for(const [src,to]of [[imageA,'a.png'],[imageA,'a-copy.png'],[imageB,'b.jpg'],[video,'a-video.mov']])await fs.copyFile(src,path.join(root,to));
const names=['a.png','a-copy.png','b.jpg','a-video.mov'];
const api=createFaceGroups({directory:root,root:path.join(root,'people'),binary:process.env.FACE_GROUPS_BINARY||process.cwd()+'/main-lib/native/face-groups',getNames:()=>names});
await api.start();let s;do{await new Promise(r=>setTimeout(r,1000));s=await api.status();console.log(JSON.stringify({phase:s.phase,done:s.done,failed:s.failed,error:s.error}));}while(s.running);
assert.equal(s.phase,'complete');assert.equal(s.people.length,2);const a=s.people.find(p=>p.files.includes('a.png'));assert(a.files.includes('a-copy.png'));assert(a.files.includes('a-video.mov'));assert(!a.files.includes('b.jpg'));
await api.rename(a.id,'测试人物甲');await api.shutdown();
const again=createFaceGroups({directory:root,root:path.join(root,'people'),binary:process.env.FACE_GROUPS_BINARY||process.cwd()+'/main-lib/native/face-groups',getNames:()=>names});assert.equal((await again.status()).people.find(p=>p.id===a.id).name,'测试人物甲');await again.start();do{await new Promise(r=>setTimeout(r,500));s=await again.status();}while(s.running);assert.equal(s.people.find(p=>p.id===a.id).name,'测试人物甲');await again.shutdown();
await fs.writeFile('/private/tmp/sayphoto-people-integration-result.json',JSON.stringify({root,status:s},null,2));console.log('PASS real Apple grouping, video frames, names survive restart and regroup',root);
})().catch(e=>{console.error(e);process.exitCode=1});
