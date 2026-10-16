import { useEffect, useState } from "react";

type SpaceHistory = Awaited<ReturnType<Window["memories"]["deletionSpaceHistory"]>>;
export function FileTasks({ pending = "" }: { pending?: string }) {
 const [history,setHistory]=useState<SpaceHistory>();
 const [tasks,setTasks]=useState<Awaited<ReturnType<Window["memories"]["fileTasks"]>>>([]);
 const [error,setError]=useState("");
 const [cancelling,setCancelling]=useState<string | null>(null);
 async function cancel(id:string) {
  setCancelling(id);
  try { await window.memories.cancelFileTask(id); setTasks(await window.memories.fileTasks().then(jobs=>jobs.filter(job=>job.kind==="delete"&&!["complete","cancelled"].includes(job.status)))); }
  catch (cause) { setError(cause instanceof Error ? cause.message : "取消失败，请重试。"); }
  finally { setCancelling(null); }
 }
 useEffect(()=>{
  if(!window.memories)return;
  let live=true;
  const refresh=async()=>{try{const [space,jobs]=await Promise.all([window.memories.deletionSpaceHistory(),window.memories.fileTasks()]);if(live){setHistory(space);setTasks(jobs.filter(job=>job.kind==="delete"&&!["complete","cancelled"].includes(job.status)));setError("");}}catch{if(live)setError("删除累计统计暂时无法读取，将自动重试。");}};
  void refresh();const timer=setInterval(()=>void refresh(),2000);
  return()=>{live=false;clearInterval(timer);};
 },[]);
 if(!window.memories)return null;
 return <section className="file-task-panel delete-text" aria-label="删除任务">
  <small>累计删除 {history ? history.totals.trashedCount.toLocaleString() : "—"} 个 · {history ? (history.totals.trashedBytes / 1_000_000_000).toFixed(2) : "—"} GB</small>
  {pending && !tasks.length && <p role="status">{pending}</p>}
  {tasks.map(job => <div className="delete-task-card" key={job.id}>
   <div className="delete-task-heading"><strong>{job.status === "paused" ? "删除已暂停" : job.status === "waiting" ? "删除等待处理" : job.deleteSubmitted ? "正在确认删除结果" : "正在检查待删除文件"}</strong><button className="secondary-button" disabled={!!cancelling || job.deleteSubmitted} onClick={() => void cancel(job.id)}>{cancelling === job.id ? "正在取消…" : "取消"}</button></div>
   <div role="status">检查 {job.checkedCount ?? 0} / {job.total} · 已处理 {job.done} / {job.total}{!!job.activeVerifications && ` · 同时检查 ${job.activeVerifications} 项`}</div>
   <progress max={Math.max(1,job.total)} value={job.deleteSubmitted ? job.done : job.checkedCount ?? 0} aria-label={job.deleteSubmitted ? "删除清理进度" : "删除检查进度"} />
   {job.deleteSubmitted && <small>系统删除已提交，正在确认结果并清理列表，无法撤销。</small>}
   {job.error && <p>{job.error}</p>}
  </div>)}
  {error && <p role="alert">{error}</p>}
 </section>;
}
