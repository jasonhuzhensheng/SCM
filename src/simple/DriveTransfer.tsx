import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

type DriveState = { configured?: boolean; connected?: boolean };
export function DriveSettings() {
 const [state, setState] = useState<DriveState>({});
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState("");
 useEffect(() => { if (window.memories) void window.memories.driveStatus().then(r => r.ok ? setState(r) : setMessage(r.error || "无法读取连接状态")); }, []);
 async function action(kind: "configure" | "login" | "disconnect") {
  if (!window.memories) { setMessage("请在桌面版中连接 Google Drive。"); return; }
  setBusy(true); setMessage(kind === "login" ? "请在浏览器中完成 Google 授权，然后返回这里。" : "");
  try {
   const result = await (kind === "configure" ? window.memories.driveConfigure() : kind === "login" ? window.memories.driveLogin() : window.memories.driveDisconnect());
   if (!result.ok) throw new Error(result.error);
   if ("canceled" in result && result.canceled) { setMessage(""); return; }
   const next = await window.memories.driveStatus(); setState(next);
   setMessage(next.connected ? "Google Drive 已连接。" : kind === "disconnect" ? "已退出本机连接。" : "配置已就绪，请登录 Google Drive。");
  } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败，请重试。"); }
  finally { setBusy(false); }
 }
 return <div className="settings-section"><h3>Google Drive / 本地文件夹</h3><p>已安装 Google Drive？批量选择素材后，点击“复制到…”或“移动到…”，在系统窗口中选择 Google Drive 文件夹即可，无需再次登录。</p><p className="setting-note">复制完成表示文件已写入目标文件夹；云端同步进度请在 Google Drive 客户端查看。也可以选择其他网盘同步文件夹或外接硬盘。</p><details><summary>高级：直接上传云端（OAuth）</summary><h3>Google Drive 云端存储</h3><p>从搜索结果批量复制或移动到 Google Drive。每批会在“我的云端硬盘”中新建一个文件夹。</p><div className="setting-note">{state.connected ? "已连接 Google Drive" : state.configured ? "OAuth 配置已导入，尚未登录" : "首次使用需要导入桌面应用 OAuth 配置"}</div><div className="drive-actions"><button className="secondary-button" disabled={busy} onClick={() => void action("configure")}>导入 OAuth JSON</button><button className="primary-button" disabled={busy || !state.configured} onClick={() => void action(state.connected ? "disconnect" : "login")}>{busy && <IconLoader2 size={15} className="spin" />}{state.connected ? "退出连接" : "登录 Google Drive"}</button></div>{message && <p role="status">{message}</p>}<details><summary>没有配置文件？查看设置步骤</summary><ol className="drive-steps"><li>打开 <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud 控制台</a>，新建或选择项目。</li><li>在“API 和服务 → 库”中启用 Google Drive API。</li><li>在 Google Auth Platform 配置应用名称、联系邮箱和目标对象；如果处于测试状态，将自己的 Google 账号加入测试用户。</li><li>创建 OAuth 客户端，应用类型选择“桌面应用”，下载 JSON 文件。</li><li>点击上方“导入 OAuth JSON”，然后“登录 Google Drive”，在浏览器中同意授权。</li></ol><p>仅申请访问本软件创建或经本软件授权的文件。授权信息加密保存在本机；无需把 JSON 或令牌发给任何人。</p><a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">Google 官方授权说明</a></details></details></div>;
}

