import { useTaskState } from "./taskState";
import { useEffect, useMemo, useState } from 'react';
import type { Asset } from './library';
export type CaptureDevice = { brand: string; model: string; status: string };
export function useCaptureDevices(assets: Asset[], enabled: boolean) {
 const [pendingTask,setPendingTask]=useTaskState("CaptureDevices-pending", false);
 const [records,setRecords]=useState<Record<string,CaptureDevice>>({});
 const [paused,setPaused]=useTaskState("CaptureDevices-paused", false);
 const [error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 const names=useMemo(()=>assets.map(a=>a.filename),[assets]);
 useEffect(()=>{
  if((!enabled && !pendingTask) || !window.memories?.captureDevices)return;
  let cancelled=false;
  const pending=names.filter(n=>!records[n]);
  if(!names.length)return;
  setPendingTask(true);
  void (async()=>{
   try {
    const missing:string[]=[];
    for(let i=0;i<pending.length&&!cancelled;i+=1000){
     const names=pending.slice(i,i+1000);
     const batch=await window.memories.captureDevices(names,{cachedOnly:true});
     if(cancelled)return;
     setRecords(old=>({...old,...batch}));
     missing.push(...names.filter(n=>!batch[n]));
    }
    if(paused)return;
    for(let i=0;i<missing.length&&!cancelled;i+=20){
     const batch=await window.memories.captureDevices(missing.slice(i,i+20));
     if(cancelled)return;
     setRecords(old=>({...old,...batch}));
     await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!cancelled)setPendingTask(false);
   }catch(e){if(!cancelled)setError(String(e));}
  })();
  return()=>{cancelled=true;};
  // Records are updated incrementally without restarting the active batch loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[names,enabled,paused,retry]);
 const devices=useMemo(()=>new Map(assets.map(a=>{
  let d=records[a.filename];
  if(d?.status==='unknown' && /^DJI[_-]/i.test(a.title))d={brand:'疑似大疆（文件名）',model:'型号未知',status:'suspected'};
  return [a.filename,d||{brand:'待扫描',model:'',status:'pending'}];
 })),[assets,records]);
 return {devices,paused,setPaused,error,retry:()=>{setError('');setRecords({});setRetry(v=>v+1);},done:names.filter(n=>records[n]).length};
}
export function CaptureDevicePanel({devices,brand,model,onChange,paused,onPause,done,total,error,onRetry}:{devices:Map<string,CaptureDevice>;brand:string;model:string;onChange:(brand:string,model:string)=>void;paused:boolean;onPause:()=>void;done:number;total:number;error:string;onRetry:()=>void}) {
 const brands=new Map<string,number>(),models=new Map<string,number>();
 for(const d of devices.values()){brands.set(d.brand,(brands.get(d.brand)||0)+1);if(d.brand===brand)models.set(d.model,(models.get(d.model)||0)+1);}
 return <div className="duplicate-summary"><strong>拍摄设备 · 已读取 {done} / {total}</strong><span>按照片 EXIF、视频设备元数据归类；文件名推测单独标记。待扫描、读取失败不等于设备未知。可与当前搜索、照片/视频及锁定筛选组合。</span><div className="view-controls"><label>品牌 <select aria-label="拍摄设备品牌" value={brand} onChange={e=>onChange(e.target.value,'')}><option value="">全部设备</option>{[...brands].sort().map(([b,n])=><option key={b} value={b}>{b}（{n}）</option>)}</select></label><label>型号 <select aria-label="拍摄设备型号" disabled={!brand} value={model} onChange={e=>onChange(brand,e.target.value)}><option value="">全部型号</option>{[...models].sort().map(([m,n])=><option key={m} value={m}>{m||'未记录'}（{n}）</option>)}</select></label><button className="text-button" onClick={onPause}>{paused?'继续读取':'暂停读取'}</button><button className="text-button" onClick={onRetry}>重新核对</button></div>{error&&<span role="alert">读取未完成：{error}</span>}<span>保留指定设备素材：筛选后使用“批量选择 → 全选 → 锁定所选”，锁定后不可删除。</span></div>;
}
