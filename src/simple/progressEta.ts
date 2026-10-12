export function createEtaEstimator() {
 let samples: {time:number;done:number}[] = [], total=0, task='', changedAt=0;
 return {
  observe(done:number, nextTotal:number, key:string, now:number) {
   if(!Number.isFinite(done)||!Number.isFinite(nextTotal)||nextTotal<=0){samples=[];return;}
   const last=samples[samples.length-1];
   if(task!==key||total!==nextTotal||!last||done<last.done){samples=[{time:now,done}];changedAt=now;task=key;total=nextTotal;return;}
   if(done>last.done){changedAt=now;const sample={time:now,done};if(samples.length>1&&Math.floor(last.time/1000)===Math.floor(now/1000))samples[samples.length-1]=sample;else samples.push(sample);}
   while(samples.length>2&&samples[1].time<now-60000)samples.shift();
   // Bound memory even when progress events arrive much faster than 1 Hz.
   if(samples.length>180)samples.splice(1,samples.length-180);
  },
  remaining(now:number):number|null {
   const first=samples[0],last=samples[samples.length-1];
   if(!first||!last||last.done>=total||now-changedAt>30000||now-first.time<8000||last.done-first.done<3)return null;
   const rate=(last.done-first.done)/((now-first.time)/1000);
   return rate>0 ? (total-last.done)/rate : null;
  },
 };
}
export function formatRemaining(seconds:number|null):string {
 if(seconds===null||!Number.isFinite(seconds))return '正在估算…';
 if(seconds<60)return '约 1 分钟以内';
 const minutes=Math.ceil(seconds/60);
 if(minutes<60)return `约 ${minutes} 分钟`;
 const hours=Math.floor(minutes/60),rest=minutes%60;
 if(hours<24)return `约 ${hours} 小时${rest ? ` ${rest} 分钟` : ''}`;
 const days=Math.floor(hours/24),remaining=hours%24;
 return `约 ${days} 天${remaining ? ` ${remaining} 小时` : ''}`;
}
