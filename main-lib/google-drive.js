"use strict";
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');
const API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function digest(file, signal) {
 const hash=crypto.createHash('md5');
 for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk);
 return hash.digest('hex');
}
function validateClient(json) {
 const c=json?.installed;
 if(!c || typeof c.client_id!=='string' || !c.client_id.endsWith('.apps.googleusercontent.com') || typeof c.client_secret!=='string') throw new Error('请选择 Google Cloud 下载的“桌面应用”OAuth JSON 配置。');
 return {client_id:c.client_id,client_secret:c.client_secret};
}
function createGoogleDrive({userDataDir,safeStorage,openExternal,fetchImpl=fetch}) {
 const file=path.join(userDataDir,'google-drive.enc');
 let state=null, loginPending=false;
 function read(){
  if(state) return state;
  if(!fs.existsSync(file)) return state={};
  if(!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串暂不可用。');
  return state=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
 }
 async function save(next){
  if(!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串暂不可用，无法保存授权。');
  const tmp=file+'.tmp';
  await fs.promises.writeFile(tmp,safeStorage.encryptString(JSON.stringify(next)),{mode:0o600});
  await fs.promises.rename(tmp,file); state=next;
 }
 function status(){const s=read();return {configured:!!s.client,connected:!!s.refresh_token};}
 async function configure(json){if(loginPending)throw new Error('请先完成当前登录。');await save({client:validateClient(json)});return status();}
 async function tokenRequest(params){
  const r=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error('Google 授权失败或已过期，请重新登录。');
  return r.json();
 }
 async function login(){
  if(loginPending)throw new Error('登录窗口已经打开。');
  const client=read().client;if(!client)throw new Error('请先导入 OAuth JSON 配置。');
  loginPending=true;
  const nonce=crypto.randomBytes(32).toString('base64url'), verifier=crypto.randomBytes(32).toString('base64url');
  const server=http.createServer(); let timer;
  try{
   server.listen(0,'127.0.0.1');await once(server,'listening');
   const redirect=`http://127.0.0.1:${server.address().port}/oauth2callback`;
   const codePromise=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('登录超时，请重试。')),180000);
    server.on('request',(req,res)=>{
     const u=new URL(req.url,'http://127.0.0.1');
     if(u.pathname!=='/oauth2callback'||u.searchParams.get('state')!==nonce){res.writeHead(400).end('Invalid callback');return;}
     res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');
     if(u.searchParams.get('error')){res.end('登录已取消，可以关闭此页。');reject(new Error('Google 登录已取消。'));return;}
     const code=u.searchParams.get('code');if(!code){res.writeHead(400).end('Missing code');return;}
     res.end('授权已收到，请返回 SCM 拾光查看连接结果。');resolve(code);
    });
   });
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   url.search=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state:nonce,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
   // Observe the callback promise even if opening the browser fails.
   codePromise.catch(()=>{});
   await openExternal(url.toString());
   const code=await codePromise;
   const tokens=await tokenRequest({...client,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'});
   if(!tokens.refresh_token)throw new Error('未获得离线授权，请重新登录。');
   await save({client,...tokens,expires_at:Date.now()+tokens.expires_in*1000});
   return status();
  }finally{clearTimeout(timer);server.close();server.closeAllConnections();loginPending=false;}
 }
 async function disconnect(){if(loginPending)throw new Error('请先结束当前登录。');await save({client:read().client});return status();}
 async function token(){
  const s=read();if(!s.refresh_token)throw new Error('请先登录 Google Drive。');
  if(s.access_token&&s.expires_at>Date.now()+60000)return s.access_token;
  const t=await tokenRequest({...s.client,refresh_token:s.refresh_token,grant_type:'refresh_token'});
  await save({...s,...t,expires_at:Date.now()+t.expires_in*1000});return t.access_token;
 }
 async function request(url,options={}){
  const authorization='Bearer '+await token();
  const r=await fetchImpl(url,{...options,headers:{...options.headers,Authorization:authorization},signal:options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)});
  if(!r.ok&&r.status!==308)throw new Error(`Google Drive 请求失败（${r.status}），请检查连接或存储空间。`);
  return r;
 }
 async function createFolder(name,signal){
  const r=await request(API+'/files?fields=id,name,webViewLink',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder'}),signal});
  return r.json();
 }
 async function upload(file,name,parent,signal,onProgress=()=>{}, checkpoint=null, saveCheckpoint=()=>{}){
  const stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size===0)throw new Error('文件不存在或为空。');
  const md5=await digest(file,signal);signal?.throwIfAborted();
  if(checkpoint?.md5 && (checkpoint.md5!==md5||checkpoint.size!==stat.size))throw Error('源文件已变化，不能续传');
  let session=checkpoint?.session;
  if(!session){
   const init=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,webViewLink',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(stat.size)},body:JSON.stringify({name,parents:[parent]}),signal});
   session=init.headers.get('location');
   if(checkpoint){Object.assign(checkpoint,{session,md5,size:stat.size});saveCheckpoint();}
  }
  if(!session||new URL(session).origin!=='https://www.googleapis.com')throw new Error('Google 返回了无效的上传地址。');
  let offset=0,result=checkpoint?.result;
  if(result)offset=stat.size;
  else if(checkpoint){
   const r=await request(session,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${stat.size}`},signal});
   if(r.status===308){const match=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');offset=match?Number(match[1])+1:0;}
   else{result=await r.json();offset=stat.size;checkpoint.result=result;saveCheckpoint();}
  }
  const handle=await fs.promises.open(file,'r');
  try{
   while(offset<stat.size){
    signal?.throwIfAborted();
    const buffer=Buffer.alloc(Math.min(8*1024*1024,stat.size-offset));
    const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(bytesRead!==buffer.length)throw new Error('上传期间文件发生变化，保留本地文件。');
    let r;
    try{r=await request(session,{method:'PUT',headers:{'Content-Length':String(bytesRead),'Content-Range':`bytes ${offset}-${offset+bytesRead-1}/${stat.size}`},body:buffer,signal});}
    catch(error){
     signal?.throwIfAborted();
     // Query committed bytes after an uncertain chunk; never blindly duplicate a file.
     r=await request(session,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${stat.size}`},signal});
     if(r.status===308){const match=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');const committed=match?Number(match[1])+1:0;if(committed<=offset)throw error;offset=committed;onProgress(offset,stat.size);continue;}
    }
    if(r.status===308){const match=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');const next=match?Number(match[1])+1:0;if(next<=offset||next>stat.size)throw new Error('上传进度异常，保留本地文件。');offset=next;}
    else{result=await r.json();offset=stat.size;if(checkpoint){checkpoint.result=result;saveCheckpoint();}}
    onProgress(offset,stat.size);
   }
  }finally{await handle.close();}
  if(!result?.id)throw new Error('上传未确认完成，保留本地文件。');
  const verified=await (await request(API+`/files/${encodeURIComponent(result.id)}?fields=id,name,size,md5Checksum,webViewLink`,{signal})).json();
  if(verified.md5Checksum!==md5||Number(verified.size)!==stat.size)throw new Error('云端文件校验未通过，保留本地文件。');
  if(await digest(file,signal)!==md5)throw new Error('本地文件已改变，已上传但保留本地副本。');
  return verified;
 }
 return {status,configure,login,disconnect,createFolder,upload};
}
module.exports={createGoogleDrive,validateClient,digest};
