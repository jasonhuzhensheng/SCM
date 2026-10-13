const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createFaceGroups,reconcilePeople}=require('../main-lib/face-groups');
const {createAssetLocks}=require('../main-lib/asset-locks');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'people-corrections-'));
 try{
 const names=['shared.jpg','other.jpg','clip.mov'],records={};for(const filename of names){await fs.writeFile(path.join(root,filename),'test');const stat=await fs.stat(path.join(root,filename));records[filename]={key:`${stat.size}:${stat.mtimeMs}:v1`,assetIDs:[filename],times:[filename==='clip.mov'?5:0],video:filename==='clip.mov'};}
 const face=(id,assetID,x)=>({id,assetID,bounds:{x,y:.2,width:.15,height:.15}});
 let groups=[{entityID:'g1',faces:[face('a','shared.jpg',.1),face('wrong','shared.jpg',.7)]},{entityID:'g2',faces:[face('a2','other.jpg',.2),face('a3','clip.mov',.3)]}];
 const initial=reconcilePeople(groups,[],records);initial[0].name='甲';initial[1].name='甲的另一个组';
 const stateDir=path.join(root,'people');await fs.mkdir(stateDir);await fs.writeFile(path.join(stateDir,'people.json'),JSON.stringify({version:1,records,people:initial}));
 const factory=()=>({close(){},async request(cmd){if(cmd.mode==='snapshot')return {groups};throw Error('Unexpected re-scan');}});
 const make=()=>createFaceGroups({root:stateDir,directory:root,binary:'mock',getNames:()=>names,clientFactory:factory,supported:()=>true});let api=make();
 const firstID=initial[0].id,secondID=initial[1].id;const faces=await api.faces(firstID);assert.equal(faces.faces.length,2);
 const locks=createAssetLocks(path.join(root,'locks.json'));locks.set(names,true);
 const moved=await api.moveFaces(firstID,[faces.faces.find(f=>f.id==='wrong').key]);const wrongID=moved.movedTo;
 assert(moved.people.find(p=>p.id===firstID).files.includes('shared.jpg'));assert.deepEqual(moved.people.find(p=>p.id===wrongID).files,['shared.jpg']);
 await api.rename(wrongID,'乙');
 const merged=await api.merge([firstID,secondID],firstID);assert.equal(merged.people.length,2);assert.equal(merged.people.find(p=>p.id===firstID).name,'甲');assert(merged.people.find(p=>p.id===firstID).aliases.includes('甲的另一个组'));assert.deepEqual(new Set(merged.people.find(p=>p.id===firstID).files),new Set(names));
 await assert.rejects(api.merge([firstID,firstID],firstID));await assert.rejects(api.merge([firstID,'missing'],firstID));await assert.rejects(api.moveFaces(firstID,['stale']));
 const before=JSON.parse(await fs.readFile(path.join(stateDir,'people.json'),'utf8'));await fs.mkdir(path.join(stateDir,'people.json.tmp'));await assert.rejects(api.rename(firstID,'不应保存'));assert.equal((await api.status()).people.find(p=>p.id===firstID).name,'甲');await fs.rmdir(path.join(stateDir,'people.json.tmp'));assert.equal(JSON.parse(await fs.readFile(path.join(stateDir,'people.json'),'utf8')).people.find(p=>p.id===firstID).name,'甲');
 // The next Apple result combines all faces and replaces native face IDs.
 groups=[{entityID:'all-changed',faces:groups.flatMap(g=>g.faces).map(f=>({...f,id:f.id+'-new'}))}];
 await api.shutdown();api=make();await api.start();let status;do{await new Promise(r=>setTimeout(r,15));status=await api.status();}while(status.running);
 assert.equal(status.phase,'complete');assert.equal(status.people.length,2);assert.equal(status.people.find(p=>p.id===wrongID).name,'乙');assert.equal((await api.faces(wrongID)).faces.length,1);assert.equal((await api.faces(firstID)).faces.length,3);assert.deepEqual(new Set(status.people.find(p=>p.id===firstID).files),new Set(names));
 assert.deepEqual(new Set(createAssetLocks(path.join(root,'locks.json')).list()),new Set(names));
 const remaining=(await api.faces(wrongID)).faces;await api.moveFaces(wrongID,remaining.map(f=>f.key));assert(!(await api.status()).people.some(p=>p.id===wrongID));
 assert((await fs.stat(path.join(stateDir,'people.json.before-manual'))).isFile());await api.shutdown();
 console.log('PASS face-level removal, shared-photo retention, video merge, names/aliases, native ID changes, restart/regroup persistence, failed-save rollback, stale validation, locks unchanged, empty-group removal, backup');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
