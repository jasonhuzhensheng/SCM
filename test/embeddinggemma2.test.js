"use strict";
const assert = require("node:assert/strict");
const {loadEmbeddingGemma2} = require("../indexer/embeddinggemma2");
const {getModel} = require("../indexer/models");
(async () => {
 const cfg=getModel("embeddinggemma-2");
 const s=await loadEmbeddingGemma2({repo:cfg.repo,cacheDir:process.env.TRANSFORMERS_CACHE});
 const vector=result=>{assert.equal(result.data.length,768);const v=Array.from(result.data);assert(v.every(Number.isFinite));assert(Math.abs(Math.hypot(...v)-1)<0.001);return v;};
 const rgb=color=>{const data=new Uint8ClampedArray(96*96*3);for(let i=0;i<data.length;i+=3)data.set(color,i);return new s.RawImage(data,96,96,3);};
 const blue=vector(await s.extractor(rgb([0,0,255])));
 const red=vector(await s.extractor(rgb([255,0,0])));
 const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
 for(const text of ['a blue square','一个蓝色方块']) {
  const q=vector((await s.queryModel(s.tokenizer(text))).sentence_embedding);
  assert(dot(q,blue)>dot(q,red),`incorrect blue retrieval: ${text}`);
 }
 vector((await s.textModel(s.tokenizer('红色的汽车'))).sentence_embedding);
 assert.equal(s.textMean,null,'do not apply CLIP centering');
 console.log('PASS: real EmbeddingGemma 2 normalized image/document/query vectors and English/Chinese color retrieval');
})().catch(error=>{console.error(error);process.exitCode=1;});
