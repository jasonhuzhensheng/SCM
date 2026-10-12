import { readdirSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
export const isModelWeight = name => /\.(onnx(?:_data|\.data)?|gguf|safetensors|pt|pth|traineddata(?:\.gz)?)$/i.test(name) || /(?:^|\/)(?:pytorch_model|adapter_model|model)(?:[._-][^/]*)?\.bin$/i.test(name);
// Only call on disposable staging/output trees. Never traverse symlinks or user caches.
export function removePackagedModels(root) {
 let removedBytes = 0, removedFiles = 0;
 function visit(directory, inCache = false) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
   const full = join(directory, entry.name);
   if (entry.isSymbolicLink()) continue;
   if (entry.isDirectory()) {
    const cache = inCache || entry.name === '.cache' || entry.name === '.huggingface';
    visit(full, cache);
    if (cache) rmSync(full, { recursive: true, force: true });
   } else if (inCache || isModelWeight(entry.name)) {
    removedBytes += lstatSync(full).size; removedFiles++;
    rmSync(full);
   }
  }
 }
 visit(root); return { removedBytes, removedFiles };
}
