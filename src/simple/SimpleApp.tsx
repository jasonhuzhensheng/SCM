import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconCheck, IconChevronLeft, IconChevronRight, IconFolder, IconFolderPlus, IconGridDots, IconHeart, IconLayoutGrid, IconList, IconLoader2, IconPhoto, IconPlus, IconSearch, IconSettings, IconShieldCheck, IconSparkles, IconTrash, IconVideo, IconX, IconClock, IconExternalLink, IconDeviceDesktop, IconMenu2 } from "@tabler/icons-react";
import { useMemorySearch } from "@/hooks/useMemorySearch";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { isVideoFile, isPlayableVideoFile, thumbFor, posterFor, scenePosterFor, formatTimecode } from "@/lib/media";
import type { StatusPayload, WatchedFolder } from "@/types";
import { assetKey, inFolder, parentFolder, parseLibrary, readSaved, saveLocal, type Asset } from "./library";

import { MapSearch } from "./MapSearch";
import { AssetContextMenu } from "./AssetContextMenu";
import { DriveSettings, DriveTransfer } from "./DriveTransfer";

type View = "all" | "photos" | "videos" | "screenshots" | "favorites";
type Mode = "files" | "scenes" | "ocr" | "dialogue";
const views = [
	{ id: "all", label: "所有素材", icon: IconLayoutGrid },
	{ id: "photos", label: "照片", icon: IconPhoto },
	{ id: "videos", label: "视频", icon: IconVideo },
	{ id: "screenshots", label: "截图", icon: IconDeviceDesktop },
	{ id: "favorites", label: "我的收藏", icon: IconHeart },
] as const;
const modes = [
	{ id: "files", label: "画面描述", placeholder: "描述你想找的画面，比如：海边的日落", hint: "用一句话，找到记忆中的画面。" },
	{ id: "scenes", label: "视频片段", placeholder: "描述视频中的一个镜头，比如：走进森林", hint: "找到具体镜头，直接跳到对应时刻。" },
	{ id: "ocr", label: "图片文字", placeholder: "输入画面里的文字、地址或订单号", hint: "查找照片和截图里出现的文字。" },
	{ id: "dialogue", label: "视频对白", placeholder: "输入视频里说过的一句话", hint: "根据已识别的对白，定位说话的时刻。" },
] as const;
const preview = !window.memories;
const storagePrefix = preview ? "scm-simple-preview-" : "scm-simple-";
const matchLabels = { semantic: "画面匹配", phrase: "名称匹配", filename: "名称匹配", ocr: "文字匹配" };

function thumbnail(asset: Asset) {
	if (asset.previewUrl) return asset.previewUrl;
	if (asset.bestScene && asset.bestScene.poster >= 0) return scenePosterFor(encodeURIComponent(asset.filename), asset.bestScene.poster);
	return isVideoFile(asset.filename) ? posterFor(encodeURIComponent(asset.filename)) : thumbFor(encodeURIComponent(asset.filename));
}
function original(asset: Asset) { return asset.mediaUrl || `/images/projects/${encodeURIComponent(asset.filename)}`; }
function dateLabel(date: number) { return date ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date) : "日期未知"; }

