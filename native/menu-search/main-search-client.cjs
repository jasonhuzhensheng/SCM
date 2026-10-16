'use strict';
const net = require('node:net');
function request(socketPath, payload, { timeout=750, completionTimeout=90000, exitGraceMs=1500, alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}} }={}) {
 return new Promise((resolve,reject)=>{
  let data='',settled=false,committed=false,owner=null,timer,checkingExit=false;
  const socket=net.createConnection(socketPath);
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value)};
  const unavailable=()=>{
   if(settled||checkingExit)return;
   if(!committed || (owner && !alive(owner))){finish(null,null);return;}
   checkingExit=true;clearTimeout(timer);const deadline=Date.now()+exitGraceMs;
   const check=()=>{if(settled)return;if(owner&&!alive(owner)){finish(null,null);return;}if(Date.now()>=deadline){finish(Error('主程序仍在搜索，请稍后重试'));return;}timer=setTimeout(check,50)};check();
  };
  const arm=ms=>{clearTimeout(timer);timer=setTimeout(unavailable,ms)};arm(timeout);
  socket.on('connect',()=>socket.write(JSON.stringify(payload)+'\n'));
  socket.on('error',unavailable);socket.on('end',unavailable);socket.on('close',unavailable);
  socket.on('data',chunk=>{
   data+=chunk;if(data.length>32*1024*1024){finish(Error('搜索结果过大'));return;}
   let end;while((end=data.indexOf('\n'))>=0&&!settled){let reply;try{reply=JSON.parse(data.slice(0,end));data=data.slice(end+1)}catch{finish(Error('搜索响应无效'));return;}
    if(reply.type==='ready'&&payload.protocol===2&&!committed){
     if(!Number.isSafeInteger(reply.pid)||reply.pid<=0){finish(Error('搜索响应无效'));return;}
     owner=reply.pid;committed=true;arm(completionTimeout);socket.write('{"type":"start"}\n');
    }else{finish(null,reply);}
   }
  });
 });
}
async function mainSearch(socketPath, query, mode, ready=false, options={}) {
 if(mode)return request(socketPath,{query,mode},{...options,timeout:45000});
 const timeout=options.timeout??(ready?250:750);
 // Probe without a query: old servers must never start work before fallback.
 const capability=await request(socketPath,{mode:'capabilities'},{...options,timeout});
 if(capability?.protocol!==2)return null;
 return request(socketPath,{query,protocol:2},{...options,timeout});
}
module.exports={mainSearch};
