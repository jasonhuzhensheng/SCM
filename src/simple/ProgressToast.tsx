import {useEffect,useRef,useState} from "react";
import {IconLoader2} from "@tabler/icons-react";
import {createEtaEstimator,formatRemaining} from "./progressEta";
export function ProgressToast({done,total,label,taskKey}:{done:number;total:number;label:string;taskKey:string}) {
 const estimator=useRef(createEtaEstimator());
 const [eta,setEta]=useState<number|null>(null);
 useEffect(()=>{const now=performance.now();estimator.current.observe(done,total,taskKey,now);setEta(estimator.current.remaining(now));},[done,total,taskKey]);
 useEffect(()=>{const timer=setInterval(()=>setEta(estimator.current.remaining(performance.now())),1000);return()=>clearInterval(timer)},[]);
 const known=Number.isFinite(total)&&total>0&&Number.isFinite(done);
 const percent=known?Math.max(0,Math.min(100,Math.floor(done/total*100))):null;
 return <div className="progress-toast" role="status"><IconLoader2 className="spin" size={22}/><div className="progress-content">
  <div className="progress-heading"><span className="progress-description">{label}</span>{percent!==null&&<strong className="progress-percent">{percent}<small>%</small></strong>}</div>
  {known?<div className="progress-count"><strong>{Math.max(0,done).toLocaleString()}</strong><span className="progress-divider">/</span><span className="progress-total">{total.toLocaleString()}</span><small>项</small></div>:<p>正在准备任务…</p>}
  <progress className="index-progress" aria-label={label} max={100} value={percent??undefined}/>
  <div className="progress-eta"><span>预计剩余</span><strong>{known&&done>=total?'正在收尾…':formatRemaining(eta)}</strong></div>
 </div></div>;
}
