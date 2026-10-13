import { useEffect, useState } from "react";

type SpaceHistory = Awaited<ReturnType<Window["memories"]["deletionSpaceHistory"]>>;
export function FileTasks() {
 const [history,setHistory]=useState<SpaceHistory>();
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!window.memories)return;
  let live=true;
  const refresh=async()=>{try{const space=await window.memories.deletionSpaceHistory();if(live){setHistory(space);setError("");}}catch{if(live)setError("删除累计统计暂时无法读取，将自动重试。");}};
  void refresh();const timer=setInterval(()=>void refresh(),2000);
  return()=>{live=false;clearInterval(timer);};
 },[]);
 if(!window.memories)return null;
 return <><section className="file-task-panel delete-text" aria-label="删除累计统计"><strong>累计删除文件 {history ? history.totals.trashedCount.toLocaleString() : "—"} 个，累计删除大小 {history ? (history.totals.trashedBytes / 1_000_000_000).toFixed(2) : "—"} GB</strong>{error&&<p role="alert">{error}</p>}</section></>;
}
