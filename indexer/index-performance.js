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
// UUIDs, long hashes and camera timestamps are identifiers, not captions.
// Keep this conservative: meaningful/mixed names retain their exact phrase.
// The lexical filename index still sees the original name, including IDs.
function filenameNeedsEmbedding(filename) {
 const stem = String(filename).replace(/\.[^.]+$/, '').replace(/(?: \(\d+\))+$/, '');
 return !(/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(stem)
  || /^(?:[a-f\d]{32}|[a-f\d]{40}|[a-f\d]{64})$/i.test(stem)
  || /^(?:(?:IMG|DSC|DSCN|PXL)[_-]?)?\d{8,}$/i.test(stem));
}
// Full-vector checkpoints are expensive at library scale. Target 40 writes,
// retaining a five-minute recovery bound when individual videos are slow.
function createCheckpointGate(total, now = Date.now) {
 const interval = Math.max(25, Math.ceil(total / 40));
 let saved = 0, savedAt = now();
 return done => {
  if (done <= saved || (done - saved < interval && now() - savedAt < 300000)) return false;
  saved = done; savedAt = now(); return true;
 };
}
module.exports = { readStats, createPhotoPrefetch, createPhraseCache, filenameNeedsEmbedding, createCheckpointGate };
