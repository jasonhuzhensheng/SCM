"use strict";
const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile);
function createFaceThumbnails({directory,root,ffmpeg}){
 let queue=Promise.resolve();
 return face=>{
  const task=queue.then(async()=>{
   if(!/^[a-f0-9]{64}$/.test(face.key)||path.basename(face.filename)!==face.filename)throw Error('无效的人脸预览');
   const dest=path.join(root,face.key+'.jpg');
   try{return 'data:image/jpeg;base64,'+(await fs.readFile(dest)).toString('base64');}catch(e){if(e.code!=='ENOENT')throw e;}
   const file=path.join(directory,face.filename);let input=file;
   if(face.video){
    const binary=ffmpeg();if(!binary)throw Error('视频预览不可用');
    const result=await exec('/usr/bin/nice',['-n','10',binary,'-v','error','-threads','1','-filter_threads','1','-ss',String(Math.max(0,face.time)),'-i',file,'-frames:v','1','-vf','scale=1600:1600:force_original_aspect_ratio=decrease','-f','image2pipe','-vcodec','mjpeg','-'],{timeout:20000,maxBuffer:8*1024*1024,encoding:'buffer'});
    input=result.stdout;
   }
   const sharp=require('sharp');const {data,info}=await sharp(input).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).toBuffer({resolveWithObject:true});
   const b=face.bounds;if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)throw Error('无效的人脸位置');
   const left=Math.max(0,Math.min(info.width-1,Math.floor(b.x*info.width))),top=Math.max(0,Math.min(info.height-1,Math.floor((1-b.y-b.height)*info.height)));
   const width=Math.max(1,Math.min(info.width-left,Math.ceil(b.width*info.width))),height=Math.max(1,Math.min(info.height-top,Math.ceil(b.height*info.height)));
   const image=await sharp(data).extract({left,top,width,height}).resize(128,128,{fit:'cover'}).jpeg({quality:82}).toBuffer();
   await fs.mkdir(root,{recursive:true,mode:0o700});await fs.writeFile(dest,image,{mode:0o600});return 'data:image/jpeg;base64,'+image.toString('base64');
  });queue=task.catch(()=>{});return task;
 };
}
module.exports={createFaceThumbnails};
