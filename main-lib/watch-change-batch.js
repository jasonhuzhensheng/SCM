'use strict';
const path=require('node:path');
function createChangeBatch(root,limit=128){
 let paths=new Set(),full=false;
 return {
  add(filename){
   if(full)return;
   if(Buffer.isBuffer(filename))filename=filename.toString('utf8');
   if(typeof filename!=='string'||!filename||filename.includes('\0')){full=true;return;}
   const candidate=path.resolve(root,filename),rel=path.relative(root,candidate);
   if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)){full=true;return;}
   paths.add(candidate);if(paths.size>limit){full=true;paths.clear();}
  },
  drain(){const result=full||!paths.size?null:[...paths];paths=new Set();full=false;return result;}
 };
}
async function resolveChanges(root,paths,stat){
 if(!Array.isArray(paths)||!paths.length)return [root];
 for(const p of paths){const rel=path.relative(root,p);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))return [root];
  try{if(!(await stat(p)).isFile())return [root];}catch{return [root];}
 }
 return paths;
}
module.exports={createChangeBatch,resolveChanges};
