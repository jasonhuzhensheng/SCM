'use strict';
const assert=require('node:assert/strict'),{promptThreads}=require('../native/menu-search/translation-budget.cjs');
const good={requested:2,cores:12,memoryBytes:32*2**30,freeBytes:4*2**30,load:2};
assert.equal(promptThreads(good),2);assert.equal(promptThreads(),1);
for(const x of [{requested:1},{requested:3},{cores:4},{memoryBytes:8*2**30},{freeBytes:1.9*2**30},{load:8.4},{load:Infinity},{load:NaN},{load:-1}])assert.equal(promptThreads({...good,...x}),1);
const fs=require('node:fs'),path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../native/menu-search/semantic.cjs'),'utf8');assert(source.includes("'-t','1','-tb',String(batchThreads)"));assert(source.includes("'-ngl','0'"));
const swift=fs.readFileSync(path.join(__dirname,'../native/menu-search/MenuSearch.swift'),'utf8');assert(swift.includes('!self.memoryConstrained && !ProcessInfo.processInfo.isLowPowerModeEnabled'));assert(swift.includes('ProcessInfo.processInfo.thermalState == .nominal'));
console.log('PASS foreground permission, core/load/memory boundaries, single-thread generation and CPU-only guard');
