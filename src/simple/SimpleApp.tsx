import { useTaskState } from "./taskState";
import { AiOriginPanel, useAiOrigins } from "./AiOrigins";
import { PhotoQualityStatus, usePhotoQuality } from "./PhotoQuality";
import { comparePhotoQuality, qualityLabel } from "./qualityRanking";
import { PeoplePanel, usePeople } from "./People";
import { CaptureDevicePanel, useCaptureDevices } from "./CaptureDevices";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconCheck, IconChevronLeft, IconChevronRight, IconFolder, IconFolderPlus, IconGridDots, IconHeart, IconCopy, IconLock, IconLockOpen, IconLayoutGrid, IconList, IconLoader2, IconPhoto, IconPlus, IconSearch, IconSettings, IconShieldCheck, IconSparkles, IconTrash, IconVideo, IconX, IconClock, IconExternalLink, IconDeviceDesktop, IconMenu2 } from "@tabler/icons-react";
import { useMemorySearch } from "@/hooks/useMemorySearch";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { isVideoFile, isPlayableVideoFile, thumbFor, posterFor, scenePosterFor, formatTimecode } from "@/lib/media";
import type { StatusPayload, WatchedFolder } from "@/types";
import { assetKey, inFolder, parentFolder, parseLibrary, readSaved, saveLocal, type Asset } from "./library";

import { detectionKind, imageTextQuery, matchesImageText } from "./detectionQuery";
import { ProgressToast } from "./ProgressToast";
import { MapSearch } from "./MapSearch";
import { assetFilter, compareKnown, emptyAssetFilters, formatFileSize, type FilterInput } from "./assetFilters";
import { AssetContextMenu } from "./AssetContextMenu";
import { DriveSettings, DriveTransfer } from "./DriveTransfer";

import { findDuplicateGroups, duplicateCleanupPlan } from "./duplicates";
import { VideoDuration } from "./VideoDuration";
import { FileTasks } from "./FileTasks";
import { CopyCleanup } from "./CopyCleanup";
import { ApplePhotos } from "./ApplePhotos";

type View = "ai-photos" | "ai-videos" | "all" | "photos" | "videos" | "screenshots" | "recordings" | "favorites" | "locked" | "duplicates";
type Mode = "files" | "scenes" | "ocr" | "dialogue";
const views = [
	{ id: "all", label: "所有素材", icon: IconLayoutGrid },
	{ id: "photos", label: "照片", icon: IconPhoto },
	{ id: "videos", label: "视频", icon: IconVideo },
	{ id: "screenshots", label: "手机/电脑截屏", icon: IconDeviceDesktop },
	{ id: "recordings", label: "手机/电脑录屏", icon: IconVideo },
	{ id: "ai-photos", label: "AI 生成图片", icon: IconSparkles },
	{ id: "ai-videos", label: "AI 生成视频", icon: IconSparkles },
	{ id: "favorites", label: "我的收藏", icon: IconHeart },
	{ id: "locked", label: "锁定文件", icon: IconLock },
	{ id: "duplicates", label: "重复文件", icon: IconCopy },
] as const;
const modes = [
	{ id: "files", label: "画面描述", placeholder: "描述你想找的画面，比如：海边的日落", hint: "支持画面描述、二维码、条形码，或输入「图片文字：订单编号」。" },
	{ id: "scenes", label: "视频片段", placeholder: "描述视频中的一个镜头，比如：走进森林", hint: "找到具体镜头，直接跳到对应时刻。" },
	{ id: "ocr", label: "图片文字", placeholder: "输入画面里的文字、地址或订单号", hint: "查找照片和截图里出现的文字。" },
	{ id: "dialogue", label: "视频对白", placeholder: "输入视频里说过的一句话", hint: "根据已识别的对白，定位说话的时刻。" },
] as const;
const RESULT_PAGE_SIZE = 90;
const preview = !window.memories;
const storagePrefix = preview ? "scm-simple-preview-" : "scm-simple-";
const matchLabels = { semantic: "画面匹配", phrase: "名称匹配", filename: "名称匹配", ocr: "文字匹配" };

function thumbnail(asset: Asset) {
	if (asset.previewUrl) return asset.previewUrl;
	if (asset.bestScene && asset.bestScene.poster >= 0) return scenePosterFor(encodeURIComponent(asset.filename), asset.bestScene.poster);
	return isVideoFile(asset.filename) ? posterFor(encodeURIComponent(asset.filename)) : thumbFor(encodeURIComponent(asset.filename));
}
function original(asset: Asset) { return asset.mediaUrl || `/images/projects/${encodeURIComponent(asset.filename)}`; }
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function dateLabel(date: number) { return date ? dateFormatter.format(date) : "日期未知"; }

