const assert=require('node:assert/strict');
const {fastChineseQuery:f}=require('../native/menu-search/fast-chinese-query.cjs');
assert.equal(f('白色的小猫在草地上面玩耍'),'white kitten at grass on playing');
assert.equal(f('海边的日落和白云'),'seaside sunset and white clouds');
for(const q of ['不是猫的照片','没有人的沙滩','不要红色汽车','除了小猫','海边的帆船','穿红衣服的女孩','照片里是张三','的在和','sunset',''])assert.equal(f(q),null,q);
assert.equal(f('一只黑色的狗正在奔跑'),'a black dog running');
console.log('PASS complete coverage, novel combinations, negation and unknown fallback');
