'use strict';
const net=require('node:net'),fs=require('node:fs'),path=require('node:path');
function startMenuSearchService({directory,search,library,openQuery,openSettings,onClose}){
 fs.mkdirSync(directory,{recursive:true});const socket=path.join(directory,'main-search.sock');try{fs.unlinkSync(socket)}catch(e){if(e.code!=='ENOENT')throw e}
 const pending=new Map(),clients=new Set();
 async function run(q){
  let work=pending.get(q);
  if(!work){work=Promise.resolve().then(()=>{const l=library();return search(q,Math.max(l.filenames.length,100))});pending.set(q,work);work.finally(()=>{if(pending.get(q)===work)pending.delete(q)}).catch(()=>{});}
  const matches=await work,current=library(),byName=new Map(current.filenames.map((n,i)=>[n,i])),results=[];
  for(const row of Array.isArray(matches)?matches:matches.results||[]){const i=byName.get(row.filename);if(i===undefined)continue;const source=current.sources[i];if(!/\.(jpe?g|png|heic|heif|webp|tiff?|bmp)$/i.test(source))continue;results.push({name:row.filename,source,text:current.ocr?.[i]||'',score:row.score});}
  return {ok:true,mode:'main',query:q,results,indexed:current.filenames.length,total:current.filenames.length};
 }
 const server=net.createServer(client=>{
  clients.add(client);client.on('close',()=>clients.delete(client));let data='',used=false,offered=null;
  client.setTimeout(120000,()=>client.destroy());client.on('error',()=>{});
  const send=r=>{if(!client.destroyed)client.end(JSON.stringify(r)+'\n')};
  const execute=q=>{used=true;run(q).then(send,e=>send({ok:false,error:e.message}))};
  client.on('data',chunk=>{if(used)return;data+=chunk;if(data.length>4096){client.destroy();return;}
   let end;while(!used&&(end=data.indexOf('\n'))>=0){let r;try{r=JSON.parse(data.slice(0,end));data=data.slice(end+1)}catch{client.destroy();return;}
    if(offered!==null){if(r.type!=='start'){client.destroy();return;}const q=offered;offered=null;execute(q);return;}
    const q=String(r.query||'').trim();
    if(r.mode==='capabilities'){used=true;send({ok:true,protocol:2});return;}
    if(['settings','open'].includes(r.mode)){used=true;Promise.resolve().then(()=>r.mode==='settings'?openSettings():openQuery(q)).then(v=>send({ok:true,[r.mode==='settings'?'settings':'opened']:v}),e=>send({ok:false,error:e.message}));return;}
    if(!q||q.length>300){used=true;send({ok:true,mode:'main',results:[]});return;}
    if(r.protocol===2){offered=q;client.write(JSON.stringify({type:'ready',pid:process.pid})+'\n');}
    else{execute(q);return;}
   }
  });
 });
 server.on('error',e=>console.warn('[menu-search]',e.message));server.listen(socket,()=>fs.chmodSync(socket,0o600));const close=()=>{for(const c of clients)c.destroy();server.close();try{fs.unlinkSync(socket)}catch{}};onClose?.(close);return {close,socket};
}
module.exports={startMenuSearchService};
