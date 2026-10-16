'use strict';
async function openMenuQuery(query,{show,window}){
 show(); const deadline=Date.now()+45000;
 while(Date.now()<deadline){const win=window();if(win&&!win.isDestroyed()){const script=`(async()=>{const input=document.querySelector('input[aria-label="搜索素材"]');if(!input)return null;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)});input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,60));input.focus();if(${JSON.stringify(query)}.trim())input.form?.requestSubmit();return input.value;})()`;try{const value=await win.webContents.executeJavaScript(script);if(value!==null)return value;}catch{}}await new Promise(r=>setTimeout(r,250));}
 throw Error('主程序搜索框尚未准备好');
}
async function openFolderSettings({show,window}) {
 show(); const deadline=Date.now()+45000;
 while(Date.now()<deadline){
  const win=window();
  if(win&&!win.isDestroyed()){
   win.webContents.send("memories:status",{type:"open-settings"});
   await new Promise(r=>setTimeout(r,250));
   try { if(await win.webContents.executeJavaScript(`(()=>{const h=[...document.querySelectorAll('h3')].find(e=>e.textContent==='自动添加文件夹');if(!h)return false;h.scrollIntoView({block:'start'});h.tabIndex=-1;h.focus({preventScroll:true});return true})()`))return true; }catch{}
  }
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('文件夹设置尚未准备好');
}
module.exports={openMenuQuery,openFolderSettings};
