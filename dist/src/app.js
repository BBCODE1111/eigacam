import {Renderer} from './engine/renderer.js';
import {decodePhoto,download,jsonBlob,readJSON} from './files.js';
import {clone,History,validateRecipe,outputDimensions} from './model.js';
import {PRESETS,createState,findLayer,safeState} from './presets.js';
import {sampleCurve} from './curves.js';

const $=id=>document.getElementById(id);
let state=createState(),history=new History(state),source,sourceFile,engine,loading=false,exporting=false,split=false,held=false,grainHeld=false,frame=0,channel='m',toastTimer,loadSequence=0;
const labels={cafe:'午後咖啡館',street:'城市街景',portrait:'自然光人像',bar:'暖燈夜色'};
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4200);}
function guard(fn){return async(...args)=>{try{await fn(...args);}catch(e){console.error(e);toast(e.message||'操作失敗，請再試一次。');}};}
function fill(input){input.style.setProperty('--fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);}
function layer(type){return findLayer(state,type);}
function commit(){history.push(state);syncHistory();}
function syncHistory(){$('undo').disabled=history.index===0;$('redo').disabled=history.index===history.items.length-1;}
function draw(){if(!engine?.source)return;const view=grainHeld?{...state,layers:state.layers.filter(l=>l.type!=='grain')}:state;engine.render(view,{original:held,split:split?Number($('splitPosition').value)/100:-1});$('splitMarker').hidden=!split||held;$('splitMarker').style.left=$('splitPosition').value+'%';drawGrainDetail();}
function render(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{try{draw();}catch(e){toast(e.message);}});}
function control(parent,{label:name,min,max,step=1,value,set,format=v=>String(Math.round(v*100)/100),id}){
 const box=document.createElement('div');box.className='control';
 const head=document.createElement('div');head.className='control-head';const label=document.createElement('label');label.textContent=name;
 const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.id=id||'control-'+Math.random().toString(36).slice(2);label.htmlFor=input.id;
 const output=document.createElement('output');output.htmlFor=input.id;output.textContent=format(Number(input.value));head.append(label,output);box.append(head,input);parent.append(box);fill(input);
 input.addEventListener('input',()=>{set(Number(input.value));output.textContent=format(Number(input.value));fill(input);render();});input.addEventListener('change',commit);
 input.addEventListener('dblclick',()=>{input.value=value;input.dispatchEvent(new Event('input'));commit();});return input;
}
function basicControls(){
 const p=$('basicControls');p.replaceChildren();
 control(p,{id:'exposure',label:'曝光',min:-2,max:2,step:.05,value:state.exposure,set:v=>state.exposure=v,format:v=>(v>0?'+':'')+v.toFixed(2)+' EV'});
 for(const [key,name,min,max] of [['contrast','對比',-50,50],['temperature','冷暖',-50,50],['highlights','高光明度',-60,60],['shadows','陰影明度',-60,60]])control(p,{id:key,label:name,min,max,value:layer('tone').params[key],set:v=>layer('tone').params[key]=v,format:v=>(v>0?'+':'')+v});
 control(p,{id:'saturation',label:'飽和度',min:-100,max:60,value:layer('color').params.saturation,set:v=>layer('color').params.saturation=v,format:v=>(v>0?'+':'')+v});
 control(p,{id:'softness',label:'柔光質感',min:0,max:100,value:layer('soften').params.amount*100,set:v=>layer('soften').params.amount=v/100,format:v=>Math.round(v)+'%'});

}
function grainControls(){
 const p=$('grainControls');p.replaceChildren();
 control(p,{id:'grain',label:'顆粒強度',min:0,max:100,value:layer('grain').params.amount/.0035,set:v=>layer('grain').params.amount=v/100*.35,format:v=>Math.round(v)+'%'});
 control(p,{id:'grainSize',label:'顆粒大小',min:.5,max:8,step:.1,value:layer('grain').params.size,set:v=>layer('grain').params.size=v,format:v=>v.toFixed(1)});
 control(p,{id:'grainRoughness',label:'粗糙度',min:0,max:100,value:layer('grain').params.roughness*100,set:v=>layer('grain').params.roughness=v/100,format:v=>Math.round(v)+'%'});
}
function drawGrainDetail(){
 if(!engine?.source)return;const c=$('grainDetail'),x=c.getContext('2d'),w=Math.min(220,engine.width),h=Math.min(132,engine.height);
 x.imageSmoothingEnabled=false;x.drawImage(engine.canvas,(engine.width-w)/2,(engine.height-h)/2,w,h,0,0,c.width,c.height);
}
const grainHold=$('grainHold');
function releaseGrain(){if(grainHeld){grainHeld=false;grainHold.setAttribute('aria-pressed','false');render();}}
grainHold.onpointerdown=e=>{grainHold.setPointerCapture(e.pointerId);grainHeld=true;grainHold.setAttribute('aria-pressed','true');render();};
grainHold.onpointerup=releaseGrain;grainHold.onpointercancel=releaseGrain;grainHold.onlostpointercapture=releaseGrain;
grainHold.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();grainHeld=true;grainHold.setAttribute('aria-pressed','true');render();}};
grainHold.onkeyup=releaseGrain;grainHold.onblur=releaseGrain;window.addEventListener('blur',releaseGrain);
document.querySelectorAll('[data-grain-stock]').forEach(b=>b.onclick=()=>{const stocks={fine:[.07,1.8,.25],classic:[.14,3.5,.55],rough:[.245,5.4,.8]},v=stocks[b.dataset.grainStock],p=layer('grain').params;[p.amount,p.size,p.roughness]=v;layer('grain').enabled=true;commit();grainControls();render();});
function layerControls(){
 const p=$('layerControls');p.replaceChildren();
 for(const type of ['bloom','shadow']){
  const l=layer(type),isLight=type==='bloom',card=document.createElement('div');card.className='layer-card'+(l.enabled?'':' off');
  card.innerHTML=`<div class="layer-title"><span class="layer-symbol">${isLight?'☼':'◕'}</span><span>${isLight?'高光層':'陰影層'}</span><small>${isLight?'HIGHLIGHTS':'SHADOWS'}</small><button type="button" class="switch" role="switch" aria-label="${isLight?'高光層':'陰影層'}開關" aria-checked="${l.enabled}"></button></div>`;
  const toggle=card.querySelector('button');toggle.onclick=()=>{l.enabled=!l.enabled;toggle.setAttribute('aria-checked',l.enabled);card.classList.toggle('off',!l.enabled);card.querySelectorAll('input').forEach(i=>i.disabled=!l.enabled);commit();render();};
  p.append(card);
  control(card,{id:type+'Mix',label:'圖層 MIX',min:0,max:100,value:l.strength*100,set:v=>l.strength=v/100,format:v=>v+'%'});
  const hue=control(card,{id:type+'Hue',label:'染色色相',min:0,max:360,value:l.params.hue,set:v=>l.params.hue=v,format:v=>v+'°'});hue.style.background='linear-gradient(90deg,#bc655c,#c4b56d,#83aa75,#6caeaa,#777dc0,#b77caf,#bc655c)';
  control(card,{id:type+'Sat',label:'染色強度',min:0,max:50,value:l.params.saturation*100,set:v=>l.params.saturation=v/100,format:v=>v+'%'});
  control(card,{id:type+'Threshold',label:isLight?'高光選取門檻':'陰影選取範圍',min:isLight?10:2,max:isLight?95:80,value:l.params.threshold*100,set:v=>l.params.threshold=v/100,format:v=>v+'%'});
  if(isLight){control(card,{id:'bloomAmount',label:'光暈強度',min:0,max:150,value:l.params.amount*100,set:v=>l.params.amount=v/100,format:v=>Math.round(v)+'%'});control(card,{id:'bloomRadius',label:'光暈擴散',min:.5,max:8,step:.1,value:l.params.radius*100,set:v=>l.params.radius=v/100,format:v=>v.toFixed(1)});}
  else control(card,{id:'shadowBrightness',label:'暗部提亮',min:-40,max:40,value:l.params.brightness*100,set:v=>l.params.brightness=v/100,format:v=>(v>0?'+':'')+v});
  card.querySelectorAll('input').forEach(i=>i.disabled=!l.enabled);
 }
}
function curveValues(){return Array.from({length:5},(_,i)=>layer('curves').params[channel+i]);}
function updateCurve(){
 const pts=curveValues(),color={m:'#dec7a1',r:'#d4948b',g:'#9cbe9c',b:'#8eacd1'}[channel],values=[];
 for(let x=0;x<=100;x++)values.push(`${x?'L':'M'}${20+x*2.4},${260-sampleCurve(pts,x/100)*240}`);
 $('curvePath').setAttribute('d',values.join(' '));$('curvePath').setAttribute('stroke',color);$('curveArea').setAttribute('d',values.join(' ')+' L260,260 L20,260 Z');
 $('curveKnots').innerHTML=pts.map((v,i)=>`<g data-knot="${i}"><circle class="curve-hit" cx="${20+i*60}" cy="${260-v*2.4}" r="16"/><circle class="curve-knot" cx="${20+i*60}" cy="${260-v*2.4}" r="5" style="stroke:${color}"/></g>`).join('');
 document.querySelectorAll('[data-channel]').forEach(b=>{b.classList.toggle('active',b.dataset.channel===channel);b.setAttribute('aria-pressed',b.dataset.channel===channel);});
}
function setCurvePoint(i,v){const p=layer('curves').params,min=i?p[channel+(i-1)]:0,max=i<4?p[channel+(i+1)]:100;p[channel+i]=Math.round(Math.max(min,Math.min(max,v)));updateCurve();}
function curveControls(){updateCurve();const box=$('curveSliders');box.replaceChildren();['黑點','暗部','中間調','亮部','白點'].forEach((name,i)=>control(box,{id:'knot-'+i,label:name+' · 輸入 '+(i*25),min:0,max:100,value:curveValues()[i],set:v=>{setCurvePoint(i,v);const input=$('knot-'+i);input.value=curveValues()[i];},format:v=>'輸出 '+v}));}
let dragging=-1;
$('curveSvg').onpointerdown=e=>{const node=e.target.closest('[data-knot]');if(!node)return;dragging=Number(node.dataset.knot);$('curveSvg').setPointerCapture(e.pointerId);e.preventDefault();};
$('curveSvg').onpointermove=e=>{if(dragging<0)return;const r=$('curveSvg').getBoundingClientRect(),y=(e.clientY-r.top)/r.height*280;setCurvePoint(dragging,(260-y)/2.4);const input=$('knot-'+dragging);input.value=curveValues()[dragging];input.previousElementSibling.querySelector('output').textContent='輸出 '+input.value;fill(input);render();};
function releaseCurve(){if(dragging>=0){dragging=-1;commit();}}
$('curveSvg').onpointerup=releaseCurve;$('curveSvg').onpointercancel=releaseCurve;$('curveSvg').onlostpointercapture=releaseCurve;
document.querySelectorAll('[data-channel]').forEach(b=>b.onclick=()=>{channel=b.dataset.channel;curveControls();});
$('resetCurve').onclick=()=>{[0,25,50,75,100].forEach((v,i)=>layer('curves').params[channel+i]=v);commit();curveControls();render();};
function refresh(){
 const p=PRESETS.find(p=>p.id===state.id);$('lookEn').textContent=p?`${String(PRESETS.indexOf(p)+1).padStart(2,'0')} / ${p.en}`:'YOUR OWN COLOR';$('lookName').textContent=state.name;$('lookDescription').textContent=state.description;
 $('mix').value=state.mix*100;$('mixValue').innerHTML=Math.round(state.mix*100)+'<span>%</span>';fill($('mix'));
 document.querySelectorAll('.preset').forEach(b=>{b.classList.toggle('active',b.dataset.look===state.id);b.setAttribute('aria-pressed',b.dataset.look===state.id);});
 basicControls();grainControls();layerControls();curveControls();syncHistory();render();
}
function selectPreset(id){const ev=state.exposure;state=createState(id);state.exposure=ev;commit();refresh();}
for(const [i,p] of PRESETS.entries()){
 const b=document.createElement('button');b.className='preset';b.dataset.look=p.id;b.title=p.desc;b.setAttribute('aria-label',`${p.name} ${p.tags}`);b.setAttribute('aria-pressed',p.id===state.id);
 b.innerHTML=`<span class="number">${String(i+1).padStart(2,'0')}</span><img alt="${p.name}套用目前照片的預覽" src="./assets/cafe.jpg"><div class="preset-info"><strong>${p.name}</strong><span class="check">✓</span><small>${p.tags}</small></div>`;b.onclick=()=>selectPreset(p.id);$('presets').append(b);
}
async function thumbnails(){
 if(!source||!engine)return;const c=document.createElement('canvas');c.width=180;c.height=120;const ctx=c.getContext('2d');
 for(const p of PRESETS){engine.render(createState(p.id));const cw=engine.width,ch=engine.height,scale=Math.max(180/cw,120/ch);ctx.drawImage(engine.canvas,(180-cw*scale)/2,(120-ch*scale)/2,cw*scale,ch*scale);document.querySelector(`[data-look="${p.id}"] img`).src=c.toDataURL('image/jpeg',.8);}
 draw();
}
function layout(){if(!source||!engine)return;const available=$('stage').getBoundingClientRect(),scale=Math.min((available.width-36)/engine.width,(available.height-36)/engine.height);$('imageFrame').style.width=Math.max(1,engine.width*scale)+'px';$('imageFrame').style.height=Math.max(1,engine.height*scale)+'px';}
new ResizeObserver(layout).observe($('stage'));
function updateAvailability(){$('exportTop').disabled=!source||loading||exporting;$('download').disabled=!source||exporting;}
async function openPhoto(file,name=file.name){
 if(loading||exporting)return;loading=true;const seq=++loadSequence;$('loading').hidden=false;$('failure').hidden=true;updateAvailability();
 try{
  const next=await decodePhoto(file);if(seq!==loadSequence){next.width=next.height=1;return;}
  if(!engine)engine=new Renderer($('preview'));
  const scale=Math.min(1,1280/Math.max(next.width,next.height));engine.setSource(next,Math.round(next.width*scale),Math.round(next.height*scale));
  if(source)source.width=source.height=1;source=next;sourceFile=file;$('imageName').textContent=name;$('imageDimensions').textContent=`${next.originalWidth} × ${next.originalHeight}`;
  held=false;split=false;$('compare').setAttribute('aria-pressed','false');$('splitControl').hidden=true;layout();draw();await thumbnails();
 }catch(e){if(!source){$('failure').hidden=false;$('failureText').textContent=e.message;}throw e;}
 finally{loading=false;$('loading').hidden=true;updateAvailability();}
}
async function sample(id){if(loading||exporting)return;const response=await fetch(`./assets/${id}.jpg`);if(!response.ok)throw Error('示範照片暫時無法讀取。');await openPhoto(new File([await response.blob()],id+'.jpg',{type:'image/jpeg'}),labels[id]);document.querySelectorAll('[data-sample]').forEach(b=>b.classList.toggle('active',b.dataset.sample===id));}
document.querySelectorAll('[data-sample]').forEach(b=>b.onclick=guard(()=>sample(b.dataset.sample)));
$('upload').onclick=()=>$('photoInput').click();$('camera').onclick=()=>$('captureInput').click();
for(const id of ['photoInput','captureInput'])$(id).onchange=guard(async e=>{const file=e.target.files[0];e.target.value='';if(file){await openPhoto(file);document.querySelectorAll('[data-sample]').forEach(b=>b.classList.remove('active'));toast('照片已套用「'+state.name+'」');}});
let dragDepth=0;document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
$('stage').ondragenter=e=>{e.preventDefault();dragDepth++;$('dropzone').hidden=false;};$('stage').ondragleave=()=>{if(--dragDepth<=0){dragDepth=0;$('dropzone').hidden=true;}};
$('stage').ondrop=guard(async e=>{e.preventDefault();dragDepth=0;$('dropzone').hidden=true;const file=e.dataTransfer.files[0];if(file)await openPhoto(file);});
$('mix').oninput=e=>{state.mix=Number(e.target.value)/100;$('mixValue').innerHTML=e.target.value+'<span>%</span>';fill(e.target);render();};$('mix').onchange=commit;
$('reset').onclick=()=>{state=createState(PRESETS.some(p=>p.id===state.id)?state.id:'afterglow');commit();refresh();toast('已還原色彩與曝光');};
$('undo').onclick=()=>{state=history.undo();refresh();};$('redo').onclick=()=>{state=history.redo();refresh();};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();e.shiftKey?$('redo').click():$('undo').click();}});
$('compare').onclick=()=>{split=!split;$('compare').setAttribute('aria-pressed',split);$('splitControl').hidden=!split;render();};
$('splitPosition').oninput=e=>{fill(e.target);e.target.nextElementSibling.textContent=e.target.value+'%';render();};fill($('splitPosition'));
const release=()=>{held=false;render();};$('hold').onpointerdown=e=>{e.preventDefault();$('hold').setPointerCapture(e.pointerId);held=true;render();};$('hold').onpointerup=release;$('hold').onpointercancel=release;$('hold').onlostpointercapture=release;$('hold').onblur=release;$('hold').onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();held=true;render();}};$('hold').onkeyup=release;
function activateTab(tab){document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===tab;b.setAttribute('aria-selected',active);b.tabIndex=active?0:-1;$('panel-'+b.dataset.tab).hidden=!active;});}
const tabs=[...document.querySelectorAll('[data-tab]')];tabs.forEach((b,i)=>{b.onclick=()=>activateTab(b.dataset.tab);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];activateTab(next.dataset.tab);next.focus();};});activateTab('adjust');
$('saveRecipe').onclick=()=>{download(jsonBlob({format:'eigacam-recipe',version:1,state}),`EIGACAM-${state.name}.json`);toast('配方已下載，不包含照片');};
$('loadRecipe').onclick=()=>$('recipeInput').click();$('recipeInput').onchange=guard(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;const next=validateRecipe(safeState(await readJSON(file)));for(const type of ['tone','color','shadow','bloom','curves','soften','grain','vignette'])if(next.layers.filter(l=>l.type===type).length!==1)throw Error('配方缺少必要圖層，請使用 EIGACAM 匯出的配方。');for(const c of ['m','r','g','b'])for(let i=1;i<5;i++)if(findLayer(next,'curves').params[c+i]<findLayer(next,'curves').params[c+(i-1)])throw Error('曲線控制點必須維持明暗順序。');state=next;commit();refresh();toast('配方已套用');});
function dims(){return outputDimensions(source.originalWidth,source.originalHeight,$('exportSize').value);}
function outputInfo(){if(!source)return;const d=dims(),limited=d.width>engine.maxSize||d.height>engine.maxSize||d.width*d.height>engine.pixelLimit;$('outputInfo').textContent=`${d.width.toLocaleString()} × ${d.height.toLocaleString()} px · 不放大原圖${limited?' · 超出此裝置範圍，請選較小尺寸':''}`;$('download').disabled=limited||exporting;}
$('exportTop').onclick=()=>{if(!source)return;$('exportStatus').textContent='';$('exportProgress').hidden=true;outputInfo();$('exportDialog').showModal();};$('exportSize').onchange=outputInfo;
$('download').onclick=guard(async()=>{
 if(!source||exporting)return;exporting=true;const snapshot=clone(state),file=sourceFile,d=dims(),q=Number($('quality').value);updateAvailability();$('exportProgress').hidden=false;let exporter,decoded;
 try{const canvas=document.createElement('canvas');exporter=new Renderer(canvas);$('exportStatus').textContent='正在準備原始照片…';decoded=await decodePhoto(file,{target:d,maxEdge:exporter.maxSize,maxPixels:exporter.pixelLimit});exporter.setSource(decoded,d.width,d.height);await exporter.export(snapshot,v=>{$('exportProgress').value=v;$('exportStatus').textContent=`正在處理光影 · ${Math.round(v)}%`;});const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('照片編碼失敗，請降低尺寸。')),'image/jpeg',q));download(blob,`EIGACAM-${snapshot.name}-${file.name.replace(/\.[^.]+$/,'')}.jpg`);$('exportProgress').value=100;$('exportStatus').textContent=`已下載 · ${d.width} × ${d.height} px`;toast('照片已匯出，請查看下載項目');}
 catch(e){$('exportStatus').textContent=e.message;throw e;}
 finally{exporter?.destroy();if(decoded)decoded.width=decoded.height=1;exporting=false;updateAvailability();outputInfo();}
});
$('about').onclick=()=>$('aboutDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('retry').onclick=()=>location.reload();$('preview').addEventListener('engine-error',e=>{$('failure').hidden=false;$('failureText').textContent=e.detail;});
refresh();updateAvailability();guard(()=>sample('cafe'))();
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
