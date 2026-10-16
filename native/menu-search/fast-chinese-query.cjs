'use strict';
// Only fully covered descriptions use this path. Unknown words and negation
// fall back to the full translator rather than silently changing the request.
const words = Object.entries({
 '海边':'seaside','沙滩':'beach','海滩':'beach','大海':'ocean','日落':'sunset','夕阳':'sunset','日出':'sunrise',
 '天空':'sky','蓝天':'blue sky','白云':'white clouds','雪山':'snowy mountain','山上':'on a mountain','山':'mountain',
 '草地':'grass','森林':'forest','树林':'trees','花园':'garden','花':'flowers','湖边':'by a lake','湖':'lake',
 '街道':'street','城市':'city','建筑':'building','房子':'house','桥':'bridge','汽车':'car','自行车':'bicycle',
 '小猫':'kitten','猫咪':'cat','猫':'cat','小狗':'puppy','狗':'dog','鸟':'bird',
 '孩子':'child','小孩':'child','小朋友':'child','男孩':'boy','女孩':'girl','男人':'man','女人':'woman','人':'person',
 '红色':'red','蓝色':'blue','黄色':'yellow','绿色':'green','白色':'white','黑色':'black',
 '晚上':'at night','夜晚':'at night','白天':'daytime','雨天':'rainy','下雪':'snowing',
 '跑步':'running','奔跑':'running','散步':'walking','睡觉':'sleeping','吃东西':'eating','玩耍':'playing',
 '坐着':'sitting','站着':'standing','游泳':'swimming','飞翔':'flying',
 '照片':'photo','图片':'image','一只':'a','一位':'a','一个':'a','一群':'a group of','两只':'two','两个':'two',
 '旁边':'beside','上面':'on','下面':'under','里面':'inside','前面':'in front of','后面':'behind',
 '正在':'','在':'at','的':'','和':'and','与':'and',
}).sort((a,b)=>b[0].length-a[0].length);
function fastChineseQuery(input) {
 const text=String(input||'').trim();
 if(!text || !/\p{Script=Han}/u.test(text) || text.length>100 || /不|没|无|别|非|除了|不要/.test(text)) return null;
 let rest=text, parts=[], subjects=0;
 while(rest){
  const space=rest.match(/^[\s，。！？、,.!?]+/u);if(space){rest=rest.slice(space[0].length);continue;}
  const word=words.find(([zh])=>rest.startsWith(zh));if(!word)return null;
  if(word[1]){parts.push(word[1]);if(!['a','at','and'].includes(word[1]))subjects++;}
  rest=rest.slice(word[0].length);
 }
 return subjects?parts.join(' '):null;
}
module.exports={fastChineseQuery};
