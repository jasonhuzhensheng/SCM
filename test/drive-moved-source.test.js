'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scm-moved-source-'));
 try{
  const file=path.join(root,'source.jpg');fs.writeFileSync(file,'original');
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const a=source.indexOf('async function persistMovedSource('),b=source.indexOf('const driveReply',a);
  const ctx={fs,movedSources:{},movedSourcesFile:path.join(root,'ledger.json')};vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
  assert.equal(await ctx.wasMovedToDrive(file),false);await ctx.persistMovedSource(file);assert.equal(await ctx.wasMovedToDrive(file),true);
  assert.equal(fs.readFileSync(file,'utf8'),'original');
  ctx.movedSources=JSON.parse(fs.readFileSync(ctx.movedSourcesFile));assert.equal(await ctx.wasMovedToDrive(file),true);
  fs.writeFileSync(file,'changed original');assert.equal(await ctx.wasMovedToDrive(file),false);
  console.log('PASS: moved sources persist across restart, originals remain untouched, changed originals may import again');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
