export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
// label, minimum, maximum, step, neutral/default. Spatial values use fractions of the short edge.
export const EFFECTS = {
  curves: {name:'曲線',icon:'⌁',params:Object.fromEntries(['m','r','g','b'].flatMap(c=>[0,25,50,75,100].map((v,i)=>[c+i,[c+i,0,100,1,v]])))},
  film: {name:'底片影調',icon:'◧',params:{density:['底片密度',0,1,.01,.3],contrast:['中段反差',0,1,.01,.5],shoulder:['高光滾降',0,1,.01,.75],toe:['暗部過渡',0,1,.01,.35],chroma:['色彩濃度',0,1,.01,.65]}},
  bloom: {name:'光學暈光',icon:'☼',params:{threshold:['光源門檻',.1,.95,.01,.72],feather:['光源柔邊',.02,.6,.01,.18],radius:['近光擴散',.005,.08,.001,.03],spread:['遠光範圍',1,6,.1,4],amount:['暈光強度',0,1.5,.01,.9],atmosphere:['空氣散射',0,1,.01,.3],halation:['暖色邊暈',0,1,.01,.35],hue:['光暈色相',0,360,1,36],saturation:['光暈染色',0,1,.01,.4],protect:['高光保護',0,1,.01,.9]}},
  tone: {name:'基礎影調', icon:'◒', params:{exposure:['局部曝光 EV',-2,2,.05,0],contrast:['對比',-50,50,1,0],highlights:['高光',-60,60,1,0],shadows:['陰影',-60,60,1,0],whites:['白點',-40,40,1,0],blacks:['黑點',-30,30,1,0],temperature:['色溫',-50,50,1,0],tint:['色調',-50,50,1,0]}},
  color: {name:'色彩與曲線',icon:'◑',params:{saturation:['飽和度',-100,60,1,0],curve:['S 曲線',-40,40,1,0],shadowHue:['暗部色相',0,360,1,192],shadowSat:['暗部染色',0,50,1,0],highlightHue:['亮部色相',0,360,1,40],highlightSat:['亮部染色',0,50,1,0],orangeHue:['橙色色相',-30,30,1,0],orangeSat:['橙色飽和',-50,50,1,0],orangeLum:['橙色明度',-30,30,1,0],aquaHue:['青藍色相',-30,30,1,0],aquaSat:['青藍飽和',-50,50,1,0],aquaLum:['青藍明度',-30,30,1,0]}},
  glow: {name:'亮部暈光',icon:'☼',params:{threshold:['亮度門檻',0,1,.01,.65],feather:['選取柔邊',.01,.6,.01,.22],radius:['擴散半徑',.002,.08,.001,.025],amount:['光量',0,1,.01,.2],hue:['光暈色相',0,360,1,38],saturation:['光暈染色',0,1,.01,.25]}},
  shadow: {name:'暗部氛圍',icon:'◕',params:{threshold:['暗部門檻',.02,.8,.01,.3],feather:['暗部柔邊',.01,.6,.01,.2],brightness:['暗部亮度',-.4,.4,.01,0],contrast:['局部反差',-.5,.5,.01,0],hue:['暗部色相',0,360,1,192],saturation:['暗部染色',0,.5,.01,.06]}},
  soften: {name:'細節柔化',icon:'◌',params:{radius:['柔化半徑',.0005,.008,.0005,.0015],amount:['柔化混合',0,1,.01,.12]}},
  grain: {name:'底片顆粒',icon:'⠿',params:{amount:['顆粒強度',0,.35,.001,.07],size:['顆粒大小',.5,8,.1,3.5],roughness:['粗糙度',0,1,.01,.45]}},
  vignette: {name:'暗角',icon:'◉',params:{amount:['暗角強度',0,1,.01,.16],range:['保留範圍',.1,1,.01,.55],feather:['羽化',.05,1,.01,.5],x:['中心 X',0,1,.01,.5],y:['中心 Y',0,1,.01,.5]}}
};
export function makeLayer(type, params={}) {
  return {id:uid(), type, name:EFFECTS[type].name, enabled:true, strength:1, params:Object.fromEntries(Object.entries(EFFECTS[type].params).map(([k,v])=>[k,params[k]??v[4]])), masks:[]};
}
export function makeMask(type='luminance') {
  return {id:uid(),type,combine:'intersect',invert:false,low:0,high:1,feather:.15,x:.5,y:.5,radius:.45,angle:0,start:.15,end:.85};
}
export class History {
  constructor(state){this.items=[clone(state)];this.index=0;}
  push(state){const v=clone(state);if(JSON.stringify(v)===JSON.stringify(this.items[this.index]))return;this.items=this.items.slice(0,this.index+1);this.items.push(v);if(this.items.length>60)this.items.shift();this.index=this.items.length-1;}
  undo(){if(this.index>0)this.index--;return clone(this.items[this.index]);}
  redo(){if(this.index<this.items.length-1)this.index++;return clone(this.items[this.index]);}
}
function number(v,min,max,label){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`${label} 超出範圍`);return v;}
export function validateRecipe(raw){
  if(!raw||raw.version!==1||raw.colorSpace!=='srgb'||!Array.isArray(raw.layers)||raw.layers.length>24)throw Error('配方版本、sRGB 色彩空間或效果數量不支援');
  const layers=raw.layers.map(l=>{
    if(!l||!EFFECTS[l.type])throw Error('不支援的效果');
    const layer=makeLayer(l.type); layer.name=String(l.name||layer.name).slice(0,60);layer.enabled=l.enabled!==false;layer.strength=number(l.strength,0,1,'效果強度');
    for(const [key,spec] of Object.entries(EFFECTS[l.type].params))layer.params[key]=number(l.params?.[key],spec[1],spec[2],key);
    if(!Array.isArray(l.masks)||l.masks.length>8)throw Error('每個效果最多 8 個遮色片');
    layer.masks=l.masks.map(m=>{
      if(!['luminance','linear','radial'].includes(m.type)||!['intersect','subtract','union'].includes(m.combine))throw Error('無效遮色片');
      const mask=makeMask(m.type);mask.combine=m.combine;mask.invert=m.invert===true;
      for(const key of ['low','high','feather','x','y','radius','start','end'])mask[key]=number(m[key],0,1,key);
      mask.angle=number(m.angle,-180,180,'angle');
      if(mask.low>mask.high||mask.start>mask.end||mask.feather<.01||mask.radius<.01)throw Error('遮色片範圍無效');
      return mask;
    });return layer;
  });
  return {version:1,revision:[2,3].includes(raw.revision)?raw.revision:1,id:String(raw.id||uid()).slice(0,80),name:String(raw.name||'自訂配方').slice(0,60),description:String(raw.description||'自訂色彩配方').slice(0,400),subtitle:String(raw.subtitle||'SRGB / FILM COLOR').slice(0,80),colorSpace:'srgb',mix:number(raw.mix??1,0,1,'Mix'),exposure:number(raw.exposure??0,-3,3,'曝光'),layers,ranges:effectRanges()};
}
export function effectRanges(){return Object.fromEntries(Object.entries(EFFECTS).map(([key,e])=>[key,Object.fromEntries(Object.entries(e.params).map(([p,s])=>[p,{min:s[1],max:s[2],step:s[3]}]))]));}
export function outputDimensions(width,height,longEdge='original'){
  const scale=longEdge==='original'?1:Math.min(1,Number(longEdge)/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
