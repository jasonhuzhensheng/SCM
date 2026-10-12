"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createLiveSearchIndex, createLiveSearchCache } = require("../main-lib/live-search-index");
const { scoreLibrary } = require("../main-lib/rank-search");

async function main() {
 const live = createLiveSearchIndex("fast", 2, 5);
 assert.equal(live.append("ready.jpg", [1, 0], [0, 0]), true);
 for (const vec of [null, [0, 0], [NaN, 1], [1], [Infinity, 0]]) assert.equal(live.append("pending-passport.jpg", vec), false);
 assert.equal(live.append("ready.jpg", [0, 1]), false);
 assert.equal(live.rows.length, 1);
 assert.equal(live.library.phrases[0].length, 2);
 const cache = createLiveSearchCache();
 const update = (offset, rows) => ({ id: live.id, modelId: live.modelId, dim: 2, total: 5, offset, rows });
 cache.apply(update(0, live.rows));
 assert.throws(() => cache.apply(update(3, [])), /snapshot changed/);
 assert.throws(() => cache.apply({ ...update(1, []), modelId: "old" }), /snapshot changed/);

 // Exercise the real worker handler with structured-cloned incremental IPC.
 let handle, response;
 vm.runInNewContext(fs.readFileSync(require.resolve("../main-lib/rank-worker"), "utf8"), {
  console, Float32Array,
  process: { env: { SCM_USER_DATA_DIR: "/tmp/live-test" }, parentPort: { on: (_, fn) => handle = fn, postMessage: msg => response = msg }, exit() {} },
  require(name) {
   if (name === "./library-store.js") return { initLibraryStore() {}, resetLibraryCaches() {}, loadLibrary() { throw Error("Partial search must not read the old disk index"); }, libraryNorms() { throw Error("old norms"); }, thresholdsFor: () => ({minSemanticScore:.01,relativeKeep:.6}), libraryGenerationNumber: () => 1 };
   if (name === "./category-overrides.js") return {initCategoryOverrides(){}};
   if (name === "./rank-search.js") return { scoreLibrary };
   if (name === "./live-search-index.js") return { createLiveSearchCache };
   return require(name);
  },
 });
 const sent = [], worker = {};
 let model = "fast";
 const ctx = {
  console, createLiveSearchIndex, migrationState: { search: live }, importInFlight: false, importSearch: null,
  loadLibrary: () => ({ modelId: "old", filenames: ["pending-passport.jpg"] }),
  poolModelId: () => model, translateSearchQuery: async () => "passport",
  askIndexer: async () => ({ vec: [1, 0] }), ensureRankWorker: () => worker,
  attachQueryVec: (rows, queryVec) => Object.assign(rows, {queryVec}),
  askRankWorker: async msg => {
   sent.push(msg.live.rows.length);
   handle({ data: structuredClone({ ...msg, id: "test" }) });
   if (!response.ok) throw Error(response.error);
   return response.results;
  },
 };
 const source = fs.readFileSync(require.resolve("../main"), "utf8");
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf("async function rankPartialSearch("), source.indexOf("// Single-round-trip variant")), ctx);
 let result = await ctx.rankPartialSearch("护照", 20);
 assert.equal(result.partial, true); assert.equal(result.indexed, 1); assert.equal(result.total, 5);
 assert.equal(result.queryVec, null); assert.deepEqual(Array.from(result.results, r => r.filename), ["ready.jpg"]);
 live.append("newly-ready.jpg", [1, 0]);
 result = await ctx.rankPartialSearch("护照", 20);
 assert(result.results.some(r => r.filename === "newly-ready.jpg"));
 await ctx.rankPartialSearch("护照", 20);
 assert.deepEqual(sent, [1, 1, 0], "only new rows cross IPC after the first query");
 worker.liveId = null; // rank worker restart: the full live snapshot is restored.
 await ctx.rankPartialSearch("护照", 20); assert.equal(sent.at(-1), 2);
 model = "old";
 await assert.rejects(ctx.rankPartialSearch("护照", 20), /模型正在切换/);
 model = "fast";
 ctx.askIndexer = async () => { model = "old"; return {vec:[1,0]}; };
 await assert.rejects(ctx.rankPartialSearch("护照", 20), /模型正在切换/);

 // First import with no committed images must not invent filename matches.
 model = "fast"; ctx.migrationState = null; ctx.importInFlight = true;
 ctx.importSearch = createLiveSearchIndex("fast", 2, 2);
 ctx.loadLibrary = () => ({modelId:"fast"}); ctx.askIndexer = async () => ({vec:[1,0]});
 result = await ctx.rankPartialSearch("passport", 20);
 assert.equal(result.results.length, 0); assert.equal(result.partial, true); assert.equal(result.indexed, 0);
 ctx.importSearch.append("imported.jpg", [1,0]);
 result = await ctx.rankPartialSearch("passport", 20);
 assert.equal(result.results[0].filename,"imported.jpg");
 console.log("PASS: partial migration/import search, only valid completed rows, incremental worker cache, restart, and model-race isolation");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
