'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dir=path.resolve('benchmarks/model-ab-100'),read=n=>JSON.parse(fs.readFileSync(path.join(dir,n)));
const a=read('siglip2-base-patch16-224.json'),b=read('embeddinggemma-2.json'),sample=read('sample.json'),q=read('queries.json');
if(sample.rows.length!==100||a.imageTiming.n!==100||b.imageTiming.n!==100||a.failures.length||b.failures.length)throw Error('100 successful images required for comparison');
const x=a.results.en,y=b.results.zh,pct=n=>(n*100).toFixed(1)+'%',ms=n=>n.toFixed(1)+' ms',sec=n=>(n/1000).toFixed(2)+' 秒';
const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex');
let onlyA=0,onlyB=0,both=0,neither=0;for(let i=0;i<q.length;i++){const aa=x.rankings[i].firstRelevantRank===1,bb=y.rankings[i].firstRelevantRank===1;if(aa&&bb)both++;else if(aa)onlyA++;else if(bb)onlyB++;else neither++;}
const lines=[`# 100 张图片模型对比实测`,``,`测试日期：2026-10-12（America/Mexico_City）。设备：${a.cpu}。`,``,`## 主对比结果`,``,`| 指标 | SigLIP-2-B/16（对应英文） | EmbeddingGemma 2（中文原句） |`,`|---|---:|---:|`,
`| 图片数 | 100 | 100 |`,`| 查询数 | ${q.length} | ${q.length} |`,
`| Top-1：第一张就是正确图片 | ${pct(x.hit1)}（${Math.round(x.hit1*q.length)}/${q.length}） | ${pct(y.hit1)}（${Math.round(y.hit1*q.length)}/${q.length}） |`,
`| Hit@5：前五张至少一张正确 | ${pct(x.hit5)} | ${pct(y.hit5)} |`,
`| Recall@5：前五张覆盖的正确图片比例 | ${pct(x.recall5)} | ${pct(y.recall5)} |`,
`| MRR：首个正确结果排名倒数均值 | ${x.mrr.toFixed(4)} | ${y.mrr.toFixed(4)} |`,
`| 100 张图片总编码时间 | ${sec(a.imageTiming.totalMs)} | ${sec(b.imageTiming.totalMs)} |`,
`| 每张图片平均时间 | ${ms(a.imageTiming.meanMs)} | ${ms(b.imageTiming.meanMs)} |`,
`| 每张图片中位时间 | ${ms(a.imageTiming.medianMs)} | ${ms(b.imageTiming.medianMs)} |`,
`| 每张图片 P95 | ${ms(a.imageTiming.p95Ms)} | ${ms(b.imageTiming.p95Ms)} |`,
`| 单条查询编码中位时间 | ${ms(x.queryTiming.medianMs)} | ${ms(y.queryTiming.medianMs)} |`,
`| 100 张向量排序中位时间 | ${ms(x.rankingTiming.medianMs)} | ${ms(y.rankingTiming.medianMs)} |`,
`| 缓存权重加载时间（非首次下载） | ${sec(a.loadMs)} | ${sec(b.loadMs)} |`,
``,`EmbeddingGemma 2 的图片编码耗时为 SigLIP 的 ${(b.imageTiming.totalMs/a.imageTiming.totalMs).toFixed(2)} 倍；Top-1 相差 ${((y.hit1-x.hit1)*100).toFixed(1)} 个百分点。40 条配对查询中，两者都首位命中 ${both} 条、仅 SigLIP 命中 ${onlyA} 条、仅 EmbeddingGemma 2 命中 ${onlyB} 条、都未首位命中 ${neither} 条。少量查询的差距不等于统计显著优势。`,
``,`## 语言对照`,``,`| 模型 | 中文直接查询 Top-1 / Hit@5 | 对应英文查询 Top-1 / Hit@5 |`,`|---|---:|---:|`,
`| SigLIP-2-B | ${pct(a.results.zh.hit1)} / ${pct(a.results.zh.hit5)} | ${pct(x.hit1)} / ${pct(x.hit5)} |`,
`| EmbeddingGemma 2 | ${pct(y.hit1)} / ${pct(y.hit5)} | ${pct(b.results.en.hit1)} / ${pct(b.results.en.hit5)} |`,
``,`## 测试方法与限制`,``,
`- 从现有素材库 JPEG/PNG/WebP 候选 ${sample.eligible} 张中，按固定种子 SHA-256 排序，选取前 100 张可读取且宽高不少于 128 像素的图片。100 张字节哈希均不同，但包含近似图片；这些近似图按查询相关性共同标注为正确结果。`,
`- 抽样遇到 ${sample.errors.EPERM||0} 次读取权限错误；因此只代表可读取素材，不代表整个 Apple 照片库。图片包含人物、旅行、物品、图表和界面截图。未上传图片至外部服务。`,
`- 查询与正确图片编号由助手目视检查联系表后固定，早于模型检索结果；不是独立人工标注团队或用户确认的标准数据集。40 条查询各有 1–4 张相关图片，使用同一相关集合评估两个模型。`,
`- SigLIP 主对比使用助手预先写好的语义对应英文，不包含实际翻译模型误差和延迟；EmbeddingGemma 2 使用中文原句。另测两个模型的中英文查询作为对照。`,
`- 两模型依次运行、CPU 推理、串行 batch=1，先预热 3 张再测同一顺序的 100 张；图片时间包含原图解码、生产代码规定的缩放和向量推理，不包含文件复制、模型加载、OCR、文件名融合、索引落盘或 UI。每种语言每条查询重复 3 次，排序单独计时。`,
`- SigLIP 使用已安装运行时 Transformers.js 3.8.1、Q8、224 输入、模板平均与既有 textMean；EmbeddingGemma 2 使用独立 4.3.1、Q4、768 解码目标、官方查询前缀、不做中心化。这是当前两种实现方案对比，不是控制相同分辨率和量化的纯模型架构对比。`,
`- 准确度只评价图片向量的检索排序；未应用 UI 最低分过滤、OCR/文件名加分。Top-1/Hit@5 是查询命中率，不等于所有返回图片都正确。`,
`- 测试时 SayPhoto 界面仍在运行，曾观察到 renderer 约一个 CPU 核心占用；这不是完全空闲机器上的多轮性能基准。图片只测一个完整轮次，不给出可靠的全库耗时预测。`,
`- 两模型均成功处理 100 张图片，失败为 0；未替换安装包、未切换真实库模型、未执行副本删除。`,
``,`## 可复现文件`,``,
`- sample.json：种子、100 个编号、路径、尺寸、哈希与抽样跳过原因。`,
`- queries.json：40 条中英文查询及正确编号。`,
`- siglip2-base-patch16-224.json / embeddinggemma-2.json：逐图时间、逐查询前五结果和汇总。`,
`- sample SHA-256：${hash('sample.json')}`,`- queries SHA-256：${hash('queries.json')}`,
``,`## 首位未命中的逐查询对比`,``,`| 查询 | SigLIP 首个正确名次 | EmbeddingGemma 2 首个正确名次 |`,`|---|---:|---:|`];
for(let i=0;i<q.length;i++){const ar=x.rankings[i].firstRelevantRank,br=y.rankings[i].firstRelevantRank;if(ar>1||br>1)lines.push(`| ${q[i].zh} | ${ar} | ${br} |`);}
fs.writeFileSync(path.join(dir,'report.md'),lines.join('\n')+'\n');console.log(JSON.stringify({siglip:x.hit1,gemma:y.hit1,siglipMs:a.imageTiming.totalMs,gemmaMs:b.imageTiming.totalMs,onlyA,onlyB,both,neither}));
