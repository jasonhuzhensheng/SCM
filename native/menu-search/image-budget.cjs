'use strict';
function imageThreads({requested=1,cores=1,memoryBytes=0,load=Infinity}={}) {
 return requested===2 && cores>=8 && memoryBytes>=16*2**30 && Number.isFinite(load) && load<cores*0.7 ? 2 : 1;
}
module.exports={imageThreads};
