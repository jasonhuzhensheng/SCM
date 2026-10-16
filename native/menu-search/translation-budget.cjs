'use strict';
// Only foreground prompt preparation may use a second CPU thread.
// Token generation remains single-threaded; no GPU or extra model process.
function promptThreads({ requested=1, cores=1, memoryBytes=0, freeBytes=0, load=Infinity }={}) {
 return requested===2 && cores>=8 && memoryBytes>=16*2**30 && freeBytes>=2*2**30 && Number.isFinite(load) && load>=0 && load<cores*0.7 ? 2 : 1;
}
module.exports={promptThreads};
