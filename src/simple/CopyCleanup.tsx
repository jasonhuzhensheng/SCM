import { useEffect, useState } from "react";
import { formatFileSize } from "./assetFilters";

type Status = Awaited<ReturnType<Window["memories"]["copyCleanupStatus"]>>;
const reasons: Record<string,string> = {reference:"已是原文件引用",permission:"无读取权限",missing:"文件缺失",different:"内容不同",changed:"文件正在变化",internal:"原路径位于素材库内",failed:"读取失败"};
export function CopyCleanup({ filesLocked = false }: { filesLocked?: boolean }) {
 const [status,setStatus] = useState<Status>();
 const [importState,setImportState] = useState<Awaited<ReturnType<Window["memories"]["getImportState"]>>>();
 const [importPending,setImportPending] = useState(false);
 const [error,setError] = useState("");
 const [pending,setPending] = useState(false);
 useEffect(() => {
  if (!window.memories) return;
  let active = true;
  const refresh = async () => { try { const [value, currentImport] = await Promise.all([window.memories.copyCleanupStatus(),window.memories.getImportState()]); if(active) {setStatus(value);setImportState(currentImport);} } catch { if(active) setError("无法读取清理状态，请重试或重新打开设置。"); } };
  void refresh(); const timer = setInterval(() => void refresh(),1000);
  return () => {active = false;clearInterval(timer);};
 },[]);
 return <div className="settings-section delete-notice"><h3>清理素材副本</h3>{filesLocked && <p className="setting-note">文件已锁定，解除锁定后才能清理副本。</p>}<p>由 App 校验原文件和副本的完整内容，一致后删除副本并改为引用原文件。保留搜索索引，无需重新建立。</p><p className="setting-note">请保留原文件与路径。缺失、无法读取或内容不同的副本不会删除。APFS 可能共享数据块，处理的文件大小不等于实际释放空间。</p>
 {!window.memories ? <p>此功能在桌面版中使用。</p> : <>
 <div className="setting-note" role="status">{!importState ? "正在读取导入状态…" : !importState.active ? "当前没有正在进行的素材导入，可直接校验副本。" : importState.paused ? "导入已暂停；当前处理项完成后即可清理。" : "素材正在导入，请先暂停后再清理。"}</div>
 {importState?.active && <button className="secondary-button" disabled={importPending || pending || status?.running} onClick={async () => {setImportPending(true);setError("");try {setImportState(await window.memories.setImportPaused(!importState.paused));}catch(error){setError(error instanceof Error ? error.message : "无法更改导入状态，请重试。");}finally{setImportPending(false);}}}>{importPending ? "正在更新…" : importState.paused ? "继续导入" : "暂停导入"}</button>}
 <button className="secondary-button delete-action" disabled={filesLocked || pending || !status || status.running} onClick={async () => {setPending(true);setError("");try {const result=await window.memories.copyCleanupStart();if(!result.ok)setError(result.error || "无法启动清理");setStatus(await window.memories.copyCleanupStatus());}catch {setError("无法启动清理，请重试。");}finally{setPending(false);}}}>{pending ? "正在准备…" : status?.running ? "正在校验并清理…" : "校验并删除副本"}</button>
 {status?.running && <button className="text-button" onClick={async () => {try {await window.memories.copyCleanupCancel();}catch{setError("停止失败，请重试。");}}}>停止清理</button>}
 {status && status.total > 0 && <div role="status"><p>{status.running ? "清理中" : status.cancelled ? "已停止" : status.error ? "清理中断" : "清理完成"}：{status.done.toLocaleString()} / {status.total.toLocaleString()}</p><progress value={status.done} max={status.total} style={{width:"100%"}} /><p>已删除 {status.converted.toLocaleString()} 个副本 · 文件内容 {formatFileSize(status.bytes)}</p>{Object.entries(status.reasons).map(([reason,count]) => <p key={reason}>{reasons[reason] || reason}：{count.toLocaleString()}</p>)}</div>}
 {!!status?.reasons.permission && <p>请在 macOS 系统设置 → 隐私与安全性 → 完全磁盘访问权限中允许 SayPhoto，退出并重新打开 App 后再次清理。需要授权的是本 App，无需 Codex。</p>}
 {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
 </>}
 </div>;
}
