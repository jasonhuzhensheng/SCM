'use strict';
const fs=require('fs'),path=require('path');
function queryReady(query,{root,lib,library=path.join(lib,'library')}){
 try {
  let english=query.trim();
  if(/\p{Script=Han}/u.test(english)){
   const exact=require('./main-translation.cjs').SEARCH_TERMS.get(english);
   let cached;try{cached=JSON.parse(fs.readFileSync(path.join(root,'translations-main.json')))[english]}catch{}
   english=exact || (typeof cached==='string'?cached.replace(/<\/?think>/g,'').trim():null) || require('./fast-chinese-query.cjs').fastChineseQuery(english);
   if(!english)return false;
  }
  const cache=require('./query-encoding-cache.cjs');
  if(!cache.read(path.join(root,'query-encodings.json'),cache.key(english,path.join(lib,'models/Xenova/clip-vit-large-patch14-336')),768))return false;
  return ['memories-index.json','memory-embed-meta-clip-vit-l14-336.json','memory-embeddings-clip-vit-l14-336.bin','memory-phrase-embeddings-clip-vit-l14-336.bin'].every(n=>fs.statSync(path.join(library,n)).size>0);
 }catch{return false;}
}
module.exports={queryReady};
