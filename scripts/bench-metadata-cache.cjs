"use strict";
// Synthetic cache-only benchmark. No user library or AI model is opened.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const { createMetadataCache, closeMetadataCaches } = require("../main-lib/metadata-cache");
(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "metadata-bench-"));
 const count = Number(process.argv[2] || 100000);
 if (!Number.isSafeInteger(count) || count < 1000 || count > 1000000) throw Error("rows must be 1000–1000000");
 const histogram = monitorEventLoopDelay({ resolution: 10 });
 try {
  const records = Object.create(null), device = { brand: "索尼", model: "A7", status: "confirmed" };
  for (let i = 0; i < count; i++) records[`${i}.jpg`] = { key: "100:123", device };
  const legacyPath = path.join(root, "capture-devices.json");
  const original = JSON.stringify(records);
  await fs.writeFile(legacyPath, original);
  const cache = createMetadataCache({ cachePath: legacyPath, kind: "device" });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  histogram.enable();
  const migrationStart = performance.now();
  await cache.get(["0.jpg"]);
  const migrationMs = performance.now() - migrationStart;
  histogram.disable(); clearInterval(timer);
  const names = Array.from({ length: 1000 }, (_, i) => `${i}.jpg`);
  const reads = [], writes = [], oldWrites = [];
  for (let round = 0; round < 10; round++) {
   let start = performance.now(); await cache.get(names); reads.push(performance.now() - start);
   const rows = names.slice(0, 20).map(name => ({ name, value: { key: `100:${round}`, device } }));
   start = performance.now(); await cache.put(rows); writes.push(performance.now() - start);
   // Reproduce old whole-object stringify/write/rename path in a separate fixture.
   for (const row of rows) records[row.name] = row.value;
   start = performance.now();
   await fs.writeFile(path.join(root, "old.next"), JSON.stringify(records));
   await fs.rename(path.join(root, "old.next"), path.join(root, "old.json"));
   oldWrites.push(performance.now() - start);
  }
  if (await fs.readFile(legacyPath, "utf8") !== original) throw Error("legacy modified");
  const median = values => Number([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(2));
  await closeMetadataCaches();
  console.log(JSON.stringify({ fixtureRows: count, legacyBytes: Buffer.byteLength(original), sqliteBytes: (await fs.stat(cache.file)).size,
   migrationMs: +migrationMs.toFixed(2), migrationMainLoopMaxMs: +(histogram.max / 1e6).toFixed(2), migrationTimerTicks: ticks,
   lookup1000MedianMs: median(reads), update20MedianMs: median(writes), oldWholeJsonUpdateMedianMs: median(oldWrites),
   caveat: "synthetic cache only; excludes stat/metadata extraction/AI/UI; SQLite commits FULL, old JSON path did not fsync" }, null, 2));
 } finally { await closeMetadataCaches(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
