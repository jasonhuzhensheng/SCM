import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconChevronUp, IconLoader2, IconX } from "@tabler/icons-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

import type { TransferProgress } from "@/types";

type DriveState = { configured?: boolean; connected?: boolean; metadataConnected?: boolean };
export function DriveSettings() {
 const [state, setState] = useState<DriveState>({});
 const [busy, setBusy] = useState(false);
 const [actionKind, setActionKind] = useState("");
 const [message, setMessage] = useState("");
 useEffect(() => { if (window.memories) void window.memories.driveStatus().then(r => r.ok ? setState(r) : setMessage(r.error || "无法读取连接状态")); }, []);
 async function action(kind: "configure" | "login" | "disconnect") {
  if (!window.memories) { setMessage("请在桌面版中连接 Google Drive。"); return; }
  setBusy(true); setActionKind(kind); setMessage(kind === "login" ? "请在浏览器中完成 Google 授权，然后返回这里。" : kind === "configure" ? "请在当前窗口的文件选择面板中选择下载的 JSON；按 Esc 可取消。" : "");
  try {
   const result = await (kind === "configure" ? window.memories.driveConfigure() : kind === "login" ? window.memories.driveLogin() : window.memories.driveDisconnect());
   if (!result.ok) throw new Error(result.error);
   if ("canceled" in result && result.canceled) { setMessage(""); return; }
   const next = await window.memories.driveStatus(); setState(next);
   setMessage(next.connected ? "Google Drive 已连接。" : kind === "disconnect" ? "已退出本机连接。" : "配置已就绪，请登录 Google Drive。");
  } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败，请重试。"); }
  finally { setBusy(false); }
 }
 return <div className="settings-section"><h3>Google Drive / 本地文件夹</h3><p>已安装 Google Drive？批量选择素材后，点击“复制到…”或“移动到…”，在系统窗口中选择 Google Drive 文件夹即可，无需再次登录。</p><p className="setting-note">复制完成表示文件已写入目标文件夹；云端同步进度请在 Google Drive 客户端查看。也可以选择其他网盘同步文件夹或外接硬盘。</p><details><summary>高级：直接上传云端（OAuth）</summary><h3>Google Drive 云端存储</h3><p>从搜索结果批量复制或移动到 Google Drive。每批会在“我的云端硬盘”中新建一个文件夹。</p><div className="setting-note">{state.metadataConnected ? "已连接：支持云端完整性校验" : state.connected ? "已连接；需重新授权云端元数据读取" : state.configured ? "OAuth 配置已导入，尚未登录" : "首次使用需要导入桌面应用 OAuth 配置"}</div><div className="drive-actions"><button className="secondary-button" disabled={busy} onClick={() => void action("configure")}>{busy && actionKind === "configure" ? "等待选择 JSON…" : "导入 OAuth JSON"}</button><button className="primary-button" disabled={busy || !state.configured} onClick={() => void action(state.metadataConnected ? "disconnect" : "login")}>{busy && actionKind === "login" && <IconLoader2 size={15} className="spin" />}{state.metadataConnected ? "退出连接" : state.connected ? "授权云端校验" : "登录 Google Drive"}</button></div>{message && <p role="status">{message}</p>}<details><summary>没有配置文件？查看设置步骤</summary><ol className="drive-steps"><li>打开 <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud 控制台</a>，新建或选择项目。</li><li>在“API 和服务 → 库”中启用 Google Drive API。</li><li>在 Google Auth Platform 配置应用名称、联系邮箱和目标对象；如果处于测试状态，将自己的 Google 账号加入测试用户。</li><li>创建 OAuth 客户端，应用类型选择“桌面应用”，下载 JSON 文件。</li><li>点击上方“导入 OAuth JSON”，然后“登录 Google Drive”，在浏览器中同意授权。</li></ol><p>上传权限用于本软件创建的文件；云端校验还需读取云端硬盘文件元数据（名称、大小及校验值）。授权信息加密保存在本机；无需把 JSON 或令牌发给任何人。</p><a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">Google 官方授权说明</a></details></details></div>;
}

