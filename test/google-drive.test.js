'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGoogleDrive,validateClient,digest}=require('../main-lib/google-drive.js');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scm-drive-test-'));
 try{
  assert.throws(()=>validateClient({web:{client_id:'a'}}),/桌面应用/);
  const file=path.join(root,'photo.jpg');fs.writeFileSync(file,Buffer.alloc(9*1024*1024,7));
  const md5=await digest(file);let corrupt=false,refreshes=0,chunks=0;
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const fetchImpl=async(url,opts)=>{
   if(url.includes('oauth2.googleapis.com/token')){refreshes++;return Response.json({access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600});}
   assert.equal(opts.headers.Authorization,'Bearer fake-access');
   if(url.includes('uploadType=resumable'))return new Response('',{headers:{location:'https://www.googleapis.com/session/test'}});
   if(url.endsWith('/session/test')){
    chunks++;assert(opts.body.length<=8*1024*1024);
    if(chunks%2===1)return new Response('',{status:308,headers:{range:'bytes=0-8388607'}});
    return Response.json({id:'file1'});
   }
   if(url.includes('/files/file1?'))return Response.json({id:'file1',size:String(9*1024*1024),md5Checksum:corrupt?'bad':md5,webViewLink:'https://drive.google.com/file/d/file1/view'});
   return Response.json({id:'folder1',webViewLink:'https://drive.google.com/drive/folders/folder1'});
  };
  const drive=createGoogleDrive({userDataDir:root,safeStorage:vault,fetchImpl,openExternal:async raw=>{
   const u=new URL(raw);assert.equal(u.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
   const cb=new URL(u.searchParams.get('redirect_uri'));cb.search=new URLSearchParams({state:'wrong',code:'fake'});assert.equal((await fetch(cb)).status,400);
   cb.search=new URLSearchParams({state:u.searchParams.get('state'),code:'fake'});assert.equal((await fetch(cb)).status,200);
  }});
  assert.equal(drive.status().configured,false);
  await drive.configure({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'fake-secret'}});
  await drive.login();assert.equal(drive.status().connected,true);assert.equal(refreshes,1);
  const folder=await drive.createFolder('test');assert.equal(folder.id,'folder1');
  const progress=[];await drive.upload(file,'photo.jpg',folder.id,new AbortController().signal,(done,total)=>progress.push([done,total]));
  assert.equal(chunks,2);assert.equal(progress.at(-1)[0],9*1024*1024);
  corrupt=true;await assert.rejects(drive.upload(file,'photo.jpg',folder.id),/校验/);assert(fs.existsSync(file));
  const ctrl=new AbortController();ctrl.abort();await assert.rejects(drive.upload(file,'photo.jpg',folder.id,ctrl.signal));assert(fs.existsSync(file));
  await drive.disconnect();assert.equal(drive.status().connected,false);
  console.log('PASS: OAuth PKCE/state, configuration, encrypted persistence seam, chunks, progress, readback checksum, cancellation, disconnect');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