export default function SimpleApp() {
	const [mapOpen, setMapOpen] = useState(false);
 const [mapDistances, setMapDistances] = useState<Map<string, number> | null>(null);
 const applyMapFilter = useCallback((value: Map<string, number> | null) => { setMapDistances(value); setSelectedFiles(new Set()); setLimit(60); }, []);
 const [assets, setAssets] = useState<Asset[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [watched, setWatched] = useState<WatchedFolder[]>([]);
	const [view, setView] = useState<View>("all");
	const [folder, setFolder] = useState("");
	const [draft, setDraft] = useState("");
	const [query, setQuery] = useState("");
	const [mode, setMode] = useState<Mode>("files");
	const [results, setResults] = useState<Asset[] | null>(null);
 const [similarReference, setSimilarReference] = useState<Asset | null>(null);
 const [similarThreshold, setSimilarThreshold] = useState(0.6);
 const [deleteReport, setDeleteReport] = useState("");
 const [deleteProgress, setDeleteProgress] = useState("");
	const [searching, setSearching] = useState(false);
	const [searchFailure, setSearchFailure] = useState("");
	const [translatedQuery, setTranslatedQuery] = useState("");
	const [translating, setTranslating] = useState(false);
	const [favorites, setFavorites] = useState<string[]>(() => { const value = readSaved<unknown>(storagePrefix + "favorites", []); return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []; });
	const [recent, setRecent] = useState<string[]>(() => { const value = readSaved<unknown>(storagePrefix + "recent", []); return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 4) : []; });
	const [layout, setLayout] = useState<"grid" | "list">("grid");
	const [sort, setSort] = useState("newest");
	const [limit, setLimit] = useState(60);
	const [selected, setSelected] = useState<Asset | null>(null);
 const [contextMenu, setContextMenu] = useState<{asset: Asset; x: number; y: number} | null>(null);
 const [deleting, setDeleting] = useState(false);
 const closeContextMenu = useCallback(() => setContextMenu(null), []);

	const [selectionMode, setSelectionMode] = useState(false);
	const [driveBusy, setDriveBusy] = useState(false);
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
	const toggleSelection = (filename: string) => setSelectedFiles(previous => {
		const next = new Set(previous); if (next.has(filename)) next.delete(filename); else next.add(filename); return next;
	});
	const [settings, setSettings] = useState(false);
	const [mobileNav, setMobileNav] = useState(false);
	const [toast, setToast] = useState("");
	const [importing, setImporting] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
	const [engine, setEngine] = useState("loading");
	const [switching, setSwitching] = useState(false);
	const [proposedModel, setProposedModel] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	const scrollRef = useRef<HTMLElement>(null);
	const sequence = useRef(0);
	const dragDepth = useRef(0);
	const names = useMemo(() => assets.map(a => a.filename), [assets]);
	const searchApi = useMemorySearch(names);
	const { search, searchScenes, searchDialogue, searchOcr, prewarm, models, activeModelId, migration, setModel } = searchApi;
	const currentMode = modes.find(m => m.id === mode)!;

	const refresh = useCallback(async () => {
		try {
			if (preview) {
				const { demoAssets } = await import("./preview");
				setAssets(new URLSearchParams(location.search).has("empty") ? [] : demoAssets);
			} else {
				const response = await fetch("/memories-index.json");
				if (!response.ok) throw new Error("无法读取素材库");
				setAssets(parseLibrary(await response.json()));
				setWatched(await window.memories.getWatchedFolders());
			}
			setLoaded(true); setLoadError("");
		} catch { setLoadError("素材库暂时无法读取，请重试。"); setLoaded(true); }
	}, []);

	useEffect(() => { void refresh(); }, [refresh]);
	useEffect(() => {
		if (preview) return;
		const receive = (status: StatusPayload) => {
			if (status.type === "model") setEngine(status.phase);
			if (status.type === "library-updated") void refresh();
			if (status.type === "open-settings") setSettings(true);
			if (status.type === "import") {
				if (status.phase === "done") { setProgress(null); void refresh(); }
				else setProgress({ label: status.phase === "scanning" ? "正在扫描素材" : status.phase === "copying" ? "正在添加素材" : "正在建立搜索索引", done: status.done ?? 0, total: status.total ?? 0 });
			}
		};
		void window.memories.getIndexerStatus().then(s => s && receive(s)).catch(() => setEngine("error"));
		return window.memories.onStatus(receive);
	}, [refresh]);
	useEffect(() => { prewarm(); }, [prewarm]);
	useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 4500); return () => clearTimeout(id); }, [toast]);
	useEffect(() => { saveLocal(storagePrefix + "favorites", favorites); }, [favorites]);
	useEffect(() => { saveLocal(storagePrefix + "recent", recent); }, [recent]);
	useEffect(() => { setProposedModel(activeModelId ?? ""); }, [activeModelId, settings]);
	useEffect(() => { document.documentElement.classList.remove("dark"); document.title = "SCM · 拾光"; }, []);

	const addAssets = useCallback(async (paths?: string[]) => {
		if (preview) { setToast("这是界面预览。请在桌面版中添加本地照片、视频或文件夹。"); return; }
		if (importing) return;
		setImporting(true);
		try {
			const result = paths ? await window.memories.importPaths(paths) : await window.memories.pickPhotos();
			if (result) {
				setToast(`已添加 ${result.added.length} 项${result.skipped.length ? `，跳过 ${result.skipped.length} 项重复素材` : ""}${result.errors.length ? `；${result.errors.length} 项导入失败` : ""}`);
				await refresh();
			}
		} catch { setToast("添加失败，请检查文件是否可访问后重试。"); }
		finally { setImporting(false); setProgress(null); }
	}, [importing, refresh]);

	const runSearch = useCallback(async (text: string, selectedMode: Mode = mode) => {
		setSimilarReference(null);
		const value = text.trim(); const seq = ++sequence.current;
		setDraft(text); setQuery(value); setMode(selectedMode); setLimit(60); setSearchFailure(""); setTranslatedQuery(""); setTranslating(false);
		if (!value) { setResults(null); setSearching(false); return; }
		setResults(null); setSearching(true);
		setRecent(prev => [value, ...prev.filter(v => v !== value)].slice(0, 4));
		try {
			let next: Asset[];
			if (preview) {
				// Demo keyword matching only: no simulated AI scores or inference.
				const terms = value.toLowerCase().split(/\s+/);
				next = assets.filter(a => selectedMode === "files" ? terms.every(t => `${a.title} ${a.tags}`.toLowerCase().includes(t)) : selectedMode === "ocr" && a.ocr.includes(value));
			} else {
				if ((selectedMode === "files" || selectedMode === "scenes") && /\p{Script=Han}/u.test(value)) {
					setTranslating(true);
					const translation = await window.memories.translateSearch(value);
					if (seq !== sequence.current) return;
					setTranslating(false);
					if (!translation.ok) { setResults([]); setSearchFailure(translation.error); return; }
					setTranslatedQuery(translation.text);
				}
				if (seq !== sequence.current) return;
				await prewarm();
				const count = Math.max(assets.length, 100);
				const matches = selectedMode === "scenes" ? await searchScenes(value, count * 3) : selectedMode === "dialogue" ? await searchDialogue(value, count * 3) : selectedMode === "ocr" ? searchOcr(value, count) : await search(value, count);
				const byName = new Map(assets.map(a => [a.filename, a]));
				next = matches.flatMap(match => { const asset = byName.get(match.filename); return asset ? [{ ...asset, ...match }] : []; });
			}
			if (seq === sequence.current) setResults(next);
		} catch { if (seq === sequence.current) { setResults([]); setSearchFailure("搜索暂时失败，请稍后重试，或切换到图片文字搜索。"); } }
		finally { if (seq === sequence.current) { setSearching(false); setTranslating(false); } }
	}, [mode, assets, prewarm, search, searchScenes, searchDialogue, searchOcr]);

	const toggleFavorite = (name: string) => setFavorites(prev => prev.includes(name) ? prev.filter(v => v !== name) : [...prev, name]);
	const selectView = (id: View, path = "") => { setView(id); setFolder(path); setMobileNav(false); setLimit(60); scrollRef.current?.scrollTo({ top: 0 }); };
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (!settings && !selected) searchInput.current?.focus(); }
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") { event.preventDefault(); if (!settings && !selected) void addAssets(); }
			if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); setSelected(null); setSettings(true); }
			if (event.key === "Escape") { setSelected(null); setSettings(false); setMobileNav(false); }
		};
		window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
	}, [addAssets, settings, selected]);

	const acceptsView = useCallback((asset: Asset, id: View) => id === "all" || (id === "photos" && !isVideoFile(asset.filename)) || (id === "videos" && isVideoFile(asset.filename)) || (id === "screenshots" && asset.category === "Screenshots") || (id === "favorites" && favorites.includes(asset.filename)), [favorites]);
	const displayed = useMemo(() => {
		const entries = (results ?? assets).filter(a => (!similarReference || a.score >= similarThreshold) && acceptsView(a, view) && (!folder || inFolder(a.sourcePath, folder)) && (!mapDistances || mapDistances.has(a.filename)));
		if (mapDistances && sort === "newest") return [...entries].sort((a, b) => mapDistances.get(a.filename)! - mapDistances.get(b.filename)!);
		if (results !== null && sort === "newest") return entries;
		return [...entries].sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : b.modifiedAt - a.modifiedAt);
	}, [assets, results, view, folder, sort, acceptsView, mapDistances, similarReference, similarThreshold]);
	const folders = useMemo(() => Array.from(new Set([...watched.map(f => f.path), ...assets.map(a => parentFolder(a.sourcePath)).filter(Boolean)])), [watched, assets]);
	useEffect(() => { setSelectedFiles(new Set()); }, [query, mode, view, folder, similarReference, similarThreshold]);
	useEffect(() => { setSelectedFiles(previous => new Set([...previous].filter(name => assets.some(asset => asset.filename === name)))); }, [assets]);
	const resultFiles = [...new Set(displayed.map(asset => asset.filename))];
	const heading = folder ? folder.split("/").pop() : views.find(v => v.id === view)?.label;
	const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
	const selectedIndex = selected ? displayed.findIndex(a => assetKey(a) === assetKey(selected)) : -1;
	const selectAdjacent = (offset: number) => { const asset = displayed[selectedIndex + offset]; if (asset) setSelected(asset); };
	const statusLabel = preview ? "界面预览 · 示例素材" : engine === "error" ? "搜索模型暂不可用" : engine === "ready" ? "本地搜索已就绪" : "正在准备搜索模型";
	const isBusy = importing || !!progress || !!migration || driveBusy || deleting;

 async function findSimilar(asset: Asset) {
  closeContextMenu();
  if (deleting || driveBusy) return;
  if (preview) { setToast("相似照片搜索请在桌面版使用。"); return; }
  const seq = ++sequence.current;
  setSelected(null); setSearching(true); setTranslating(false); setTranslatedQuery(""); setSearchFailure("");
  setQuery(""); setDraft(""); setMode("files"); setView("photos"); setFolder(""); setMapOpen(false); setMapDistances(null);
  setSimilarReference(asset); setResults([]); setSort("newest"); setLimit(60); setSelectionMode(true); setSelectedFiles(new Set()); setDeleteReport("");
  try {
   const response = await window.memories.similarPhotos(asset.filename);
   if (seq !== sequence.current) return;
   if (!response.ok) throw Error(response.error || "相似照片搜索失败。");
   const byName = new Map(assets.map(item => [item.filename,item]));
   setResults((response.matches || []).flatMap(match => { const found = byName.get(match.filename); return found ? [{...found,...match}] : []; }));
  } catch (error) { if (seq === sequence.current) { setResults([]); setSearchFailure(error instanceof Error ? error.message : "查找失败"); } }
  finally { if (seq === sequence.current) setSearching(false); }
 }
 async function deleteBatch() {
  if (deleting || driveBusy || !selectedFiles.size) return;
  const batch = assets.filter(item => selectedFiles.has(item.filename));
  const paths = batch.slice(0,8).map(item => item.sourcePath || item.title).join("\n");
  if (!window.confirm(`删除选中的 ${batch.length} 个文件？\n原文件将移到系统废纸篓，同时删除素材库副本及搜索记录。网盘同步目录中的删除可能同步到云端。\n\n${paths}${batch.length > 8 ? "\n…其余文件也将删除" : ""}`)) return;
  setDeleting(true); setDeleteReport("");
  const removed = new Set<string>(), errors: string[] = [];
  try {
   for (let i = 0; i < batch.length; i++) {
    const asset = batch[i]; setDeleteProgress(`正在删除 ${i+1} / ${batch.length}：${asset.title}`);
    try { const response = preview ? {ok:true} : await window.memories.deleteMemory(asset.filename,{original:true}); if (!response.ok) throw Error(response.error || "删除失败"); removed.add(asset.filename); }
    catch (error) { errors.push(`${asset.title}：${error instanceof Error ? error.message : "删除失败"}`); }
   }
  } finally {
   sequence.current++; setSearching(false); setTranslating(false);
   setAssets(previous => previous.filter(item => !removed.has(item.filename)));
   setResults(previous => previous ? previous.filter(item => !removed.has(item.filename)) : previous);
   setSelectedFiles(previous => new Set([...previous].filter(name => !removed.has(name))));
   setFavorites(previous => previous.filter(name => !removed.has(name)));
   setDeleteReport(`已删除 ${removed.size} 个，失败 ${errors.length} 个。${errors.length ? "失败文件保留选中，可重试。 " + errors.slice(0,3).join("；") : "原文件已移到废纸篓或原本已不存在。"}`);
   setDeleteProgress(""); setDeleting(false);
  }
 }
 async function deleteAsset(asset: Asset, originalFile = false) {
  closeContextMenu();
  if (driveBusy || deleting) { setToast("正在传输或删除文件，请稍后重试。"); return; }
  if (!window.confirm(`删除“${asset.title}”？\n${originalFile ? `原文件将移到系统废纸篓，并删除素材库副本及搜索记录。\n原文件：${asset.sourcePath || "未记录（无法删除原文件）"}\n若原文件在网盘同步目录中，删除可能同步到云端。` : "仅删除软件素材库副本及搜索记录，最初导入的原文件保留。"}${isVideoFile(asset.filename) ? "\n同一视频的所有片段会一起移除。" : ""}`)) return;
  setDeleting(true);
  try {
   if (!preview) { const result = await window.memories.deleteMemory(asset.filename, { original: originalFile }); if (!result.ok) throw Error(result.error || "删除失败，请等待当前任务结束后重试。"); }
   sequence.current++; setSearching(false); setTranslating(false);
   setAssets(previous => previous.filter(item => item.filename !== asset.filename));
   setResults(previous => previous ? previous.filter(item => item.filename !== asset.filename) : previous);
   setSelectedFiles(previous => new Set([...previous].filter(name => name !== asset.filename)));
   setFavorites(previous => previous.filter(name => name !== asset.filename));
   setSelected(previous => previous?.filename === asset.filename ? null : previous);
   setToast(preview ? "已从示例列表移除。" : originalFile ? "已移除素材；原文件已移到废纸篓或原本已不存在。" : "已删除素材库副本，原文件保留。");
  } catch (error) { setToast(error instanceof Error ? error.message : "删除失败，请重试。"); }
  finally { setDeleting(false); }
 }
	const activeProgress = migration ?? progress;
	const progressPercent = activeProgress && Number.isFinite(activeProgress.total) && activeProgress.total > 0 && Number.isFinite(activeProgress.done)
		? Math.max(0, Math.min(100, Math.floor(activeProgress.done / activeProgress.total * 100)))
		: null;
	const closeSettings = () => setSettings(false);

	return <div className="simple-app" onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (preview) { void addAssets(); return; } const paths = Array.from(event.dataTransfer.files).map(f => window.memories.getPathForFile(f)).filter(Boolean); if (paths.length) void addAssets(paths); }}>
		{mobileNav && <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
		<aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="素材导航">
			<div className="window-drag" />
			<a className="brand" href="./" aria-label="拾光首页"><span className="brand-mark"><IconGridDots size={23} stroke={2} /></span><span><strong>拾光<span className="brand-scm">SCM</span></strong><small>你的本地视觉资料库</small></span></a>
			<div className="nav-section-label">素材库</div>
			<nav>{views.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id && !folder ? "active" : ""}`} aria-current={view === id && !folder ? "page" : undefined} onClick={() => selectView(id)}><Icon size={19} stroke={1.7} /><span>{label}</span><span className="nav-count">{assets.filter(a => acceptsView(a, id)).length}</span></button>)}</nav>
			<div className="nav-section-label section-with-action"><span>文件夹</span><button className="icon-button" aria-label="添加文件夹" title="添加文件夹" onClick={() => void addAssets()} disabled={isBusy}><IconPlus size={16} /></button></div>
			<div className="folder-nav">{folders.length ? folders.map(path => <button key={path} title={path} className={`nav-item ${folder === path ? "active" : ""}`} onClick={() => selectView("all", path)}><IconFolder size={18} stroke={1.6} /><span>{path.split("/").pop()}</span><span className="nav-count">{assets.filter(a => inFolder(a.sourcePath, path)).length}</span></button>) : <p className="sidebar-hint">添加文件夹后，在这里快速浏览。</p>}</div>
			{recent.length > 0 && <><div className="nav-section-label section-with-action"><span>最近搜索</span><button className="icon-button" aria-label="清除搜索记录" onClick={() => setRecent([])}><IconTrash size={14} /></button></div><div>{recent.map(text => <button className="nav-item recent-item" key={text} title={text} onClick={() => { void runSearch(text); setMobileNav(false); }}><IconClock size={16} /><span>{text}</span></button>)}</div></>}
			<div className="sidebar-bottom"><div className="privacy-note"><IconShieldCheck size={17} /><span>{preview ? "桌面版在本机处理素材" : "本地检索 · 自主上传"}</span></div><button className="nav-item settings-button" onClick={() => setSettings(true)}><IconSettings size={19} /><span>设置</span><kbd>⌘ ,</kbd></button><div className="sidebar-version">SCM 简洁版 <span>本地优先</span></div></div>
		</aside>
		<main className="workspace" ref={scrollRef}>
			<header className="workspace-header"><div className="header-heading"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><IconMenu2 size={22} /></button><div><div className="eyebrow">YOUR VISUAL LIBRARY</div><h1>{heading}</h1><p>让每个画面，都能被找到。</p></div></div><button className="primary-button" onClick={() => void addAssets()} disabled={isBusy}>{isBusy ? <IconLoader2 className="spin" size={18} /> : <IconPlus size={18} />}<span>{isBusy ? "正在处理" : "添加素材"}</span></button></header>
			<section className="search-section" aria-label="搜索素材">
				<form className="search-box" onSubmit={event => { event.preventDefault(); void runSearch(draft); }}><IconSearch size={23} stroke={1.7} /><input ref={searchInput} aria-label="搜索素材" placeholder={currentMode.placeholder} value={draft} onChange={event => { setDraft(event.target.value); if (!event.target.value) void runSearch(""); }} /><div className="search-actions">{draft ? <button type="button" className="icon-button" aria-label="清空搜索" onClick={() => void runSearch("")}><IconX size={17} /></button> : <kbd>⌘ K</kbd>}<button className="search-submit" type="submit" aria-label="执行搜索" disabled={searching}>{searching ? <IconLoader2 className="spin" size={19} /> : <IconArrowRight size={19} />}</button></div></form>
				<div className="search-options"><div className="mode-tabs" aria-label="搜索方式">{modes.map(m => <button key={m.id} className={mode === m.id ? "selected" : ""} aria-pressed={mode === m.id} onClick={() => { setMode(m.id); if (query) void runSearch(draft, m.id); }}>{m.id === "files" && <IconSparkles size={14} />}{m.label}</button>)}</div><span className="search-hint">{currentMode.hint}</span></div>
			</section>
			{preview && <div className="preview-notice"><IconDeviceDesktop size={15} /><span>交互预览：使用示例照片，搜索演示仅匹配标题与标签。</span></div>}
			{translating && <div className="engine-notice" role="status"><IconLoader2 size={15} className="spin" /><span>正在用本地语言模型翻译搜索词，首次加载可能稍慢…</span></div>}
			{translatedQuery && <div className="engine-notice"><span>英文检索：{translatedQuery}</span></div>}
			{!preview && engine !== "ready" && <div className={`engine-notice ${engine === "error" ? "notice-error" : ""}`} role="status"><IconLoader2 size={15} className={engine !== "error" ? "spin" : ""} /><span>{engine === "error" ? "搜索模型未就绪，仍可浏览素材或按已有文字查找。在设置中检查模型。" : "首次使用正在准备本地搜索模型，你可以先浏览或添加素材。"}</span></div>}
			<div className="map-toggle"><button className="secondary-button" aria-pressed={mapOpen} onClick={() => { setMapOpen(v => !v); setMapDistances(null); setSelectedFiles(new Set()); }}>{mapOpen ? "关闭地图" : "地图找照片"}</button>{mapDistances && <span>已按地点筛选</span>}</div>
			{mapOpen && <MapSearch names={names} onFilter={applyMapFilter} />}
			{similarReference && <div className="similar-banner"><img src={thumbnail(similarReference)} alt="参考照片" /><div><strong>参考：{similarReference.title}</strong><p>按整体画面相似度排序，最多显示 500 项（含参考照片）。相似结果不代表重复文件，请勾选确认后处理。</p><label>匹配范围 <select aria-label="相似照片匹配范围" value={similarThreshold} disabled={deleting || driveBusy} onChange={event => setSimilarThreshold(Number(event.target.value))}><option value={0.75}>更接近的画面</option><option value={0.6}>相似内容</option><option value={0.4}>扩大范围</option></select></label></div><button className="secondary-button" disabled={deleting || driveBusy} onClick={() => void runSearch("")}>退出相似搜索</button></div>}
   {deleteProgress && <p role="status">{deleteProgress}</p>}{deleteReport && <p role="status" className="setting-note">{deleteReport}</p>}
   <div className="results-toolbar"><div className="results-summary"><h2>{similarReference ? "相似照片" : query ? `“${query}”的搜索结果` : "全部内容"}</h2><span>{searching ? "正在查找…" : `${displayed.length} 项素材`}</span>{query && <button className="text-button" onClick={() => void runSearch("")}>清除</button>}</div><div className="view-controls"><button className="secondary-button" disabled={driveBusy || searching} aria-pressed={selectionMode} onClick={() => { setSelectionMode(value => !value); setSelectedFiles(new Set()); }}>{selectionMode ? "退出选择" : "批量选择"}</button><select aria-label="素材排序" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">{mapDistances ? "距离最近" : query ? "相关度优先" : "最新优先"}</option><option value="name">名称排序</option></select><div className="layout-switch"><button aria-label="网格视图" aria-pressed={layout === "grid"} className={layout === "grid" ? "selected" : ""} onClick={() => setLayout("grid")}><IconLayoutGrid size={17} /></button><button aria-label="列表视图" aria-pressed={layout === "list"} className={layout === "list" ? "selected" : ""} onClick={() => setLayout("list")}><IconList size={18} /></button></div></div></div>
			{selectionMode && <div className="batch-toolbar"><strong>已选 {selectedFiles.size} 个文件</strong><button className="text-button" disabled={searching || driveBusy || deleting} onClick={() => setSelectedFiles(new Set(resultFiles))}>全选结果（{resultFiles.length}）</button><button className="text-button" onClick={() => setSelectedFiles(new Set())}>取消全选</button><button className="secondary-button" disabled={!selectedFiles.size || deleting || driveBusy || searching} onClick={() => void deleteBatch()}>删除选中的原文件…</button><DriveTransfer filenames={deleting ? [] : [...selectedFiles]} onBusy={setDriveBusy} onSettings={() => setSettings(true)} onComplete={removed => { setSelectedFiles(previous => new Set([...previous].filter(name => !removed.includes(name)))); if (removed.length) { sequence.current++; setSearching(false); setTranslating(false); setResults(previous => previous ? previous.filter(asset => !removed.includes(asset.filename)) : previous); } void refresh(); }} /><span>同一视频的多个片段只选取一份原文件</span></div>}
			{loadError ? <EmptyState title="素材库暂时无法打开" description={loadError} action="重新加载" onAction={() => void refresh()} /> : !loaded || searching ? <div className="asset-grid skeleton-grid" aria-label="正在加载" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div className="skeleton-card" key={i}><div /><span /><small /></div>)}</div> : displayed.length === 0 ? <EmptyState title={mapDistances ? "附近没有匹配的照片" : similarReference || query ? "暂时没有找到匹配的素材" : assets.length ? "这里还没有素材" : "把散落的画面，收进一个地方"} description={mapDistances ? "可以扩大地图范围或更换地点。只有带 GPS 信息、且符合当前筛选条件的照片才会显示。" : searchFailure || (query ? "试试更简短的描述，或切换搜索方式。视频片段与对白需要先完成索引。" : view === "favorites" ? "点击素材上的爱心，就能在这里快速找到它。" : "添加照片、视频或整个文件夹，也可以直接拖到这里。")} action={mapDistances ? "关闭地点筛选" : similarReference || query ? "清除搜索" : assets.length ? "查看所有素材" : "添加第一批素材"} onAction={() => mapDistances ? (setMapOpen(false), setMapDistances(null)) : similarReference || query ? void runSearch("") : assets.length ? selectView("all") : void addAssets()} /> : <><div className={layout === "grid" ? "asset-grid" : "asset-list"}>{displayed.slice(0, limit).map(asset => <article className={`asset-card ${selectionMode && selectedFiles.has(asset.filename) ? "batch-selected" : ""}`} key={assetKey(asset)} onContextMenu={event => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setContextMenu({ asset, x: event.clientX || bounds.left + 20, y: event.clientY || bounds.top + 20 }); }}>{selectionMode && <input className="batch-checkbox" type="checkbox" checked={selectedFiles.has(asset.filename)} aria-label={`选择 ${asset.title}`} onChange={() => toggleSelection(asset.filename)} />}<button className="asset-open" onClick={() => selectionMode ? toggleSelection(asset.filename) : setSelected(asset)} aria-label={`${selectionMode ? "选择" : "预览"} ${asset.title}`}><div className="asset-image"><img src={thumbnail(asset)} alt={asset.title} loading="lazy" onError={event => { event.currentTarget.style.opacity = "0"; }} /><span className="image-fallback"><IconPhoto size={28} /></span>{isVideoFile(asset.filename) && <span className="video-label"><IconVideo size={13} />{asset.bestScene ? formatTimecode(asset.bestScene.t) : "视频"}</span>}{query && asset.dominant && <span className="match-label">{matchLabels[asset.dominant]}</span>}</div><div className="asset-caption"><h3 title={asset.title}>{asset.title}</h3><p><span>{parentFolder(asset.sourcePath).split("/").pop() || (isVideoFile(asset.filename) ? "视频" : "照片")}</span><span>{similarReference?.filename === asset.filename ? "参考照片" : mapDistances ? `${mapDistances.get(asset.filename)?.toFixed(1)} 公里` : dateLabel(asset.modifiedAt)}</span></p></div></button><button className={`favorite-button ${favoriteSet.has(asset.filename) ? "is-favorite" : ""}`} aria-label={`${favoriteSet.has(asset.filename) ? "取消收藏" : "收藏"} ${asset.title}`} aria-pressed={favoriteSet.has(asset.filename)} onClick={() => toggleFavorite(asset.filename)}><IconHeart size={17} fill={favoriteSet.has(asset.filename) ? "currentColor" : "none"} /></button></article>)}</div>{displayed.length > limit && <button className="secondary-button load-more" onClick={() => setLimit(prev => prev + 60)}>再显示 {Math.min(60, displayed.length - limit)} 项</button>}</>}
			<footer className="workspace-footer"><span><i className={`status-dot ${!preview && engine !== "ready" ? "pending" : ""}`} />{statusLabel}</span><span>单击预览 · 方向键切换<kbd>Esc</kbd> 关闭</span></footer>
		</main>
		{activeProgress && <div className="progress-toast" role="status"><IconLoader2 className="spin" size={20} /><div className="progress-content"><div className="progress-heading"><strong>{migration ? "正在更新搜索索引" : progress?.label}</strong>{progressPercent !== null && <span className="progress-percent">{progressPercent}%</span>}</div><p>{progressPercent !== null ? `${activeProgress.done} / ${activeProgress.total} 项` : "正在处理，请稍候"}</p><progress className="index-progress" aria-label={migration ? "更新搜索索引进度" : progress?.label} max={100} value={progressPercent ?? undefined} /></div></div>}
		{toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast("")}><IconX size={16} /></button></div>}
		{dragging && <div className="drop-overlay"><IconFolderPlus size={48} stroke={1.3} /><h2>松开，添加到素材库</h2><p>支持照片、视频和文件夹</p></div>}
		{selected && <Viewer onDelete={() => void deleteAsset(selected, true)} deleteDisabled={driveBusy || deleting} deleting={deleting} onSimilar={!isVideoFile(selected.filename) ? () => void findSimilar(selected) : undefined} asset={selected} favorite={favoriteSet.has(selected.filename)} onFavorite={() => toggleFavorite(selected.filename)} onClose={() => setSelected(null)} onPrevious={selectedIndex > 0 ? () => selectAdjacent(-1) : undefined} onNext={selectedIndex < displayed.length - 1 ? () => selectAdjacent(1) : undefined} position={`${selectedIndex + 1} / ${displayed.length}`} notify={setToast} />}
		{contextMenu && <AssetContextMenu x={contextMenu.x} y={contextMenu.y} disabled={driveBusy || deleting} onClose={closeContextMenu} onSimilar={!isVideoFile(contextMenu.asset.filename) ? () => void findSimilar(contextMenu.asset) : undefined} onDelete={originalFile => void deleteAsset(contextMenu.asset, originalFile)} />}
		{settings && <Modal title="设置" subtitle="日常保持简单，细节由你掌控。" onClose={closeSettings}><div className="settings-section"><h3>搜索模型</h3><p>选择用于理解画面的模型。更换模型会重新建立素材索引。</p>{preview ? <div className="setting-note">模型设置在桌面版中可用，预览不会下载或切换模型。</div> : <><label className="field-label" htmlFor="model-select">当前模型</label><select id="model-select" className="settings-select" value={proposedModel} onChange={event => setProposedModel(event.target.value)} disabled={switching || !!migration}>{!models?.length && <option value="">正在读取模型…</option>}{models?.map(model => <option value={model.id} key={model.id}>{model.label}{model.downloaded ? " · 已下载" : " · 需要下载"}</option>)}</select><p className="setting-note">CLIP 适合常规场景；SigLIP-2-B 导入较快；SigLIP-2-L 可用于细节检索。切换前请留意模型下载与索引耗时。</p><button className="primary-button" disabled={!proposedModel || proposedModel === activeModelId || switching || !!migration} onClick={async () => { setSwitching(true); try { const result = await setModel(proposedModel); setToast(result.failures.length ? `模型已切换，${result.failures.length} 项索引失败` : "搜索模型已更新"); } catch { setToast("模型切换失败，请稍后重试。"); } finally { setSwitching(false); } }}>{switching || migration ? <IconLoader2 size={17} className="spin" /> : <IconCheck size={17} />}应用模型</button></>}</div><div className="settings-section"><h3>自动添加文件夹</h3><p>通过“添加素材”选择文件夹，新素材会自动加入资料库。</p>{watched.length ? watched.map(w => <div className="watched-row" key={w.path}><IconFolder size={18} /><div><strong>{w.path.split("/").pop()}</strong><small>{w.path}{!w.exists ? " · 路径不可用" : ""}</small></div><button className="text-button" onClick={async () => { try { const result = await window.memories.removeWatchedFolder(w.path); if (!result.ok) throw new Error(); await refresh(); setToast("已停止自动添加，现有素材仍保留。"); } catch { setToast("未能停止自动添加，请重试。"); } }}>停止同步</button></div>) : <div className="setting-note">暂无自动添加的文件夹</div>}<button className="secondary-button" disabled={isBusy} onClick={() => void addAssets()}><IconFolderPlus size={17} />添加文件夹</button></div><DriveSettings /><div className="settings-section"><h3>更多选项</h3><p>视频分析精度、文字识别语言、AI 问答和索引备份，可在原版界面中管理。</p>{preview ? <div className="setting-note">原版界面入口在桌面版中可用。</div> : <a className="secondary-button" href="?classic=1"><IconExternalLink size={16} />打开原版界面</a>}</div><div className="settings-footnote"><IconShieldCheck size={16} />本地检索 · 云端存储需授权</div></Modal>}
	</div>;
}

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
	return <div className="empty-state"><div className="empty-art"><div /><div /><span><IconPhoto size={39} stroke={1.2} /></span></div><h2>{title}</h2><p>{description}</p><button className="primary-button" onClick={onAction}><IconPlus size={17} />{action}</button><small>照片 · 视频 · 截图，都可以在这里找到</small></div>;
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null); useFocusTrap(ref, true);
	return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={ref} tabIndex={-1}><header><div><h2 id="settings-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="关闭设置" onClick={onClose}><IconX size={22} /></button></header><div className="settings-body">{children}</div></div></div>;
}

function Viewer({ asset, favorite, onFavorite, onClose, onPrevious, onNext, position, notify, onSimilar, onDelete, deleteDisabled, deleting }: { onDelete: () => void; deleteDisabled: boolean; deleting: boolean; onSimilar?: () => void; asset: Asset; favorite: boolean; onFavorite: () => void; onClose: () => void; onPrevious?: () => void; onNext?: () => void; position: string; notify: (message: string) => void }) {
	const ref = useRef<HTMLDivElement>(null); useFocusTrap(ref, true);
	const [details, setDetails] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => { setFailed(false); }, [asset.filename]);
	useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.target instanceof HTMLVideoElement || event.target instanceof HTMLInputElement) return; if (event.key === "ArrowLeft") { event.preventDefault(); onPrevious?.(); } if (event.key === "ArrowRight") { event.preventDefault(); onNext?.(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [onPrevious, onNext]);
	const video = isVideoFile(asset.filename), playable = isPlayableVideoFile(asset.filename);
	const reveal = async () => { if (preview) { notify("示例素材没有本地原文件；桌面版支持在 Finder 中定位。"); return; } try { const result = await window.memories.revealInFinder(asset.filename); if (!result.ok) throw new Error(); } catch { notify("无法在 Finder 中定位该文件。"); } };
	return <div className="viewer" ref={ref} role="dialog" aria-modal="true" aria-labelledby="viewer-title" tabIndex={-1}><header className="viewer-header"><button className="viewer-icon" onClick={onClose} aria-label="关闭预览"><IconArrowLeft size={21} /></button><div><h2 id="viewer-title">{asset.title}</h2><p>{position}{asset.bestScene ? ` · 匹配时刻 ${formatTimecode(asset.bestScene.t)}` : ""}</p></div><div className="viewer-actions"><button className="viewer-text viewer-delete" onClick={onDelete} disabled={deleteDisabled} title="将原文件移到废纸篓，并删除素材库副本" aria-label="删除原文件及素材库副本">{deleting ? <IconLoader2 size={17} className="spin" /> : <IconTrash size={17} />}{deleting ? "正在删除…" : "删除"}</button>{onSimilar && <button className="viewer-text" onClick={onSimilar}><IconSearch size={17} />查找相似照片</button>}<button className={`viewer-icon ${favorite ? "liked" : ""}`} onClick={onFavorite} aria-label={favorite ? "取消收藏" : "收藏"} aria-pressed={favorite}><IconHeart size={21} fill={favorite ? "currentColor" : "none"} /></button><button className="viewer-text" onClick={() => setDetails(v => !v)} aria-pressed={details}>详细信息</button><button className="viewer-text" onClick={() => void reveal()}><IconFolder size={17} />在 Finder 中显示</button><button className="viewer-icon" onClick={onClose} aria-label="退出预览"><IconX size={22} /></button></div></header><div className="viewer-content"><button className="viewer-arrow" disabled={!onPrevious} onClick={onPrevious} aria-label="上一项"><IconChevronLeft size={27} /></button><div className="viewer-media">{failed ? <div className="media-error"><IconPhoto size={36} /><p>暂时无法预览这个文件</p><button className="viewer-text" onClick={() => void reveal()}>在 Finder 中查看</button></div> : video && playable ? <video key={assetKey(asset)} src={original(asset)} controls autoPlay onError={() => setFailed(true)} onLoadedMetadata={event => { if (asset.bestScene) event.currentTarget.currentTime = asset.bestScene.t; }} /> : <img key={asset.filename} src={video ? thumbnail(asset) : original(asset)} alt={asset.title} onError={() => setFailed(true)} />}{video && !playable && <button className="external-video" onClick={async () => { try { const result = await window.memories?.openExternal?.(asset.filename); if (!result?.ok) notify("无法打开默认播放器，请在 Finder 中查看。"); } catch { notify("无法打开默认播放器。"); } }}>此格式请使用系统播放器打开 <IconExternalLink size={16} /></button>}</div><button className="viewer-arrow" disabled={!onNext} onClick={onNext} aria-label="下一项"><IconChevronRight size={27} /></button>{details && <aside className="detail-panel"><h3>素材信息</h3><dl><dt>名称</dt><dd>{asset.title}</dd><dt>类型</dt><dd>{video ? "视频" : "图片"} · {asset.filename.split(".").pop()?.toUpperCase()}</dd><dt>原始位置</dt><dd>{asset.sourcePath || "未记录"}</dd><dt>修改日期</dt><dd>{asset.modifiedAt ? new Date(asset.modifiedAt).toLocaleString("zh-CN") : "未记录"}</dd>{asset.bestScene?.snippet && <><dt>匹配对白</dt><dd>{asset.bestScene.snippet}</dd></>}{asset.ocr && <><dt>识别出的文字</dt><dd className="ocr-detail">{asset.ocr}</dd></>}</dl></aside>}</div><footer className="viewer-footer"><span><kbd>←</kbd><kbd>→</kbd> 切换素材</span><span><kbd>Esc</kbd> 关闭预览</span></footer></div>;
}
