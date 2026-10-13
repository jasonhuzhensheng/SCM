const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {parseDeviceExif,normalizeDevice,parseVideoMetadata,createDeviceIndex}=require('../main-lib/capture-device');
(async()=>{
 for(const le of [true,false]){
 const b=Buffer.alloc(70);b.write(le?'II':'MM');const w16=(v,p)=>le?b.writeUInt16LE(v,p):b.writeUInt16BE(v,p),w32=(v,p)=>le?b.writeUInt32LE(v,p):b.writeUInt32BE(v,p);
 w16(42,2);w32(8,4);w16(2,8);w16(0x10f,10);w16(2,12);w32(5,14);w32(40,18);b.write('SONY\0',40);w16(0x110,22);w16(2,24);w32(7,26);w32(50,30);b.write('ILCE-7\0',50);
 assert.equal(parseDeviceExif(b).make,'SONY');assert.equal(parseDeviceExif(Buffer.concat([Buffer.from('Exif\0\0'),b])).model,'ILCE-7');
 w32(99999,18);assert.equal(parseDeviceExif(b).make,undefined);
 }
 assert.equal(normalizeDevice({make:'Sony'}).brand,'索尼');assert.equal(normalizeDevice({make:'DJI',model:'FC123'}).status,'confirmed');assert.equal(normalizeDevice({}).status,'unknown');assert.equal(normalizeDevice({model:'ABC'}).brand,'品牌未记录');
 assert.equal(parseVideoMetadata('com.apple.quicktime.make=DJI\ncom.apple.quicktime.model=Pocket').model,'Pocket');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'capture-test-'));try{
 await fs.writeFile(path.join(dir,'a.mov'),'x');let reads=0;
 const index=createDeviceIndex({directory:dir,cachePath:path.join(dir,'cache.json'),metadata:async()=>({}),videoMetadata:async()=>{reads++;return {make:'DJI'};}});
 assert.equal((await index(['a.mov']))['a.mov'].brand,'大疆');await index(['a.mov']);assert.equal(reads,1);
 assert.equal((await index(['missing.jpg']))['missing.jpg'].status,'error');assert.equal(Object.keys(await index(['../outside'])).length,0);
 const restart=createDeviceIndex({directory:dir,cachePath:path.join(dir,'cache.json'),metadata:async()=>{throw Error('unexpected');},videoMetadata:async()=>{throw Error('unexpected');}});
 assert.equal((await restart(['a.mov','missing.jpg'],{cachedOnly:true}))['a.mov'].brand,'大疆');
 let probes=0;const originalStat=fs.stat;
 fs.stat=async(...args)=>{probes++;return originalStat(...args);};
 try {assert.equal(Object.keys(await restart(Array.from({length:95000},(_,i)=>`uncached-${i}.jpg`),{cachedOnly:true})).length,0);assert.equal(probes,0,'cache misses must not touch disk');}
 finally {fs.stat=originalStat;}
 assert.equal(Object.keys(await restart(['missing.jpg'],{cachedOnly:true})).length,0);
 await fs.writeFile(path.join(dir,'a.mov'),'changed');
 assert.equal(Object.keys(await restart(['a.mov'],{cachedOnly:true})).length,0);
await index(['a.mov']);assert.equal(reads,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
 console.log('PASS device EXIF endian/bounds, brands, video tags, unknown/errors, cache invalidation, traversal');
})().catch(e=>{console.error(e);process.exitCode=1;});
