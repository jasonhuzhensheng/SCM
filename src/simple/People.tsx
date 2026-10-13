import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconUser, IconVideo, IconLock } from '@tabler/icons-react';
import type { PeopleStatus, PersonGroup, PersonFace, PersonFacesPage } from '@/types';
import { thumbFor, formatTimecode } from '@/lib/media';
export const personLabel=(p:PersonGroup)=>p.name||`人物 ${p.number}`;
export function usePeople(open:boolean) {
 const [status,setStatus]=useState<PeopleStatus|null>(null);
 const [people,setPeople]=useState<PersonGroup[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const revision=useRef<number|undefined>(undefined);
 const accept=useCallback((value:PeopleStatus)=>{if(revision.current!==undefined&&value.revision<revision.current)return;setStatus(value);if(value.people){setPeople(value.people);revision.current=value.revision;}},[]);
 useEffect(()=>{
  if(!open||!window.memories?.peopleStatus)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{const value=await window.memories.peopleStatus(revision.current);if(!cancelled){accept(value);}}catch(e){if(!cancelled)setError(String(e));}finally{if(!cancelled)timer=setTimeout(()=>void poll(),2000);}};
  void poll();return()=>{cancelled=true;clearTimeout(timer);};
 },[open,accept]);
 const act=useCallback(async(action:'start'|'pause'|'rename',id='',name='')=>{
  setBusy(true);setError('');try{accept(await(action==='start'?window.memories.peopleStart():action==='pause'?window.memories.peoplePause():window.memories.peopleRename(id,name)));}catch(e){setError(String(e));}finally{setBusy(false);}
 },[accept]);
 const edit=useCallback(async(request:()=>Promise<PeopleStatus>)=>{
  setBusy(true);setError('');try{const value=await request();accept(value);return value;}catch(e){setError(String(e));return null;}finally{setBusy(false);}
 },[accept]);
 return {status,people,error,busy,act,edit};
}
function PersonTile({person,selected,onToggle,onRename,onInspect,busy}:{person:PersonGroup;selected:boolean;onToggle:()=>void;onRename:(name:string)=>void;onInspect:()=>void;busy:boolean}) {
 const [name,setName]=useState(person.name);
 useEffect(()=>setName(person.name),[person.name]);
 const r=person.representative,b=r.bounds;
 return <div className={`person-tile ${selected?'selected':''}`}>
  <button className="person-pick" aria-label={`选择人物 ${personLabel(person)}`} aria-pressed={selected} onClick={onToggle}>
   <span className="person-avatar">{r.video?<IconVideo size={30}/>:b.width>0&&b.height>0?<img loading="lazy" src={thumbFor(encodeURIComponent(r.filename))} alt="人物参考头像" style={{position:'absolute',width:`${100/b.width}%`,height:`${100/b.height}%`,maxWidth:'none',left:`${-100*b.x/b.width}%`,top:`${-100*(1-b.y-b.height)/b.height}%`}}/>:<IconUser/>}</span>
   <strong>{personLabel(person)}</strong><span>{person.files.length} 个照片或视频文件</span>
  </button>
  <form onSubmit={e=>{e.preventDefault();onRename(name);}}><input aria-label={`命名 ${personLabel(person)}`} placeholder="输入人物姓名" value={name} maxLength={80} onChange={e=>setName(e.target.value)}/><button className="text-button" disabled={busy||!name.trim()||name.trim()===person.name}>保存</button></form>
  <button className="text-button" disabled={busy} onClick={onInspect}>检查 / 移出人脸</button>
  {person.review&&<small>分组包含多个已有名称：{person.aliases.join('、')}，请检查。</small>}
 </div>;
}
export function PeoplePanel({controller,selected,onSelect,onLock,lockDisabled,lockCount}:{controller:ReturnType<typeof usePeople>;selected:Set<string>;onSelect:(ids:Set<string>)=>void;onLock:()=>void;lockDisabled:boolean;lockCount:number}) {
 const {status,people,error,busy,act,edit}=controller;
 const [notice,setNotice]=useState(''),[dismissedError,setDismissedError]=useState('');
 const currentError=error||status?.error||'';
 useEffect(()=>{if(currentError&&currentError!==dismissedError)setNotice(currentError);if(!currentError)setDismissedError('');},[currentError,dismissedError]);
 const [reviewID,setReviewID]=useState(''),[targetID,setTargetID]=useState(''),[feedback,setFeedback]=useState('');
 const selectedGroups=people.filter(p=>selected.has(p.id));
 const mergeTarget=selectedGroups.some(p=>p.id===targetID)?targetID:selectedGroups[0]?.id||'';
 const editingDisabled=busy||!!status?.running;
 const merge=async()=>{setFeedback('');const value=await edit(()=>window.memories.peopleMerge(selectedGroups.map(p=>p.id),mergeTarget));if(value){onSelect(new Set([mergeTarget]));setReviewID('');setFeedback('人物已合并，原文件和已有锁定保持不变。');}};
 const move=async(keys:string[])=>{setFeedback('');const value=await edit(()=>window.memories.peopleMoveFaces(reviewID,keys));if(value){onSelect(new Set([...selected].filter(id=>value.people?.some(p=>p.id===id))));setReviewID('');setFeedback(`已移出 ${keys.length} 张人脸并组成新人物组，可继续命名或合并。`);return true;}return false;};
 const [search,setSearch]=useState(''),[limit,setLimit]=useState(36);
 const matches=useMemo(()=>people.filter(p=>[personLabel(p),...p.aliases].some(n=>n.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))),[people,search]);
 const phases:Record<string,string>={idle:'尚未扫描',scanning:'正在识别',grouping:'正在按人物分组',paused:'已暂停',partial:'部分文件读取失败，可重试',complete:'本轮扫描完成',error:'扫描未完成'};
 return <section className="people-panel" aria-label="人物分组">
  <div className="people-heading"><strong>人物 · 苹果本地识别</strong><button className="secondary-button" disabled={busy||!status?.supported||(status.running&&status.paused)} onClick={()=>void act(status?.running?'pause':'start')}>{status?.running?(status.paused?'等待当前文件完成…':'暂停识别'):status?.phase==='paused'?'继续识别':'扫描 / 更新人物'}</button></div>
  <p className="people-progress" role="status">{!status?'正在读取人物索引':!status.supported?'此功能需要 macOS 27 或更高版本':`${phases[status.phase]||status.phase} · ${status.done} / ${status.total} · ${people.length} 个人物组${status.failed?` · ${status.failed} 项失败`:''}`}</p>
  <p>照片在本机识别；视频约每5秒抽帧，最多120帧，长视频间隔更大。人物可能误分或漏检，未检测到人脸不代表无人。命名保存在本应用，不读取苹果“照片”里的人物名称。</p>
  <div className="people-notice-slot">{(notice||feedback)&&<div className="people-notice"><p role={notice?'alert':'status'}>{notice||feedback}</p><button className="text-button" onClick={()=>{setNotice('');setFeedback('');setDismissedError(currentError);}}>关闭提示</button></div>}</div>
  <div className="people-heading"><input type="search" aria-label="搜索人物姓名" placeholder="搜索人物姓名" value={search} onChange={e=>{setSearch(e.target.value);setLimit(36);}}/><button className="text-button" onClick={()=>onSelect(new Set())} disabled={!selected.size}>清除人物筛选</button><button className="secondary-button" disabled={lockDisabled||!lockCount} onClick={onLock}><IconLock size={16}/>锁定所选人物全部素材（{lockCount}）</button></div>
  <div className="people-heading"><label>合并后保留人物 <select aria-label="合并目标人物" value={mergeTarget} disabled={editingDisabled||selectedGroups.length<2} onChange={e=>setTargetID(e.target.value)}>{selectedGroups.map(p=><option key={p.id} value={p.id}>{personLabel(p)}</option>)}</select></label><button className="secondary-button" disabled={editingDisabled||selectedGroups.length<2||selectedGroups.length>100} onClick={()=>void merge()}>合并所选人物（{selectedGroups.length}）</button></div>
  <p>选择同一人的多个组后合并，保留目标姓名，其他名称作为搜索别名。检查人脸可把误识别项移到新组；手动调整会保留，已锁定文件不会解锁。调整前需暂停识别并等待当前任务完成。</p>
  {reviewID&&<FaceReview key={reviewID} person={people.find(p=>p.id===reviewID)} revision={status?.revision||0} busy={editingDisabled} onClose={()=>setReviewID('')} onMove={move}/>}
  {selected.size>0&&<p>已选择 {selected.size} 个人物，下方显示包含任一所选人物的素材；可继续组合画面搜索。锁定按钮保留这些人物的全部已识别素材，不受下方其他筛选影响。</p>}
  <div className="people-grid">{matches.slice(0,limit).map(p=><PersonTile key={p.id} person={p} busy={editingDisabled} onInspect={()=>setReviewID(p.id)} selected={selected.has(p.id)} onToggle={()=>{const next=new Set(selected);next.has(p.id)?next.delete(p.id):next.add(p.id);onSelect(next);}} onRename={name=>void act('rename',p.id,name)}/>)}</div>
  {!matches.length&&<p>{people.length?'没有匹配的人物名称。':status?.running?'正在识别照片与视频，完成分组后将在这里显示人物。':'点击“扫描 / 更新人物”开始识别，完成分组后可命名与选择。'}</p>}
  {matches.length>limit&&<button className="text-button" onClick={()=>setLimit(n=>n+36)}>再显示36个人物</button>}
 </section>;
}

