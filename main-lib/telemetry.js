'use strict';
const {randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const APP_ID='8F82E4EE-69A4-4658-94DC-BC0BD4566628';
const preferences=path.join(os.homedir(),'Library/Application Support/SayPhoto Usage/preferences.json');
const EVENTS=new Set(['App.started','Search.used','Settings.opened']);
function enabled(){try{return JSON.parse(fs.readFileSync(preferences)).enabled!==false}catch{return true}}
function setEnabled(value){fs.mkdirSync(path.dirname(preferences),{recursive:true});fs.writeFileSync(preferences+'.tmp',JSON.stringify({enabled:!!value}));fs.renameSync(preferences+'.tmp',preferences)}
function createTelemetry({version,fetchImpl=fetch,isEnabled=enabled,onResult=()=>{},testMode=false}){
 const sessionID=randomUUID(),last=new Map();let pending=0;
 return function track(type,query){
  if(!EVENTS.has(type)||!isEnabled()||pending>=2)return;
  const now=Date.now();if(now-(last.get(type)||0)<5000)return;last.set(type,now);
  const payload={'SayPhoto.app':'main','TelemetryDeck.AppInfo.version':String(version),'TelemetryDeck.Device.platform':'macOS'};
  // Only deliberate search text; reject path/URL-shaped input and control characters.
  if(type==='Search.used'&&typeof query==='string'&&query.trim()&&!/[\\/]|file:|https?:|[\x00-\x1f]/i.test(query))payload['SayPhoto.searchTerm']=query.trim().slice(0,300);
  const event={appID:APP_ID,clientUser:'',sessionID,type,isTestMode:testMode,payload};pending++;
  Promise.resolve().then(()=>{if(!isEnabled())return null;return fetchImpl('https://nom.telemetrydeck.com/v2/',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify([event]),signal:AbortSignal.timeout(5000)})}).then(r=>{if(r)onResult({event:type,ok:r.ok,status:r.status,at:new Date().toISOString()})}).catch(()=>onResult({event:type,ok:false,at:new Date().toISOString()})).finally(()=>pending--);
 };
}
let tracker=()=>{};
function start(app){tracker=createTelemetry({version:app.getVersion(),testMode:process.env.SAYPHOTO_TELEMETRY_TEST==='1',onResult:r=>{try{fs.writeFileSync(path.join(app.getPath('userData'),'telemetry-status.json'),JSON.stringify(r))}catch{}}});tracker('App.started')}
function menuItem(){return {label:'帮助改进 SayPhoto',type:'checkbox',checked:enabled(),click:item=>setEnabled(item.checked)}}
module.exports={APP_ID,createTelemetry,start,menuItem,enabled,setEnabled,track:(type,query)=>tracker(type,query)};
