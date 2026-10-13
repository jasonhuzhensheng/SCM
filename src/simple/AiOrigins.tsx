import { useTaskState } from "./taskState";
import { useEffect, useRef, useState } from "react";
import type { Asset } from "./library";
export type AiOrigin = { status: "marked" | "suspected" | "unknown" | "error"; evidence: string; failed?: boolean };
export function useAiOrigins(assets: Asset[], enabled: boolean) {
	const records = useRef(new Map<string, AiOrigin>());
	const [matches, setMatches] = useState(new Map<string, AiOrigin>());
	const [done, setDone] = useState(0);
	const [failed, setFailed] = useState(0);
	const [paused, setPaused] = useTaskState("AiOrigins-paused", false);
	const [error, setError] = useState("");
	const forced = useRef(new Set<string>());
 const recovering = useRef(false);
 const [ready, setReady] = useState(!window.memories);
 useEffect(() => {
  if (!window.memories) return;
  let live = true;
  void window.memories.taskCheckpoint('ai-origin').then(value => {
   if (!live) return;
   if (value?.pending) { forced.current = new Set(value.forced); recovering.current = true; }
   setReady(true);
  }).catch(e => { if (live) setError(`任务恢复失败：${String(e)}`); });
  return () => { live = false; };
 }, []);
 const [revision, setRevision] = useState(0);
	useEffect(() => {
		if (!ready || (!enabled && !recovering.current) || !window.memories?.aiOrigins) return;
		let cancelled = false, lastPublish = 0;
		const names = assets.map(a => a.filename);
  if (!names.length) return;
  const forceNames = forced.current;
  recovering.current = true;
		const publish = (force = false) => {
			if (cancelled || (!force && Date.now() - lastPublish < 1000)) return;
			lastPublish = Date.now();
			const next = new Map<string, AiOrigin>(); let count = 0, errors = 0;
			for (const name of names) { const record = records.current.get(name); if (!record) continue; count++; if (record.failed || record.status === "error") errors++; if (record.status === "marked" || record.status === "suspected") next.set(name, record); }
			setMatches(next); setDone(count); setFailed(errors);
		};
		void (async () => {
			try {
				await window.memories.taskCheckpoint('ai-origin', { pending: true, names: [], forced: [...forceNames] });
				const pending = names.filter(n => !records.current.has(n)), missing: string[] = [];
				for (let i = 0; i < pending.length && !cancelled; i += 1000) {
					const group = pending.slice(i, i + 1000);
					const batch = await window.memories.aiOrigins(group.filter(n => !forceNames.has(n)), { cachedOnly: true });
					if (cancelled) return;
					for (const [name, value] of Object.entries(batch)) records.current.set(name, value);
					missing.push(...group.filter(n => !(n in batch))); publish();
				}
				if (paused) { publish(true); return; }
				for (let i = 0; i < missing.length && !cancelled; i += 10) {
					const group = missing.slice(i, i + 10);
     const batch: Record<string, AiOrigin> = {};
     const parts = [true, false].map(refresh => ({ refresh, items: group.filter(n => forceNames.has(n) === refresh) }));
     for (const { refresh, items } of parts) {
      if (!items.length || cancelled) continue;
      Object.assign(batch, await window.memories.aiOrigins(items, { refresh }));
      if (cancelled) return;
      items.forEach(n => forceNames.delete(n));
      if (refresh) await window.memories.taskCheckpoint('ai-origin', { pending: true, names: [], forced: [...forceNames] });
     }
					if (cancelled) return;
					for (const [name, value] of Object.entries(batch)) records.current.set(name, value);
					publish(); await new Promise(resolve => setTimeout(resolve, 100));
				}
				if (!cancelled) { await window.memories.taskCheckpoint('ai-origin', { pending: false, names: [], forced: [] }); recovering.current = false; }
				publish(true);
			} catch (e) { publish(true); if (!cancelled) setError(String(e)); }
		})();
		return () => { cancelled = true; };
	}, [assets, enabled, paused, revision, ready]);
	return { matches, done, failed, paused, setPaused, error, retry: () => { forced.current = new Set(assets.map(a => a.filename)); records.current.clear(); setMatches(new Map()); setDone(0); setFailed(0); setError(""); setPaused(false); setRevision(v => v + 1); } };
}
export function AiOriginPanel({ controller, total, includeSuspected, onIncludeSuspected }: { controller: ReturnType<typeof useAiOrigins>; total: number; includeSuspected: boolean; onIncludeSuspected: (value: boolean) => void }) {
	return <div className="duplicate-summary"><strong>AI 来源查找 · 已读取 {controller.done} / {total} · 读取失败 {controller.failed}</strong><span>依据生成参数、来源声明和文件名线索分类，不凭画面外观判定。来源声明未经签名验证；没有标记、元数据被移除或不支持的格式可能漏检。计数为已发现结果。</span><div className="view-controls" style={{ flexWrap: "wrap" }}><label><input type="checkbox" checked={includeSuspected} onChange={e => onIncludeSuspected(e.target.checked)} /> 包含疑似（工具名 / 文件名线索）</label><button className="text-button" onClick={() => controller.setPaused(v => !v)}>{controller.paused ? "继续查找" : "暂停查找"}</button><button className="text-button" onClick={controller.retry}>重新核对</button></div>{!window.memories?.aiOrigins && <span>请在桌面应用中读取文件来源。</span>}{controller.error && <span role="alert">查找未完成：{controller.error}</span>}</div>;
}
