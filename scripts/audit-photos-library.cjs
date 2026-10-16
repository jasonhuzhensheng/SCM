'use strict';
// Read-only audit: keeps original index ordinals and writes only its report.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const input=process.argv[2],output=process.argv[3];if(!input||!output)throw Error('Usage: node audit-photos-library.cjs index.json report.json');
const index=JSON.parse(fs.readFileSync(input)),ctx={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/simple/photosLibraryView.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const selection=ctx.exports.photosLibrarySelection(index.images,index.sources),counts={},samples={};
for(let i=0;i<index.images.length;i++){
 const source=index.sources[i]||'',match=source.match(/\.photoslibrary\/(.*)/i);if(!match)continue;
 const category=match[1].startsWith('resources/')?match[1].split('/').slice(0,2).join('/'):match[1].split('/')[0];counts[category]=(counts[category]||0)+1;
 if((samples[category]??=[]).length<3)samples[category].push({filename:index.images[i],source});
}
const report={at:new Date().toISOString(),total:index.images.length,visible:selection.selected.length,hiddenInternal:selection.internal,groupedCompanions:selection.grouped,counts,samples,policy:'仅显示筛选，不删除或重写任何原件、索引或向量。跨图库及普通文件不按同名合并。'};
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,samples:undefined}));
