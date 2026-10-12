import { useEffect, useState } from "react";
import type { ApplePhotosStatus } from "@/types";
const phases: Record<string,string> = { idle: "已同步，等待新增照片", scanning: "正在检查图库", downloading: "正在读取原片（iCloud 照片可能需要下载）", indexing: "正在建立索引，已完成的照片可以搜索", waiting: "等待当前任务完成后继续", paused: "已暂停自动同步", error: "部分照片尚未同步，将自动重试" };
export function ApplePhotos({ onActive }: { onActive: (active: boolean) => void }) {
 const [status,setStatus] = useState<ApplePhotosStatus | null>(null);
 const [error,setError] = useState("");
 const [working,setWorking] = useState(false);
 useEffect(() => {
  if (!window.memories) return;
  let canceled = false;
  const update = async () => { try { const value = await window.memories.applePhotosStatus(); if (!canceled) { setStatus(value); onActive(value.enabled); } } catch { if (!canceled) setError("无法读取图库连接状态"); } };
  void update(); const timer = setInterval(() => void update(), 3000);
  return () => { canceled = true; clearInterval(timer); };
 }, [onActive]);
 const act = async (action: "connect" | "pause" | "sync") => {
  setWorking(true); setError("");
  try { const value = await (action === "connect" ? window.memories.applePhotosConnect() : action === "pause" ? window.memories.applePhotosPause() : window.memories.applePhotosSync()); setStatus(value); onActive(value.enabled); }
  catch (error) { setError(error instanceof Error ? error.message.replace(/^Error invoking remote method [^:]+: Error: /, "") : "连接失败，请重试"); }
  finally { setWorking(false); }
 };
 if (!window.memories || (status && !status.supported)) return null;
 return <section className="settings-section apple-photos-panel" style={{margin:"12px 0",padding:"12px",border:"1px solid var(--border, #d8dfd6)",borderRadius:12}}>
  <strong>Apple 照片图库</strong>
  <p style={{fontSize:12}}>连接系统图库，无需手动导出。big2 photo运行时每分钟检查新增照片，重启后继续同步。</p>
  {status && (status.enabled || status.indexed > 0) && <p role="status" style={{fontSize:12}}>{phases[status.phase] || status.phase} · 已处理 {status.indexed.toLocaleString()}{status.total ? ` / ${status.total.toLocaleString()}` : ""}{status.failed ? ` · ${status.failed} 项待重试` : ""}</p>}
  {status?.limited && <p>当前只获准访问部分照片。请在系统设置中允许访问全部照片。</p>}
  {(error || status?.error) && <p role="alert" style={{fontSize:12}}>{error || status?.error}</p>}
  <button className="secondary-button" disabled={working || !status} onClick={() => void act(status?.enabled ? "pause" : "connect")}>{working ? "正在连接…" : status?.enabled ? "暂停同步" : "连接整个照片图库"}</button>
  {status?.enabled && <button className="text-button" disabled={working} onClick={() => void act("sync")}>立即检查</button>}
  <p style={{fontSize:11}}>读取照片与视频原片，在big2 photo保存本地副本和索引。iCloud 原片会按需下载；不会修改或删除 Apple 图库内容。</p>
 </section>;
}
