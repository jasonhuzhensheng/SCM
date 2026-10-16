"use strict";
// IPC-independent wrapper. Cache I/O is delegated to the rank utility process.
function createCachedSearch({context,request,onError=()=>{}}) {
 const readContext=async mode=>{try{return await context(mode);}catch(error){onError(error);return null;}};
 const send=async message=>{try{return await request(message);}catch(error){onError(error);return null;}};
 return (mode,search)=>async(...args)=>{
  const before=await readContext(mode);
  const query=typeof args[0]==='string'?args[0]:'';
  const keyContext=before ? {...before,args:args.map(value=>value===undefined?null:value)} : null;
  if(keyContext){
   const found=await send({type:'query-cache-lookup',query,context:keyContext});
   if(found?.hit && JSON.stringify(await readContext(mode))===JSON.stringify(before)) {
    const value=found.result;
    if(value.array){const rows=value.rows;if(value.hasQueryVec)rows.queryVec=value.queryVec;return rows;}
    return value.value;
   }
  }
  const value=await search(...args);
  // Do not persist partial results, errors or ambiguous empty fallback responses.
  const eligible=Array.isArray(value)?value.length>0:value?.ok===true&&(value.matches?.length>0||value.filenames?.length>0);
  if(keyContext && eligible && JSON.stringify(await readContext(mode))===JSON.stringify(before)) {
   const result=Array.isArray(value)?{array:true,rows:Array.from(value),hasQueryVec:Object.hasOwn(value,'queryVec'),queryVec:value.queryVec??null}:{array:false,value};
   await send({type:'query-cache-store',query,context:keyContext,result});
  }
  return value;
 };
}
module.exports={createCachedSearch};
