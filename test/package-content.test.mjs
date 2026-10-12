import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {removePackagedModels,isModelWeight} from '../scripts/package-content.mjs';
const root=mkdtempSync(join(tmpdir(),'scm-no-models-'));
try {
 const stage=join(root,'stage'),cache=join(stage,'node_modules/transformers/.cache/repo');mkdirSync(cache,{recursive:true});
 writeFileSync(join(cache,'vision.onnx'),'weights');writeFileSync(join(cache,'config.json'),'config');
 writeFileSync(join(stage,'model.gguf'),'weights');writeFileSync(join(stage,'runtime.dylib'),'runtime');writeFileSync(join(stage,'engine.wasm'),'wasm');writeFileSync(join(stage,'model-registry.js'),'code');
 const external=join(root,'external');mkdirSync(external);writeFileSync(join(external,'model.onnx'),'user model');symlinkSync(external,join(stage,'linked-cache'));
 const result=removePackagedModels(stage);assert.equal(result.removedFiles,3);assert(!existsSync(join(stage,'node_modules/transformers/.cache')));assert(!existsSync(join(stage,'model.gguf')));
 for(const name of ['runtime.dylib','engine.wasm','model-registry.js']) assert(existsSync(join(stage,name)));
 assert(existsSync(join(external,'model.onnx')));assert(isModelWeight('weights.onnx_data'));assert(isModelWeight('/cache/model-00001-of-00002.bin'));assert(!isModelWeight('runtime.so'));
 console.log('PASS: model/cache exclusion, runtime preservation, external symlink safety');
} finally {rmSync(root,{recursive:true,force:true});}
