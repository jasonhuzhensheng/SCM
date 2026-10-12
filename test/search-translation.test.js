'use strict';
const assert = require('node:assert/strict');
const { createSearchTranslator } = require('../main-lib/search-translation.js');
(async () => {
 let calls=0, model='one', last;
 const translate=createSearchTranslator({
  getModelId:()=>model,isAvailable:()=>true,
  chat:async req=>{calls++;last=req;await new Promise(r=>setTimeout(r,5));return {content:'a beautiful woman',stopReason:'stop'};},
 });
 assert.equal(await translate('red dress'),'red dress'); assert.equal(calls,0);
 assert.deepEqual(await Promise.all([translate('美女'),translate('美女')]),['a beautiful woman','a beautiful woman']);
 assert.equal(calls,1); assert.equal(last.messages[1].content,'美女');
 assert.equal(await translate('美女'),'a beautiful woman'); assert.equal(calls,1);
 model='two'; await translate('美女'); assert.equal(calls,2);
 const unavailable=createSearchTranslator({getModelId:()=>model,isAvailable:()=>false,chat:()=>assert.fail()});
 await assert.rejects(unavailable('美女'),/本地语言模型/);
 assert.equal(await unavailable('裸体'),'nudity');
 assert.equal(await unavailable('护照'),'passport');
 await assert.rejects(unavailable('不是裸体'),/本地语言模型/);
 const refused=createSearchTranslator({getModelId:()=>model,isAvailable:()=>true,chat:async()=>({content:'I cannot help with that request.'})});
 await assert.rejects(refused('其他描述'),/翻译未返回搜索词/);
 let retries=0;
 const invalid=createSearchTranslator({getModelId:()=>model,isAvailable:()=>true,chat:async()=>{retries++;return {content:'美女'};}});
 await assert.rejects(invalid('美女'),/英文翻译/); await assert.rejects(invalid('美女')); assert.equal(retries,2);
 let signal;
 const stalled=createSearchTranslator({getModelId:()=>model,isAvailable:()=>true,timeoutMs:10,chat:req=>{signal=req.signal;return new Promise(()=>{});}});
 await assert.rejects(stalled('美女'),/超时/); assert(signal.aborted);
 console.log('PASS: English bypass, original input, translation, shared cache, model changes, missing model, invalid output, retries and timeout');
})().catch(e=>{console.error(e);process.exitCode=1;});
