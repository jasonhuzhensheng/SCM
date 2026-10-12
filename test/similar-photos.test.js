const assert = require('node:assert/strict');
const {similarPhotos} = require('../main-lib/similar-photos');
(async()=>{
 const library={filenames:['ref.jpg','same.png','near.heic','other.jpg','video.mp4','zero.jpg','bad.jpg','dimension.jpg'],embeddings:[[2,0],[8,0],[3,1],[0,1],[2,0],[0,0],[NaN,0],[1,0,1]]};
 const matches=await similarPhotos(library,'ref.jpg');
 assert.deepEqual(matches.map(x=>x.filename),['ref.jpg','same.png','near.heic']);assert.equal(matches[1].score,1);assert(matches[2].score>.9);
 assert.equal((await similarPhotos(library,'ref.jpg',2)).length,2);
 await assert.rejects(similarPhotos(library,'missing.jpg'));
 await assert.rejects(similarPhotos(library,'zero.jpg'));
 await assert.rejects(similarPhotos(library,'video.mp4'));
 const many={filenames:Array.from({length:600},(_,i)=>`${i}.jpg`),embeddings:Array.from({length:600},()=>[1,0])};
 const pending=similarPhotos(many,'0.jpg');many.filenames.splice(0,10);many.embeddings.splice(0,10);
 const snapshot=await pending;assert.equal(snapshot.length,500);assert.equal(snapshot[0].filename,'0.jpg');assert(snapshot.every(x=>Number.isFinite(x.score)));
 console.log('PASS: normalized whole-image ranking, reference first, photo-only, malformed vectors, limit, snapshot during deletion');
})().catch(e=>{console.error(e);process.exitCode=1;});
