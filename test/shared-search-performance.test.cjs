'use strict';
const fs=require('fs'),net=require('net'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {mainSearch}=require('../native/menu-search/main-search-client.cjs');
const {startMenuSearchService}=require('../main-lib/menu-search-service');
(async()=>{const directory=fs.mkdtempSync('/private/tmp/shared-timing-');let calls=0;const service=startMenuSearchService({directory,library:()=>({filenames:['a.jpg'],sources:['/a.jpg']}),search:async()=>{calls++;await new Promise(r=>setTimeout(r,1100));return [{filename:'a.jpg',score:1}]}});await new Promise(r=>setTimeout(r,30));
const old=()=>new Promise(resolve=>{const c=net.createConnection(service.socket,()=>c.write('{"query":"fresh"}\n'));let data='';c.setTimeout(750,()=>{c.destroy();resolve(null)});c.on('data',b=>{data+=b;if(data.includes('\n')){c.destroy();resolve(JSON.parse(data))}})});
let start=Date.now();let r=await old(),localRuns=0;if(!r){localRuns++;await new Promise(r=>setTimeout(r,1100));}const oldMs=Date.now()-start;assert.equal(calls+localRuns,2);
start=Date.now();r=await mainSearch(service.socket,'fresh');const newMs=Date.now()-start;assert.equal(r.mode,'main');assert.equal(calls,2);assert(newMs<oldMs-400);service.close();fs.rmSync(directory,{recursive:true,force:true});console.log(JSON.stringify({syntheticBackendMs:1100,oldMs,newMs,oldComputations:2,newComputations:1}));})().catch(e=>{console.error(e);process.exitCode=1});
