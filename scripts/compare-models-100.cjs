'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),{createRequire}=require('module'),{pathToFileURL}=require('url');
const core=require('../indexer/build-memory-embeddings-core');
const {centerText}=require('../indexer/memory-embedding-utils');
const modelId=process.argv[2],out=path.resolve('benchmarks/model-ab-100');
const sample=JSON.parse(fs.readFileSync(path.join(out,'sample.json'))),queries=JSON.parse(fs.readFileSync(path.join(out,'queries.json')));
const cfg=core.getModelConfig(modelId);const now=()=>performance.now();
const stats=xs=>{const a=[...xs].sort((x,y)=>x-y);return{n:a.length,totalMs:xs.reduce((a,b)=>a+b,0),meanMs:xs.reduce((a,b)=>a+b,0)/a.length,medianMs:a[Math.floor(a.length/2)],p95Ms:a[Math.ceil(a.length*.95)-1]};};
(async()=>{
 let s;const begin=now();
 if(cfg.runtime==='embeddinggemma2')s=await require('../indexer/embeddinggemma2').loadEmbeddingGemma2({repo:cfg.repo,cacheDir:'/private/tmp/sayphoto-eg2-models'});
 else{
 const req=createRequire('/private/tmp/sayphoto-ab-old-runtime/package.json');const imported=await import(pathToFileURL(req.resolve('@huggingface/transformers')).href);const mod=imported.env?imported:imported.default;mod.env.cacheDir='/private/tmp/sayphoto-ab-models';mod.env.allowRemoteModels=false;process.env.TRANSFORMERS_CACHE=mod.env.cacheDir;
 const extractor=await mod.pipeline('image-feature-extraction',cfg.repo,{dtype:'q8',session_options:{executionProviders:['cpu']}});
 const tokenizer=await mod.AutoTokenizer.from_pretrained(cfg.repo),textModel=await mod.SiglipTextModel.from_pretrained(cfg.repo,{dtype:'q8',session_options:{executionProviders:['cpu']}});
 s={extractor,tokenizer,textModel,outputKey:cfg.textOutputKey,RawImage:mod.RawImage,sharp:req('sharp'),dim:768};
 s.textMean=await core.resolveTextMean({registryId:modelId,dim:768,textPair:s,textMaxLength:64,log:console});
 }
 const loadMs=now()-begin;
 const photo=async row=>core.embedRawImage(s.extractor,s.RawImage,await core.decodeToRaw(row.file,s.sharp,cfg.inputSize),768,cfg.visionPool);
 for(const row of sample.rows.slice(0,3))await photo(row);
 const vectors=[],times=[],failures=[];
 for(const row of sample.rows){const t=now();try{const v=await photo(row);times.push(now()-t);vectors.push(Array.from(v));}catch(e){failures.push({id:row.id,error:e.message});vectors.push(null);}if(vectors.length%10===0)console.log(modelId,'images',vectors.length,'/',sample.rows.length);fs.writeFileSync(path.join(out,modelId+'-partial.json'),JSON.stringify({done:vectors.length,times,failures}));}
 const query=async text=>{
 if(cfg.runtime==='embeddinggemma2')return Array.from((await s.queryModel(s.tokenizer(text))).sentence_embedding.data);
 const texts=[text,...(text.length>=4?[`a photo of ${text}`,`a screenshot of ${text}`]:[])];const vecs=[];for(const t of texts)vecs.push(await core.embedText(t,s,768,64));const avg=new Float32Array(768);for(const v of vecs)for(let i=0;i<768;i++)avg[i]+=v[i];core.normalizeInPlace ? core.normalizeInPlace(avg) : (()=>{const n=Math.hypot(...avg);for(let i=0;i<768;i++)avg[i]/=n;})();return Array.from(centerText(avg,s.textMean));
 };
 await query(queries[0].en);
 const modes=cfg.runtime==='embeddinggemma2'?['zh','en']:['en','zh'];const results={};
 for(const language of modes){const rankings=[],queryTimes=[],rankTimes=[];for(const q of queries){let v;const repeats=[];for(let rep=0;rep<3;rep++){const t=now();v=await query(q[language]);repeats.push(now()-t);}queryTimes.push(...repeats);const t=now();const ranked=vectors.map((a,i)=>({id:sample.rows[i].id,score:a?a.reduce((n,x,j)=>n+x*v[j],0):-Infinity})).sort((a,b)=>b.score-a.score);rankTimes.push(now()-t);const first=ranked.findIndex(r=>q.relevant.includes(r.id))+1;rankings.push({query:q[language],relevant:q.relevant,firstRelevantRank:first,top5:ranked.slice(0,5),recall5:ranked.slice(0,5).filter(r=>q.relevant.includes(r.id)).length/q.relevant.length});}
 results[language]={hit1:rankings.filter(r=>r.firstRelevantRank===1).length/queries.length,hit5:rankings.filter(r=>r.firstRelevantRank<=5).length/queries.length,mrr:rankings.reduce((n,r)=>n+1/r.firstRelevantRank,0)/queries.length,recall5:rankings.reduce((n,r)=>n+r.recall5,0)/queries.length,queryTiming:stats(queryTimes),rankingTiming:stats(rankTimes),rankings};console.log(modelId,language,'hit1',results[language].hit1,'hit5',results[language].hit5);}
 const result={modelId,timestamp:new Date().toISOString(),cpu:os.cpus()[0].model,loadMs,imageTiming:stats(times),imageTimes:times,failures,results};fs.writeFileSync(path.join(out,modelId+'.json'),JSON.stringify(result,null,2));console.log('DONE',modelId,JSON.stringify(result.imageTiming));
})().catch(e=>{console.error(e);process.exitCode=1});
