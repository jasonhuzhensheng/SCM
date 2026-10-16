"use strict";
const assert = require("node:assert/strict");
const { metadataBudget, mapMetadata } = require("../main-lib/metadata-budget");
(async () => {
 assert.deepEqual(metadataBudget({ cores: 12, memoryBytes: 96 * 2 ** 30 }), { extraction: 4, stat: 20, inference: 1 });
 assert.deepEqual(metadataBudget({ cores: 4, memoryBytes: 8 * 2 ** 30 }), { extraction: 2, stat: 4, inference: 1 });
 let active = 0, peak = 0, visited = [], waves = [], current = 0, disabled = false;
 const histogram = { max: 90e6, enable() {}, disable() { disabled = true; }, reset() { this.max = 0; } };
 await mapMetadata(Array.from({ length: 12 }, (_, i) => i), 4, async value => {
  current++; active++; peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 1));
  active--; visited.push(value);
 }, { monitor: () => histogram, yieldTurn: async () => { waves.push(current); current = 0; } });
 assert.equal(peak, 4); assert.deepEqual(waves, [4, 2, 3, 3]); assert.equal(visited.length, 12); assert(disabled);
 let settled = false;
 await assert.rejects(mapMetadata([1, 2], 2, async value => {
  if (value === 1) throw Error("failed");
  await new Promise(resolve => setTimeout(resolve, 10)); settled = true;
 }), /failed/);
 assert(settled, "must not leave writes running after a failed wave");
 console.log("PASS: hardware bounds, lag backoff, gradual recovery, bounded concurrency and failure settlement");
})().catch(error => { console.error(error); process.exitCode = 1; });
