'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),net=require('net'),{spawn}=require('child_process'),{DatabaseSync}=require('node:sqlite');
const home=os.homedir(),lib=path.join(home,'Library/Application Support/scm'),root=process.env.SAYPHOTO_MENU_DATA||path.join(home,'Library/Application Support/SayPhoto Menu');
const model='clip-vit-l14-336',repo='Xenova/clip-vit-large-patch14-336',dim=768;
const serverMode=process.argv[2]==='--server';
let request={},output;
let snapshot=null,loadedText=null;
const assetRows=require('./sqlite-rows-cache.cjs').createRowsCache();
const queryVectors=new Map();
const {vectorNorm,updateRow}=require('./vector-norms.cjs');
async function release(){assetRows.close();await imageSession.release();if(loadedText){await loadedText.textModel.dispose();loadedText=null;}snapshot=null;queryVectors.clear();}
let child;function stop(){if(child){child.kill('SIGTERM');child=null;}}process.on('exit',stop);process.on('SIGTERM',()=>{stop();process.exit(143)});
os.setPriority(0,19);
const norm=v=>{let n=Math.sqrt(v.reduce((s,x)=>s+x*x,0));if(!Number.isFinite(n)||n<1e-6)throw Error('无效向量');return Float32Array.from(v,x=>x/n)};
function atomic(file,obj){const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(obj));fs.renameSync(tmp,file)}
async function translate(text){
 if(!/\p{Script=Han}/u.test(text))return text;
 const {INSTRUCTION,SEARCH_TERMS}=require('./main-translation.cjs');if(SEARCH_TERMS.has(text))return SEARCH_TERMS.get(text);
 const cachePath=path.join(root,'translations-main.json');let cache={};try{cache=JSON.parse(fs.readFileSync(cachePath))}catch{}if(cache[text])return cache[text].replace(/<\/?think>/g,'').trim();
 const fast=require('./fast-chinese-query.cjs').fastChineseQuery(text);if(fast)return fast;
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
 const translationStarted=performance.now();
 const budget={requested:request.translationThreads,cores:os.cpus().length,memoryBytes:os.totalmem(),freeBytes:os.freemem(),load:os.loadavg()[0]};
 const batchThreads=require('./translation-budget.cjs').promptThreads(budget);
 child=spawn(path.join(lib,'llm/bin/llama-server'),['-m',path.join(lib,'llm/models/Qwen3-1.7B-Q4_K_M.gguf'),'--host','127.0.0.1','--port',String(port),'-c','1024','-t','1','-tb',String(batchThreads),'-b','64','-ub','64','--no-warmup','-ngl','0','--parallel','1','--reasoning-budget','0'],{stdio:'ignore'});
 let failure;child.on('error',e=>failure=e);const deadline=Date.now()+60000;
 try{for(;;){if(failure)throw failure;if(Date.now()>deadline||child.exitCode!==null)throw Error('中文搜索准备超时');try{if((await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)})).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 const r=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:INSTRUCTION},{role:'user',content:text}],temperature:0,max_tokens:128,stream:false}),signal:AbortSignal.timeout(60000)});const j=await r.json();const result=String(j.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'').replace(/<\/?think>/g,'').trim();if(!result||/\p{Script=Han}/u.test(result)||!/[a-z]/i.test(result)||j.choices?.[0]?.finish_reason==='length')throw Error('中文转换失败，请重试');try{atomic(path.join(root,'translation-check.json'),{elapsedMs:performance.now()-translationStarted,batchThreads,generationThreads:1,budget})}catch{}cache[text]=result;atomic(cachePath,Object.fromEntries(Object.entries(cache).slice(-128)));return result;
 }finally{const c=child;stop();if(c&&c.exitCode===null)await Promise.race([new Promise(r=>c.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);}
}
async function models(){const t=require('./node_modules/@huggingface/transformers');t.env.cacheDir=path.join(lib,'models');t.env.allowRemoteModels=false;t.env.allowLocalModels=true;t.env.localModelPath=path.join(lib,'models')+'/';return t}
const opts={dtype:'q8',local_files_only:true,session_options:{executionProviders:['cpu'],intraOpNumThreads:1,interOpNumThreads:1}};
let imageThreadCount=1;
const imageSession=require('./image-session.cjs').createImageSession(async()=>{const t=await models();return t.pipeline('image-feature-extraction',repo,{...opts,session_options:{...opts.session_options,intraOpNumThreads:imageThreadCount}})});
async function loadText(){if(!loadedText){const t=await models();loadedText={tokenizer:await t.AutoTokenizer.from_pretrained(repo,{local_files_only:true}),textModel:await t.CLIPTextModelWithProjection.from_pretrained(repo,opts)};}return loadedText;}
async function mainSearch(query,mode,ready=false){
 return require('./main-search-client.cjs').mainSearch(path.join(root,'main-search.sock'),query,mode,ready);
}
async function run(){
 if(request.mode!=='fill')await imageSession.release();
 if(request.mode==='releaseImage')return {ok:true};
 if(request.mode==='warmup'){await loadText();return {ok:true,warmed:true};}
 if(['open','settings'].includes(request.mode)){const deadline=Date.now()+45000;while(Date.now()<deadline){const reply=await mainSearch(request.query||'', request.mode);if(reply)return reply;await new Promise(r=>setTimeout(r,300));}throw Error('主程序尚未准备好');}
 if(request.mode!=='fill'&&request.query?.trim()){const ready=require('./query-readiness.cjs').queryReady(request.query,{root,lib,library:process.env.SAYPHOTO_MENU_LIBRARY||path.join(lib,'library')});const shared=await mainSearch(request.query.trim(),undefined,ready);if(shared){if(!shared.ok)throw Error(shared.error);return shared;}}
 if((request.query?.length||0)>300)throw Error('请缩短描述');
 const translatedQuery=request.mode==='fill'||!request.query?.trim()?null:await translate(request.query.trim());
 const dir=process.env.SAYPHOTO_MENU_LIBRARY||path.join(lib,'library');
 const paths=['memories-index.json',`memory-embed-meta-${model}.json`,`memory-embeddings-${model}.bin`,`memory-phrase-embeddings-${model}.bin`].map(f=>path.join(dir,f));
 const {loadSnapshot,stamps}=require('./index-snapshot.cjs');
 const stamp=()=>stamps(paths).join('|');
 snapshot=loadSnapshot(paths,snapshot);
 const before=snapshot.stamp;
 const {index,meta,bin,phraseBin}=snapshot;
 if(index.modelId!==model||index.dim!==dim||meta.modelId!==model||meta.dim!==dim||meta.codeVersion!==1)throw Error('图片索引版本不匹配');
 if(before!==stamp()||index.images.length!==meta.filenames.length||index.images.some((n,i)=>n!==meta.filenames[i]))throw Error('索引正在更新，请稍后再试');if(bin.readInt32LE(0)!==meta.filenames.length||bin.readInt32LE(4)!==dim||bin.length!==8+meta.filenames.length*dim*4)throw Error('图片索引尚未保存完整');
 const assets=assetRows.read(path.join(root,'search.sqlite'),"SELECT name,source,baseText||' '||extraText AS text,locked,signature FROM assets WHERE hidden=0").filter(a=>/\.(jpe?g|png|heic|heif|webp|tiff?|bmp)$/i.test(a.source));
 const rows=new Map(meta.filenames.map((n,i)=>[n,i]));const extra=new DatabaseSync(path.join(root,'vectors.sqlite'));extra.exec('CREATE TABLE IF NOT EXISTS vectors(name TEXT PRIMARY KEY,signature TEXT,model TEXT,vec BLOB,error TEXT)');
 const cached=new Map(extra.prepare('SELECT * FROM vectors WHERE model=?').all(model).map(r=>[r.name,r]));
 const current=new Map(index.images.map((name,i)=>[name,index.sources[i]]));
 const candidates=[],missing=[];for(const a of assets){if(current.get(a.name)!==a.source)continue;let v;const i=rows.get(a.name);if(i!==undefined){v=new Float32Array(bin.buffer,bin.byteOffset+8+i*dim*4,dim);if(!v.some(x=>x!==0))v=null}if(!v){const c=cached.get(a.name);if(c?.signature===a.signature&&c.vec?.length===dim*4)v=new Float32Array(Uint8Array.from(c.vec).buffer);if(!v&&!(c?.signature===a.signature&&c.error))missing.push(a)}if(v)candidates.push({a,v})}
 let status={indexed:candidates.length,total:assets.length,pending:missing.length,model,at:new Date().toISOString()};atomic(path.join(root,'semantic-status.json'),status);
 if(request.mode==='fill'){
  const desiredThreads=require('./image-budget.cjs').imageThreads({requested:request.imageThreads,cores:os.cpus().length,memoryBytes:os.totalmem(),load:os.loadavg()[0]});
  if(desiredThreads!==imageThreadCount){await imageSession.release();imageThreadCount=desiredThreads;}
  if(!missing.length){await imageSession.release();extra.close();return {...status,ok:true};}const a=missing[0];try{const st=fs.statSync(a.source);if(st.size>100*1024*1024)throw Error('文件过大，已跳过');const t=await models(),sharp=require('sharp');sharp.concurrency(1);const decodeStart=performance.now();const raw=await sharp(a.source,{limitInputPixels:40000000}).resize(336,336,{fit:'inside',withoutEnlargement:true}).raw().toBuffer({resolveWithObject:true});const decodeMs=performance.now()-decodeStart;const {result:res,timings}=await imageSession.use(new t.RawImage(new Uint8Array(raw.data),raw.info.width,raw.info.height,raw.info.channels));const v=norm(Array.from(res.data));if(v.length!==dim)throw Error('向量维度不符');const saveStart=performance.now();extra.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?,NULL)').run(a.name,a.signature,model,Buffer.from(v.buffer));status.indexed++;status.pending--;atomic(path.join(root,'semantic-status.json'),status);return {...status,ok:true,filled:a.name,timings:{decodeMs,...timings,saveMs:performance.now()-saveStart,threads:imageThreadCount}};}catch(e){extra.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?,NULL,?)').run(a.name,a.signature,model,e.message);return {...status,ok:true,skipped:a.name}}finally{extra.close()}
 }
 if(!request.query?.trim()){extra.close();return {ok:true,results:[],...status};}if(request.query.length>300)throw Error('请缩短描述');
 const english=translatedQuery,encodingCache=require('./query-encoding-cache.cjs');
 const encodingKey=encodingCache.key(english,path.join(lib,'models',repo)),cacheFile=path.join(root,'query-encodings.json');
 let baseQuery=queryVectors.get(encodingKey)||encodingCache.read(cacheFile,encodingKey,dim);
 if(!baseQuery){
 const {tokenizer,textModel}=await loadText();
 const templates=english.length>=4?[english,`a photo of ${english}`,`a screenshot of ${english}`]:[english];const sum=new Float32Array(dim);for(const phrase of templates){const out=await textModel(tokenizer(phrase,{padding:true,truncation:true}));const v=norm(Array.from(out.text_embeds.data));if(v.length!==dim)throw Error('向量维度不符');for(let i=0;i<dim;i++)sum[i]+=v[i]}
 baseQuery=norm(Array.from(sum));if(queryVectors.size>=64)queryVectors.delete(queryVectors.keys().next().value);queryVectors.set(encodingKey,baseQuery);try{encodingCache.write(cacheFile,encodingKey,baseQuery)}catch{}
 }
 let q=Float32Array.from(baseQuery);if(!Array.isArray(index.textMean)||index.textMean.length!==dim)throw Error('缺少查询向量校准');const proj=q.reduce((s,x,i)=>s+x*index.textMean[i],0);q=norm(Array.from(q,(x,i)=>x-proj*index.textMean[i]));
 const {scoreLibrary}=require('./main-rank-search.cjs');
 if(phraseBin.length!==bin.length||phraseBin.readInt32LE(0)!==meta.filenames.length||phraseBin.readInt32LE(4)!==dim)throw Error('搜索数据尚未保存完整');
 if(!snapshot.ranking){const embeddings=[],phrases=[],norms=[];for(let i=0;i<meta.filenames.length;i++){const v=new Float32Array(bin.buffer,bin.byteOffset+8+i*dim*4,dim);embeddings.push(v);phrases.push(new Float32Array(phraseBin.buffer,phraseBin.byteOffset+8+i*dim*4,dim));norms.push(vectorNorm(v));}snapshot.ranking={filenames:meta.filenames,embeddings,phrases,ocrWords:index.ocrWords||meta.filenames.map(()=>[]),dim};snapshot.norms=norms;}
 for(const {a,v} of candidates){const i=rows.get(a.name);if(i!==undefined){updateRow(snapshot.ranking,snapshot.norms,i,v);}}
 let thresholds={};try{thresholds=JSON.parse(fs.readFileSync(path.join(dir,'memory-models.json'))).models?.[model]?.thresholds||{}}catch{}
 const ranked=scoreLibrary(snapshot.ranking,request.query,q,Math.max(meta.filenames.length,100),thresholds,snapshot.norms),available=new Map(candidates.map(c=>[c.a.name,c.a]));
 const results=ranked.filter(r=>available.has(r.filename)).map(r=>({...available.get(r.filename),score:r.score}));
 extra.close();return {ok:true,mode:'shared-ranker',query:request.query,english,results,...status};
}
async function handle(input,dest){request=JSON.parse(fs.readFileSync(input,'utf8'));output=dest;const start=Date.now();try{const r=await run();atomic(output,{...r,elapsedMs:Date.now()-start});}catch(e){atomic(output,{ok:false,error:e.message,elapsedMs:Date.now()-start});}}
if(serverMode){
 const readline=require('readline').createInterface({input:process.stdin});let chain=Promise.resolve(),timer;
 let closing=false;const close=async()=>{if(closing)return;closing=true;clearTimeout(timer);readline.close();process.stdin.destroy();await release();};
 const idle=()=>{clearTimeout(timer);timer=setTimeout(close,60000);};idle();
 readline.on('line',line=>{clearTimeout(timer);chain=chain.then(async()=>{clearTimeout(timer);const m=JSON.parse(line);await handle(m.input,m.output);}).catch(()=>{}).finally(idle);});
 readline.on('close',close);
}else{handle(process.argv[2],process.argv[3]).then(release);}
