'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {createPhotoDeletion}=require('../main-lib/photo-deletion'),{MAX_FILE_SELECTION}=require('../main-lib/selection-limit');
(async()=>{
 const executable=process.argv[2]||path.join(__dirname,'../main-lib/native/apple-photos-bridge'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'batch-limit-'));
 try{
  // This command returns before authorization and never invokes PhotoKit.
  function preflight(items){const r=cp.spawnSync(executable,[],{input:JSON.stringify({mode:'validate-batch',items}),encoding:'utf8',timeout:20000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
  for(const count of [1,9999,10000]){const value=preflight(Array.from({length:count},()=>({})));assert.equal(value.ok,true);assert.equal(value.count,count);assert.equal(value.maxItems,MAX_FILE_SELECTION);}
  const oversized=preflight(Array.from({length:10001},()=>({})));assert.equal(oversized.ok,false);assert.match(oversized.error,/10,000/);
  for(const invalid of [[],null,['bad']]){const value=preflight(invalid);assert.equal(value.ok,false);assert.match(value.error,/无效/);}
  const calls=[];let saved=0,validations=0;const deletion=createPhotoDeletion({directory,bridge:async r=>{calls.push(r.mode);return {ok:true,verified:true};}});
  const prepared={id:'fixture',size:1,deletedBytes:1,resources:[{size:1}]};
  const make=count=>({entries:Array.from({length:count},()=>({journal:{photosPrepared:prepared}}))});
  const tooMany=make(10001);await assert.rejects(deletion.commitBatch(tooMany,()=>saved++,null,async()=>validations++),/10,000/);assert.equal(calls.length,0);assert.equal(saved,0);assert.equal(validations,0);assert(!tooMany.requested);
  const good=make(10000);await deletion.commitBatch(good,()=>saved++,null,async()=>[]);assert.deepEqual(calls,['delete-batch']);assert(good.confirmed);
  // A submitted record, even oversized, ONLY queries its original outcome.
  calls.length=0;const pending=make(22424);pending.requested=true;pending.requests=[];pending.receipt=directory+'/existing.json';
  await deletion.commitBatch(pending,()=>{},null,()=>{throw Error('must not validate or re-submit')});assert.deepEqual(calls,['delete-batch-outcome']);
  // Compile the exact Foundation parser from the production Swift source.
  // Old receipts bypass the NEW-selection cap, but malformed items still fail.
  const swift=fs.readFileSync(path.join(__dirname,'../native/apple-photos.swift'),'utf8');
  const parser=swift.slice(swift.indexOf('func batchItems('),swift.indexOf('func batchOutcome('));
  assert.match(swift.slice(swift.indexOf('func batchOutcome('),swift.indexOf('func deleteBatch(')),/let items = try batchItems\(request\)/);
  const harness='import Foundation\nfunc failure(_ message:String)->NSError { NSError(domain:"test",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }\n'+parser+'\nlet legacy:[String:Any] = ["items":Array(repeating:["id":"fixture"],count:22424)]\nassert(try! batchItems(legacy).count == 22424)\ndo { _ = try selectedBatchItems(legacy); fatalError("accepted oversize new request") } catch { assert(error.localizedDescription.contains("10,000")) }\nprint("PASS legacy 22,424 receipt parser")\n';
  const file=path.join(directory,'parser.swift');fs.writeFileSync(file,harness);
  cp.execFileSync('swiftc',['-module-cache-path','/tmp/fly-photo-swift-cache',file,'-o',path.join(directory,'parser')]);cp.execFileSync(path.join(directory,'parser'),[],{stdio:'inherit'});
  console.log('PASS: new selections 1/9,999/10,000 accepted, 10,001 rejected before submission; old 22,424 receipt parser and outcome-only recovery retained');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
