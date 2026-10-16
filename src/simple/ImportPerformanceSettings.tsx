import { useEffect, useState } from "react";
import type { ImportPerformance } from "../types";

export function ImportPerformanceSettings() {
	const [profile, setProfile] = useState<ImportPerformance>();
	const [value, setValue] = useState("1");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const available = !!window.memories?.getImportPerformance;
	useEffect(() => {
		if (!available) return;
		let mounted = true;
		const read = () => { void window.memories.getImportPerformance().then(result => {
			if (mounted) { setProfile(result); setValue(String(result.configured)); }
		}).catch(() => { if (mounted) setError("无法读取进程设置，请重新打开设置。"); }); };
		read(); window.addEventListener("resource-settings-changed", read);
		return () => { mounted = false; window.removeEventListener("resource-settings-changed", read); };
	}, [available]);
	const count = Number(value);
	const valid = value.trim() !== "" && Number.isInteger(count) && count >= 1 && count <= (profile?.max ?? 32);
	const save = async (processes: number) => {
		setPending(true); setError(""); setMessage("");
		try {
			const result = await window.memories.setImportProcesses(processes);
			setProfile(result); setValue(String(result.configured));
			window.dispatchEvent(new Event("resource-settings-changed"));
			setMessage(`已保存，下批素材最多使用 ${result.effective} 个进程。`);
		} catch { setError("保存失败，原设置保留，请重试。"); }
		finally { setPending(false); }
	};
	return <div className="settings-section">
		<h3>添加素材性能</h3>
		<p>后台并行处理素材，可根据电脑负载调整进程数量。进程过多可能争抢 CPU 和内存，并不一定更快。</p>
		{!available ? <p className="setting-note">桌面版可读取系统配置并推荐进程数量。</p> : <>
			{profile && <p className="setting-note">本机 {profile.cores} 核 CPU · {profile.memoryGiB} GB 内存，推荐 {profile.recommended} 个进程。预留系统资源后，本机最多使用 {profile.safeMax} 个。</p>}
			<label className="field-label" htmlFor="import-processes">添加素材进程数</label>
			<input id="import-processes" className="settings-select" type="number" min={1} max={profile?.max ?? 32} step={1} value={value} disabled={pending || !profile} aria-describedby="import-processes-help" onChange={event => { setValue(event.target.value); setMessage(""); }} />
			<p id="import-processes-help" className="setting-note">{!valid ? "请输入 1–32 的整数。" : profile ? `按此配置，下批实际最多使用 ${Math.min(count, profile.safeMax)} 个进程。` : "正在读取系统配置…"} 修改从下一批生效，当前任务继续完成。</p>
			{profile?.active != null && <p className="setting-note">当前批次使用 {profile.active} 个进程。</p>}
			<button className="primary-button" disabled={!profile || !valid || pending} onClick={() => void save(count)}>{pending ? "正在保存…" : "保存进程设置"}</button>{" "}
			<button className="secondary-button" disabled={!profile || pending} onClick={() => profile && void save(profile.recommended)}>使用推荐数量并保存</button>
			<p className="setting-note">推荐值按硬件估算，不保证所有负载下都流畅。较大的模型、视频和其他正在运行的软件会占用更多资源；出现卡顿时请降低进程数。批次结束后释放空闲的额外进程。</p>
		</>}
		{error && <p role="alert">{error}</p>}
		{message && <p role="status">{message}</p>}
	</div>;
}
