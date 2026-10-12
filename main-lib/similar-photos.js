'use strict';
const PHOTO = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp)$/i;
function norm(vector) {
 if (!vector?.length) return 0;
 let sum = 0; for (const v of vector) { if (!Number.isFinite(v)) return 0; sum += v*v; }
 return Math.sqrt(sum);
}
async function similarPhotos(library, filename, limit = 500) {
 // Snapshot row identities before yielding so imports/deletions cannot misalign rows.
 const names = library.filenames.slice(), vectors = library.embeddings.slice();
 const at = names.indexOf(filename), reference = vectors[at];
 if (at < 0 || !PHOTO.test(filename)) throw Error('请选择素材库中的照片。');
 const referenceNorm = norm(reference);
 if (!referenceNorm) throw Error('这张照片尚未完成索引，请稍后重试。');
 const matches = [];
 for (let i = 0; i < names.length; i++) {
  if (i % 256 === 255) await new Promise(resolve => setImmediate(resolve));
  if (!PHOTO.test(names[i])) continue;
  const vector = vectors[i]; if (vector?.length !== reference.length) continue;
  const magnitude = norm(vector); if (!magnitude) continue;
  let dot = 0; for (let d = 0; d < reference.length; d++) dot += reference[d]*vector[d];
  const score = Math.min(1, Math.max(-1, dot/(referenceNorm*magnitude)));
  if (score >= 0.4) matches.push({filename:names[i],score});
 }
 matches.sort((a,b)=> (a.filename===filename?-1:b.filename===filename?1:b.score-a.score) || a.filename.localeCompare(b.filename));
 return matches.slice(0,limit);
}
module.exports = { similarPhotos };
