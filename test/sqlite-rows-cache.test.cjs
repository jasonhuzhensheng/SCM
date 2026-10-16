'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createRowsCache}=require('../native/menu-search/sqlite-rows-cache.cjs');
const root=fs.mkdtempSync('/private/tmp/sayphoto-rows-'),file=root+'/search.sqlite',cache=createRowsCache(),sql='SELECT name FROM assets WHERE hidden=0';
let writer;
try {
 writer=new DatabaseSync(file);writer.exec("PRAGMA journal_mode=WAL;CREATE TABLE assets(name TEXT,hidden INTEGER);INSERT INTO assets VALUES('a',0)");
 const first=cache.read(file,sql);assert.equal(first[0].name,'a');assert.strictEqual(cache.read(file,sql),first);
 writer.exec('UPDATE assets SET hidden=1');assert.equal(cache.read(file,sql).length,0);
 writer.exec('UPDATE assets SET hidden=0');assert.equal(cache.read(file,sql)[0].name,'a');writer.close();writer=null;
 fs.renameSync(file,file+'.old');const replacement=new DatabaseSync(file);replacement.exec("CREATE TABLE assets(name TEXT,hidden INTEGER);INSERT INTO assets VALUES('b',0)");replacement.close();assert.equal(cache.read(file,sql)[0].name,'b');
 cache.close();fs.unlinkSync(file);assert.throws(()=>cache.read(file,sql));fs.writeFileSync(file,'broken');assert.throws(()=>cache.read(file,sql));
 console.log('PASS unchanged rows reused, WAL hide/restore, database replacement, missing/corrupt fail closed');
}finally{cache.close();writer?.close();fs.rmSync(root,{recursive:true,force:true})}
