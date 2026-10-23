import {makeLayer,makeMask,clone} from './model.js';
import {identity} from './curves.js';
const presets=[
 {id:'coast',name:'別怕，夢做大一點',en:'COLD COAST',color:'#89a9ba',desc:'鋼藍空氣，深邃黑位。留一點暖意給人物。',tags:'冷灰 / 克制 / 清透',tone:{contrast:12,temperature:-8,highlights:-15,blacks:-7},colorParams:{saturation:-15,shadowHue:215,shadowSat:9,highlightHue:44,highlightSat:4,aquaSat:-12},hi:{hue:44,saturation:.15,amount:.22},sh:{hue:213,saturation:.08,brightness:-.015},curve:[0,21,49,77,98],grain:.012,soft:.02},
 {id:'velvet',name:'你在跟我說話嗎？',en:'RED VELVET',color:'#c0715f',desc:'酒紅與琥珀的餘韻，讓暗處也有故事。',tags:'琥珀 / 濃郁 / 復古',tone:{contrast:17,temperature:9,highlights:-16,blacks:-9},colorParams:{saturation:2,shadowHue:25,shadowSat:5,highlightHue:38,highlightSat:12,orangeSat:-5},hi:{hue:35,saturation:.4,amount:.32},sh:{hue:28,saturation:.04,brightness:-.02},curve:[0,20,48,77,98],grain:.023,soft:.05},
 {id:'solar',name:'沒有犧牲，就沒有勝利',en:'SOLAR HEAT',color:'#e4ad63',desc:'金色輪廓光與冷青陰影，讓日常更有張力。',tags:'金橙 / 冷青 / 強烈',tone:{contrast:22,temperature:2,highlights:-10,blacks:-12},colorParams:{saturation:9,shadowHue:199,shadowSat:22,highlightHue:40,highlightSat:19,orangeSat:-6,aquaHue:-10,aquaSat:7},hi:{hue:40,saturation:.45,amount:.38},sh:{hue:199,saturation:.13,brightness:-.025},curve:[0,17,50,81,99],grain:.009,soft:0},
 {id:'summer',name:'這樣就好，我就喜歡這樣',en:'PALE SUMMER',color:'#bac59b',desc:'透亮奶白與清新的綠，收藏一個輕盈午後。',tags:'奶白 / 青綠 / 柔亮',tone:{contrast:-9,temperature:2,highlights:-8,shadows:15,blacks:3},colorParams:{saturation:-6,shadowHue:187,shadowSat:6,highlightHue:48,highlightSat:8,aquaHue:-7},hi:{hue:49,saturation:.14,amount:.65},sh:{hue:185,saturation:.035,brightness:.025},curve:[2,28,55,79,99],grain:.014,soft:.17},
 {id:'nocturne',name:'我希望是一萬年',en:'NIGHT WANDER',color:'#73a799',desc:'墨綠、暖燈與濕漉反光，延長城市的夜晚。',tags:'墨綠 / 暖燈 / 濃影',tone:{contrast:16,temperature:-4,highlights:-15,blacks:-8},colorParams:{saturation:4,shadowHue:160,shadowSat:18,highlightHue:41,highlightSat:16,orangeSat:-5,aquaHue:-14},hi:{hue:39,saturation:.4,amount:.6},sh:{hue:165,saturation:.14,brightness:-.02},curve:[0,19,47,77,98],grain:.023,soft:.08},
 {id:'afterglow',name:'把餘光，留給昨天',en:'AFTERGLOW',color:'#d4b48c',desc:'奶油金光、冷綠暗部，像一張留在記憶裡的照片。',tags:'奶油 / 光暈 / 記憶',tone:{contrast:1,temperature:4,highlights:-13,shadows:5,blacks:-3},colorParams:{saturation:-13,shadowHue:178,shadowSat:14,highlightHue:46,highlightSat:18,aquaSat:-15,orangeSat:-5},hi:{hue:42,saturation:.34,amount:.95},sh:{hue:177,saturation:.09,brightness:.005},curve:[3,23,51,77,97],grain:.03,soft:.21},
 {id:'ozu',name:'人生，不是很令人失望嗎？',en:'AUTUMN TABLE',color:'#bb7958',desc:'暖棕中間調、沉穩黑位與飽滿色彩，把平凡日常留成一張溫暖的照片。適合室內與生活靜物。',tags:'暖棕 / 飽滿 / 日常',tone:{contrast:8,temperature:12,highlights:-20,shadows:4,blacks:-3},colorParams:{saturation:8,shadowHue:32,shadowSat:5,highlightHue:45,highlightSat:8,orangeSat:8,aquaSat:-10},hi:{hue:43,saturation:.12,amount:.12,halation:.06},sh:{hue:35,saturation:.035,brightness:.006},curve:[1,24,52,77,97],grain:.018,soft:.035},
 {id:'kurosawa',name:'贏的是農民，不是我們',en:'RAIN & SILVER',color:'#a5a8a6',desc:'雨中的深黑、鮮明反差與細顆粒，適合街道、建築和人物。預設全黑白，降低 MIX 可混回原色。',tags:'黑白 / 反差 / 顆粒',mix:1,tone:{contrast:29,highlights:-24,shadows:-5,blacks:-12},colorParams:{saturation:-100,shadowSat:0,highlightSat:0},hi:{saturation:0,amount:0,halation:0},sh:{saturation:0,brightness:-.025,contrast:.06},curve:[0,17,46,80,98],grain:.038,soft:0},
 {id:'kitano',name:'笨蛋，我們還沒開始呢',en:'STILL BLUE',color:'#668da9',desc:'冷藍陰影、低飽和與安靜中間調，像夏天還沒說完的話。適合海邊、陰天與城市街景。',tags:'冷藍 / 疏離 / 靜謐',tone:{contrast:6,temperature:-17,highlights:-20,shadows:2,blacks:-5},colorParams:{saturation:-22,shadowHue:221,shadowSat:24,highlightHue:210,highlightSat:7,aquaHue:9,aquaSat:-6},hi:{hue:216,saturation:.12,amount:.15,halation:0},sh:{hue:220,saturation:.17,brightness:-.012},curve:[1,22,48,74,97],grain:.017,soft:.025},
 {id:'iwai',name:'你好嗎？我很好',en:'SOFT LETTER',color:'#cbd2bb',desc:'透亮白色、淡青陰影與輕柔暈光，把一句問候留在逆光裡。適合窗邊人像與柔亮的午後。',tags:'透白 / 淡青 / 柔光',tone:{contrast:-15,temperature:-3,highlights:-18,shadows:18,blacks:5},colorParams:{saturation:-17,shadowHue:182,shadowSat:8,highlightHue:46,highlightSat:5,orangeLum:5,aquaSat:-10},hi:{hue:48,saturation:.09,amount:.85,atmosphere:.3,halation:.08},sh:{hue:184,saturation:.04,brightness:.025},curve:[4,30,58,82,99],grain:.015,soft:.26}
];
export const PRESETS=presets;
export function createState(id='afterglow'){
 const p=presets.find(p=>p.id===id)||presets[5];
 const light=makeLayer('bloom',{threshold:.7,feather:.22,radius:.026,spread:4,atmosphere:.22,halation:.2,protect:.94,...p.hi});light.name='高光層';
 const shadow=makeLayer('shadow',{threshold:.38,feather:.26,contrast:.02,...p.sh});shadow.name='陰影層';
 const curve=makeLayer('curves',identity());p.curve.forEach((v,i)=>curve.params['m'+i]=v);
 return {version:1,revision:2,id:p.id,name:p.name,description:p.desc,colorSpace:'srgb',mix:p.mix??.8,exposure:0,layers:[makeLayer('tone',p.tone),makeLayer('color',p.colorParams),shadow,light,curve,makeLayer('soften',{amount:p.soft}),makeLayer('grain',{amount:Math.min(.14,p.grain*3),size:p.id==='kurosawa'?4.8:p.id==='solar'?2.6:3.5,roughness:.55}),makeLayer('vignette',{amount:.1,range:.7,feather:.7})]};
}
export function findLayer(state,type){return state.layers.find(l=>l.type===type);}
export function highlightMask(threshold=.55){const m=makeMask();m.low=threshold;m.high=1;m.feather=.2;return m;}
export function safeState(raw){
 if(!['eigacam-recipe','luma-recipe'].includes(raw?.format)||raw.version!==1)throw Error('請選擇 EIGACAM 或舊版 LUMA 配方檔。');
 return raw.state;
}
