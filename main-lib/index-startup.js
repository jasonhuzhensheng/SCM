'use strict';
// One-shot request: keep it on failure, clear only after migration settles.
async function applyRequestedIndexModel({readSettings, writeSettings, getModel, reembedToModel, migrationSettled}) {
 const modelId=readSettings().requestedIndexModel;
 if (!modelId) return null;
 if (!getModel(modelId)) throw new Error(`Unknown model: ${modelId}`);
 const result=await reembedToModel(modelId,{requireComplete:true});
 await migrationSettled();
 if (readSettings().requestedIndexModel===modelId) writeSettings({requestedIndexModel:null});
 return result;
}
module.exports={applyRequestedIndexModel};
