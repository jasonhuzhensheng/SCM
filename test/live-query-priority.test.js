"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../indexer/indexer"), "utf8");
const start = source.indexOf("const queryPending = [];");
const end = source.indexOf("\n}\n\n// Standalone self-test", start);
let receive, release;
const order = [];
const first = new Promise(resolve => release = resolve);
vm.runInNewContext(`(function(){${source.slice(start,end)}})()`, {
 console, setImmediate, photoPrefetch:{prime(){}},
 process:{parentPort:{on:(_,handler)=>receive=handler}},
 handleMessage:async message=>{order.push(message.id);if(message.id==="running")await first;},
});
(async()=>{
 receive({data:{type:"embed-photo",id:"running"}});
 await new Promise(setImmediate);
 receive({data:{type:"embed-photo",id:"next-photo"}});
 receive({data:{type:"enrich-video",id:"background"}});
 receive({data:{type:"embed-query",id:"search"}});
 release(); await new Promise(setImmediate); await new Promise(setImmediate);
 assert.deepEqual(order,["running","search","next-photo","background"]);
 console.log("PASS: interactive search preempts queued image work without interrupting the current image");
})().catch(error=>{console.error(error);process.exitCode=1;});
