"use strict";
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const isVideo=name=>/\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|hevc|mpg|mpeg)$/i.test(name);
const assetPrefix=name=>crypto.createHash('sha256').update(name).digest('hex');
function createNativeClient(binary,root) {
 let child,pending,ready,buffer='',failure='';
 const fail=error=>{failure=error.message;const p=pending;pending=null;if(p){clearTimeout(p.timer);p.reject(error);}};
 function wait(timeout){return new Promise((resolve,reject)=>{pending={resolve,reject,timer:setTimeout(()=>{fail(Error('苹果人物识别超时，已有结果已保留，请重试。'));child?.kill();},timeout)};});}
 async function launch(){
  if(ready)return ready;
  ready=(async()=>{
   await fs.mkdir(root,{recursive:true,mode:0o700});
   const response=wait(180000);
   child=spawn('/usr/bin/nice',['-n','10',binary,root],{stdio:['pipe','pipe','pipe']});
   child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>128*1024*1024){fail(Error('人物结果过大'));child.kill();return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.startsWith('{'))continue;try{const value=JSON.parse(line);if(pending){const p=pending;pending=null;clearTimeout(p.timer);value.ok===false?p.reject(Error(value.error)):p.resolve(value);}}catch{}}});
   child.stderr.on('data',()=>{});
   child.on('error',fail);child.on('exit',(code,signal)=>{fail(Error(`苹果人物进程已停止（${signal||code}），已有结果已保留。`));});
   child.stdin.on('error',fail);
   const value=await response;if(!value.ready)throw Error('苹果人物接口未就绪');
  })();return ready;
 }
 return {async request(value){await launch();if(failure)throw Error(failure);if(pending)throw Error('人物进程忙碌');const answer=wait(value.mode==='snapshot'?600000:300000);child.stdin.write(JSON.stringify(value)+'\n');return answer;},close(){child?.kill();}};
}
function faceKey(face, signature) {
 const b=face.bounds;
 return crypto.createHash('sha256').update(JSON.stringify([face.assetID,signature||'',...[b.x,b.y,b.width,b.height].map(n=>Math.round(n*10000))])).digest('hex');
}
function reconcilePeople(groups,previous,records,manual={people:{},assignments:{},redirects:{}}){
 const sources=new Map();for(const [filename,row]of Object.entries(records))for(let i=0;i<row.assetIDs.length;i++)sources.set(row.assetIDs[i],{filename,time:row.times[i]||0,video:!!row.video,signature:row.key});
 const canonical=id=>{const seen=new Set();while(manual.redirects[id]&&!seen.has(id)){seen.add(id);id=manual.redirects[id];}return id;};
 const metadata=new Map([...previous,...Object.values(manual.people)].map(p=>[p.id,p]));
 const owners=new Map(),stableOwners=new Map(),byEntity=new Map(previous.map(p=>[p.entityID,p]));
 for(const person of previous){for(const id of person.faceIDs)owners.set(id,person);for(const face of person.faces||[])stableOwners.set(face.key,person);}
 const used=new Set(),buckets=new Map();let ordinal=[...metadata.values()].reduce((max,p)=>Math.max(max,p.number||0),0);
 for(const group of groups){
  const faces=group.faces.filter(f=>sources.has(f.assetID)).map(f=>{const source=sources.get(f.assetID);return {...f,key:faceKey(f,source.signature),filename:source.filename,time:source.time,video:source.video};});if(!faces.length)continue;
  const votes=new Map();for(const face of faces){const p=owners.get(face.id)||stableOwners.get(face.key);if(p){const id=canonical(p.id);votes.set(id,(votes.get(id)||0)+1);}}
  const allowed=id=>!used.has(id)||!!manual.people[id];
  const fallback=canonical(byEntity.get(group.entityID)?.id);
  const candidate=[...votes].sort((a,b)=>b[1]-a[1]).find(([id])=>allowed(id))?.[0]||(fallback&&allowed(fallback)?fallback:null);
  const defaultID=candidate||crypto.randomUUID();used.add(defaultID);
  if(!metadata.has(defaultID))metadata.set(defaultID,{id:defaultID,number:++ordinal,name:'',aliases:[]});
  const aliases=[...new Set([...votes.keys()].flatMap(id=>{const p=metadata.get(id);return p?[p.name,...(p.aliases||[])]:[];}).filter(Boolean))];
  for(const face of faces){
   const id=canonical(manual.assignments[face.key]||defaultID);
   const meta=metadata.get(id)||metadata.get(defaultID);
   if(!buckets.has(id))buckets.set(id,{...meta,id,entityID:group.entityID,faces:[],aliases:manual.people[id]?(meta.aliases||[]):aliases,review:!manual.people[id]&&aliases.length>1});
   buckets.get(id).faces.push(face);
  }
 }
 return [...buckets.values()].map(p=>summarizePerson(p)).sort((a,b)=>a.number-b.number);
}
function summarizePerson(person){
 const faces=person.faces,first=faces.find(f=>!f.video)||faces[0];
 return {...person,faceIDs:faces.map(f=>f.id),files:[...new Set(faces.map(f=>f.filename))],representative:first?{filename:first.filename,time:first.time,video:first.video,bounds:first.bounds}:person.representative};
}
function personMeta(p){return {id:p.id,number:p.number,name:p.name,aliases:p.aliases||[]};}
function createFaceGroups({directory,root,binary,getNames,clientFactory=createNativeClient,readThumbnail,supported=()=>process.platform==='darwin'&&Number(require('node:os').release().split('.')[0])>=26}) {
 let state,loading,client,editing=false,running=false,paused=false,closing=false,revision=0,progress={done:0,total:0,failed:0,phase:'idle'},error='';
 const stateFile=path.join(root,'people.json');
 const load=()=>loading||(loading=(async()=>{try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));if(state.version!==1||!state.records||!Array.isArray(state.people))throw Error('人物索引格式无效');}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,records:{},people:[]};}paused=state.task?.paused===true;if(paused)progress.phase='paused';state.manual ||= {people:{},assignments:{},redirects:{}};return state;})());
 let writes=Promise.resolve();
 function persist(value=state){const data=JSON.stringify(value);const task=writes.then(async()=>{await fs.mkdir(root,{recursive:true,mode:0o700});await fs.writeFile(stateFile+'.tmp',data,{mode:0o600});await fs.rename(stateFile+'.tmp',stateFile);});writes=task.catch(()=>{});return task;}
 async function snapshot(){progress.phase='grouping';const result=await client.request({mode:'snapshot'});const next={...state,people:reconcilePeople(result.groups,state.people,state.records,state.manual)};await persist(next);state=next;revision++;}
 async function hydrate(){
  if(state.people.every(p=>Array.isArray(p.faces)))return;
  const reader=clientFactory(binary,root);
  try{const result=await reader.request({mode:'snapshot'});const next={...state,people:reconcilePeople(result.groups,state.people,state.records,state.manual)};await persist(next);state=next;revision++;}finally{reader.close();}
 }
 async function edit(action){
  await load();if(running||editing)throw Error('请先暂停人物识别，并等待当前任务完成后再调整分组。');editing=true;
  try{
   try{await fs.copyFile(stateFile,stateFile+'.before-manual',require('node:fs').constants.COPYFILE_EXCL);}catch(e){if(e.code!=='ENOENT'&&e.code!=='EEXIST')throw e;}
   await hydrate();const next=structuredClone(state);const result=await action(next);await persist(next);state=next;revision++;return result;}finally{editing=false;}
 }
 function requirePerson(data,id){const person=data.people.find(p=>p.id===id);if(!person)throw Error('人物分组已变化，请刷新后重试');return person;}

 async function scan(){
  try{
   await load();client=clientFactory(binary,root);
   const names=[...new Set(getNames())],known=new Set(names);progress={done:0,total:names.length,failed:0,phase:'scanning'};
   // Remove only derived face records for files no longer in the library.
   const gone=Object.keys(state.records).filter(n=>!known.has(n));
   if(gone.length){await client.request({mode:'delete',assetIDs:gone.flatMap(n=>state.records[n].assetIDs)});for(const n of gone)delete state.records[n];await persist();}
   let changes=0;
   for(const filename of names){
    if(paused||closing)break;
    if(path.basename(filename)!==filename)continue;
    progress.phase='scanning';let analyzed=false;
    try{
     const file=path.join(directory,filename),stat=await fs.stat(file),key=`${stat.size}:${stat.mtimeMs}:v1`;
     if(state.records[filename]?.key!==key){
      const prefix=assetPrefix(filename),previous=state.records[filename]?.assetIDs||Array.from({length:120},(_,i)=>`${prefix}:${i}`);
      const result=await client.request({mode:'scan',file,assetID:prefix,previous,video:isVideo(filename)});
      state.records[filename]={key,assetIDs:result.assetIDs,times:result.times,video:isVideo(filename),faceCount:result.faceCount};
      changes++;analyzed=true;
     }
    }catch(e){progress.failed++;error=`${filename}: ${e.message}`;if(/进程已停止|超时|ENOENT.*spawn/.test(e.message))throw e;}
    progress.done++;
    if(changes>=20){await snapshot();changes=0;}
    if(analyzed||progress.done%100===0)await new Promise(r=>setTimeout(r,analyzed?60:5));
   }
   if(!closing)await snapshot();
   progress.phase=paused?'paused':progress.failed?'partial':'complete';
   if(!closing){state.task={pending:paused,paused};await persist();}
  }catch(e){error=e.message;progress.phase='error';}
  finally{running=false;client?.close();client=null;revision++;}
 }
 return {
  async status(since){
   await load();const result={supported:supported(),running,paused,...progress,error,revision};
   if(since!==revision){const known=new Set(getNames());result.people=state.people.map(({faceIDs,faces,entityID,...p})=>({...p,files:p.files.filter(n=>known.has(n))})).filter(p=>p.files.length);}
   return result;
  },
  async start(){await load();if(!supported())throw Error('人物分组需要 macOS 27 或更高版本');if(editing)throw Error('正在保存人物调整，请稍后再开始识别');if(!running){running=true;try{state.task={pending:true,paused:false};await persist();paused=false;error='';void scan();}catch(e){running=false;throw e;}}return this.status();},
  async pause(){await load();paused=true;state.task={pending:true,paused:true};await persist();return this.status();},
  async resume(){await load();if(state.task?.pending&&!state.task.paused)return this.start();return this.status();},
  async rename(id,name){
   if(typeof name!=='string'||name.trim().length>80||!name.trim())throw Error('人物名称须为1–80个字符');
   await edit(next=>{const person=requirePerson(next,id);person.name=name.trim();if(next.manual.people[id])next.manual.people[id]=personMeta(person);});return this.status();
  },
  async merge(ids,targetID){
   if(!Array.isArray(ids)||ids.length<2||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length||!ids.includes(targetID))throw Error('请选择2–100个不同人物，并指定保留的人物。');
   await edit(next=>{
    const selected=ids.map(id=>requirePerson(next,id)),target=requirePerson(next,targetID),faces=selected.flatMap(p=>p.faces);
    target.faces=faces;target.aliases=[...new Set(selected.flatMap(p=>[p.name,...p.aliases]).filter(n=>n&&n!==target.name))];target.review=false;
    for(const person of selected){if(person.id!==targetID)next.manual.redirects[person.id]=targetID;}
    for(const face of faces)next.manual.assignments[face.key]=targetID;
    next.manual.people[targetID]=personMeta(target);
    next.people=next.people.filter(p=>!ids.includes(p.id)||p.id===targetID).map(p=>p.id===targetID?summarizePerson(target):p);
   });return this.status();
  },
  async faces(id,offset=0){
   await load();if(!Number.isInteger(offset)||offset<0)throw Error('无效的人脸页码');
   if(state.people.some(p=>!Array.isArray(p.faces)))await edit(()=>{});
   const person=requirePerson(state,id),known=new Set(getNames()),faces=person.faces.filter(f=>known.has(f.filename));
   return {personID:id,total:faces.length,offset,faces:faces.slice(offset,offset+24),revision};
  },
  async moveFaces(id,keys){
   if(!Array.isArray(keys)||!keys.length||keys.length>1000||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length)throw Error('请选择需要移出的人脸。');
   let newID;
   await edit(next=>{
    const person=requirePerson(next,id),selected=new Set(keys),faces=person.faces.filter(f=>selected.has(f.key));
    if(faces.length!==keys.length)throw Error('人脸列表已变化，请刷新后重新选择。');
    newID=crypto.randomUUID();const number=[...next.people,...Object.values(next.manual.people)].reduce((n,p)=>Math.max(n,p.number||0),0)+1;
    const moved=summarizePerson({id:newID,number,name:'',aliases:[],review:false,faces});
    person.faces=person.faces.filter(f=>!selected.has(f.key));
    // Pin both sides so Apple's next grouping cannot undo the correction.
    for(const face of person.faces)next.manual.assignments[face.key]=id;
    for(const face of faces)next.manual.assignments[face.key]=newID;
    next.manual.people[id]=personMeta(person);next.manual.people[newID]=personMeta(moved);
    next.people=next.people.filter(p=>p.id!==id);if(person.faces.length)next.people.push(summarizePerson(person));next.people.push(moved);next.people.sort((a,b)=>a.number-b.number);
   });return {...await this.status(),movedTo:newID};
  },
  async thumbnail(id,key){
   await load();const face=requirePerson(state,id).faces?.find(f=>f.key===key);
   if(!face||!getNames().includes(face.filename)||!readThumbnail)throw Error('人脸预览不可用');
   const stat=await fs.stat(path.join(directory,face.filename));if(state.records[face.filename]?.key!==`${stat.size}:${stat.mtimeMs}:v1`)throw Error('原文件已变化，请重新扫描');
   return readThumbnail(face);
  },
  async shutdown(){closing=true;paused=true;client?.close();await writes;},
 };
}
module.exports={createFaceGroups,createNativeClient,reconcilePeople,assetPrefix,faceKey};