function bytes(value = 0) {
 const units = ["B", "KB", "MB", "GB", "TB"];
 let n = value, unit = 0;
 while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
 return `${n.toFixed(unit ? 2 : 0)} ${units[unit]}`;
}
function progressSummary(p: TransferProgress) {
 return p.phase === "index-cleanup" ? `正在更新列表和索引 ${p.done}/${p.total}` : `已复制 ${p.copied ?? p.done}/${p.total} · 已校验 ${p.verified ?? p.done}/${p.total}`;
}
export function TransferDetails({ progress: p, mode, paused = false }: { progress: TransferProgress; mode?: string; paused?: boolean }) {
 const phase = ({ identifying: "正在识别照片原件（内容校验，尚未复制或删除）", "copying-first": "优先复制全部主文件，检查稍后进行", recopying: "校验不一致，正在重新复制此文件", copying: "正在传输", verifying: "正在检查文件", resources: "正在核对原件及处理配套资源", prepared: "当前文件已校验，继续准备下一项", "cloud-auth": "等待连接 Google Drive 云端校验，原件保留", "cloud-verifying": "等待同步并核对 Google Drive 云端 SHA-256 与大小", "release-local": "本批移动完成，等待在访达移除本地下载", "final-verification": "整批文件最终复核中", deleting: "等待系统删除确认或处理结果", preparing: "正在准备", "index-cleanup": "删除已确认，正在更新列表和索引", finished: "当前文件已完成" } as Record<string, string>)[p.phase || "preparing"] || "正在处理";
 const activeBytes = p.phase === "identifying" || p.phase === "copying" || p.phase === "copying-first" || p.phase === "recopying" || p.phase === "verifying";
 return <div role="status">
  <p>{progressSummary(p)}</p>
  {!!p.verificationConcurrency && <p>后台并行校验：{p.activeVerifications ?? 0} / {p.verificationConcurrency} · 最多 {p.verificationConcurrency} 个原生进程</p>}
  {p.cloudVerified !== undefined && <p>云端已核验 {p.cloudVerified} 项 · 已释放本地下载 {p.localReleased ?? 0} 项</p>}
  <p>主文件已传输 {bytes(p.transferredBytes)} / {bytes(p.totalBytes)} · {(p.overallPercent ?? 0).toFixed(1)}%</p>
  <progress className="index-progress" max={100} value={p.overallPercent ?? 0} aria-label="主文件传输进度" />
  <p>{paused ? "暂停前：" : ""}{phase}{activeBytes ? ` · ${p.percent}% · ${bytes(p.currentBytes)} / ${bytes(p.currentTotal)}` : ""}</p>
  {activeBytes && <progress className="index-progress" max={100} value={p.percent} aria-label="当前阶段进度" />}
  {!!p.releaseNames?.length && <><p>仅移除本批以下文件及其配套资源文件夹的下载：</p><ul>{p.releaseNames.map(name=><li key={name} className="drive-filename">{name}</li>)}</ul></>}
  {p.filename && <p className="drive-filename">{p.filename}</p>}
  {!!p.issues?.length && <details open><summary>单独处理 {p.issues.length} 项（不阻塞其他文件校验）</summary><ul className="drive-errors">{p.issues.map(item=><li key={item.filename}>{item.retained ? "保留原件" : "失败"} · {item.filename}：{item.error}</li>)}</ul></details>}
  <p>已处理 {p.done} / {p.total} 个{mode === "move" ? ` · 移动成功 ${p.moved ?? p.done} 个` : ""}。配套资源另行处理；传输 100% 后仍可能需要校验及系统确认。</p>
 </div>;
}

