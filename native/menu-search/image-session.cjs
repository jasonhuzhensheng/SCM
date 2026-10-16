'use strict';
// Used only by the serial semantic worker. Never overlaps model inference.
function createImageSession(load, idleMs=15000) {
 let model=null,timer=null;
 async function release(){clearTimeout(timer);timer=null;const old=model;model=null;if(old)await old.dispose();}
 async function use(image){
  clearTimeout(timer);timer=null;
  const timings={},start=performance.now();
  try{
   if(!model)model=await load();
   timings.prepareMs=performance.now()-start;
   const begin=performance.now(),result=await model(image);
   timings.inferenceMs=performance.now()-begin;
   return {result,timings};
  }catch(e){await release();throw e;}
  finally{if(model){timer=setTimeout(()=>{release().catch(()=>{});},idleMs);timer.unref?.();}}
 }
 return {use,release};
}
module.exports={createImageSession};
