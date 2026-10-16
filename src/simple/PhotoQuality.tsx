import { useTaskState } from "./taskState";
import { useEffect, useMemo, useRef, useState } from 'react';
import { isVideoFile } from '@/lib/media';
import type { Asset } from './library';
import { qualityScore, type PhotoQualityRecord } from './qualityRanking';

export function usePhotoQuality(assets: Asset[], enabled: boolean) {
	const [records, setRecords] = useState<Record<string, PhotoQualityRecord>>({});
	const [rankingRecords, setRankingRecords] = useState<Record<string, PhotoQualityRecord>>({});
	const recordsRef = useRef<Record<string, PhotoQualityRecord>>({});
	const forceTargets = useRef(new Set<string>());
	const [checkpointReady, setCheckpointReady] = useState(!window.memories);
 const recoveredNames = useRef<string[] | null>(null);
 useEffect(() => {
  if (!window.memories) return;
  let live = true;
  void window.memories.taskCheckpoint('quality').then(value => {
   if (!live) return;
   if (value?.pending) { recoveredNames.current = value.names; forceTargets.current = new Set(value.forced); }
   setCheckpointReady(true);
  }).catch(e => { if (live) setError(`任务恢复失败：${String(e)}`); });
  return () => { live = false; };
 }, []);
 const [paused, setPaused] = useTaskState("PhotoQuality-paused", false);
	const [restoring, setRestoring] = useState(false);
	const [error, setError] = useState('');
	const [retry, setRetry] = useState(0);
	// Filtering/sorting score updates must not restart the scanner.
	const namesKey = useMemo(() => JSON.stringify([...new Set(assets.filter(a => !isVideoFile(a.filename)).map(a => a.filename))]), [assets]);
	const names = useMemo<string[]>(() => recoveredNames.current ?? JSON.parse(namesKey), [namesKey, checkpointReady, retry]);
	useEffect(() => {
		if (!checkpointReady) return;
		if (!enabled && !recoveredNames.current) return;
		const forced = forceTargets.current;
  if (!names.length) return;
  const taskNames = recoveredNames.current ?? names;
  recoveredNames.current = taskNames;
		if (!window.memories?.photoQuality) { setError('AI 优选需在已更新的 macOS 桌面版中使用'); return; }
		let cancelled = false;
		setError('');
		setRestoring(true);
		void (async () => {
			try {
				await window.memories.taskCheckpoint('quality', { pending: true, names: taskNames, forced: [...forced] });
				const restored: Record<string, PhotoQualityRecord> = {};
				for (let i = 0; i < taskNames.length && !cancelled; i += 1000) {
					const response = await window.memories.photoQuality(taskNames.slice(i, i + 1000), { cachedOnly: true });
					if (cancelled) return;
					Object.assign(restored, response);
				}
				if (cancelled) return;
				for (const name of forced) delete restored[name];
				recordsRef.current = restored;
				setRecords(restored);
				setRestoring(false);
    if (paused) return;
				const pending = taskNames.filter(name => !restored[name]);
				for (let i = 0; i < pending.length && !cancelled; i += 16) {
					const batch = pending.slice(i, i + 16);
					const response: Record<string, PhotoQualityRecord> = {};
					const groups = [true, false].map(force => ({ force, group: batch.filter(name => forced.has(name) === force) }));
					for (const { force, group } of groups) {
						if (!group.length || cancelled) continue;
						Object.assign(response, await window.memories.photoQuality(group, { force }));
      if (cancelled) return;
						for (const name of group) forced.delete(name);
      if (force) await window.memories.taskCheckpoint('quality', { pending: true, names: taskNames, forced: [...forced] });
					}
					if (cancelled) return;
					const checked = Object.fromEntries(batch.map(name => [name, response[name] || { error: '素材已不可用' }]));
					recordsRef.current = { ...recordsRef.current, ...checked };
					setRecords(recordsRef.current);
					await new Promise(resolve => setTimeout(resolve, 150));
				}
				if (!cancelled) { await window.memories.taskCheckpoint('quality', { pending: false, names: [], forced: [] }); recoveredNames.current = null; setRankingRecords({ ...recordsRef.current }); }
			} catch (e) { if (!cancelled) { setRestoring(false); setError(String(e)); } }
		})();
		return () => { cancelled = true; };
	}, [names, enabled, paused, retry, checkpointReady]);
	const { done, failed } = useMemo(() => {
		let done = 0, failed = 0;
		for (const name of names) if (records[name]) { done++; if (qualityScore(records[name]) === null) failed++; }
		return { done, failed };
	}, [names, records]);
	return { records, rankingRecords, restoring, paused, setPaused, error, done, failed, total: names.length, rescore: () => { recoveredNames.current = null; forceTargets.current = new Set(names); setPaused(false); setRetry(v => v + 1); }, retry: () => { recoveredNames.current = null; forceTargets.current = new Set(); recordsRef.current = {}; setPaused(false); setRetry(v => v + 1); } };
}

export function PhotoQualityStatus({ controller: c, ascending = false }: { controller: ReturnType<typeof usePhotoQuality>; ascending?: boolean }) {
	return <div className="duplicate-summary photo-quality-status"><strong>AI 优选 · {c.paused ? '已暂停' : c.restoring ? '正在读取已有评分' : c.done === c.total ? '评分完成' : '正在评分'} · 已处理 {c.done} / {c.total} 张照片{c.failed > 0 ? ` · ${c.failed} 张失败` : ''}</strong><span>按当前范围内照片的 AI 综合美感与拍摄质量{ascending ? '从低到高' : '从高到低'}排列，评分期间保持照片顺序，全部处理完成后统一排序。待评分、失败照片及视频排在后面。已有评分自动复用，仅新增或文件变化时评分；点击“重新评分”可重算当前范围全部照片。评分仅供选片参考，在本机运行，需 macOS 15 或更新版本。</span><div className="view-controls"><button className="text-button" disabled={!c.total || (!c.restoring && c.done === c.total)} onClick={() => c.setPaused(v => !v)}>{c.paused ? '继续评分' : '暂停评分'}</button><button className="secondary-button" disabled={!c.total} onClick={c.rescore} title="重新计算当前范围全部照片的评分，不复用旧分数">重新评分</button><button className="text-button" onClick={c.retry}>重新核对 / 重试失败项</button></div>{c.error && <span role="alert">评分未完成：{c.error}</span>}</div>;
}