function FacePreview({personID,face}:{personID:string;face:PersonFace}){
 const [image,setImage]=useState('');
 useEffect(()=>{let live=true;void window.memories.peopleFaceThumbnail(personID,face.key).then(value=>{if(live)setImage(value);}).catch(()=>{});return()=>{live=false;};},[personID,face.key]);
 return <span className="face-detail-image">{image?<img src={image} alt="识别人脸"/>:<IconUser size={28}/>}</span>;
}
function FaceReview({person,revision,busy,onClose,onMove}:{person:PersonGroup|undefined;revision:number;busy:boolean;onClose:()=>void;onMove:(keys:string[])=>Promise<boolean>}){
 const [page,setPage]=useState<PersonFacesPage|null>(null),[offset,setOffset]=useState(0),[picked,setPicked]=useState<Set<string>>(new Set()),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!person)return;let live=true;setLoading(true);setError('');setPicked(new Set());
  void window.memories.peopleFaces(person.id,offset).then(value=>{if(live)setPage(value);}).catch(e=>{if(live){setError(String(e));setPage(null);}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
 },[person?.id,offset,revision]);
 if(!person)return <p>人物分组已变化，请关闭后重新选择。<button onClick={onClose}>关闭检查</button></p>;
 return <section className="face-review" aria-label="检查人脸"><div className="people-heading"><strong>检查：{personLabel(person)}</strong><button className="text-button" onClick={onClose}>关闭检查</button></div><p>每项是一张识别人脸。合照或视频还有其他人脸留在原组时，该文件仍会显示在原组。移出仅调整分组，不删除文件、不解除锁定。</p>{error&&<p role="alert">{error}</p>}
  <div className="people-heading"><button className="text-button" disabled={busy||loading||!page?.faces.length} onClick={()=>setPicked(new Set(page?.faces.map(f=>f.key)))}>选择本页人脸</button><button className="secondary-button" disabled={busy||loading||!picked.size} onClick={()=>void onMove([...picked])}>移出所选人脸（{picked.size}）</button></div>
  <p className="face-loading-status" role="status">{loading?'正在读取人脸…':''}</p><div className="face-detail-grid" aria-busy={loading}>{page?.faces.map((face,i)=><label className="face-detail" key={face.key}><input type="checkbox" aria-label={`选择人脸 ${offset+i+1}：${face.filename}${face.video?' '+formatTimecode(face.time):''}`} disabled={busy} checked={picked.has(face.key)} onChange={()=>setPicked(old=>{const next=new Set(old);next.has(face.key)?next.delete(face.key):next.add(face.key);return next;})}/><FacePreview personID={person.id} face={face}/><span title={face.filename}>{face.filename}</span>{face.video&&<small>视频 {formatTimecode(face.time)}</small>}</label>)}</div>
  <div className="people-heading"><button className="text-button" disabled={busy||loading||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-24))}>上一页人脸</button><span>{page?`${Math.min(offset+1,page.total)}–${Math.min(offset+24,page.total)} / ${page.total} 张人脸`:''}</span><button className="text-button" disabled={busy||loading||!page||offset+24>=page.total} onClick={()=>setOffset(n=>n+24)}>下一页人脸</button></div>
 </section>;
}
