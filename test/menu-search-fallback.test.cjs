'use strict';
const fs=require('fs'),net=require('net'),path=require('path'),assert=require('assert/strict');
const {mainSearch}=require('../native/menu-search/main-search-client.cjs');
const {startMenuSearchService}=require('../main-lib/menu-search-service');
(async()=>{const directory=fs.mkdtempSync('/private/tmp/shared-search-'),socket=path.join(directory,'main-search.sock');let calls=0;
const service=startMenuSearchService({directory,library:()=>({filenames:['a.jpg'],sources:['/a.jpg']}),search:async()=>{calls++;await new Promise(r=>setTimeout(r,180));return [{filename:'a.jpg',score:.7}]},openSettings:()=>true});await new Promise(r=>setTimeout(r,30));
const opts={timeout:60,completionTimeout:1000,exitGraceMs:50};const start=Date.now();const result=await Promise.all([mainSearch(socket,'新的中文描述',undefined,false,opts),mainSearch(socket,'新的中文描述',undefined,false,opts)]);assert.equal(calls,1);assert(result.every(r=>r.mode==='main'));assert(Date.now()-start>=180);
// An abandoned offer must not start computation.
await new Promise((resolve,reject)=>{const c=net.createConnection(socket,()=>c.write('{"protocol":2,"query":"取消"}\n'));c.on('error',reject);c.on('data',()=>{c.destroy();resolve()})});assert.equal(calls,1);
assert.equal((await mainSearch(socket,'','settings')).settings,true);service.close();await new Promise(r=>setTimeout(r,10));
// Legacy probe has no query, so falling back cannot duplicate a legacy search.
let legacyCalls=0;let server=net.createServer(c=>c.once('data',b=>{if(JSON.parse(b).query)legacyCalls++;c.end('{"ok":true,"mode":"main","results":[]}\n')}));await new Promise(r=>server.listen(socket,r));assert.equal(await mainSearch(socket,'新查询',undefined,false,opts),null);assert.equal(legacyCalls,0);await new Promise(r=>server.close(r));fs.rmSync(socket,{force:true});
// After commitment a living owner must not trigger a second local computation.
server=net.createServer(c=>c.on('data',b=>{const r=JSON.parse(b);if(r.mode==='capabilities')c.end('{"protocol":2}\n');else if(r.protocol===2)c.write(JSON.stringify({type:'ready',pid:process.pid})+'\n');else c.end()}));await new Promise(r=>server.listen(socket,r));await assert.rejects(mainSearch(socket,'断线',undefined,false,{...opts,alive:()=>true}),/仍在搜索/);assert.equal(await mainSearch(socket,'已退出',undefined,false,{...opts,alive:()=>false}),null);await new Promise(r=>server.close(r));fs.rmSync(socket,{force:true});
assert.equal(await mainSearch(socket,'无主程序',undefined,false,opts),null);fs.rmSync(directory,{recursive:true,force:true});console.log('PASS shared slow query once, concurrent deduplication, abandoned offer, legacy/no-server fallback, alive/dead owner disconnect, settings');})().catch(e=>{console.error(e);process.exitCode=1});
