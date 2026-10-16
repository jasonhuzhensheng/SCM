'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function key(text,modelDirectory){
 const files=['config.json','tokenizer.json','tokenizer_config.json','onnx/text_model_quantized.onnx'];
 const stamps=files.map(f=>{const s=fs.statSync(path.join(modelDirectory,f));return [f,s.ino,s.size,s.mtimeMs]});
 return crypto.createHash('sha256').update(JSON.stringify(['clip-mean-three-v1-q8',text,stamps])).digest('hex');
}
function valid(v,dim){return Array.isArray(v)&&v.length===dim&&v.every(Number.isFinite)&&Math.abs(v.reduce((n,x)=>n+x*x,0)-1)<0.01;}
function read(file,k,dim){try{const v=JSON.parse(fs.readFileSync(file,'utf8'))[k];return valid(v,dim)?Float32Array.from(v):null}catch{return null}}
function write(file,k,v){let all={};try{all=JSON.parse(fs.readFileSync(file,'utf8'));if(!all||Array.isArray(all)||typeof all!=='object')all={}}catch{}delete all[k];all[k]=Array.from(v);const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(Object.fromEntries(Object.entries(all).slice(-64))),{mode:0o600});fs.renameSync(tmp,file);}
module.exports={key,read,write,valid};
