"use strict";
const os = require("node:os");
const { monitorEventLoopDelay } = require("node:perf_hooks");
function metadataBudget({ cores = os.cpus().length, memoryBytes = os.totalmem() } = {}) {
 const cpu = Math.max(1, cores - 2);
 const memory = Math.max(1, Math.floor(memoryBytes / 2 ** 30 / 4));
 return { extraction: Math.max(1, Math.min(4, cpu, memory)), stat: Math.max(2, Math.min(32, cpu * 2, memory * 4)), inference: 1 };
}
// Bounded waves yield between batches. Existing work always settles before errors escape.
async function mapMetadata(items, limit, visit, { monitor = () => monitorEventLoopDelay({ resolution: 10 }), yieldTurn = () => new Promise(resolve => setImmediate(resolve)) } = {}) {
 const histogram = monitor();
 histogram.enable();
 let width = Math.max(1, limit);
 try {
  for (let i = 0; i < items.length;) {
   const wave = items.slice(i, i + width);
   const results = await Promise.allSettled(wave.map(visit));
   const failed = results.find(result => result.status === "rejected");
   if (failed) throw failed.reason;
   i += wave.length;
   await yieldTurn();
   const lag = histogram.max / 1e6;
   if (lag > 40) width = Math.max(1, Math.floor(width / 2));
   else if (lag < 20) width = Math.min(limit, width + 1);
   histogram.reset();
  }
 } finally { histogram.disable(); }
}
module.exports = { metadataBudget, mapMetadata };