export function DriveTransfer({ filenames, onComplete, onSettings, onBusy }: { filenames: string[]; onComplete: (removed: string[]) => void; onSettings: () => void; onBusy: (busy: boolean) => void }) {
 const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
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
 const [progress, setProgress] = useState<{done: number; total: number; filename: string; percent: number} | null>(null);
 const ref = useRef<HTMLDivElement>(null); useFocusTrap(ref, open);
 useEffect(() => { if (!window.memories) return; return window.memories.onDriveProgress(setProgress); }, []);
 async function begin(next: "copy" | "move") {
  setError(""); setReport(null); setProgress(null); setBatch([...filenames]); setMode(next);
  setFolderName(`SCM 搜索结果 ${new Date().toLocaleDateString("sv-SE")}`); setOpen(true);
 }
 async function transfer() {
  if (!window.memories) { setError("请在桌面版中复制本地素材。"); return; }
  setBusy(true); onBusy(true); setError("");
  try {
   const result = await window.memories.driveTransfer({filenames: batch, mode, folderName, ...(destination === "folder" ? { destination: "folder" as const, folderToken: folder?.token } : {})});
   if (!result.ok) throw new Error(result.error || "传输失败");
   setReport(result);
   onComplete(mode === "move" ? (result.results || []).filter(r => r.ok).map(r => r.filename) : []);
  } catch (e) { setError(e instanceof Error ? e.message : "传输失败，请重试。"); }
  finally { setBusy(false); onBusy(false); }
 }
 const succeeded = report?.results?.filter(r => r.ok).length || 0;
 const failures = report?.results?.filter(r => !r.ok) || [];
 return <><button className="secondary-button" disabled={!filenames.length || busy} onClick={() => void begin("copy")}>复制到…</button><button className="secondary-button" disabled={!filenames.length || busy} onClick={() => void begin("move")}>移动到…</button>{open && <div className="modal-backdrop"><div className="settings-modal drive-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="drive-transfer-title" tabIndex={-1}><header><div><h2 id="drive-transfer-title">{mode === "move" ? "移动" : "复制"} {batch.length} 个文件</h2><p>复制完整文件，视频片段会复制对应的完整视频。</p></div><button className="icon-button" disabled={busy} onClick={() => setOpen(false)} aria-label="关闭传输窗口"><IconX size={20} /></button></header><div className="settings-body"><div className="settings-section"><label className="field-label" htmlFor="transfer-destination">目标位置</label><select id="transfer-destination" className="settings-select" value={destination} disabled={busy || !!report} onChange={e => { setDestination(e.target.value as "folder" | "cloud"); setError(""); }}><option value="folder">本机文件夹 / Google Drive 客户端（推荐）</option><option value="cloud">直接上传 Google Drive（需要 OAuth）</option></select>{destination === "folder" ? <><div className="drive-actions"><button className="secondary-button" disabled={busy || !!report} onClick={() => void pickFolder()}>选择目标文件夹</button></div><p className="drive-filename">{folder?.path || "在系统窗口中选择 Google Drive 内的文件夹。"}</p><p className="setting-note">每批新建独立文件夹，不覆盖已有文件。云端同步由 Google Drive 客户端完成。</p></> : <><label className="field-label" htmlFor="drive-folder">新建云端文件夹名称</label><input className="settings-select" id="drive-folder" value={folderName} maxLength={160} disabled={busy || !!report} onChange={e => setFolderName(e.target.value)} /></>}<p>{mode === "move" ? "复制并校验成功后，删除软件素材库副本及搜索记录；导入前的原文件不变。未成功的文件会保留。" : "复制一份副本，软件素材库及原文件保持不变。"}</p>{busy && <div role="status"><p>{progress ? `${progress.done} / ${progress.total} 个文件 · 当前文件 ${progress.percent}%` : "正在准备目标文件夹…"}</p><p className="drive-filename">{progress?.filename}</p><progress className="index-progress" max={100} value={progress ? (progress.done + progress.percent / 100) / progress.total * 100 : undefined} /></div>}{error && <p role="alert">{error}</p>}{report && <div role="status"><p>{report.canceled ? "已停止。" : "传输完成。"}成功 {succeeded} 个，失败 {failures.length} 个，未处理 {batch.length - (report.results?.length || 0)} 个。</p>{report.folderPath && <><p className="drive-filename">保存位置：{report.folderPath}</p><p>已完成本地写入；云端同步状态请查看 Google Drive 客户端。</p></>}{report.folderUrl && <a href={report.folderUrl} target="_blank" rel="noreferrer">打开云端文件夹</a>}{failures.length > 0 && <ul className="drive-errors">{failures.map(r => <li key={r.filename}>{r.filename}：{r.error}</li>)}</ul>}</div>}<div className="drive-actions">{busy ? <button className="secondary-button" onClick={() => void window.memories.driveCancel()}>停止传输</button> : report ? <button className="primary-button" onClick={() => setOpen(false)}>完成</button> : <>{destination === "cloud" && <button className="secondary-button" onClick={() => { setOpen(false); onSettings(); }}>连接账号 / 配置帮助</button>}<button className="primary-button" disabled={destination === "folder" ? !folder : !folderName.trim()} onClick={() => void transfer()}>{mode === "move" ? "确认移动并移出素材库" : "开始复制"}</button></>}</div></div></div></div></div>}</>;
}
