'use strict';
const fs=require('fs');
function stamps(paths,io=fs){return paths.map(p=>{const s=io.statSync(p);return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`});}
function loadSnapshot(paths,previous,io=fs){
 const before=stamps(paths,io),stamp=before.join('|');
 if(previous?.stamp===stamp)return previous;
 const read=(i,json)=>{
  const name=['index','meta','bin','phraseBin'][i];
  if(previous?.fileStamps?.[i]===before[i])return previous[name];
  const data=io.readFileSync(paths[i]);return json?JSON.parse(data):data;
 };
 const next={stamp,fileStamps:before,index:read(0,true),meta:read(1,true),bin:read(2,false),phraseBin:read(3,false)};
 if(stamps(paths,io).join('|')!==stamp)throw Error('索引正在更新，请稍后再试');
 // Do not retain ranking/OCR state across metadata changes.
 return next;
}
module.exports={loadSnapshot,stamps};
