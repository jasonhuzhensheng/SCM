"use strict";
// Bound filesystem concurrency without changing chronological import order.
async function readStats(paths, stat, concurrency = 16) {
 const result = new Map(); let cursor = 0;
 await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
  while (cursor < paths.length) {
   const file = paths[cursor++];
   try { result.set(file, await stat(file)); } catch { /* reported by import */ }
  }
 }));
 return result;
}
// Hold at most ONE next resized photo. Rejections are handled immediately;
// inference stays serialized and the normal per-file error path reports them.
function createPhotoPrefetch(decode) {
 let slot = null;
 function prime(message) {
  if (slot || message?.type !== 'embed-photo') return;
  slot = { message, value: Promise.resolve().then(() => decode(message.path)).then(raw => ({ raw }), error => ({ error })) };
 }
 async function take(message) {
  if (!slot || slot.message !== message) return decode(message.path);
  const value = slot.value; slot = null;
  const result = await value;
  if (result.error) throw result.error;
  return result.raw;
 }
 return { prime, take };
}
function createPhraseCache(limit = 512) {
 const states = new WeakMap();
 return async (state, phrase, compute) => {
  let cache = states.get(state); if (!cache) { cache = new Map(); states.set(state, cache); }
  if (cache.has(phrase)) { const value = cache.get(phrase); cache.delete(phrase); cache.set(phrase, value); return value.slice(); }
  const value = await compute();
  if (value) { cache.set(phrase, value.slice()); if (cache.size > limit) cache.delete(cache.keys().next().value); }
  return value;
 };
}
module.exports = { readStats, createPhotoPrefetch, createPhraseCache };
