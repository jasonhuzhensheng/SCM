"use strict";

// Rank worker (Phase 0.4): dedicated utilityProcess for the O(N × dim)
// hybrid search scan so the Electron main thread never blocks on search
// math (UI responsiveness A/B). Owns its own library-store instance loaded
// from disk under SCM_USER_DATA_DIR (same DATA_DIR as main). Protocol:
//   → { type: "rank", id, query, topK, qVec: Float32Array|Array, gen }
//   ← { type: "rank", id, ok, results } | { type: "rank", id, ok: false, error }
//   → { type: "shutdown" }
// `gen` is library-store's generation counter (bumped on saveLibrary /
// resetLibraryCaches / writeBins). A mismatch forces a cache reset + reload
// from disk so the worker tracks main's persisted state without shipping
// embeddings over IPC.

const path = require("path");
const {
	initLibraryStore,
	resetLibraryCaches,
	loadLibrary,
	libraryNorms,
	thresholdsFor,
	libraryGenerationNumber,
} = require("./library-store.js");
const { initCategoryOverrides } = require("./category-overrides.js");
const { scoreLibrary } = require("./rank-search.js");
const { createLiveSearchCache } = require("./live-search-index.js");
const liveCache = createLiveSearchCache();

const userDataDir = process.env.SCM_USER_DATA_DIR;
if (!userDataDir) {
	console.error("[rank-worker] SCM_USER_DATA_DIR missing");
	process.exit(1);
}
initLibraryStore({ userDataDir });
initCategoryOverrides({ dataDir: path.join(userDataDir, "library") });

let queryCache;
function getQueryCache() {
 return queryCache ||= require("./query-result-cache.js").openQueryResultCache(path.join(userDataDir,"library","query-results.sqlite"));
}
let cachedGen = null;
function ensureLibrary(gen) {
	if (cachedGen === gen) return;
	resetLibraryCaches();
	loadLibrary();
	cachedGen = gen;
}

function post(message) {
	if (process.parentPort) {
		process.parentPort.postMessage(message);
	}
}

if (process.parentPort) {
	process.parentPort.on("message", (event) => {
		const msg = event && event.data !== undefined ? event.data : event;
		if (!msg || !msg.type) return;
		if (msg.type === "shutdown") {
			process.exit(0);
			return;
		}
        if (msg.type === "query-cache-lookup" || msg.type === "query-cache-store") {
            try {
                const cache=getQueryCache();
                const results=msg.type === "query-cache-lookup" ? cache.lookup(msg.query,msg.context) : cache.store(msg.query,msg.context,msg.result);
                post({id:msg.id,ok:true,results});
            } catch (error) { post({id:msg.id,ok:false,error:error.message}); }
            return;
        }
		if (msg.type === "sync-live") {
			try {
				if (msg.live.offset === 0) { resetLibraryCaches(); cachedGen = null; }
				liveCache.apply(msg.live);
				post({type:"sync-live",id:msg.id,ok:true,results:null});
			} catch (err) { post({type:"sync-live",id:msg.id,ok:false,error:err.message}); }
			return;
		}
		if (msg.type === "rank" || msg.type === "rank-live") {
			const id = msg.id;
			try {
				const gen =
					typeof msg.gen === "number" ? msg.gen : libraryGenerationNumber();
				let live = null;
				if (msg.type === "rank-live") live = liveCache.apply(msg.live);
				else { liveCache.clear(); ensureLibrary(gen); }
				const l = live ? live.library : loadLibrary();
				const thresholds = thresholdsFor(l.modelId) || {};
				const norms = live ? live.norms : libraryNorms();
				const qVec =
					msg.qVec instanceof Float32Array
						? msg.qVec
						: Float32Array.from(msg.qVec || []);
				const results = scoreLibrary(
					l,
					msg.query,
					qVec,
					msg.topK || 96,
					thresholds,
					norms,
				);
				post({ type: "rank", id, ok: true, results });
			} catch (err) {
				post({
					type: "rank",
					id,
					ok: false,
					error: (err && err.message) || String(err),
				});
			}
			return;
		}
	});
	post({ type: "rank-ready", gen: libraryGenerationNumber() });
}
