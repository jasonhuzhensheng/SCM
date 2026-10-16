'use strict';
function vectorNorm(v){let sum=0;for(let i=0;i<v.length;i++)sum+=v[i]*v[i];return Math.sqrt(sum);}
function updateRow(ranking,norms,i,v){
 const previous=ranking.embeddings[i];
 if(previous && previous.buffer===v.buffer && previous.byteOffset===v.byteOffset && previous.length===v.length)return false;
 ranking.embeddings[i]=v;norms[i]=vectorNorm(v);return true;
}
module.exports={vectorNorm,updateRow};
