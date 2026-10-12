'use strict';
const assert = require('node:assert/strict');
const {scoreLibrary} = require('../main-lib/rank-search');
function rank(noiseCount) {
 const scores = [0.8, 0.72, 0.6, ...Array(noiseCount).fill(0.25)];
 const lib = {dim:2, filenames:scores.map((_,i)=>`image-${i}.jpg`), embeddings:scores.map(s=>new Float32Array([s,Math.sqrt(1-s*s)])), phrases:[], ocrWords:scores.map(()=>[])};
 const norms=lib.embeddings.map(v=>Math.hypot(...v));
 const options={minSemanticScore:0.04,relativeKeep:0.6};
 const result=scoreLibrary(lib,'QR code',new Float32Array([1,0]),scores.length,options,norms);
 assert.deepEqual(result.map(r=>r.filename),['image-0.jpg','image-1.jpg','image-2.jpg']);
 // Explicit OCR evidence in a visually weak row must survive the new floor.
 lib.ocrWords=scores.map(()=>[]);lib.ocrWords[3]=[{text:'QR'},{text:'code'}];
 const withText=scoreLibrary(lib,'QR code',new Float32Array([1,0]),scores.length,options,norms);
 assert(withText.some(r=>r.filename==='image-3.jpg'));
 assert.equal(withText.length,4);
}
rank(100);rank(10000);
console.log('PASS: full-library requests exclude weak semantic tail regardless of library size; exact OCR evidence survives');