function indexSummary(status: {indexed:number;total:number;pending:number;failed:number;paused:boolean;reconciling:boolean} | undefined, kind:string) {
 if (!status) return "读取本地检测索引";
 return `本地索引 ${status.indexed} / ${status.total} · ${kind === "text" ? "OCR 待完成" : status.paused ? "后台已暂停，待检测" : "后台待检测"} ${status.pending}${status.failed ? ` · 失败 ${status.failed}` : ""}${status.reconciling ? " · 正在核对文件变化" : ""}`;
}
export default function SimpleApp() {
	const [applePhotosActive, setApplePhotosActive] = useState(false);
	const [mapOpen, setMapOpen] = useState(false);
 const [mapDistances, setMapDistances] = useState<Map<string, number> | null>(null);
 const applyMapFilter = useCallback((value: Map<string, number> | null) => { setMapDistances(value); setSelectedFiles(new Set()); setLimit(RESULT_PAGE_SIZE); }, []);
 const [assets, setAssets] = useState<Asset[]>([]);
 const [peopleOpen,setPeopleOpen]=useTaskState("people-open", false);
 const [selectedPeople,setSelectedPeople]=useState<Set<string>>(new Set());
 const peopleController=usePeople(peopleOpen);
 const peopleFiles=useMemo(()=>new Set(peopleController.people.filter(p=>selectedPeople.has(p.id)).flatMap(p=>p.files)),[peopleController.people,selectedPeople]);
 const knownPeopleFiles=useMemo(()=>{const known=new Set(assets.map(a=>a.filename));return [...peopleFiles].filter(n=>known.has(n));},[assets,peopleFiles]);
 const personMatches=useCallback((name:string)=>!peopleOpen||!selectedPeople.size||peopleFiles.has(name),[peopleOpen,selectedPeople,peopleFiles]);
 const [deviceOpen,setDeviceOpen]=useTaskState("device-open", false);
 const [deviceBrand,setDeviceBrand]=useState('');
 const [deviceModel,setDeviceModel]=useState('');
 const deviceIndex=useCaptureDevices(assets,deviceOpen);
 const deviceMatches=useCallback((name:string)=>!deviceOpen || ((!deviceBrand || deviceIndex.devices.get(name)?.brand===deviceBrand) && (!deviceModel || deviceIndex.devices.get(name)?.model===deviceModel)),[deviceOpen,deviceBrand,deviceModel,deviceIndex.devices]);
 const duplicates = useMemo(() => findDuplicateGroups(assets), [assets]);
	const [loaded, setLoaded] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [watched, setWatched] = useState<WatchedFolder[]>([]);
	const [view, setView] = useTaskState<View>("view", "all");
 const aiView = view === "ai-photos" || view === "ai-videos";
 const aiOrigins = useAiOrigins(assets, aiView);
 const [includeSuspectedAi, setIncludeSuspectedAi] = useState(true);
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
	const [qrProgress, setQrProgress] = useState("");
 const [indexPaused, setIndexPaused] = useState(false);
 const [indexedSearch, setIndexedSearch] = useState(false);
	const [searchFailure, setSearchFailure] = useState("");
	const [translatedQuery, setTranslatedQuery] = useState("");
	const [translating, setTranslating] = useState(false);
	const [favorites, setFavorites] = useState<string[]>(() => { const value = readSaved<unknown>(storagePrefix + "favorites", []); return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []; });
	const [recent, setRecent] = useState<string[]>(() => { const value = readSaved<unknown>(storagePrefix + "recent", []); return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 4) : []; });
	const [layout, setLayout] = useState<"grid" | "dense" | "list">("grid");
	const [sort, setSort] = useTaskState("sort", "newest");
 const [filterOpen, setFilterOpen] = useState(false);
 const [filters, setFilters] = useState<FilterInput>(emptyAssetFilters);
 const filter = useMemo(() => assetFilter(filters), [filters]);
 const [fileSizes, setFileSizes] = useState<Record<string, number | null>>({});
 const [sizeProgress, setSizeProgress] = useState<{done:number; total:number} | null>(null);
 const [sizeError, setSizeError] = useState("");
 const [sizeRetry, setSizeRetry] = useState(0);
	const [limit, setLimit] = useState(RESULT_PAGE_SIZE);
	const [selected, setSelected] = useState<Asset | null>(null);
 const [contextMenu, setContextMenu] = useState<{asset: Asset; x: number; y: number} | null>(null);
 const [deleting, setDeleting] = useState(false);
 const [filesLocked, setFilesLocked] = useState(true);
 const [lockReady, setLockReady] = useState(false);
 const [lockPending, setLockPending] = useState(false);
 useEffect(() => {
  const readLock = () => {
   if (preview) { setFilesLocked(localStorage.getItem("sayphoto-file-lock") === "true"); setLockReady(true); return; }
   void window.memories.getFileLock().then(value => { setFilesLocked(value); setLockReady(true); }).catch(() => { setFilesLocked(true); setLockReady(false); });
  };
  readLock(); window.addEventListener("focus", readLock);
  return () => window.removeEventListener("focus", readLock);
 }, []);
 async function toggleFileLock() {
  setLockPending(true);
  try {
   const next = !filesLocked;
   if (preview) { localStorage.setItem("sayphoto-file-lock", String(next)); setFilesLocked(next); }
   else { const result = await window.memories.setFileLock(next); if (!result.ok || typeof result.locked !== "boolean") throw Error(result.error || "无法更改锁定状态"); setFilesLocked(result.locked); }
  } catch (error) { setToast(error instanceof Error ? error.message : "无法更改锁定状态"); }
  finally { setLockPending(false); }
 }
 const [showLocked, setShowLocked] = useState(true);
 const includesLocked = view === "locked" || showLocked;
 const [lockedFiles, setLockedFiles] = useState<Set<string>>(new Set());
 const [assetLocksReady, setAssetLocksReady] = useState(false);
 const [assetLockPending, setAssetLockPending] = useState(false);
 const assetLockBusy = useRef(false);
 useEffect(() => {
  let active = true;
  const read = async () => {
   try {
    const names: string[] = preview ? JSON.parse(localStorage.getItem(storagePrefix + "locks") || "[]") : await window.memories.getAssetLocks();
    if (active && !assetLockBusy.current) { setLockedFiles(new Set(names)); setAssetLocksReady(true); }
   } catch { if (active) setAssetLocksReady(false); }
  };
  void read(); window.addEventListener("focus", read);
  return () => { active = false; window.removeEventListener("focus", read); };
 }, []);
 async function changeAssetLocks(names: string[], locked: boolean) {
  if (!assetLocksReady || assetLockBusy.current || deleting || driveBusy || !names.length) return;
  assetLockBusy.current = true; setAssetLockPending(true);
  try {
   if (preview) {
    const next = new Set(lockedFiles); names.forEach(name => locked ? next.add(name) : next.delete(name));
    localStorage.setItem(storagePrefix + "locks", JSON.stringify([...next])); setLockedFiles(next);
   } else {
    const result = await window.memories.setAssetLocks(names, locked);
    if (!result.ok || !result.filenames) throw Error(result.error || "无法保存素材锁定状态");
    setLockedFiles(new Set(result.filenames));
   }
   setToast(`${locked ? "已锁定" : "已解除锁定"} ${names.length} 个文件${locked ? "，不可删除" : ""}`);
  } catch (error) { setToast(error instanceof Error ? error.message : "无法保存锁定状态"); }
  finally { assetLockBusy.current = false; setAssetLockPending(false); }
 }
 const closeContextMenu = useCallback(() => setContextMenu(null), []);

	const [selectionMode, setSelectionMode] = useState(false);
	const [driveBusy, setDriveBusy] = useState(false);
	const [selectedFileState, setSelectedFiles] = useState<Set<string>>(new Set());
 const selectableName = useCallback((name: string) => personMatches(name) && deviceMatches(name) && (view !== "duplicates" || duplicates.byFilename.has(name)) && (view !== "locked" || lockedFiles.has(name)) && (includesLocked || (assetLocksReady && !lockedFiles.has(name))), [view, duplicates, lockedFiles, includesLocked, assetLocksReady, deviceMatches, personMatches]);
 const selectedFiles = useMemo(() => new Set([...selectedFileState].filter(selectableName)), [selectedFileState, selectableName]);
 useEffect(() => {
  setSelectedFiles(previous => {
   const next = new Set([...previous].filter(selectableName));
   return next.size === previous.size ? previous : next;
  });
  setSelected(previous => previous && !selectableName(previous.filename) ? null : previous);
  setContextMenu(previous => previous && !selectableName(previous.asset.filename) ? null : previous);
 }, [selectableName]);
 const selectedLockedCount = [...selectedFiles].filter(name => lockedFiles.has(name)).length;
 const lockActionDisabled = !assetLocksReady || assetLockPending || deleting || driveBusy;
 const [selectionCount, setSelectionCount] = useState("");
	const toggleSelection = (filename: string) => setSelectedFiles(previous => {
		const next = new Set(previous); if (next.has(filename)) next.delete(filename); else next.add(filename); return next;
	});
	const [settings, setSettings] = useState(false);
	const [mobileNav, setMobileNav] = useState(false);
	const [toast, setToastMessage] = useState("");
 const [toastIsDelete, setToastIsDelete] = useState(false);
 const setToast = useCallback((message: string) => { setToastIsDelete(false); setToastMessage(message); }, []);
 const showDeleteToast = useCallback((message: string) => { setToastIsDelete(true); setToastMessage(message); }, []);
	const [importing, setImporting] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [progress, setProgress] = useState<{ label: string; done: number; total: number; paused?: boolean } | null>(null);
	const [engine, setEngine] = useState("loading");
	const [switching, setSwitching] = useState(false);
	const [proposedModel, setProposedModel] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	const scrollRef = useRef<HTMLElement>(null);
	const sequence = useRef(0);
	const dragDepth = useRef(0);
	const names = useMemo(() => assets.map(a => a.filename), [assets]);

	const searchApi = useMemorySearch(names);
	const { search, searchScenes, searchDialogue, searchOcr, prewarm, models, activeModelId, migration, partialSearch, setModel } = searchApi;
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
				else setProgress({ label: status.phase === "scanning" ? "正在扫描素材" : status.phase === "copying" ? "正在添加素材" : "正在建立搜索索引", done: status.done ?? 0, total: status.total ?? 0, paused: !!status.paused });
			}
		};
		void window.memories.getIndexerStatus().then(s => s && receive(s)).catch(() => setEngine("error"));
		void window.memories.getImportState().then(receive).catch(() => {});
		return window.memories.onStatus(receive);
	}, [refresh]);
	useEffect(() => { prewarm(); }, [prewarm]);
	useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 4500); return () => clearTimeout(id); }, [toast]);
	useEffect(() => { saveLocal(storagePrefix + "favorites", favorites); }, [favorites]);
	useEffect(() => { saveLocal(storagePrefix + "recent", recent); }, [recent]);
	useEffect(() => { setProposedModel(activeModelId ?? ""); }, [activeModelId, settings]);
	useEffect(() => { document.documentElement.classList.remove("dark"); document.title = "SayPhoto 说图"; }, []);

 const applyImportSnapshot = (status: Extract<StatusPayload, {type:"import"}>) => {
  setProgress(status.active && status.phase !== "done" ? {label: "正在添加素材",done:status.done ?? 0,total:status.total ?? 0,paused:!!status.paused} : null);
 };
 const toggleImportPause = async () => { applyImportSnapshot(await window.memories.setImportPaused(!progress?.paused)); };
 const refreshImportProgress = async () => { applyImportSnapshot(await window.memories.getImportState()); await refresh(); };

	const addAssets = useCallback(async (paths?: string[]) => {
		if (preview) { setToast("这是界面预览。请在桌面版中添加本地照片、视频或文件夹。"); return; }
		if (importing) return;
		setImporting(true);
		try {
			const result = paths ? await window.memories.importPaths(paths) : await window.memories.pickPhotos();
			if (result) {
				setToast(`已添加 ${result.added.length} 项${result.skipped.length ? `，跳过 ${result.skipped.length} 项重复素材` : ""}${result.errors.length ? `；${result.errors.length} 项导入失败：${result.errors[0]?.error || "文件无法读取"}` : ""}`);
				await refresh();
			}
		} catch { setToast("添加失败，请检查文件是否可访问后重试。"); }
		finally { setImporting(false); }
	}, [importing, refresh]);

	const runSearch = useCallback(async (text: string, selectedMode: Mode = mode) => {
		setSimilarReference(null); setQrProgress(""); setIndexedSearch(false);
		const value = text.trim(); const codeKind = detectionKind(value); const textQuery = imageTextQuery(value, selectedMode); const seq = ++sequence.current;
		setDraft(text); setQuery(value); setMode(selectedMode); setLimit(RESULT_PAGE_SIZE); setSearchFailure(""); setTranslatedQuery(""); setTranslating(false);
		if (!value) { setResults(null); setSearching(false); return; }
		setResults(null); setSearching(true);
		setRecent(prev => [value, ...prev.filter(v => v !== value)].slice(0, 4));
		try {
			let next: Asset[];
			if (!preview && (textQuery !== null || (selectedMode === "files" && codeKind))) {
    const kind = textQuery !== null ? "text" : codeKind!;
    const response = await window.memories.detectionSearch(kind, textQuery || "");
    if (seq !== sequence.current) return;
    if (!response.ok) throw new Error(response.error || "无法读取本地检测索引");
    const found = new Set(response.filenames);
    const label = kind === "text" ? "已识别图片文字" : kind === "qr" ? "检测到二维码" : "检测到条形码";
    next = assets.filter(a => found.has(a.filename)).map(a => ({...a, detectedLabel:label}));
    setIndexedSearch(true); setIndexPaused(!!response.status?.paused);
    setQrProgress(indexSummary(response.status, kind));
    if (!next.length) setSearchFailure("本地索引暂无匹配。后台检测完成后结果会自动更新；未完成或识别失败的图片不会作为命中显示。");
   } else if (preview) {
    next = textQuery !== null ? assets.filter(a => matchesImageText(a.ocr,textQuery)).map(a=>({...a,detectedLabel:"已识别图片文字"})) : assets.filter(a => selectedMode === "files" && value.toLowerCase().split(/\s+/).every(t=>`${a.title} ${a.tags}`.toLowerCase().includes(t)));

   } else {
				if (migration && selectedMode === "scenes") throw new Error("正在更新搜索索引，画面搜索暂不可用。更新完成后请重新搜索；这不代表素材库中没有匹配图片。");
				if ((selectedMode === "files" || selectedMode === "scenes") && /\p{Script=Han}/u.test(value)) {
					setTranslating(true);
					const translation = await window.memories.translateSearch(value);
					if (seq !== sequence.current) return;
					setTranslating(false);
					if (!translation.ok) { setResults([]); setSearchFailure(translation.error); return; }
					setTranslatedQuery(translation.text);
				}
				if (seq !== sequence.current) return;
				if (!migration) await prewarm();
				const count = Math.max(assets.length, 100);
				const matches = selectedMode === "scenes" ? await searchScenes(value, count * 3) : selectedMode === "dialogue" ? await searchDialogue(value, count * 3) : selectedMode === "ocr" ? searchOcr(value, count) : await search(value, count);
				let currentAssets = assets;
    const knownNames = new Set(assets.map(asset => asset.filename));
    if (matches.some(match => !knownNames.has(match.filename))) {
     const response = await fetch("/memories-index.json");
     if (!response.ok) throw new Error("素材列表刷新失败，请重试。");
     currentAssets = parseLibrary(await response.json());
     if (seq !== sequence.current) return;
     setAssets(currentAssets);
    }
    const byName = new Map(currentAssets.map(a => [a.filename, a]));
				next = matches.flatMap(match => { const asset = byName.get(match.filename); return asset ? [{ ...asset, ...match }] : []; });
			}
			if (seq === sequence.current) setResults(next);
		} catch (error) { if (seq === sequence.current) { setResults([]); setQrProgress(""); setSearchFailure(error instanceof Error ? error.message : "搜索暂时失败，请稍后重试。"); } }
		finally { if (seq === sequence.current) { setSearching(false); setTranslating(false); } }
	}, [mode, assets, migration, prewarm, search, searchScenes, searchDialogue, searchOcr]);

 const liveRefreshNeeded = applePhotosActive || !!migration || !!progress || importing || !!partialSearch;
 const wasLiveSearch = useRef(false);
 useEffect(() => {
  const finishing = wasLiveSearch.current && !liveRefreshNeeded;
  wasLiveSearch.current = liveRefreshNeeded;
  if (preview || !query || mode !== "files" || indexedSearch || detectionKind(query) || imageTextQuery(query, mode) !== null || (!liveRefreshNeeded && !finishing)) return;
  let canceled = false, busy = false;
  const refreshResults = async () => {
   if (busy) return;
   busy = true;
   const seq = sequence.current;
   try {
    const matches = await search(query, Math.max(assets.length, 100));
    if (canceled || seq !== sequence.current) return;
    let currentAssets = assets;
    const knownNames = new Set(assets.map(asset => asset.filename));
    if (matches.some(match => !knownNames.has(match.filename))) {
     const response = await fetch("/memories-index.json");
     if (!response.ok) throw new Error("素材列表刷新失败，请重试。");
     currentAssets = parseLibrary(await response.json());
     if (seq !== sequence.current) return;
     setAssets(currentAssets);
    }
    const byName = new Map(currentAssets.map(a => [a.filename, a]));
    setResults(matches.flatMap(match => { const asset = byName.get(match.filename); return asset ? [{ ...asset, ...match }] : []; }));
    setSearchFailure("");
   } catch (error) {
    if (!canceled && seq === sequence.current) setSearchFailure(error instanceof Error ? error.message : "搜索暂不可用，请稍后重试。");
   } finally { busy = false; }
  };
  if (finishing) void refreshResults();
  const timer = liveRefreshNeeded ? setInterval(() => void refreshResults(), 5000) : undefined;
  return () => { canceled = true; clearInterval(timer); };
 }, [query, mode, assets, indexedSearch, liveRefreshNeeded, search]);

 useEffect(() => {
  if (!indexedSearch || preview || !query) return;
  const textQuery = imageTextQuery(query,mode), kind = textQuery !== null ? "text" : mode === "files" ? detectionKind(query) : null;
  if (!kind) return;
  let canceled=false, inFlight=false;
  const update = async () => {
   if(inFlight)return;inFlight=true;
   try {
    const response=await window.memories.detectionSearch(kind,textQuery || "");
    if(canceled)return;
    if(!response.ok) {setQrProgress(response.error || "索引读取失败");return;}
    const names=new Set(response.filenames),label=kind==="text"?"已识别图片文字":kind==="qr"?"检测到二维码":"检测到条形码";
    setResults(assets.filter(a=>names.has(a.filename)).map(a=>({...a,detectedLabel:label})));
    setQrProgress(indexSummary(response.status,kind));setIndexPaused(!!response.status?.paused);
   } catch { if(!canceled)setQrProgress("索引读取失败，请重试"); }
   finally {inFlight=false;}
  };
  const timer=setInterval(()=>void update(),3000);
  return ()=>{canceled=true;clearInterval(timer)};
 },[indexedSearch,query,mode,assets]);

	const toggleFavorite = (name: string) => setFavorites(prev => prev.includes(name) ? prev.filter(v => v !== name) : [...prev, name]);
	const selectView = (id: View, path = "") => { setView(id); if (id === "duplicates") setSort("newest"); setFolder(path); setMobileNav(false); setLimit(RESULT_PAGE_SIZE); scrollRef.current?.scrollTo({ top: 0 }); };
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (!settings && !selected) searchInput.current?.focus(); }
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") { event.preventDefault(); if (!settings && !selected) void addAssets(); }
			if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); setSelected(null); setSettings(true); }
			if (event.key === "Escape") { setSelected(null); setSettings(false); setMobileNav(false); }
		};
		window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
	}, [addAssets, settings, selected]);

	const acceptsView = useCallback((asset: Asset, id: View) => id === "all" || ((id === "ai-photos" || id === "ai-videos") && isVideoFile(asset.filename) === (id === "ai-videos") && (aiOrigins.matches.get(asset.filename)?.status === "marked" || (includeSuspectedAi && aiOrigins.matches.get(asset.filename)?.status === "suspected"))) || (id === "photos" && !isVideoFile(asset.filename)) || (id === "videos" && isVideoFile(asset.filename)) || (id === "screenshots" && asset.category === "Screenshots") || (id === "recordings" && asset.category === "ScreenRecordings") || (id === "favorites" && favorites.includes(asset.filename)) || (id === "locked" && lockedFiles.has(asset.filename)) || (id === "duplicates" && duplicates.byFilename.has(asset.filename)), [favorites, lockedFiles, duplicates, aiOrigins.matches, includeSuspectedAi]);
	const filteredAssets = useMemo(() => (results ?? assets).filter(a => personMatches(a.filename) && deviceMatches(a.filename) && (includesLocked || (assetLocksReady && !lockedFiles.has(a.filename))) && filter.matches(fileSizes[a.filename], a.modifiedAt) && (!similarReference || a.score >= similarThreshold) && acceptsView(a, view) && (!folder || inFolder(a.sourcePath, folder)) && (!mapDistances || mapDistances.has(a.filename))), [assets, results, personMatches, deviceMatches, includesLocked, assetLocksReady, lockedFiles, filter, fileSizes, similarReference, similarThreshold, acceptsView, view, folder, mapDistances]);
 const qualitySort = sort === "quality" || sort === "quality-asc";
 const photoQuality = usePhotoQuality(filteredAssets, qualitySort);
 const qualityOrder = useRef<string[]>([]);
 const committedQuality = useRef(photoQuality.rankingRecords);
 const committedQualitySort = useRef(sort);
 const displayed = useMemo(() => {
  const entries = filteredAssets;
  if (qualitySort) {
   if (committedQuality.current !== photoQuality.rankingRecords || (qualitySort && committedQualitySort.current !== sort && Object.keys(photoQuality.rankingRecords).length > 0)) return [...entries].sort((a, b) => comparePhotoQuality(a.filename, b.filename, photoQuality.rankingRecords, sort === "quality-asc"));
   const order = new Map(qualityOrder.current.map((name, index) => [name, index]));
   return [...entries].sort((a, b) => (order.get(assetKey(a)) ?? Infinity) - (order.get(assetKey(b)) ?? Infinity));
  }
		if (view === "duplicates" && sort === "newest") return [...entries].sort((a,b) => duplicates.byFilename.get(a.filename)!.id - duplicates.byFilename.get(b.filename)!.id || a.title.localeCompare(b.title, "zh-CN"));
		if (sort === "size-desc" || sort === "size-asc") return [...entries].sort((a,b) => compareKnown(fileSizes[a.filename],fileSizes[b.filename],sort === "size-desc") || a.filename.localeCompare(b.filename));
  if (sort === "date-desc" || sort === "date-asc") return [...entries].sort((a,b) => compareKnown(a.modifiedAt > 0 ? a.modifiedAt : null,b.modifiedAt > 0 ? b.modifiedAt : null,sort === "date-desc") || a.filename.localeCompare(b.filename));
		if (mapDistances && sort === "newest") return [...entries].sort((a, b) => mapDistances.get(a.filename)! - mapDistances.get(b.filename)!);
		if (results !== null && sort === "newest") return entries;
		return [...entries].sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : b.modifiedAt - a.modifiedAt);
	}, [filteredAssets, photoQuality.rankingRecords, qualitySort, results, view, sort, mapDistances, duplicates]);
 useEffect(() => {
  qualityOrder.current = displayed.map(assetKey);
  committedQuality.current = photoQuality.rankingRecords;
  committedQualitySort.current = sort;
 }, [displayed, photoQuality.rankingRecords, sort]);
	// Only size-based operations need metadata for the entire library.
	const needsAllSizes = !!filters.minSize || !!filters.maxSize || sort === "size-desc" || sort === "size-asc";
	const sizeNamesKey = useMemo(() => JSON.stringify([...new Set([...selectedFiles, ...(needsAllSizes ? names : displayed.slice(0, limit).map(a => a.filename))])]), [needsAllSizes, names, displayed, limit, selectedFiles]);
 const selectedSize = useMemo(() => {
  let bytes = 0, pending = 0, unavailable = 0;
  for (const name of selectedFiles) {
   const size = fileSizes[name];
   if (size === undefined) pending++;
   else if (size === null || !Number.isFinite(size) || size < 0) unavailable++;
   else bytes += size;
  }
  return { bytes, pending, unavailable };
 }, [selectedFiles, fileSizes]);
	const sizeCache = useRef<Record<string, number | null>>({});
	useEffect(() => {
		if (preview) return;
		let canceled = false;
		const files: string[] = JSON.parse(sizeNamesKey);
		const missing = files.filter(name => !(name in sizeCache.current) || (sizeRetry > 0 && sizeCache.current[name] === null));
		setSizeError("");
		setSizeProgress(missing.length ? { done: 0, total: missing.length } : null);
		void (async () => {
			let lastPublish = performance.now();
			try {
				for (let i = 0; i < missing.length; i += 100) {
					if (canceled) return;
					const rows = await window.memories.fileSizes(missing.slice(i, i + 100));
					for (const row of rows) sizeCache.current[row.filename] = row.size;
					if (canceled) return;
					const done = Math.min(i + 100, missing.length);
					// Batch publication: avoid re-sorting a large library after every IPC.
					if (done === missing.length || performance.now() - lastPublish >= 1000) {
						setFileSizes({ ...sizeCache.current });
						setSizeProgress({ done, total: missing.length });
						lastPublish = performance.now();
					}
				}
				if (!canceled) setFileSizes({ ...sizeCache.current });
			} catch { if (!canceled) setSizeError("文件大小读取失败，可重试；未知大小的文件不会出现在大小范围筛选结果中。"); }
			finally { if (!canceled) setSizeProgress(null); }
		})();
		return () => { canceled = true; };
	}, [sizeNamesKey, sizeRetry]);

	const folders = useMemo(() => Array.from(new Set([...watched.map(f => f.path), ...assets.map(a => parentFolder(a.sourcePath)).filter(Boolean)])), [watched, assets]);
	const viewCounts = useMemo(() => Object.fromEntries(views.map(({ id }) => [id, assets.filter(a => acceptsView(a, id)).length])), [assets, acceptsView]);
	const folderCounts = useMemo(() => {
		const counts: Record<string, number> = Object.create(null);
		for (const asset of assets) {
			const path = asset.sourcePath.replace(/\\/g, "/");
			for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1)) {
				const parent = path.slice(0, i);
				counts[parent] = (counts[parent] ?? 0) + 1;
			}
		}
		return Object.fromEntries(folders.map(folder => [folder, counts[folder.replace(/\/$/, "")] ?? 0]));
	}, [assets, folders]);

	useEffect(() => { setSelectedFiles(new Set()); }, [query, mode, view, folder, similarReference, similarThreshold, filters]);
	useEffect(() => { const known = new Set(names); setSelectedFiles(previous => new Set([...previous].filter(name => known.has(name)))); }, [assets]);
	const resultFiles = useMemo(() => [...new Set(displayed.map(asset => asset.filename))], [displayed]);
 const duplicatePlan = useMemo(() => duplicateCleanupPlan(duplicates.groups, lockedFiles, new Set(resultFiles)), [duplicates, lockedFiles, resultFiles]);
 const fileOrdinals = useMemo(() => new Map(resultFiles.map((name, index) => [name, index + 1])), [resultFiles]);
 const requestedSelectionCount = Number(selectionCount);
 const validSelectionCount = /^\d+$/.test(selectionCount) && Number.isSafeInteger(requestedSelectionCount) && requestedSelectionCount >= 1 && requestedSelectionCount <= resultFiles.length;
 const selectionBusy = searching || driveBusy || deleting || assetLockPending || !assetLocksReady;
 function selectFileCount() {
  if (selectionBusy || !validSelectionCount) return;
  setSelectedFiles(new Set(resultFiles.slice(0, requestedSelectionCount)));
 }
	const heading = folder ? folder.split("/").pop() : views.find(v => v.id === view)?.label;
	const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
	const selectedIndex = selected ? displayed.findIndex(a => assetKey(a) === assetKey(selected)) : -1;
	const selectAdjacent = (offset: number) => { const asset = displayed[selectedIndex + offset]; if (asset) setSelected(asset); };
	const statusLabel = preview ? "界面预览 · 示例素材" : engine === "error" ? "搜索模型暂不可用" : engine === "ready" ? "本地搜索已就绪" : "正在准备搜索模型";
	const isBusy = importing || !!migration || driveBusy || deleting;

 async function findSimilar(asset: Asset) {
  closeContextMenu();
  if (deleting || driveBusy) return;
  if (preview) { setToast("相似照片搜索请在桌面版使用。"); return; }
  const seq = ++sequence.current;
  setSelected(null); setSearching(true); setTranslating(false); setTranslatedQuery(""); setSearchFailure("");
  setQuery(""); setDraft(""); setMode("files"); setView("photos"); setFolder(""); setMapOpen(false); setMapDistances(null);
  setSimilarReference(asset); setResults([]); setSort("newest"); setLimit(RESULT_PAGE_SIZE); setSelectionMode(true); setSelectedFiles(new Set()); setDeleteReport("");
  try {
   const response = await window.memories.similarPhotos(asset.filename);
   if (seq !== sequence.current) return;
   if (!response.ok) throw Error(response.error || "相似照片搜索失败。");
   const byName = new Map(assets.map(item => [item.filename,item]));
   setResults((response.matches || []).flatMap(match => { const found = byName.get(match.filename); return found ? [{...found,...match}] : []; }));
  } catch (error) { if (seq === sequence.current) { setResults([]); setSearchFailure(error instanceof Error ? error.message : "查找失败"); } }
  finally { if (seq === sequence.current) setSearching(false); }
 }
 async function deleteBatch(extraOnly = false) {
  if (!assetLocksReady || assetLockPending) return;
  if (filesLocked || (!extraOnly && selectedLockedCount > 0)) { showDeleteToast("文件已锁定，请先解除锁定。"); return; }
  if (deleting || driveBusy || searching) return;
  const targets = extraOnly ? new Set(duplicatePlan.keys()) : selectedFiles;
  if (!targets.size) return;
  const batch = assets.filter(item => targets.has(item.filename));
  const paths = batch.slice(0,8).map(item => item.sourcePath || item.title).join("\n");
  if (!window.confirm(`${extraOnly ? "删除当前筛选范围内的多余重复文件" : "删除选中的文件"}：共 ${batch.length} 个？${extraOnly ? "\n仅处理已锁定原图的组，锁定文件全部保留；删除前重新校验内容。" : ""}\n普通原文件移到系统废纸篓；Apple照片通过系统图库删除并进入“最近删除”，可能同步到iCloud及其他设备；Live Photo的照片和视频、RAW及配套原件一起删除；移除文件引用及搜索记录。网盘同步目录中的删除可能同步到云端。\n\n${paths}${batch.length > 8 ? "\n…其余文件也将删除" : ""}`)) return;
  setDeleting(true); setDeleteReport("");
  const removed = new Set<string>(), errors: string[] = [];
  try {
   setDeleteProgress(`正在删除 ${batch.length} 个文件`);
   const response = preview ? {ok:true,results:batch.map(asset=>({filename:asset.filename,ok:true,error:undefined}))} : await window.memories.deleteBatch(batch.map(asset=>({filename:asset.filename,original:true,...(extraOnly?{duplicateKeeper:duplicatePlan.get(asset.filename)}:{})})));
   if(!response.ok) errors.push(response.error||"删除中断，未完成任务已保留");
   for(const item of response.results||[]) {if(item.ok)removed.add(item.filename);else errors.push(`${item.filename}：${item.error||"删除失败"}`);}
  } catch(error) { errors.push(error instanceof Error?error.message:"删除中断，任务已保留");
  } finally {
   sequence.current++; setSearching(false); setTranslating(false);
   setAssets(previous => previous.filter(item => !removed.has(item.filename)));
   setResults(previous => previous ? previous.filter(item => !removed.has(item.filename)) : previous);
   setSelectedFiles(previous => new Set([...previous].filter(name => !removed.has(name))));
   setFavorites(previous => previous.filter(name => !removed.has(name)));
   setDeleteReport(`已删除 ${removed.size} 个，失败 ${errors.length} 个。${errors.length ? "未完成任务已保留。 " + errors.slice(0,3).join("；") : "普通文件移入废纸篓；Apple照片删除已由系统图库确认。"}`);
   setDeleteProgress(""); setDeleting(false);
  }
 }
 async function deleteAsset(asset: Asset, originalFile = false) {
  if (!assetLocksReady || assetLockPending) return;
  if (filesLocked || lockedFiles.has(asset.filename)) { showDeleteToast("文件已锁定，请先解除锁定。"); return; }
  closeContextMenu();
  if (driveBusy || deleting) { showDeleteToast("正在传输或删除文件，请稍后重试。"); return; }
  if (!window.confirm(`删除“${asset.title}”？\n${originalFile ? `普通原文件移到系统废纸篓；Apple照片从系统图库删除、进入“最近删除”，可能同步到iCloud及其他设备；Live Photo的照片和视频、RAW及配套原件一起删除；移除文件引用及搜索记录。\n原文件：${asset.sourcePath || "未记录（无法删除原文件）"}\n若原文件在网盘同步目录中，删除可能同步到云端。` : "仅删除软件素材库副本及搜索记录，最初导入的原文件保留。"}${isVideoFile(asset.filename) ? "\n同一视频的所有片段会一起移除。" : ""}`)) return;
  setDeleting(true);
  try {
   if (!preview) { const result = await window.memories.deleteMemory(asset.filename, { original: originalFile }); if (!result.ok) throw Error(result.error || "删除失败，请等待当前任务结束后重试。"); }
   sequence.current++; setSearching(false); setTranslating(false);
   setAssets(previous => previous.filter(item => item.filename !== asset.filename));
   setResults(previous => previous ? previous.filter(item => item.filename !== asset.filename) : previous);
   setSelectedFiles(previous => new Set([...previous].filter(name => name !== asset.filename)));
   setFavorites(previous => previous.filter(name => name !== asset.filename));
   setSelected(previous => previous?.filename === asset.filename ? null : previous);
   showDeleteToast(preview ? "已从示例列表移除。" : originalFile ? "已移除素材；普通文件移入废纸篓；Apple照片删除已由系统图库确认。" : "已移除文件引用，原文件保留。");
  } catch (error) { showDeleteToast(error instanceof Error ? error.message : "删除失败，请重试。"); }
  finally { setDeleting(false); }
 }
	const activeProgress = migration ?? progress;

	const closeSettings = () => setSettings(false);

	return <div className="simple-app" onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (preview) { void addAssets(); return; } const paths = Array.from(event.dataTransfer.files).map(f => window.memories.getPathForFile(f)).filter(Boolean); if (paths.length) void addAssets(paths); }}>
		{mobileNav && <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
		<aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="素材导航">
			<div className="window-drag" />
			<a className="brand" href="./" aria-label="SayPhoto 说图首页"><img className="brand-mark" src="./brand/sayphoto-icon.png" alt="" /><span><strong>SayPhoto</strong><small>说图 <span className="brand-by">by Big2</span></small></span></a>
			<div className="nav-section-label">素材库</div>
			<nav>{views.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id && !folder ? "active" : ""}`} aria-current={view === id && !folder ? "page" : undefined} onClick={() => selectView(id)}><Icon size={19} stroke={1.7} /><span>{label}</span><span className="nav-count">{viewCounts[id]}</span></button>)}<button className={`nav-item ${deviceOpen ? "active" : ""}`} aria-pressed={deviceOpen} onClick={()=>{setDeviceOpen(v=>!v);setLimit(RESULT_PAGE_SIZE);setSelectedFiles(new Set());}}><IconPhoto size={19}/><span>拍摄设备</span></button><button className={`nav-item ${peopleOpen ? "active" : ""}`} aria-pressed={peopleOpen} onClick={()=>{setPeopleOpen(v=>!v);setMobileNav(false);setLimit(RESULT_PAGE_SIZE);setSelectedFiles(new Set());}}><IconPhoto size={19}/><span>人物</span></button></nav>
			<ApplePhotos onActive={setApplePhotosActive} onAdd={() => void addAssets()} addDisabled={isBusy} addStatus={importing ? (progress ? "已打开添加流程；选定的文件会等待当前导入完成。若导入已暂停，请先继续。" : "正在选择或添加文件，请完成当前添加流程。") : migration ? "模型更新期间暂不能添加，请等待更新完成。" : driveBusy ? "文件传输期间暂不能添加。" : deleting ? "删除完成后可继续添加。" : progress ? "可以继续选择文件，将在当前导入完成后添加。" : ""} /><div className="nav-section-label section-with-action"><span>文件夹</span><button className="icon-button" aria-label="添加文件夹" title="添加文件夹" onClick={() => void addAssets()} disabled={isBusy}><IconPlus size={16} /></button></div>
			<div className="folder-nav">{folders.length ? folders.map(path => <button key={path} title={path} className={`nav-item ${folder === path ? "active" : ""}`} onClick={() => selectView("all", path)}><IconFolder size={18} stroke={1.6} /><span>{path.split("/").pop()}</span><span className="nav-count">{folderCounts[path]}</span></button>) : <p className="sidebar-hint">添加文件夹后，在这里快速浏览。</p>}</div>
			{recent.length > 0 && <><div className="nav-section-label section-with-action"><span>最近搜索</span><button className="icon-button" aria-label="清除搜索记录" onClick={() => setRecent([])}><IconTrash size={14} /></button></div><div>{recent.map(text => <button className="nav-item recent-item" key={text} title={text} onClick={() => { void runSearch(text); setMobileNav(false); }}><IconClock size={16} /><span>{text}</span></button>)}</div></>}
			<div className="sidebar-bottom"><button className="nav-item" aria-pressed={filesLocked} disabled={!lockReady || lockPending || driveBusy || deleting} onClick={() => void toggleFileLock()}><IconShieldCheck size={19} /><span>{!lockReady ? "正在读取文件锁定…" : filesLocked ? "文件已锁定 · 点击解锁" : "锁定文件"}</span></button>{filesLocked && <p className="setting-note">可搜索、预览和复制；禁止移动和删除。</p>}<div className="privacy-note"><IconShieldCheck size={17} /><span>{preview ? "桌面版在本机处理素材" : "本地检索 · 自主上传"}</span></div><button className="nav-item settings-button" onClick={() => setSettings(true)}><IconSettings size={19} /><span>设置</span><kbd>⌘ ,</kbd></button><div className="sidebar-version">SayPhoto 说图 <span>本地优先</span></div></div>
		</aside>
		<main className="workspace" ref={scrollRef}>
			<header className="workspace-header"><div className="header-heading"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><IconMenu2 size={22} /></button><div><div className="eyebrow">SAYPHOTO · BY BIG2</div><h1>{heading}</h1><p>说句话，照片就找到。</p></div></div><button className="primary-button" onClick={() => void addAssets()} disabled={isBusy}>{isBusy ? <IconLoader2 className="spin" size={18} /> : <IconPlus size={18} />}<span>{isBusy ? "正在处理" : "添加素材"}</span></button></header>
			<section className="search-section" aria-label="搜索素材">
				<form className="search-box" onSubmit={event => { event.preventDefault(); void runSearch(draft); }}><IconSearch size={23} stroke={1.7} /><input ref={searchInput} aria-label="搜索素材" placeholder={currentMode.placeholder} value={draft} onChange={event => { setDraft(event.target.value); if (!event.target.value) void runSearch(""); }} /><div className="search-actions">{draft ? <button type="button" className="icon-button" aria-label="清空搜索" onClick={() => void runSearch("")}><IconX size={17} /></button> : <kbd>⌘ K</kbd>}<button className="search-submit" type="submit" aria-label="执行搜索" disabled={searching}>{searching ? <IconLoader2 className="spin" size={19} /> : <IconArrowRight size={19} />}</button></div></form>
				<div className="search-options"><div className="mode-tabs" aria-label="搜索方式">{modes.map(m => <button key={m.id} className={mode === m.id ? "selected" : ""} aria-pressed={mode === m.id} onClick={() => { setMode(m.id); if (query) void runSearch(draft, m.id); }}>{m.id === "files" && <IconSparkles size={14} />}{m.label}</button>)}</div><span className="search-hint">{currentMode.hint}</span></div>
			</section>
			{preview && <div className="preview-notice"><IconDeviceDesktop size={15} /><span>交互预览：使用示例照片，搜索演示仅匹配标题与标签。</span></div>}
			{translating && <div className="engine-notice" role="status"><IconLoader2 size={15} className="spin" /><span>正在用本地语言模型翻译搜索词，首次加载可能稍慢…</span></div>}
			{query && mode === "files" && !indexedSearch && (migration || partialSearch) && <div className="engine-notice" role="status"><span>边建索引边搜索 · 已可搜索 {(partialSearch?.indexed ?? migration?.done ?? 0).toLocaleString()} / {(partialSearch?.total ?? migration?.total ?? 0).toLocaleString()} 项；结果尚不完整，每 5 秒自动更新。</span></div>}
			{translatedQuery && <div className="engine-notice"><span>英文检索：{translatedQuery}</span></div>}
			{!preview && engine !== "ready" && <div className={`engine-notice ${engine === "error" ? "notice-error" : ""}`} role="status"><IconLoader2 size={15} className={engine !== "error" ? "spin" : ""} /><span>{engine === "error" ? "搜索模型未就绪，仍可浏览素材或按已有文字查找。在设置中检查模型。" : "首次使用正在准备本地搜索模型，你可以先浏览或添加素材。"}</span></div>}
			<div className="search-filter-toolbar" role="group" aria-label="地图与素材筛选"><div className="map-toggle"><button className="secondary-button" aria-pressed={mapOpen} onClick={() => { setMapOpen(v => !v); setMapDistances(null); setSelectedFiles(new Set()); }}>{mapOpen ? "关闭地图" : "地图找照片"}</button>{mapDistances && <span>已按地点筛选</span>}</div><div className="filter-toggle"><button className="secondary-button" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}>大小与时间筛选{filter.active ? " · 已启用" : ""}</button>{filter.active && <button className="text-button" onClick={() => setFilters(emptyAssetFilters)}>清除筛选</button>}</div></div>
			{mapOpen && <MapSearch names={names} onFilter={applyMapFilter} />}
			{similarReference && <div className="similar-banner"><img src={thumbnail(similarReference)} alt="参考照片" /><div><strong>参考：{similarReference.title}</strong><p>按整体画面相似度排序，最多显示 500 项（含参考照片）。相似结果不代表重复文件，请勾选确认后处理。</p><label>匹配范围 <select aria-label="相似照片匹配范围" value={similarThreshold} disabled={deleting || driveBusy} onChange={event => setSimilarThreshold(Number(event.target.value))}><option value={0.75}>更接近的画面</option><option value={0.6}>相似内容</option><option value={0.4}>扩大范围</option></select></label></div><button className="secondary-button" disabled={deleting || driveBusy} onClick={() => void runSearch("")}>退出相似搜索</button></div>}
   {deleteProgress && <p role="status" className="delete-text">{deleteProgress}</p>}{deleteReport && <p role="status" className="setting-note delete-text">{deleteReport}</p>}

   {filterOpen && <section className="asset-filters" aria-label="文件大小和时间筛选"><fieldset><legend>文件大小（MB，1 MB = 1,000,000 字节）</legend><label>最小大小<input aria-label="最小文件大小 MB" type="number" min="0" step="any" placeholder="不限" value={filters.minSize} onChange={event => setFilters(previous => ({...previous,minSize:event.target.value}))} /></label><span>至</span><label>最大大小<input aria-label="最大文件大小 MB" type="number" min="0" step="any" placeholder="不限" value={filters.maxSize} onChange={event => setFilters(previous => ({...previous,maxSize:event.target.value}))} /></label></fieldset><fieldset><legend>原文件修改日期（包含开始和结束当天）</legend><label>开始日期<input aria-label="开始修改日期" type="date" value={filters.startDate} onChange={event => setFilters(previous => ({...previous,startDate:event.target.value}))} /></label><span>至</span><label>结束日期<input aria-label="结束修改日期" type="date" value={filters.endDate} onChange={event => setFilters(previous => ({...previous,endDate:event.target.value}))} /></label></fieldset><p>按导入时记录的原文件修改时间筛选。大小未知或日期未知的素材不参与对应范围筛选。</p></section>}
   {filter.error && <p role="alert">{filter.error}</p>}
   {sizeProgress && <p className="filter-status" role="status">正在读取文件大小 {sizeProgress.done} / {sizeProgress.total}；大小排序与筛选结果会逐步更新。</p>}
   {sizeError && <p role="status">{sizeError} <button className="text-button" onClick={() => setSizeRetry(value => value+1)}>重试</button></p>}
   {peopleOpen && <PeoplePanel controller={peopleController} selected={selectedPeople} onSelect={ids=>{setSelectedPeople(ids);setSelectedFiles(new Set());setLimit(RESULT_PAGE_SIZE);}} onLock={()=>void changeAssetLocks(knownPeopleFiles,true)} lockCount={knownPeopleFiles.length} lockDisabled={lockActionDisabled}/>}
   {aiView && <AiOriginPanel controller={aiOrigins} total={assets.length} includeSuspected={includeSuspectedAi} onIncludeSuspected={value => { setIncludeSuspectedAi(value); setLimit(RESULT_PAGE_SIZE); setSelectedFiles(new Set()); }} />}
   {deviceOpen && <CaptureDevicePanel devices={deviceIndex.devices} brand={deviceBrand} model={deviceModel} onChange={(brand,model)=>{setDeviceBrand(brand);setDeviceModel(model);setLimit(RESULT_PAGE_SIZE);setSelectedFiles(new Set());}} paused={deviceIndex.paused} onPause={()=>deviceIndex.setPaused(v=>!v)} done={deviceIndex.done} total={assets.length} error={deviceIndex.error} onRetry={deviceIndex.retry}/>}
   {(view === "screenshots" || view === "recordings") && <div className="duplicate-summary"><strong>{view === "screenshots" ? "手机与电脑截屏" : "手机与电脑录屏"}</strong><span>{view === "screenshots" ? "根据文件名、来源文件夹和已有截屏标记归类。" : "根据录屏文件名和来源文件夹归类，支持常见手机与电脑录屏命名。"}改名或缺少标记的文件可能未收录；可在此搜索内容，也可切到所有素材用画面描述查找。</span><button className="text-button" onClick={() => void refresh()}>刷新分类</button></div>}{view === "duplicates" && <div className="duplicate-summary"><strong>{duplicates.groups.length} 组重复文件 · {duplicates.byFilename.size} 个文件</strong><span>按入库时的文件内容查找，组内内容完全相同；原文件修改后需重新核对。尚未入库的文件不计入。</span>{duplicates.missingHashes > 0 && <span>{duplicates.missingHashes} 项缺少内容指纹，暂未参与比较。</span>}<span className="delete-text">先在每组要保留的文件上点击“锁定原图”，再删除多余文件。未锁定原图的组不会清理；所有锁定文件都会保留。</span><button className="secondary-button delete-action" disabled={filesLocked || lockActionDisabled || searching || !duplicatePlan.size} onClick={() => void deleteBatch(true)}>删除多余文件（{duplicatePlan.size}）…</button><span className="delete-text">仅清理当前筛选范围；原文件移到废纸篓，同时移除素材库副本和搜索记录。</span><button className="text-button" onClick={() => void refresh()}>刷新重复列表</button></div>}{qualitySort && <PhotoQualityStatus controller={photoQuality} ascending={sort === "quality-asc"} />}<div className="results-toolbar"><div className="results-summary"><h2>{similarReference ? "相似照片" : query ? `“${query}”的搜索结果` : "全部内容"}</h2><span>{searching ? qrProgress || "正在查找…" : `${displayed.length} 项素材`}</span>{indexedSearch && detectionKind(query) && <button className="text-button" onClick={async () => { const response=await window.memories.detectionPause(!indexPaused); if(response.ok)setIndexPaused(value=>!value); else setQrProgress(response.error || "无法更改后台检测状态"); }}>{indexPaused ? "继续后台检测" : "暂停后台检测"}</button>}{query && <button className="text-button" onClick={() => void runSearch("")}>清除</button>}</div><div className="view-controls"><label className="show-locked-toggle"><input type="checkbox" role="switch" checked={includesLocked} disabled={view === "locked" || driveBusy || deleting || assetLockPending} onChange={event => { setShowLocked(event.target.checked); setLimit(RESULT_PAGE_SIZE); }} />显示锁定内容</label><button className="secondary-button" disabled={driveBusy || searching} aria-pressed={selectionMode} onClick={() => { setSelectionMode(value => !value); setSelectedFiles(new Set()); }}>{selectionMode ? "退出选择" : "批量选择"}</button><select aria-label="素材排序" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">{view === "duplicates" ? "重复分组" : mapDistances ? "距离最近" : query ? "相关度优先" : "最新优先"}</option><option value="quality">AI 优选：质量高到低</option><option value="quality-asc">AI 优选：质量低到高</option><option value="name">名称排序</option><option value="size-desc">文件大小：大到小</option><option value="size-asc">文件大小：小到大</option><option value="date-desc">修改时间：新到旧</option><option value="date-asc">修改时间：旧到新</option></select><div className="layout-switch"><button aria-label="网格视图" aria-pressed={layout === "grid"} className={layout === "grid" ? "selected" : ""} onClick={() => setLayout("grid")}><IconLayoutGrid size={17} /></button><button aria-label="密集视图（每行9个）" title="密集视图：每行9个" aria-pressed={layout === "dense"} className={layout === "dense" ? "selected" : ""} onClick={() => setLayout("dense")}><IconGridDots size={18} /></button><button aria-label="列表视图" aria-pressed={layout === "list"} className={layout === "list" ? "selected" : ""} onClick={() => setLayout("list")}><IconList size={18} /></button></div></div></div>
			<FileTasks />
			{<div className="batch-toolbar" style={selectionMode ? undefined : { display: "none" }}><strong>已选 {selectedFiles.size} 个文件</strong><span className="selected-size" role="status">{preview && selectedFiles.size ? "总计大小：桌面版可读取" : `总计大小：${selectedSize.pending || selectedSize.unavailable ? "已知 " : ""}${formatFileSize(selectedSize.bytes)}${selectedSize.pending ? ` · ${sizeError ? "待读取" : "计算中"}（${selectedSize.pending} 项）` : ""}${selectedSize.unavailable ? ` · ${selectedSize.unavailable} 项大小不可读取` : ""}`}</span><label className="batch-count">选择数量<input type="number" inputMode="numeric" min={1} max={resultFiles.length || 1} step={1} value={selectionCount} placeholder="输入数量" aria-label="选择文件数量" aria-describedby="batch-count-help" disabled={selectionBusy || !resultFiles.length} onChange={event => setSelectionCount(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); selectFileCount(); } }} /></label><button className="secondary-button" disabled={selectionBusy || !validSelectionCount} onClick={selectFileCount}>{validSelectionCount ? `选择前 ${requestedSelectionCount} 个文件` : "按数量选择"}</button><button className="secondary-button" disabled={selectionBusy || !resultFiles.length} onClick={() => setSelectedFiles(new Set(resultFiles))}>全选</button><button className="text-button" disabled={selectionBusy} onClick={() => setSelectedFiles(new Set())}>清空选择</button><span id="batch-count-help">共 {resultFiles.length} 个文件，按当前排序选择并替换已选项{selectionCount && !validSelectionCount ? `；请输入 1–${resultFiles.length} 的整数` : ""}</span><button className="secondary-button delete-action" disabled={filesLocked || !assetLocksReady || assetLockPending || selectedLockedCount > 0 || !selectedFiles.size || deleting || driveBusy || searching} onClick={() => void deleteBatch()}>删除选中的原文件…</button><button className="secondary-button" disabled={lockActionDisabled || !selectedFiles.size || selectedLockedCount === selectedFiles.size} onClick={() => void changeAssetLocks([...selectedFiles], true)}><IconLock size={16} />锁定所选</button><button className="text-button" disabled={lockActionDisabled || !selectedLockedCount} onClick={() => void changeAssetLocks([...selectedFiles], false)}>解锁所选</button>{selectedLockedCount > 0 && <span className="delete-text">已锁定 {selectedLockedCount} 项，不可删除</span>}<DriveTransfer filesLocked={filesLocked || !assetLocksReady || assetLockPending || selectedLockedCount > 0} progressStatus={activeProgress && <ProgressToast done={activeProgress.done} total={activeProgress.total} label={migration ? "正在更新搜索索引" : "正在添加素材"} taskKey={migration ? `migration:${activeModelId}` : "import"} paused={!migration && !!progress?.paused} onTogglePause={!migration ? toggleImportPause : undefined} onRefresh={refreshImportProgress} />} filenames={deleting ? [] : [...selectedFiles]} onBusy={setDriveBusy} onSettings={() => setSettings(true)} onComplete={removed => { setSelectedFiles(previous => new Set([...previous].filter(name => !removed.includes(name)))); if (removed.length) { sequence.current++; setSearching(false); setTranslating(false); setResults(previous => previous ? previous.filter(asset => !removed.includes(asset.filename)) : previous); } void refresh(); }} /><span>序号按当前排序排列；同一视频的多个片段共用文件序号，只选取一份原文件</span></div>}
			{qrProgress && !searching && <p role="status" className="setting-note">{qrProgress}</p>}
			{loadError ? <EmptyState title="素材库暂时无法打开" description={loadError} action="重新加载" onAction={() => void refresh()} /> : !loaded || (searching && (!qrProgress || !results?.length)) ? <div className="asset-grid skeleton-grid" aria-label="正在加载" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div className="skeleton-card" key={i}><div /><span /><small /></div>)}</div> : displayed.length === 0 ? <EmptyState title={searchFailure && !indexedSearch ? "搜索暂不可用" : query && mode === "files" && partialSearch ? "已处理的素材中暂未找到匹配" : filter.active ? "没有符合筛选条件的素材" : mapDistances ? "附近没有匹配的照片" : similarReference || query ? "暂时没有找到匹配的素材" : aiView ? "尚未发现 AI 来源线索" : assets.length ? "这里还没有素材" : "把散落的画面，收进一个地方"} description={!includesLocked ? "已隐藏锁定内容，可打开上方“显示锁定内容”查看。" : searchFailure && !indexedSearch ? searchFailure : query && mode === "files" && partialSearch ? "索引仍在继续，新处理好的图片会自动加入搜索结果。" : filter.active ? filter.error || "请放宽大小或修改日期范围，或清除筛选条件。" : mapDistances ? "可以扩大地图范围或更换地点。只有带 GPS 信息、且符合当前筛选条件的照片才会显示。" : searchFailure || (query ? "试试更简短的描述，或切换搜索方式。视频片段与对白需要先完成索引。" : aiView ? "当前范围内尚未发现 AI 来源线索。查找进度见上方；未发现标记不代表文件不是 AI 生成。" : view === "screenshots" || view === "recordings" ? "当前筛选范围内没有识别到此类文件。可切到所有素材，按画面内容继续查找。" : view === "duplicates" ? "当前筛选范围内没有发现内容相同的已入库文件。" : view === "locked" ? "点击素材收藏旁的锁定按钮，文件就会显示在这里，也可以在本列表中搜索。" : view === "favorites" ? "点击素材上的爱心，就能在这里快速找到它。" : "添加照片、视频或整个文件夹，也可以直接拖到这里。仅引用原文件，不再复制素材。")} action={searchFailure && !indexedSearch ? "重试搜索" : filter.active ? "清除大小与时间筛选" : mapDistances ? "关闭地点筛选" : similarReference || query ? "清除搜索" : assets.length ? "查看所有素材" : "添加第一批素材"} onAction={() => searchFailure && !indexedSearch ? void runSearch(query) : filter.active ? setFilters(emptyAssetFilters) : mapDistances ? (setMapOpen(false), setMapDistances(null)) : similarReference || query ? void runSearch("") : assets.length ? selectView("all") : void addAssets()} /> : <><div className={layout === "list" ? "asset-list" : layout === "dense" ? "asset-grid asset-dense" : "asset-grid"}>{displayed.slice(0, limit).map(asset => <article className={`asset-card ${asset.detectedLabel ? "qr-match" : ""} ${selectionMode && selectedFiles.has(asset.filename) ? "batch-selected" : ""}`} key={assetKey(asset)} onContextMenu={event => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setContextMenu({ asset, x: event.clientX || bounds.left + 20, y: event.clientY || bounds.top + 20 }); }}>{selectionMode && <input className="batch-checkbox" type="checkbox" checked={selectedFiles.has(asset.filename)} aria-label={`选择 ${asset.title}`} onChange={() => toggleSelection(asset.filename)} />}<button className="asset-open" onClick={() => setSelected(asset)} aria-label={`预览 ${asset.title}`}><div className="asset-image"><img src={thumbnail(asset)} alt={asset.title} loading="lazy" onError={event => { event.currentTarget.style.opacity = "0"; }} /><span className="image-fallback"><IconPhoto size={28} /></span>{isVideoFile(asset.filename) && <VideoDuration src={original(asset)} />}{query && (asset.detectedLabel || asset.dominant) && <span className="match-label">{asset.detectedLabel ? asset.detectedLabel : asset.dominant ? matchLabels[asset.dominant] : ""}</span>}</div><div className="asset-caption">{aiView && <span className="duplicate-badge">{aiOrigins.matches.get(asset.filename)?.evidence}</span>}{qualitySort && <span className="duplicate-badge" title={photoQuality.records[asset.filename]?.error}>{isVideoFile(asset.filename) ? "视频不参与评分" : qualityLabel(photoQuality.records[asset.filename])}</span>}{view === "duplicates" && <span className="duplicate-badge">重复组 {duplicates.byFilename.get(asset.filename)?.id} · 共 {duplicates.byFilename.get(asset.filename)?.count} 份</span>}<span className="asset-ordinal">第 {fileOrdinals.get(asset.filename)} 个文件</span>{deviceOpen && <span className="duplicate-badge">{deviceIndex.devices.get(asset.filename)?.brand} · {deviceIndex.devices.get(asset.filename)?.model}</span>}<h3 title={asset.title}>{asset.title}</h3><p className="asset-location" title={parentFolder(asset.sourcePath) || "位置未记录"}>位置：{parentFolder(asset.sourcePath) || "未记录"}</p><p className="asset-metadata"><span>修改：{dateLabel(asset.modifiedAt)}</span><span>大小：{formatFileSize(fileSizes[asset.filename])}</span></p>{(asset.bestScene || mapDistances || similarReference?.filename === asset.filename) && <p className="asset-context">{asset.bestScene ? `匹配时刻 ${formatTimecode(asset.bestScene.t)}` : mapDistances ? `距离 ${mapDistances.get(asset.filename)?.toFixed(1)} 公里` : "参考照片"}</p>}</div></button><button className={`favorite-button ${favoriteSet.has(asset.filename) ? "is-favorite" : ""}`} aria-label={`${favoriteSet.has(asset.filename) ? "取消收藏" : "收藏"} ${asset.title}`} aria-pressed={favoriteSet.has(asset.filename)} onClick={() => toggleFavorite(asset.filename)}><IconHeart size={17} fill={favoriteSet.has(asset.filename) ? "currentColor" : "none"} /></button><button className={`favorite-button asset-lock-button ${lockedFiles.has(asset.filename) ? "is-locked" : ""}`} disabled={lockActionDisabled} aria-label={`${lockedFiles.has(asset.filename) ? "解除锁定" : "锁定"} ${asset.title}`} title={lockedFiles.has(asset.filename) ? "已锁定，不可删除；点击解锁" : "锁定后不可删除"} aria-pressed={lockedFiles.has(asset.filename)} onClick={() => void changeAssetLocks([asset.filename], !lockedFiles.has(asset.filename))}>{lockedFiles.has(asset.filename) ? <IconLock size={17} /> : <IconLockOpen size={17} />}</button>{view === "duplicates" && <button className="secondary-button duplicate-keep-button" disabled={lockActionDisabled} aria-pressed={lockedFiles.has(asset.filename)} onClick={() => void changeAssetLocks([asset.filename], !lockedFiles.has(asset.filename))}>{lockedFiles.has(asset.filename) ? "已锁定原图 · 点击解锁" : "锁定原图"}</button>}</article>)}</div>{displayed.length > limit && <button className="secondary-button load-more" onClick={() => setLimit(prev => prev + RESULT_PAGE_SIZE)}>再显示 {Math.min(RESULT_PAGE_SIZE, displayed.length - limit)} 项</button>}</>}
			<footer className="workspace-footer"><span><i className={`status-dot ${!preview && engine !== "ready" ? "pending" : ""}`} />{statusLabel}</span><span>点击照片预览 · 勾选方框选择 · 方向键切换<kbd>Esc</kbd> 关闭</span></footer>
		</main>
		{toast && <div className={`toast${toastIsDelete ? " delete-toast" : ""}`} role="status"><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast("")}><IconX size={16} /></button></div>}
		{dragging && <div className="drop-overlay"><IconFolderPlus size={48} stroke={1.3} /><h2>松开，添加到素材库</h2><p>支持照片、视频和文件夹</p></div>}
		{selected && <Viewer fileSize={fileSizes[selected.filename]} onDelete={() => void deleteAsset(selected, true)} locked={lockedFiles.has(selected.filename)} onLock={() => void changeAssetLocks([selected.filename], !lockedFiles.has(selected.filename))} lockDisabled={lockActionDisabled} deleteDisabled={filesLocked || !assetLocksReady || assetLockPending || lockedFiles.has(selected.filename) || driveBusy || deleting} deleting={deleting} onSimilar={!isVideoFile(selected.filename) ? () => void findSimilar(selected) : undefined} asset={selected} favorite={favoriteSet.has(selected.filename)} onFavorite={() => toggleFavorite(selected.filename)} onClose={() => setSelected(null)} onPrevious={selectedIndex > 0 ? () => selectAdjacent(-1) : undefined} onNext={selectedIndex < displayed.length - 1 ? () => selectAdjacent(1) : undefined} position={`${selectedIndex + 1} / ${displayed.length}`} notify={setToast} />}
		{contextMenu && <AssetContextMenu filesLocked={filesLocked || !assetLocksReady || assetLockPending || lockedFiles.has(contextMenu.asset.filename)} x={contextMenu.x} y={contextMenu.y} disabled={driveBusy || deleting} onClose={closeContextMenu} onPreview={() => { setSelected(contextMenu.asset); closeContextMenu(); }} onSimilar={!isVideoFile(contextMenu.asset.filename) ? () => void findSimilar(contextMenu.asset) : undefined} onDelete={originalFile => void deleteAsset(contextMenu.asset, originalFile)} />}
		{settings && <Modal title="设置" subtitle="日常保持简单，细节由你掌控。" onClose={closeSettings}><div className="settings-section"><h3>搜索模型</h3><p>选择用于理解画面的模型。更换模型会重新建立素材索引。</p>{preview ? <div className="setting-note">模型设置在桌面版中可用，预览不会下载或切换模型。</div> : <><label className="field-label" htmlFor="model-select">当前模型</label><select id="model-select" className="settings-select" value={proposedModel} onChange={event => setProposedModel(event.target.value)} disabled={switching || !!migration}>{!models?.length && <option value="">正在读取模型…</option>}{models?.map(model => <option value={model.id} key={model.id}>{model.label}{model.downloaded ? " · 已下载" : " · 需要下载"}</option>)}</select><p className="setting-note">EmbeddingGemma 2 支持中文与图片检索；CLIP 适合常规场景；SigLIP-2-B 导入较快。切换需重新生成搜索向量，原文件与旧索引保留。</p><button className="primary-button" disabled={!proposedModel || proposedModel === activeModelId || switching || !!migration} onClick={async () => { setSwitching(true); try { const result = await setModel(proposedModel); setToast(result.failures.length ? `模型已切换，${result.failures.length} 项索引失败` : "搜索模型已更新"); } catch { setToast("模型切换失败，请稍后重试。"); } finally { setSwitching(false); } }}>{switching || migration ? <IconLoader2 size={17} className="spin" /> : <IconCheck size={17} />}应用模型</button></>}</div><div className="settings-section"><h3>自动添加文件夹</h3><p>通过“添加素材”选择文件夹，新素材会自动加入资料库。普通文件仅引用原位置；请保留原文件与路径，外置磁盘需保持连接。Apple 照片图库请通过侧栏连接并导入，会保存用于检索的副本。</p>{watched.length ? watched.map(w => <div className="watched-row" key={w.path}><IconFolder size={18} /><div><strong>{w.path.split("/").pop()}</strong><small>{w.path}{!w.exists ? " · 路径不可用" : ""}</small></div><button className="text-button" onClick={async () => { try { const result = await window.memories.removeWatchedFolder(w.path); if (!result.ok) throw new Error(); await refresh(); setToast("已停止自动添加，现有素材仍保留。"); } catch { setToast("未能停止自动添加，请重试。"); } }}>停止同步</button></div>) : <div className="setting-note">暂无自动添加的文件夹</div>}<button className="secondary-button" disabled={isBusy} onClick={() => void addAssets()}><IconFolderPlus size={17} />添加文件夹</button></div><CopyCleanup filesLocked={filesLocked} /><DriveSettings /><div className="settings-section"><h3>更多选项</h3><p>视频分析精度、文字识别语言、AI 问答和索引备份，可在原版界面中管理。</p>{preview ? <div className="setting-note">原版界面入口在桌面版中可用。</div> : <a className="secondary-button" href="?classic=1"><IconExternalLink size={16} />打开原版界面</a>}</div><div className="settings-footnote"><IconShieldCheck size={16} />本地检索 · 云端存储需授权</div></Modal>}
	</div>;
}

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
	return <div className="empty-state"><div className="empty-art"><div /><div /><span><IconPhoto size={39} stroke={1.2} /></span></div><h2>{title}</h2><p>{description}</p><button className="primary-button" onClick={onAction}><IconPlus size={17} />{action}</button><small>照片 · 视频 · 截图，都可以在这里找到</small></div>;
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null); useFocusTrap(ref, true);
	return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={ref} tabIndex={-1}><header><div><h2 id="settings-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="关闭设置" onClick={onClose}><IconX size={22} /></button></header><div className="settings-body">{children}</div></div></div>;
}

function Viewer({ locked, onLock, lockDisabled, asset, favorite, onFavorite, onClose, onPrevious, onNext, position, notify, onSimilar, onDelete, deleteDisabled, deleting, fileSize }: { locked: boolean; onLock: () => void; lockDisabled: boolean; fileSize?: number | null; onDelete: () => void; deleteDisabled: boolean; deleting: boolean; onSimilar?: () => void; asset: Asset; favorite: boolean; onFavorite: () => void; onClose: () => void; onPrevious?: () => void; onNext?: () => void; position: string; notify: (message: string) => void }) {
	const ref = useRef<HTMLDivElement>(null); useFocusTrap(ref, true);
	const [details, setDetails] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => { setFailed(false); }, [asset.filename]);
	useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.target instanceof HTMLVideoElement || event.target instanceof HTMLInputElement) return; if (event.key === "ArrowLeft") { event.preventDefault(); onPrevious?.(); } if (event.key === "ArrowRight") { event.preventDefault(); onNext?.(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [onPrevious, onNext]);
	const video = isVideoFile(asset.filename), playable = isPlayableVideoFile(asset.filename);
	const reveal = async () => { if (preview) { notify("示例素材没有本地原文件；桌面版支持在 Finder 中定位。"); return; } try { const result = await window.memories.revealInFinder(asset.filename); if (!result.ok) throw new Error(); } catch { notify("无法在 Finder 中定位该文件。"); } };
	return <div className="viewer" ref={ref} role="dialog" aria-modal="true" aria-labelledby="viewer-title" tabIndex={-1}><header className="viewer-header"><button className="viewer-icon" onClick={onClose} aria-label="关闭预览"><IconArrowLeft size={21} /></button><div><h2 id="viewer-title">{asset.title}</h2><p>{position}{asset.bestScene ? ` · 匹配时刻 ${formatTimecode(asset.bestScene.t)}` : ""}</p></div><div className="viewer-actions"><button className="viewer-text viewer-delete delete-action" onClick={onDelete} disabled={deleteDisabled} title="将原文件移到废纸篓，并删除素材库副本" aria-label="删除原文件及素材库副本">{deleting ? <IconLoader2 size={17} className="spin" /> : <IconTrash size={17} />}{deleting ? "正在删除…" : "删除"}</button>{onSimilar && <button className="viewer-text" onClick={onSimilar}><IconSearch size={17} />查找相似照片</button>}<button className={`viewer-icon ${favorite ? "liked" : ""}`} onClick={onFavorite} aria-label={favorite ? "取消收藏" : "收藏"} aria-pressed={favorite}><IconHeart size={21} fill={favorite ? "currentColor" : "none"} /></button><button className="viewer-icon" onClick={onLock} disabled={lockDisabled} aria-label={locked ? "解除锁定" : "锁定"} aria-pressed={locked} title={locked ? "已锁定，不可删除" : "锁定后不可删除"}>{locked ? <IconLock size={21} /> : <IconLockOpen size={21} />}</button><button className="viewer-text" onClick={() => setDetails(v => !v)} aria-pressed={details}>详细信息</button><button className="viewer-text" onClick={() => void reveal()}><IconFolder size={17} />在 Finder 中显示</button><button className="viewer-icon" onClick={onClose} aria-label="退出预览"><IconX size={22} /></button></div></header><div className="viewer-content"><button className="viewer-arrow" disabled={!onPrevious} onClick={onPrevious} aria-label="上一项"><IconChevronLeft size={27} /></button><div className="viewer-media">{failed ? <div className="media-error"><IconPhoto size={36} /><p>暂时无法预览这个文件，请检查原文件是否已移动、删除或所在磁盘未连接。恢复原路径后可重新打开预览。</p><button className="viewer-text" onClick={() => void reveal()}>在 Finder 中查看</button></div> : video && playable ? <video key={assetKey(asset)} src={original(asset)} controls autoPlay onError={() => setFailed(true)} onLoadedMetadata={event => { if (asset.bestScene) event.currentTarget.currentTime = asset.bestScene.t; }} /> : <img key={asset.filename} src={video ? thumbnail(asset) : original(asset)} alt={asset.title} onError={() => setFailed(true)} />}{video && !playable && <button className="external-video" onClick={async () => { try { const result = await window.memories?.openExternal?.(asset.filename); if (!result?.ok) notify("无法打开默认播放器，请在 Finder 中查看。"); } catch { notify("无法打开默认播放器。"); } }}>此格式请使用系统播放器打开 <IconExternalLink size={16} /></button>}</div><button className="viewer-arrow" disabled={!onNext} onClick={onNext} aria-label="下一项"><IconChevronRight size={27} /></button>{details && <aside className="detail-panel"><h3>素材信息</h3><dl><dt>名称</dt><dd>{asset.title}</dd><dt>类型</dt><dd>{video ? "视频" : "图片"} · {asset.filename.split(".").pop()?.toUpperCase()}</dd><dt>文件大小</dt><dd>{formatFileSize(fileSize)}</dd><dt>原始位置</dt><dd>{asset.sourcePath || "未记录"}</dd><dt>修改日期</dt><dd>{asset.modifiedAt ? new Date(asset.modifiedAt).toLocaleString("zh-CN") : "未记录"}</dd>{asset.bestScene?.snippet && <><dt>匹配对白</dt><dd>{asset.bestScene.snippet}</dd></>}{asset.ocr && <><dt>识别出的文字</dt><dd className="ocr-detail">{asset.ocr}</dd></>}</dl></aside>}</div><footer className="viewer-footer"><span><kbd>←</kbd><kbd>→</kbd> 切换素材</span><span><kbd>Esc</kbd> 关闭预览</span></footer></div>;
}
