import {makeLayer,makeMask,clone} from './model.js';
import {identity} from './curves.js';
// Five distinct starting looks. Parameters are creative interpretations, not official film LUTs.
const presets=[
 {id:'nocturne',name:'霓虹夜行',en:'JADE NIGHT',color:'#8dba9d',desc:'青黑暗部、琥珀燈光，讓城市的夜有了深度。',tags:'墨綠 / 琥珀 / 濃影',mix:.9,tone:{contrast:16,temperature:-5,highlights:-18,shadows:-4,blacks:-8},colorParams:{saturation:-2,shadowHue:163,shadowSat:35,highlightHue:39,highlightSat:23,orangeSat:-8,orangeLum:4,aquaHue:-20,aquaSat:-12},hi:{hue:33,saturation:.4,amount:.48,threshold:.76,halation:.3,radius:.015,atmosphere:.12},sh:{hue:164,saturation:.24,brightness:-.016,contrast:.06},curve:[0,18,45,76,98],rgb:{r:[0,22,49,78,100],g:[0,27,52,77,99],b:[1,26,48,71,94]},film:{density:.24,contrast:.3,shoulder:.42,toe:.08,chroma:.72},grain:.025,soft:.025},
 {id:'velvet',name:'鎢光往事',en:'AMBER STORY',color:'#cc9967',desc:'暖棕與深紅沉進暗處，膚色留在金色的光裡。',tags:'暖棕 / 金光 / 復古',mix:.9,tone:{contrast:14,temperature:8,highlights:-18,shadows:-2,blacks:-7},colorParams:{saturation:1,shadowHue:20,shadowSat:17,highlightHue:38,highlightSat:25,orangeHue:-3,orangeSat:-6,aquaSat:-24},hi:{hue:31,saturation:.4,amount:.38,threshold:.77,halation:.24,radius:.018,atmosphere:.12},sh:{hue:24,saturation:.09,brightness:-.012},curve:[0,20,48,78,98],rgb:{r:[1,26,53,79,100],g:[0,24,50,75,98],b:[0,22,44,68,92]},film:{density:.2,contrast:.34,shoulder:.4,toe:.12,chroma:.8},grain:.026,soft:.035},
 {id:'coast',name:'冷冽銀幕',en:'STEEL BLUE',color:'#8baabc',desc:'鋼藍陰影與冷白高光，留下清晰、克制的重量。',tags:'鋼藍 / 冷白 / 反差',mix:.9,tone:{contrast:19,temperature:-10,highlights:-19,shadows:-2,blacks:-8},colorParams:{saturation:-22,shadowHue:213,shadowSat:28,highlightHue:43,highlightSat:7,orangeSat:-8,aquaHue:7,aquaSat:-15},hi:{hue:43,saturation:.12,amount:.13,threshold:.8,halation:.06,radius:.012,atmosphere:.08},sh:{hue:216,saturation:.2,brightness:-.012,contrast:.04},curve:[0,19,48,79,99],rgb:{r:[0,22,48,76,99],g:[0,25,51,77,99],b:[1,29,54,79,99]},film:{density:.18,contrast:.38,shoulder:.42,toe:.08,chroma:.6},grain:.019,soft:.005},
 {id:'iwai',name:'柔光書信',en:'PALE LETTER',color:'#c7cbb0',desc:'奶白亮部、淡青陰影，柔光裡仍保留人物的輪廓。',tags:'奶白 / 淡青 / 柔光',mix:.9,tone:{contrast:-4,temperature:0,highlights:-12,shadows:8,blacks:1},colorParams:{saturation:-16,shadowHue:179,shadowSat:15,highlightHue:47,highlightSat:10,orangeLum:4,aquaSat:-14},hi:{hue:46,saturation:.12,amount:.5,threshold:.73,halation:.1,radius:.018,atmosphere:.17},sh:{hue:180,saturation:.07,brightness:.012},curve:[2,26,55,80,99],rgb:{r:[1,25,51,77,100],g:[2,28,54,79,100],b:[3,29,53,76,97]},film:{density:.06,contrast:.1,shoulder:.25,toe:.24,chroma:.62},grain:.018,soft:.09},
 {id:'kurosawa',name:'黑白銀鹽',en:'SILVER FRAME',color:'#c4c6be',desc:'扎實的黑、層次分明的灰，讓顆粒與光線說話。',tags:'黑白 / 銀灰 / 顆粒',mix:1,tone:{contrast:24,highlights:-22,shadows:-2,blacks:-8},colorParams:{saturation:-100,shadowSat:0,highlightSat:0},hi:{saturation:0,amount:0,halation:0},sh:{saturation:0,brightness:-.014,contrast:.04},curve:[0,18,47,80,98],film:{density:.2,contrast:.3,shoulder:.4,toe:.12,chroma:.5},grain:.038,soft:0}
];
export const PRESETS=presets;
export function createState(id='nocturne'){
 const p=presets.find(p=>p.id===id)||presets[0];
 const light=makeLayer('bloom',{threshold:.7,feather:.22,radius:.026,spread:4,atmosphere:.22,halation:.2,protect:.94,...p.hi});light.name='高光層';
 const shadow=makeLayer('shadow',{threshold:.38,feather:.26,contrast:.02,...p.sh});shadow.name='陰影層';
 const curve=makeLayer('curves',identity());p.curve.forEach((v,i)=>curve.params['m'+i]=v);for(const [channel,values] of Object.entries(p.rgb||{}))values.forEach((v,i)=>curve.params[channel+i]=v);
 return {version:1,revision:3,id:p.id,name:p.name,description:p.desc,colorSpace:'srgb',mix:p.mix??.9,exposure:0,layers:[makeLayer('tone',p.tone),makeLayer('color',p.colorParams),shadow,makeLayer('film',p.film),curve,light,makeLayer('soften',{amount:p.soft}),makeLayer('grain',{amount:Math.min(.14,p.grain*3),size:p.id==='kurosawa'?4.8:p.id==='solar'?2.6:3.5,roughness:.55}),makeLayer('vignette',{amount:.1,range:.7,feather:.7})]};
}
export function findLayer(state,type){return state.layers.find(l=>l.type===type);}
export function highlightMask(threshold=.55){const m=makeMask();m.low=threshold;m.high=1;m.feather=.2;return m;}
export function safeState(raw){
 if(!['eigacam-recipe','luma-recipe'].includes(raw?.format)||raw.version!==1)throw Error('請選擇 EIGACAM 或舊版 LUMA 配方檔。');
 return raw.state;
}
