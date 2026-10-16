const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const api=require('../main-lib/photos-trash-state');
(async()=>{const root=fs.mkdtempSync('/private/tmp/photos-trash-test-'),a=root+'/A.photoslibrary',b=root+'/B.photoslibrary',uuid='A2F59326-9E47-442F-9595-0623FEA3AB90',file=uuid+'.jpeg';try{
 for(const [lib,state]of [[a,1],[b,0]]){fs.mkdirSync(lib+'/database',{recursive:true});const db=new DatabaseSync(lib+'/database/Photos.sqlite');db.exec('CREATE TABLE ZASSET (ZUUID TEXT,ZDIRECTORY TEXT,ZFILENAME TEXT,ZTRASHEDSTATE INTEGER)');db.prepare('INSERT INTO ZASSET VALUES (?,?,?,?)').run(uuid,'A',file,state);db.close();}
 const sources=[a+'/originals/A/'+file,b+'/originals/A/'+file,root+'/'+file,a+'/originals/B/'+file,a+'/resources/renders/A/'+file];
 assert.deepEqual(await api.filterPaths(sources),sources.slice(1));
 const rows=sources.map((source,i)=>({source,filenameKey:'row'+i}));assert.deepEqual([...await api.trashed(rows)],['row0']);
 const db=new DatabaseSync(a+'/database/Photos.sqlite');db.exec('UPDATE ZASSET SET ZTRASHEDSTATE=0');db.close();assert.equal((await api.trashed(rows,{fresh:true})).size,0,'restored assets become visible');
 assert.equal(api.identify(a+'/originals/A/../A/'+file),null);assert.deepEqual(await api.filterPaths([root+'/Missing.photoslibrary/originals/A/'+file]),[root+'/Missing.photoslibrary/originals/A/'+file],'unreadable library is not evidence for hiding');
 await assert.rejects(api.trashed([{source:root+'/Missing.photoslibrary/originals/A/'+file}],{strict:true}), 'display must not publish an empty deletion classification on read failure');
 console.log('PASS: read-only trash state, same UUID across libraries, exact original path, restored files, unknown libraries');
 }finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
