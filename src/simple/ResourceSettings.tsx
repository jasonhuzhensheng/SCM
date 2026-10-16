import { useEffect, useState } from "react";
import type { ResourceStatus } from "../types";
const size = (bytes: number | null) => bytes == null ? "未知" : `${(bytes / 2 ** 30).toFixed(1)} GiB`;

export function ResourceSettings({ firstRun = false }: { firstRun?: boolean }) {
	const [status, setStatus] = useState<ResourceStatus>();
	const [dismissed, setDismissed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		if (!window.memories?.getResourceStatus) return;
		let active = true;
		const read = () => { void window.memories.getResourceStatus().then(value => { if (active) setStatus(value); }).catch(() => { if (active) setError("无法评估资源，请在设置中重试。"); }); };
		read(); window.addEventListener("resource-settings-changed", read);
		return () => { active = false; window.removeEventListener("resource-settings-changed", read); };
	}, []);
	if (!window.memories?.getResourceStatus || dismissed || (firstRun && (!status || status.acknowledged))) return null;
	const act = async (action: () => Promise<ResourceStatus>) => {
		setBusy(true); setError("");
		try { setStatus(await action()); window.dispatchEvent(new Event("resource-settings-changed")); } catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试。"); }
		finally { setBusy(false); }
	};
	const body = <div className="settings-section">
		<h3>{firstRun ? "已为这台电脑匹配后台方案" : "后台处理与存储"}</h3>
		<p>新安装默认自动分配进程，搜索时让后台稍候。已有手动设置会保留。</p>
		{status && <>
			<p>{status.performance.cores} 核 CPU · {status.performance.memoryGiB} GiB 内存 · 下批最多 {status.performance.effective} 个进程</p>
			<label className="field-label" htmlFor={firstRun ? "first-resource-mode" : "resource-mode"}>处理方案</label>
			<select id={firstRun ? "first-resource-mode" : "resource-mode"} className="settings-select" value={status.performance.mode} disabled={busy} onChange={event => void act(() => window.memories.setResourceMode(event.target.value as "auto" | "economy" | "manual"))}>
				<option value="auto">自动 · 保守并发</option><option value="economy">省资源 · 单进程</option><option value="manual">手动 · 使用进程上限</option>
			</select>
			<p className="setting-note">已入库 {status.plan.count == null ? "数量待统计" : `${status.plan.count.toLocaleString()} 项`}。这里只读取已有索引计数，不扫描全盘。</p>
			{status.pending && <p>本批待处理 {status.pending.count.toLocaleString()} 项 · 原件逻辑大小 {size(status.pending.sourceBytes)}</p>}
			<p>资料库所在卷可用 {size(status.plan.freeBytes)} · 估算预留 {size(status.plan.reserveBytes)}</p>
			{status.plan.deficitBytes != null && status.plan.deficitBytes > 0 && <p role="status">还缺约 {size(status.plan.deficitBytes)}。建议选择有足够空间的外置磁盘，在文件传输中复制或移动选定素材。</p>}
			{status.gate.waitingReason && <p role="status">后台：{status.gate.waitingReason}</p>}
			{status.plan.recommendedExternalBytes != null && <p>本批复制至外置盘，建议可用空间至少 {size(status.plan.recommendedExternalBytes)}（含估算余量）。</p>}
			<p className="setting-note">预留为当前索引检查点及临时写入的估算，不含全部原件、模型下载或完整备份。完整原件大小未统计，外置容量建议只覆盖已评估批次。</p>
			{status.target && <p style={{ overflowWrap: "anywhere" }}>传输首选位置：{status.target.directory}<br />{status.target.online ? `可用 ${size(status.target.freeBytes)}` : "等待原磁盘连接"}</p>}
			<button className="secondary-button" disabled={busy} onClick={() => void act(() => window.memories.chooseStorageTarget())}>选择存储文件夹…</button>{" "}
			<button className="text-button" disabled={busy} onClick={() => void act(() => window.memories.getResourceStatus())}>重新评估</button>
			<p className="setting-note">选择位置只设置传输文件夹的默认路径。复制或移动仍需在素材列表中选择文件并执行；不会自动迁移数据库或原件。系统内存压力尚未接入，卡顿时可切换省资源。</p>
		</>}
		{error && <p role="alert">{error}</p>}
		{firstRun && <button className="primary-button" disabled={busy} onClick={async () => {
			setBusy(true);
			try { await window.memories.acknowledgeResourceSetup(); setDismissed(true); } catch { setError("设置未保存，请检查可用空间后重试。"); } finally { setBusy(false); }
		}}>开始使用</button>}
	</div>;
	return firstRun ? <div className="modal-backdrop"><section className="settings-modal" role="dialog" aria-modal="true" aria-label="首次资源评估" style={{ maxHeight: "85vh", overflowY: "auto", maxWidth: 620, padding: 24 }}>{body}</section></div> : body;
}
