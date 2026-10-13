"use strict";
const fs = require('node:fs/promises');
const path = require('node:path');
function parseDeviceExif(exif) {
 try {
  if (!Buffer.isBuffer(exif)) return {};
  const b = exif.subarray(exif.subarray(0,6).equals(Buffer.from('Exif\0\0')) ? 6 : 0);
  const little = b.toString('ascii',0,2) === 'II';
  if (!little && b.toString('ascii',0,2) !== 'MM') return {};
  const u16 = p => little ? b.readUInt16LE(p) : b.readUInt16BE(p);
  const u32 = p => little ? b.readUInt32LE(p) : b.readUInt32BE(p);
  if (u16(2) !== 42) return {};
  const offset=u32(4), count=u16(offset), result={};
  if(offset<8 || count>1024 || offset+2+count*12>b.length) return {};
  for(let i=0;i<count;i++) {
   const p=offset+2+i*12, tag=u16(p), n=u32(p+4);
   if((tag!==0x10f && tag!==0x110) || u16(p+2)!==2 || !n || n>1024) continue;
   const start=n<=4?p+8:u32(p+8);
   if(start+n>b.length) continue;
   result[tag===0x10f?'make':'model']=b.toString('utf8',start,start+n).replace(/\0.*$/s,'').trim();
  }
  return result;
 } catch { return {}; }
}
function normalizeDevice({make='',model=''}={}) {
 make=String(make).trim(); model=String(model).trim();
 const brands=[[/sony/i,'索尼'],[/dji|大疆/i,'大疆'],[/canon/i,'佳能'],[/nikon/i,'尼康'],[/apple/i,'苹果'],[/fujifilm|fuji photo/i,'富士'],[/panasonic/i,'松下'],[/gopro/i,'GoPro'],[/olympus|om digital/i,'奥林巴斯 / OM'],[/samsung/i,'三星'],[/huawei/i,'华为']];
 return {brand:brands.find(([r])=>r.test(make))?.[1] || make || (model?'品牌未记录':'设备未知'),model:model||'型号未记录',status:make||model?'confirmed':'unknown'};
}
function parseVideoMetadata(text) {
 const tags={};
 for(const line of text.split(/\r?\n/)) {const at=line.indexOf('='); if(at>0)tags[line.slice(0,at).toLowerCase()]=line.slice(at+1).trim();}
 return {make:tags['com.apple.quicktime.make']||tags.make||tags.manufacturer,model:tags['com.apple.quicktime.model']||tags.model};
}
function createDeviceIndex({directory,cachePath,metadata,videoMetadata}) {
 let cache,queue=Promise.resolve();
 return (names, { cachedOnly = false } = {}) => {
  const job=queue.then(async()=>{
   if(!cache) {try{cache=JSON.parse(await fs.readFile(cachePath,'utf8'));}catch{cache={};}}
   const result={}; let changed=false;
   for(const filename of names) {
    if(path.basename(filename)!==filename || filename==='.' || filename==='..')continue;
    if(cachedOnly && !Object.hasOwn(cache,filename)) continue;
    try {
     const file=path.join(directory,filename),stat=await fs.stat(file),key=`${stat.size}:${stat.mtimeMs}`;
     if(cache[filename]?.key!==key) {
      if(cachedOnly) continue;
      const raw=/\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|hevc)$/i.test(filename)?await videoMetadata(file):parseDeviceExif((await metadata(file)).exif);
      cache[filename]={key,device:normalizeDevice(raw)}; changed=true;
      await new Promise(resolve=>setTimeout(resolve,20));
     }
     result[filename]=cache[filename].device;
    } catch {if(!cachedOnly)result[filename]={brand:'读取失败',model:'',status:'error'};}
   }
   if(changed) {
   await fs.mkdir(path.dirname(cachePath),{recursive:true});
   await fs.writeFile(cachePath+'.tmp',JSON.stringify(cache));await fs.rename(cachePath+'.tmp',cachePath);
   }
   return result;
  });
  queue=job.catch(()=>{});return job;
 };
}
module.exports={parseDeviceExif,normalizeDevice,parseVideoMetadata,createDeviceIndex};
