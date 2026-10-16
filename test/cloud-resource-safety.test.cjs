'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createPhotoDeletion}=require('../main-lib/photo-deletion');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-resource-safety-'));try{
 const uuid='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',file=path.join(dir,'fixture.photoslibrary/originals/a/'+uuid+'.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'photo');const s=fs.statSync(file),sig=[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
 const calls=[],journal={};const bridge=createPhotoDeletion({directory:dir,bridge:async request=>{calls.push(request.mode);if(request.mode==='verify-delete')return {ok:true,id:uuid+'/L0/001',resources:[{index:0,type:1,filename:'photo.png',size:5},{index:1,type:5,filename:'edit.jpg'}],primaryIndex:0,assetVersion:'1'};if(request.mode==='export-resources')throw Error('download unavailable');throw Error('unexpected deletion');}});
 await assert.rejects(bridge.remove(file,sig,journal,()=>{},new AbortController().signal,undefined,{verification:'system-copy',prepareOnly:true,backup:async(r,exporter)=>exporter(dir)}),/download unavailable/);
 assert.deepEqual(calls,['verify-delete','export-resources']);assert(!journal.photos?.requested);assert(!journal.photosPrepared);assert.equal(fs.readFileSync(file,'utf8'),'photo');
 const source=fs.readFileSync(path.join(__dirname,'../native/apple-photos.swift'),'utf8');for(const [a,b]of [['func exportSimpleResources(', 'func verifiedAsset('],['func exportResources(', 'func receiptURL(']]){const block=source.slice(source.indexOf(a),source.indexOf(b));assert(block.includes('options.isNetworkAccessAllowed = true'));assert(!block.includes('options.isNetworkAccessAllowed = false'));}assert(source.slice(source.indexOf('func resourceDigest('),source.indexOf('func resolvedAsset(')).includes('options.isNetworkAccessAllowed = false'));
 console.log('PASS companion downloads enabled; verification remains local; failed export cannot submit deletion or mark prepared');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
