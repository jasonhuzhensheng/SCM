const assert=require('node:assert/strict');
(async()=>{
 const {detectionKind,imageTextQuery,matchesImageText}=await import('../src/simple/detectionQuery.ts');
 for(const q of ['条形码','條碼','barcode','bar code'])assert.equal(detectionKind(q),'barcode');
 for(const q of ['二维码','QR code'])assert.equal(detectionKind(q),'qr');
 assert.equal(detectionKind('海边的人'),null);
 assert.equal(imageTextQuery('图片文字：订单编号','files'),'订单编号');
 assert.equal(imageTextQuery('图片文字','files'),'');
 assert.equal(imageTextQuery('海边','files'),null);
 assert(matchesImageText('订 单 编号 １２３','订单编号123'));
 assert(!matchesImageText('订单 编号 123','订单金额'));
 assert(!matchesImageText('...',''));
 const photos=[{ocr:'订单编号 123'},{ocr:'海边日落'},{ocr:''}];
 assert.equal(photos.filter(p=>matchesImageText(p.ocr,'订单编号')).length,1);
 photos.shift();assert.equal(photos.filter(p=>matchesImageText(p.ocr,'订单编号')).length,0);
 console.log('PASS: detector routing, OCR-only query routing, normalized literal matching, no unrelated fill after deletion');
})().catch(e=>{console.error(e);process.exitCode=1});
