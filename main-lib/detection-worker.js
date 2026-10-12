'use strict';
const {spawn}=require('node:child_process');
const os=require('node:os');
function createDetectionWorker(binary) {
 let child=null, buffer='', pending=null, serial=0;
 function fail(error) { const p=pending; pending=null; if(p){clearTimeout(p.timer);p.reject(error)} }
 function stop(){const old=child;child=null;if(old)old.kill();fail(new Error('检测进程已停止'));buffer=''}
 function start(){
  if(child)return;
  const proc=spawn(binary,['--stream'],{stdio:['pipe','pipe','pipe']});child=proc;buffer='';try{os.setPriority(proc.pid,10)}catch{};
  proc.stderr.resume();proc.stdin.on('error',()=>{});
  proc.on('error',()=>{if(child===proc){child=null;fail(new Error('本地检测器无法启动'))}});
  proc.on('close',()=>{if(child===proc){child=null;fail(new Error('本地检测器意外退出'))}});
  proc.stdout.on('data',data=>{
   if(child!==proc)return;buffer+=data;
   if(buffer.length>100000){stop();return}
   let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);try{
    const message=JSON.parse(line);if(!pending||message.id!==pending.id)continue;
    if(!Array.isArray(message.rows)||message.rows.length!==1)throw Error();
    const p=pending;pending=null;clearTimeout(p.timer);p.resolve(message.rows[0]);
   }catch{stop();return}}
  });
 }
 return {
  run(file){if(pending)return Promise.reject(new Error('检测器忙碌'));start();return new Promise((resolve,reject)=>{
   const id=++serial;const timer=setTimeout(()=>stop(),30000);pending={id,resolve,reject,timer};child.stdin.write(JSON.stringify({id,paths:[file]})+'\n');
  })},stop,
 };
}
module.exports={createDetectionWorker};
