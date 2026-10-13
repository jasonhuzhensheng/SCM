import { useEffect, useState } from "react";
import type { ApplePhotosStatus } from "@/types";
const phases: Record<string,string> = { idle: "已同步，等待新增照片", scanning: "正在检查图库", downloading: "正在读取原片（iCloud 照片可能需要下载）", indexing: "正在建立索引，已完成的照片可以搜索", waiting: "等待当前任务完成后继续", paused: "已暂停自动同步", error: "部分照片尚未同步，将自动重试" };
function errorMessage(error: unknown) {
 const message = error instanceof Error ? error.message : typeof error === "string" ? error : "连接失败，请重试。";
 return message.replace(/^Error invoking remote method (['"]).*?\1:\s*(?:Error:\s*)?/s, "").replace(/^Error:\s*/, "");
}
export function ApplePhotos({ onActive, onAdd, addDisabled = false, addStatus = "" }: { onActive: (active: boolean) => void; onAdd: () => void; addDisabled?: boolean; addStatus?: string }) {
 const [status,setStatus] = useState<ApplePhotosStatus | null>(null);
 const [error,setError] = useState("");
 const [working,setWorking] = useState(false);
 useEffect(() => {
  if (!window.memories) return;
  let canceled = false;
  const update = async () => { try { const value = await window.memories.applePhotosStatus(); if (!canceled) { setStatus(value); onActive(value.enabled && !value.referenceOnly); } } catch { if (!canceled) setError("无法读取图库连接状态"); } };
  void update(); const timer = setInterval(() => void update(), 3000);
  return () => { canceled = true; clearInterval(timer); };
 }, [onActive]);
 const act = async (action: "connect" | "pause" | "sync") => {
  if (!status || status.referenceOnly || working) return;
  setWorking(true); setError("");
  try { const value = await (action === "connect" ? window.memories.applePhotosConnect() : action === "pause" ? window.memories.applePhotosPause() : window.memories.applePhotosSync()); setStatus(value); onActive(value.enabled && !value.referenceOnly); }
  catch (error) { setError(errorMessage(error)); }
  finally { setWorking(false); }
 };
 if (!window.memories || (status && !status.supported)) return null;
 return <section className="settings-section apple-photos-panel" style={{margin:"12px 0",padding:"12px",border:"1px solid var(--border, #d8dfd6)",borderRadius:12}}>
  <strong>Apple 照片图库</strong>
  <p style={{fontSize:12}}>{!status ? "正在读取图库连接状态…" : status.referenceOnly ? "仅引用模式已关闭 Apple 照片自动导出。" : "直接读取 Apple 照片图库中的照片和视频，无需手动选择文件；首次连接需要系统授权。"}</p>
  {status && !status.referenceOnly && (status.enabled || status.indexed > 0) && <p role="status" style={{fontSize:12}}>{phases[status.phase] || status.phase} · 已处理 {status.indexed.toLocaleString()}{status.total ? ` / ${status.total.toLocaleString()}` : ""}{status.failed ? ` · ${status.failed} 项待重试` : ""}</p>}
  {!status?.referenceOnly && status?.limited && <p>当前只获准访问部分照片。请在系统设置中允许访问全部照片。</p>}
  {(error || status?.error) && <p role="alert" style={{fontSize:12}}>{errorMessage(error || status?.error)}</p>}
  {status?.referenceOnly ? <button className="secondary-button" disabled={addDisabled} onClick={onAdd}>添加原文件</button> : <button className="secondary-button" disabled={working || !status} onClick={() => void act(status?.enabled ? "pause" : "connect")}>{working ? "正在连接…" : status?.enabled ? "暂停同步" : "连接并导入 Apple 照片图库"}</button>}
  {!status?.referenceOnly && status?.enabled && <button className="text-button" disabled={working} onClick={() => void act("sync")}>立即检查</button>}
  {status?.referenceOnly && addStatus && <p role="status" style={{fontSize:11}}>{addStatus}</p>}
  {status && <p style={{fontSize:11}}>{status.referenceOnly ? "选择本机可读取的照片、视频或文件夹。仅保存文件引用，不复制素材；请保留原文件与路径。" : "导入会在本应用保存用于检索的素材副本，不修改 Apple 照片原片。iCloud 原片可能需要下载并占用本机空间；可随时暂停同步。"}</p>}
 </section>;
}