export function DriveTransfer({ filesLocked = false, filenames, onComplete, onSettings, onBusy, progressStatus }: { filesLocked?: boolean; progressStatus?: ReactNode; filenames: string[]; onComplete: (removed: string[], notice?: string) => void; onSettings: () => void; onBusy: (busy: boolean) => void }) {
 const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
 const [started, setStarted] = useState(false);
 const [mode, setMode] = useState<"copy" | "move">("copy");
 const [batch, setBatch] = useState<string[]>([]);
 const [folderName, setFolderName] = useState("");
 const [destination, setDestination] = useState<"folder" | "cloud">("folder");
 const [folder, setFolder] = useState<{ path: string; token: string } | null>(null);
 async function pickFolder() {
  if (!window.memories) { setError("请在桌面版中选择目标文件夹。"); return; }
  try { const r = await window.memories.pickTransferFolder(); if (!r.ok) throw Error(r.error); if (!r.canceled && r.folderPath && r.token) { setFolder({ path: r.folderPath, token: r.token }); setError(""); } }
  catch (e) { setError(e instanceof Error ? e.message : "无法选择文件夹"); }
 }
 const [error, setError] = useState("");
 const [report, setReport] = useState<Awaited<ReturnType<typeof window.memories.driveTransfer>> | null>(null);
 const [progress, setProgress] = useState<TransferProgress | null>(null);
 const [recovered, setRecovered] = useState<Awaited<ReturnType<typeof window.memories.fileTasks>>[number] | null>(null);
 const [recoveredOpen, setRecoveredOpen] = useState(false);
 const recoveredRef = useRef<HTMLDivElement>(null);
 const localTransfer = useRef(false);
 const callbacks = useRef({ onBusy, onComplete });
 callbacks.current = { onBusy, onComplete };
 useEffect(() => {
  if (!window.memories?.fileTasks) return;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  let recoveredId: string | null = null;
  async function refreshTask() {
   try {
    const tasks = await window.memories.fileTasks();
    if (disposed) return;
    const task = tasks.find(t => t.kind === "transfer" && t.status === "running") || tasks.find(t => t.kind === "transfer" && ["running", "queued", "waiting", "pausing", "paused"].includes(t.status));
    if (localTransfer.current) { if (task?.progress) setProgress(task.progress); return; }
    if (task) {
     recoveredId = task.id;
     setRecovered(task);
     setStarted(false);
     callbacks.current.onBusy(!["paused"].includes(task.status));
    } else if (recoveredId) {
     const finished = tasks.find(t => t.id === recoveredId);
     setRecovered(finished || null);
     callbacks.current.onBusy(false);
     callbacks.current.onComplete([]);
     recoveredId = null;
    }
   } catch { /* Keep the last known task visible if reading temporarily fails. */ }
   finally { if (!disposed) timer = setTimeout(() => void refreshTask(), 1500); }
  }
  void refreshTask();
  return () => { disposed = true; clearTimeout(timer); };
 }, []);
 const recovering = !!recovered && ["running", "queued", "waiting"].includes(recovered.status);
 const ref = useRef<HTMLDivElement>(null); useFocusTrap(ref, open && !started);
 useEffect(() => { if (!window.memories) return; return window.memories.onDriveProgress(setProgress); }, []);
 async function begin(next: "copy" | "move") {
  if (filesLocked && next === "move") return;
  setRecoveredOpen(false); setRecovered(null); setStarted(false); setError(""); setReport(null); setProgress(null); setBatch([...filenames]); setMode(next);
  setFolderName(`SayPhoto 搜索结果 ${new Date().toLocaleDateString("sv-SE")}`); setOpen(true);
 }
 async function transfer() {
  if (filesLocked && mode === "move") { setError("文件已锁定，请先解除锁定。"); return; }
  if (!window.memories) { setError("请在桌面版中复制本地素材。"); return; }
  localTransfer.current = true; setBusy(true); onBusy(true); setError(""); setStarted(true); setOpen(false); setProgress(null);
  try {
   const result = await window.memories.driveTransfer({filenames: batch, mode, folderName, ...(destination === "folder" ? { destination: "folder" as const, folderToken: folder?.token } : {})});
   if (!result.ok && result.staleFilenames?.length) {
    const stale = new Set(result.staleFilenames.filter(name => batch.includes(name)));
    const remaining = batch.filter(name => !stale.has(name));
    const notice = `列表已更新：移除 ${stale.size} 项已删除或失效的选择，未执行本次传输。`;
    setBatch(remaining); setStarted(false); setOpen(remaining.length > 0); setProgress(null);
    setError(remaining.length ? `${notice}剩余 ${remaining.length} 项，请核对后再确认。` : "");
    onComplete([...stale], notice);
    return;
   }
   if (!result.ok) throw new Error(result.error || "传输失败");
   if (result.paused) { setReport(null); setStarted(false); setOpen(false); setRecoveredOpen(true); } else setReport(result);
   onComplete(mode === "move" ? (result.results || []).filter(r => r.ok).map(r => r.filename) : []);
  } catch (e) { setError(e instanceof Error ? e.message : "传输失败，请重试。"); }
  finally { localTransfer.current = false; setBusy(false); onBusy(false); }
 }
 const label = mode === "move" ? "移动" : "复制";
 const summary = busy ? (progress ? progressSummary(progress) : "正在准备…") : error ? "传输失败 · 点击查看" : report?.canceled ? "已停止 · 点击查看" : "传输完成 · 点击查看";
 const percent = progress ? progress.overallPercent ?? 0 : 0;
 const dismiss = () => { setOpen(false); setStarted(false); };
 const succeeded = report?.results?.filter(r => r.ok).length || 0;
 const skipped = report?.results?.filter(r => r.skipped).length || 0;
 const failures = report?.results?.filter(r => !r.ok && !r.skipped) || [];
 return <><button className="secondary-button" disabled={filenames.length > 10000 || !filenames.length || busy || recovering} onClick={() => void begin("copy")}>复制到…</button><button className="secondary-button" disabled={filenames.length > 10000 || filesLocked || !filenames.length || busy || recovering} onClick={() => void begin("move")}>移动到…</button>{createPortal(<div className="task-status-stack">{progressStatus}{recovered && !started && <><button className="transfer-status-tab" aria-expanded={recoveredOpen} aria-controls="recovered-transfer-details" onClick={() => setRecoveredOpen(value => !value)}>{recovering && <IconLoader2 size={17} className="spin" />}<span><strong>{recovered.repairOriginals ? "移动后删除原文件" : recovered.mode === "move" ? "移动原文件" : "复制到目标"} {recovered.total} 个文件</strong><small>{recovered.progress ? progressSummary(recovered.progress) : `${recovered.done} / ${recovered.total} 个文件`} · {recovered.status === "running" ? "正在处理" : recovered.status === "waiting" || recovered.status === "queued" ? "等待继续" : recovered.status === "paused" ? "已暂停" : recovered.status === "pausing" ? "正在暂停" : recovered.status === "cancelled" ? "已结束" : "已完成"}</small></span>{recoveredOpen ? <IconChevronDown size={18} /> : <IconChevronUp size={18} />}{recovering && <progress max={100} value={recovered.progress?.overallPercent ?? 0} aria-label="恢复的传输进度" />}</button>{recoveredOpen && <div className="transfer-panel-anchor"><div id="recovered-transfer-details" className="settings-modal drive-modal transfer-side-panel" ref={recoveredRef} role="dialog" aria-labelledby="recovered-transfer-title" tabIndex={-1}><header><h2 id="recovered-transfer-title">{recovered.repairOriginals ? "移动后删除原文件" : recovered.mode === "move" ? "移动原文件" : "复制文件"}详情</h2><button className="icon-button" aria-label="收起传输详情" onClick={() => setRecoveredOpen(false)}><IconChevronDown size={18} /></button></header><div className="settings-body"><div className="settings-section"><p>目标位置</p><p className="drive-filename">{recovered.destination || "目标位置不可用"}</p>{recovered.cloudVerifiedMove && <p className="setting-note">省空间模式：每批最多 5 项、主文件约 2 GiB。云端内容核验后才删除原件；本批完成后在访达“移除下载”，释放后继续。单个超大文件及配套资源可能超过此上限。</p>}<p role="status">已处理 {recovered.done} / {recovered.total} 个 · 成功 {recovered.succeeded ?? recovered.done} 个 · 失败 {recovered.failed ?? 0} 个 · 跳过 {recovered.skipped ?? 0} 个</p>{recovered.progress && <TransferDetails progress={recovered.progress} mode={recovered.mode} paused={recovered.status === "paused" || recovered.status === "pausing"} />}{recovered.error && <p role="alert" className="delete-text">{recovered.error}</p>}<p>{recovered.status === "paused" ? "已暂停，进度已保存；可继续或结束任务。" : recovered.status === "pausing" ? "正在保存进度，请稍候。" : recovered.status === "cancelled" ? "已结束，未处理的原文件保持不变。" : recovered.status === "complete" ? "任务已完成。" : recovered.status === "waiting" || recovered.status === "queued" ? "等待条件满足后继续。" : "正在校验并处理文件。"}</p>{recovered.mode === "move" && <p className="delete-text">{recovered.cloudVerifiedMove ? "本批主文件及配套资源的Google Drive云端大小与SHA-256均核验成功后" : "目标系统复制及大小检查成功后"}，普通原文件进入废纸篓；Apple照片通过系统图库删除并进入“最近删除”，可能同步到iCloud及其他设备，再移除搜索记录。Live Photo、RAW的配套资源也会完整保存到目标后一起删除；不保留素材库副本。</p>}<div className="drive-actions">{recovered.cloudVerifiedMove && <><button className="secondary-button" onClick={onSettings}>连接云端校验 / 设置</button><button className="secondary-button" onClick={()=>void window.memories.revealFileTask(recovered.id)}>在访达查看目标</button></>}{recovering ? <button className="secondary-button" onClick={() => void window.memories.pauseFileTask(recovered.id)}>暂停传输</button> : recovered.status === "paused" ? <><button className="primary-button" onClick={() => void window.memories.resumeFileTask(recovered.id)}>继续</button><button className="secondary-button" onClick={() => void window.memories.cancelFileTask(recovered.id)}>结束任务</button></> : recovered.status === "pausing" ? <button className="secondary-button" disabled>正在暂停…</button> : <button className="primary-button" onClick={() => { setRecoveredOpen(false); setRecovered(null); }}>完成</button>}</div></div></div></div></div>}</>}{started && <button className="transfer-status-tab" aria-expanded={open} aria-controls="transfer-details" onClick={() => setOpen(value => !value)}>{busy && <IconLoader2 size={17} className="spin" />}<span><strong>{label} {batch.length} 个文件</strong><small>{summary}</small></span>{open ? <IconChevronDown size={18} /> : <IconChevronUp size={18} />}{busy && <progress max={100} value={percent} aria-label="整体传输进度" />}</button>}{open && <div className={started ? "transfer-panel-anchor" : "modal-backdrop"}><div id="transfer-details" className={`settings-modal drive-modal${started ? " transfer-side-panel" : ""}`} ref={ref} role="dialog" aria-modal={started ? undefined : true} aria-labelledby="drive-transfer-title" tabIndex={-1}><header><div><h2 id="drive-transfer-title">{mode === "move" ? "移动" : "复制"} {batch.length} 个文件</h2><p>复制完整文件，视频片段会复制对应的完整视频。</p></div><button className="icon-button" onClick={() => setOpen(false)} aria-label={started ? "收起到右侧状态栏" : "关闭传输窗口"}>{started ? <IconChevronDown size={20} /> : <IconX size={20} />}</button></header><div className="settings-body"><div className="settings-section"><label className="field-label" htmlFor="transfer-destination">目标位置</label><select id="transfer-destination" className="settings-select" value={destination} disabled={busy || !!report} onChange={e => { setDestination(e.target.value as "folder" | "cloud"); setError(""); }}><option value="folder">本机文件夹 / Google Drive 客户端（推荐）</option><option value="cloud">直接上传 Google Drive（需要 OAuth）</option></select>{destination === "folder" ? <><div className="drive-actions"><button className="secondary-button" disabled={busy || !!report} onClick={() => void pickFolder()}>选择目标文件夹</button></div><p className="drive-filename">{folder?.path || "在系统窗口中选择 Google Drive 内的文件夹。"}</p><p className="setting-note">每批新建独立文件夹，不覆盖已有文件。云端同步由 Google Drive 客户端完成。</p></> : <><label className="field-label" htmlFor="drive-folder">新建云端文件夹名称</label><input className="settings-select" id="drive-folder" value={folderName} maxLength={160} disabled={busy || !!report} onChange={e => setFolderName(e.target.value)} /></>}<p className={mode === "move" ? "delete-text" : undefined}>{mode === "move" ? "目标文件写入并检查成功后，普通原文件移入废纸篓；Apple照片从系统图库删除、进入“最近删除”，可能同步到iCloud及其他设备；移除文件引用及搜索记录，并累计删除数量和大小。Live Photo的照片和视频、RAW及配套资源会一并保存并校验，全部成功才删除原项目。失败时保留原文件。本地使用系统复制及大小、文件状态检查，不做逐字节比对。使用网盘同步文件夹时，不代表已上传云端。" : "将原文件复制到目标位置，原文件保持不变；软件不额外保存素材副本。"}</p>{busy && (progress ? <TransferDetails progress={progress} mode={mode} /> : <p role="status">正在准备目标文件夹…</p>)}{error && <p role="alert" className={mode === "move" ? "delete-text" : undefined}>{error}</p>}{report && <div role="status"><p>{report.canceled ? "已停止。" : "传输完成。"}成功 {succeeded} 个，失败 {failures.length} 个，跳过 {skipped} 个，未处理 {batch.length - (report.results?.length || 0)} 个。</p>{report.folderPath && <><p className="drive-filename">保存位置：{report.folderPath}</p><p>已完成本地写入；云端同步状态请查看 Google Drive 客户端。</p></>}{report.folderUrl && <a href={report.folderUrl} target="_blank" rel="noreferrer">打开云端文件夹</a>}{failures.length > 0 && <ul className={`drive-errors${mode === "move" ? " delete-text" : ""}`}>{failures.map(r => <li key={r.filename}>{r.filename}：{r.error}</li>)}</ul>}</div>}<div className="drive-actions">{busy ? <button className="secondary-button" onClick={() => void window.memories.drivePause()}>暂停传输</button> : report ? <button className="primary-button" onClick={dismiss}>完成</button> : <>{destination === "cloud" && <button className="secondary-button" onClick={() => { setOpen(false); onSettings(); }}>连接账号 / 配置帮助</button>}<button className={`primary-button${mode === "move" ? " delete-action" : ""}`} disabled={!batch.length || (filesLocked && mode === "move") || (destination === "folder" ? !folder : !folderName.trim())} onClick={() => void transfer()}>{mode === "move" ? "确认移动并删除本机原文件" : "开始复制"}</button></>}</div></div></div></div></div>}</div>, document.body)}</>;
}
