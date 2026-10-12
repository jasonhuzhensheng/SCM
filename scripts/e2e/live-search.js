"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

async function runLiveSearchSmoke({win, importPaths, reembedToModel, loadLibrary, getMigration, getImporting}) {
 const dir = process.env.MEMORIES_DATA_DIR;
 assert(dir && fs.realpathSync(dir).startsWith("/private/tmp/fly-photo-live-test-"), "Requires an isolated /tmp test library");
 assert.equal(loadLibrary().filenames.length, 0, "Never run against an existing library");
 const sharp = require("sharp");
 const fixtureDir = path.join(dir, "fixtures");
 fs.mkdirSync(fixtureDir);
 const files = [];
 for (let i = 0; i < 12; i++) {
  const file = path.join(fixtureDir, `red-${i}.jpg`);
  await sharp({create:{width:128,height:128,channels:3,background:{r:240,g:10+i*8,b:15+i}}}).jpeg().toFile(file);
  files.push(file);
 }
 const waitFor = async check => {
  for (let n = 0; n < 3000; n++) { if (check()) return; await delay(20); }
  throw Error("Timed out waiting for partial index");
 };
 const query = () => win.webContents.executeJavaScript(`(async () => {
  const result = await window.memories.rankSearch('red',100);
  const rows = Array.isArray(result) ? result : result.results;
  return {partial:result.partial,indexed:result.indexed,total:result.total,queryVec:result.queryVec,filenames:rows.map(row=>row.filename)};
 })()`);
 const importing = importPaths(files);
 await waitFor(() => loadLibrary().filenames.length >= 1 && getImporting());
 const first = await query();
 assert.equal(first.partial, true); assert(first.indexed > 0 && first.indexed < 12);
 assert(first.filenames.length > 0); assert.equal(first.queryVec, null);
 assert(first.filenames.every(name => loadLibrary().filenames.includes(name)));
 console.log(`[live-search-smoke] import query returned ${first.filenames.length} matches at ${first.indexed}/12 before completion`);
 await importing;
 const originalModel = loadLibrary().modelId;
 const target = originalModel === "siglip2-base-patch16-224" ? "clip-vit-l14-336" : "siglip2-base-patch16-224";
 const converting = reembedToModel(target, { requireComplete: true });
 await waitFor(() => getMigration()?.search?.rows.length > 0);
 const second = await query();
 assert.equal(second.partial, true); assert(second.indexed > 0 && second.indexed < 12);
 assert(second.filenames.length > 0); assert.equal(second.queryVec, null);
 assert.equal(loadLibrary().modelId, originalModel, "Original index stays active until full conversion");
 console.log(`[live-search-smoke] migration query returned ${second.filenames.length} matches at ${second.indexed}/12 before completion`);
 await converting;
 assert.equal(loadLibrary().modelId,target);
 const final = await query();
 assert(!final.partial); assert(final.filenames.length > 0);
 console.log("[live-search-smoke] OK: real models, renderer IPC, import and migration partial results, atomic completion");
}
module.exports = {runLiveSearchSmoke};
