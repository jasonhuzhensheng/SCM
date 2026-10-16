import {useEffect,useRef,useState} from "react";
import {IconChevronDown,IconChevronUp,IconLoader2,IconPlayerPause,IconPlayerPlay,IconRefresh} from "@tabler/icons-react";
import {createEtaEstimator,formatRemaining} from "./progressEta";
export function ProgressToast({done,total,label,taskKey,paused=false,waiting=false,pendingJobs,waitingReason,onTogglePause,onRefresh}:{done:number;total:number;label:string;taskKey:string;paused?:boolean;waiting?:boolean;pendingJobs?:number;waitingReason?:string;onTogglePause?:()=>Promise<void>;onRefresh?:()=>Promise<void>}) {
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem("sayphoto-progress-collapsed")==="true";}catch{return false;}});
 const toggleCollapsed=(value:boolean)=>{setCollapsed(value);try{localStorage.setItem("sayphoto-progress-collapsed",String(value));}catch{}};
 const estimator=useRef(createEtaEstimator());
 const [eta,setEta]=useState<number|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{estimator.current=createEtaEstimator();setEta(null);},[paused,taskKey]);
 useEffect(()=>{if(paused)return;const now=performance.now();estimator.current.observe(done,total,taskKey,now);setEta(estimator.current.remaining(now));},[done,total,taskKey,paused]);
 useEffect(()=>{if(paused)return;const timer=setInterval(()=>setEta(estimator.current.remaining(performance.now())),1000);return()=>clearInterval(timer)},[paused]);
 const act=async (action:()=>Promise<void>)=>{setBusy(true);setError("");try{await action();}catch(error){setError(error instanceof Error?error.message:"操作失败，请重试");}finally{setBusy(false);}};
 const isImport=taskKey==="import";
 const known=!waiting&&Number.isFinite(total)&&total>0&&Number.isFinite(done);
 const percent=known?Math.max(0,Math.min(100,Math.floor(done/total*100))):null;
 if(collapsed)return <div className="progress-compact" role="status"><button className="progress-expand" aria-label={`展开${label}进度${paused?"（已暂停）":""}`} aria-expanded={false} title={`${paused?"已暂停":label}：${known?`${isImport?"已处理 / 本轮待处理：":""}${done.toLocaleString()} / ${total.toLocaleString()}`:"准备中"}，点击展开`} onClick={()=>toggleCollapsed(false)}><progress className="index-progress" aria-label={paused?`${label}（已暂停）`:label} max={100} value={percent??undefined}/><span>{paused?"已暂停":waiting?`排队 ${pendingJobs ?? total} 批`:percent===null?"准备中":`${percent}%`}</span><IconChevronUp size={15}/></button></div>;
 return <div className="progress-toast" role="status">{paused?<IconPlayerPause size={22}/>:<IconLoader2 className="spin" size={22}/>}<div className="progress-content">
  <div className="progress-heading"><span className="progress-description">{paused?"已暂停派发任务":label}</span>{percent!==null&&<strong className="progress-percent">{percent}<small>%</small></strong>}<button className="icon-button progress-collapse" aria-label="收起素材进度" title="收起为底部进度条" aria-expanded={true} onClick={()=>toggleCollapsed(true)}><IconChevronDown size={18}/></button></div>
  {waiting&&<p>等待添加 {pendingJobs ?? total} 批 · {waitingReason || "等待当前任务完成"}</p>}
  {!waiting&&!!pendingJobs&&<p>后台添加队列：{pendingJobs} 批（含当前批次）</p>}
  {isImport&&known&&<p>已处理 / 本轮待处理</p>}
  {known?<div className="progress-count"><strong>{Math.max(0,done).toLocaleString()}</strong><span className="progress-divider">/</span><span className="progress-total">{total.toLocaleString()}</span><small>项</small></div>:!waiting&&<p>正在准备任务…</p>}
  {isImport&&!waiting&&<p>仅统计本轮任务，不代表素材总数；已入库文件不重复计入。</p>}
  <progress className="index-progress" aria-label={label} max={100} value={percent??undefined}/>
  {!waiting&&<div className="progress-eta"><span>{paused?"当前处理项完成后停止":"预计剩余"}</span><strong>{paused?"等待继续":known&&done>=total?'正在收尾…':formatRemaining(eta)}</strong></div>}
  {(onTogglePause||onRefresh)&&<div className="progress-actions">
   {onTogglePause&&<button className="secondary-button" disabled={busy} onClick={()=>void act(onTogglePause)}>{paused?<IconPlayerPlay size={16}/>:<IconPlayerPause size={16}/>}<span>{paused?"继续":"暂停"}</span></button>}
   {onRefresh&&<button className="secondary-button" title="更新进度和素材列表，不重启任务" disabled={busy} onClick={()=>void act(onRefresh)}><IconRefresh size={16}/><span>刷新</span></button>}
  </div>}
  {error&&<p className="notice-error" role="alert">{error}</p>}
 </div></div>;
}
