"use strict";

let nextId = 0;
// Append-only, model-specific view. Never changes the durable active library.
function createLiveSearchIndex(modelId, dim, total, id = `live-${++nextId}`) {
 const rows = [], norms = [], seen = new Set();
 const zero = new Float32Array(dim);
 const library = { modelId, dim, filenames: [], embeddings: [], phrases: [], ocrWords: [] };
 const normOf = vec => {
  if (!vec || vec.length !== dim) return 0;
  let sum = 0;
  for (const value of vec) { if (!Number.isFinite(value)) return 0; sum += value * value; }
  return Math.sqrt(sum);
 };
 const index = { id, modelId, dim, total, rows, norms, library,
  append(filename, embedding, phrase, ocrWords = []) {
   const norm = normOf(embedding);
   if (!norm || seen.has(filename)) return false;
   const validPhrase = normOf(phrase) ? phrase : null;
   rows.push({ filename, embedding, phrase: validPhrase, ocrWords });
   library.filenames.push(filename); library.embeddings.push(embedding);
   library.phrases.push(validPhrase || zero); library.ocrWords.push(ocrWords);
   norms.push(norm); seen.add(filename); return true;
  },
  seed(source, embeddings = source.embeddings, phrases = source.phrases) {
   source.filenames.forEach((filename, i) => index.append(filename, embeddings[i], phrases?.[i], source.ocrWords?.[i]));
   return index;
  },
 };
 return index;
}

function createLiveSearchCache() {
 let current = null;
 return {
  apply(update) {
   if (update.offset === 0) current = createLiveSearchIndex(update.modelId, update.dim, update.total, update.id);
   if (!current || current.id !== update.id || current.modelId !== update.modelId || current.dim !== update.dim || current.rows.length !== update.offset) {
    throw new Error("Live search snapshot changed; retry the query");
   }
   for (const row of update.rows) {
    if (!current.append(row.filename, row.embedding, row.phrase, row.ocrWords)) throw new Error("Invalid live search row");
   }
   return current;
  },
  clear() { current = null; },
 };
}
module.exports = { createLiveSearchIndex, createLiveSearchCache };
