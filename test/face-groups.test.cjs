const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {reconcilePeople,createFaceGroups}=require('../main-lib/face-groups');
const {createAssetLocks}=require('../main-lib/asset-locks');
const bounds={x:.2,y:.3,width:.2,height:.2};
const records={'a.jpg':{assetIDs:['a'],times:[0]},'clip.mov':{assetIDs:['v','v2'],times:[0,5],video:true},'b.jpg':{assetIDs:['b'],times:[0]}};
const groups=[{entityID:'one',faces:[{id:'f1',assetID:'a',bounds},{id:'f2',assetID:'v',bounds},{id:'f3',assetID:'v2',bounds}]},{entityID:'two',faces:[{id:'f4',assetID:'b',bounds}]}];
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'people-regression-'));
 try{
 let people=reconcilePeople(groups,[],records);assert.equal(people.length,2);assert.deepEqual(people[0].files,['a.jpg','clip.mov']);people[0].name='甲';people[1].name='乙';
 const originalID=people[0].id;people=reconcilePeople([...groups].reverse().map(g=>({...g,entityID:g.entityID+'-new'})),people,records);
 assert.equal(people.find(p=>p.id===originalID).name,'甲');assert.equal(people.find(p=>p.id===originalID).number,1);
 const merged=reconcilePeople([{entityID:'merged',faces:groups.flatMap(g=>g.faces)}],people,records);assert.equal(merged[0].review,true);assert(merged[0].aliases.includes('乙'));
 assert.equal(reconcilePeople(groups,people,{'b.jpg':records['b.jpg']}).length,1);
 const locks=createAssetLocks(path.join(dir,'locks.json'));locks.set(people.find(p=>p.id===originalID).files,true);assert(locks.has('a.jpg'));assert(locks.has('clip.mov'));assert(!locks.has('b.jpg'));assert(createAssetLocks(path.join(dir,'locks.json')).has('clip.mov'));
 await fs.writeFile(path.join(dir,'a.jpg'),'mock');await fs.writeFile(path.join(dir,'b.jpg'),'mock');
 let scans=0,release,started;const waiting=new Promise(r=>started=r);
 const clientFactory=()=>({close(){},async request(cmd){if(cmd.mode==='scan'){scans++;started();await new Promise(r=>release=r);return {assetIDs:[cmd.assetID+':0'],times:[0],faceCount:0};}return {groups:[]};}});
 const api=createFaceGroups({directory:dir,root:path.join(dir,'state'),binary:'unused',getNames:()=>['a.jpg','b.jpg'],clientFactory,supported:()=>true});
 await api.start();await waiting;await api.pause();release();let status;do{await new Promise(r=>setTimeout(r,15));status=await api.status();}while(status.running);
 assert.equal(scans,1);assert.equal(status.phase,'paused');assert.equal(status.done,1);
 const saved=JSON.parse(await fs.readFile(path.join(dir,'state/people.json'),'utf8'));assert.equal(Object.keys(saved.records).length,1);await api.shutdown();
 await assert.rejects(api.rename('missing','Name'),/分组已变化/);
 const bad=path.join(dir,'bad');await fs.mkdir(bad);await fs.writeFile(path.join(bad,'people.json'),'bad');const badApi=createFaceGroups({directory:dir,root:bad,getNames:()=>[]});await assert.rejects(badApi.status());
 console.log('PASS grouping identities, photo/video dedup, rename stability, merge warning, removed assets, exact locks, pause checkpoint, corrupt state fails closed');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
