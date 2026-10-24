import {Renderer} from './engine/renderer.js';
import {decodePhoto,download,jsonBlob,readJSON} from './files.js';
import {clone,History,validateRecipe,outputDimensions} from './model.js';
import {PRESETS,createState,findLayer,safeState} from './presets.js';
import {CameraSession,previewDimensions} from './camera.js';
import {canSharePhoto,sharePhoto} from './photo-delivery.js';
import {sampleCurve} from './curves.js';

const $=id=>document.getElementById(id);
let state=createState(),history=new History(state),source,sourceFile,engine,loading=false,exporting=false,split=false,held=false,grainHeld=false,frame=0,channel='m',toastTimer,loadSequence=0;
let live=false,cameraPending=false,cameraFrame=0,lastCameraFrame=0,fillView=false,activePanel='',lastTool=null,shooting=false,cameraAttempt=0;
let preparedPhoto=null,preparedURL='',sharing=false;
const video=$('cameraVideo'),cameraSession=new CameraSession(navigator.mediaDevices,video);
function compactControls(parent,key){
 const controls=[...parent.querySelectorAll('.control')];if(!controls.length)return;
 const previous=parent.dataset.selected||key||controls[0].querySelector('input').id;
 const select=document.createElement('select');select.className='parameter-picker';select.setAttribute('aria-label','選擇'+(parent.id==='layerControls'?'光影':'調整')+'項目');
 controls.forEach(c=>{const i=c.querySelector('input'),o=document.createElement('option');o.value=i.id;o.textContent=c.querySelector('label').textContent;select.append(o);});
 parent.prepend(select);select.value=controls.some(c=>c.querySelector('input').id===previous)?previous:select.options[0].value;
 const show=()=>{parent.dataset.selected=select.value;controls.forEach(c=>c.hidden=c.querySelector('input').id!==select.value);};select.onchange=show;show();
}
const panelNames={mix:'MIX',grain:'底片顆粒',layers:'光影分層',more:'更多',adjust:'基本調整',curves:'曲線',looks:'電影色彩'};
function openPanel(name,trigger){
 activePanel=activePanel===name?'':name;if(trigger)lastTool=trigger;
 $('tray').hidden=!activePanel;$('cameraApp').dataset.panel=activePanel;
 document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!=='panel-'+activePanel);
 document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-expanded',b.dataset.panel===activePanel));
 if(activePanel)$('trayTitle').textContent=panelNames[activePanel];
}
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel,b));
function closePanel(){activePanel='';$('tray').hidden=true;$('cameraApp').dataset.panel='';document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-expanded','false'));}
$('closeTray').onclick=()=>{closePanel();lastTool?.focus();};document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePanel();lastTool?.focus();}});
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4200);}
function guard(fn){return async(...args)=>{try{await fn(...args);}catch(e){console.error(e);toast(e.message||'操作失敗，請再試一次。');}};}
function fill(input){input.style.setProperty('--fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);}
function layer(type){return findLayer(state,type);}
function commit(){history.push(state);syncHistory();}
function syncHistory(){$('undo').disabled=history.index===0;$('redo').disabled=history.index===history.items.length-1;}
function draw(){if(!engine?.source)return;const view=grainHeld?{...state,layers:state.layers.filter(l=>l.type!=='grain')}:state;engine.render(view,{original:held,split:-1});$('splitMarker').hidden=!split||held;$('splitMarker').style.left='50%';if(activePanel==='grain')drawGrainDetail();}
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
 compactControls(p,'exposure');
}
function grainControls(){
 const p=$('grainControls');p.replaceChildren();
 control(p,{id:'grain',label:'顆粒強度',min:0,max:100,value:layer('grain').params.amount/.0035,set:v=>layer('grain').params.amount=v/100*.35,format:v=>Math.round(v)+'%'});
 control(p,{id:'grainSize',label:'顆粒大小',min:.5,max:8,step:.1,value:layer('grain').params.size,set:v=>layer('grain').params.size=v,format:v=>v.toFixed(1)});
 control(p,{id:'grainRoughness',label:'粗糙度',min:0,max:100,value:layer('grain').params.roughness*100,set:v=>layer('grain').params.roughness=v/100,format:v=>Math.round(v)+'%'});
 compactControls(p,'grain');
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
 const p=$('layerControls');p.replaceChildren();$('layerSwitches').replaceChildren();
 for(const type of ['bloom','shadow']){
  const l=layer(type),isLight=type==='bloom',prefix=isLight?'高光':'陰影';
  const toggle=document.createElement('button');toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',prefix+'層開關');toggle.setAttribute('aria-checked',l.enabled);toggle.textContent=prefix+(l.enabled?' · 開':' · 關');$('layerSwitches').append(toggle);
  const inputs=[];const add=spec=>inputs.push(control(p,spec));
  toggle.onclick=()=>{l.enabled=!l.enabled;toggle.setAttribute('aria-checked',l.enabled);toggle.textContent=prefix+(l.enabled?' · 開':' · 關');inputs.forEach(i=>i.disabled=!l.enabled);commit();render();};
  add({id:type+'Mix',label:prefix+' · MIX',min:0,max:100,value:l.strength*100,set:v=>l.strength=v/100,format:v=>v+'%'});
  add({id:type+'Hue',label:prefix+' · 染色色相',min:0,max:360,value:l.params.hue,set:v=>l.params.hue=v,format:v=>v+'°'});
  add({id:type+'Sat',label:prefix+' · 染色強度',min:0,max:50,value:l.params.saturation*100,set:v=>l.params.saturation=v/100,format:v=>v+'%'});
  add({id:type+'Threshold',label:prefix+' · 選取範圍',min:isLight?10:2,max:isLight?95:80,value:l.params.threshold*100,set:v=>l.params.threshold=v/100,format:v=>v+'%'});
  if(isLight){add({id:'bloomAmount',label:'高光 · 光暈強度',min:0,max:150,value:l.params.amount*100,set:v=>l.params.amount=v/100,format:v=>Math.round(v)+'%'});add({id:'bloomRadius',label:'高光 · 光暈擴散',min:.5,max:8,step:.1,value:l.params.radius*100,set:v=>l.params.radius=v/100,format:v=>v.toFixed(1)});}
  else add({id:'shadowBrightness',label:'陰影 · 亮度',min:-40,max:40,value:l.params.brightness*100,set:v=>l.params.brightness=v/100,format:v=>(v>0?'+':'')+v});
  inputs.forEach(i=>i.disabled=!l.enabled);
 }
 compactControls(p,'bloomAmount');
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
function curveControls(){updateCurve();const box=$('curveSliders');box.replaceChildren();['黑點','暗部','中間調','亮部','白點'].forEach((name,i)=>control(box,{id:'knot-'+i,label:name+' · 輸入 '+(i*25),min:0,max:100,value:curveValues()[i],set:v=>{setCurvePoint(i,v);const input=$('knot-'+i);input.value=curveValues()[i];},format:v=>'輸出 '+v}));compactControls(box,'knot-2');}
let dragging=-1;
$('curveSvg').onpointerdown=e=>{const node=e.target.closest('[data-knot]');if(!node)return;dragging=Number(node.dataset.knot);$('curveSvg').setPointerCapture(e.pointerId);e.preventDefault();};
$('curveSvg').onpointermove=e=>{if(dragging<0)return;const r=$('curveSvg').getBoundingClientRect(),y=(e.clientY-r.top)/r.height*280;setCurvePoint(dragging,(260-y)/2.4);const input=$('knot-'+dragging);input.value=curveValues()[dragging];input.previousElementSibling.querySelector('output').textContent='輸出 '+input.value;fill(input);render();};
function releaseCurve(){if(dragging>=0){dragging=-1;commit();}}
$('curveSvg').onpointerup=releaseCurve;$('curveSvg').onpointercancel=releaseCurve;$('curveSvg').onlostpointercapture=releaseCurve;
document.querySelectorAll('[data-channel]').forEach(b=>b.onclick=()=>{channel=b.dataset.channel;curveControls();});
$('resetCurve').onclick=()=>{[0,25,50,75,100].forEach((v,i)=>layer('curves').params[channel+i]=v);commit();curveControls();render();};
function refresh(){
 const p=PRESETS.find(p=>p.id===state.id);$('lookDot').style.background=p?.color||'#dec79b';$('lookName').textContent=state.name;$('lookDescription').textContent=state.description;
 $('mix').value=state.mix*100;$('mixValue').innerHTML=Math.round(state.mix*100)+'<span>%</span>';fill($('mix'));
 document.querySelectorAll('.preset').forEach(b=>{b.classList.toggle('active',b.dataset.look===state.id);b.setAttribute('aria-pressed',b.dataset.look===state.id);});
 basicControls();grainControls();layerControls();curveControls();syncHistory();render();
}
function selectPreset(id){const ev=state.exposure;state=createState(id);state.exposure=ev;commit();refresh();}
for(const [i,p] of PRESETS.entries()){
 const b=document.createElement('button');b.className='preset';b.dataset.look=p.id;b.title=p.desc;b.setAttribute('aria-label',`${p.name} ${p.tags}`);b.setAttribute('aria-pressed',p.id===state.id);
 b.innerHTML=`<span class="number">${String(i+1).padStart(2,'0')} / ${p.en}</span><strong>${p.name}</strong><small>${p.tags}</small>`;b.onclick=()=>selectPreset(p.id);$('presets').append(b);
}
function layout(){
 if(!engine?.source)return;const available=$('stage').getBoundingClientRect(),scale=(fillView?Math.max:Math.min)(available.width/engine.width,available.height/engine.height);
 $('imageFrame').style.width=Math.max(1,engine.width*scale)+'px';$('imageFrame').style.height=Math.max(1,engine.height*scale)+'px';
}
new ResizeObserver(layout).observe($('stage'));
$('fitView').onclick=()=>{fillView=!fillView;$('cameraApp').classList.toggle('fit-fill',fillView);$('fitView').setAttribute('aria-pressed',fillView);$('fitView').textContent=fillView?'滿版檢視':'完整構圖';layout();if(fillView)toast('滿版只放大預覽，匯出仍保留完整照片');};
function updateAvailability(){
 $('exportTop').disabled=!source||live||cameraPending||loading||exporting;$('download').disabled=!preparedPhoto||exporting||sharing;
 $('camera').disabled=loading||exporting||cameraPending||shooting;$('camera').setAttribute('aria-label',live?'拍攝照片':'開啟相機');$('camera').classList.toggle('live',live);
 $('flipCamera').disabled=!live||cameraPending||shooting;$('leaveCamera').hidden=!live&&!cameraPending;$('fitView').disabled=!engine?.source;
 $('modeLabel').textContent=live?'LIVE / 即時套色':source?'PHOTO / 照片調色':'PHOTO / FILM COLOR';
}
function restoreStill(){
 if(source&&engine){const d=previewDimensions(source.width,source.height,1280);engine.setSource(source,d.width,d.height);$('imageFrame').hidden=false;$('empty').hidden=true;layout();draw();}
 else{$('imageFrame').hidden=true;$('empty').hidden=false;}
}
function stopCamera(restore=true){cameraAttempt++;live=false;cameraPending=false;cameraSession.stop();cancelAnimationFrame(cameraFrame);if(restore)restoreStill();updateAvailability();}
async function startCamera(facing='environment'){
 if(loading||exporting||cameraPending)return;const attempt=++cameraAttempt;cameraPending=true;$('cameraStatus').textContent='請允許相機權限，準備即時取景…';updateAvailability();
 try{
  live=false;cancelAnimationFrame(cameraFrame);const stream=await cameraSession.start(facing);if(!stream||attempt!==cameraAttempt)return;
  if(!engine)engine=new Renderer($('preview'));
  const d=previewDimensions(video.videoWidth,video.videoHeight,960);engine.setSource(video,d.width,d.height);
  live=true;$('imageFrame').hidden=false;$('empty').hidden=true;$('failure').hidden=true;closePanel();layout();
  stream.getVideoTracks().forEach(t=>t.onended=()=>{if(live){stopCamera();toast('相機已停止，可重新開啟或匯入照片');}});
  const loop=t=>{if(!live)return;try{if(video.readyState>=2&&t-lastCameraFrame>80){lastCameraFrame=t;const size=previewDimensions(video.videoWidth,video.videoHeight,960);if(engine.width!==size.width||engine.height!==size.height){engine.setSource(video,size.width,size.height);layout();}engine.updateSource(video,cameraSession.facing==='user');draw();}cameraFrame=requestAnimationFrame(loop);}catch(e){stopCamera();toast(e.message);}};cameraFrame=requestAnimationFrame(loop);
 }catch(e){if(attempt!==cameraAttempt)return;stopCamera();$('cameraStatus').textContent=e.message;$('nativeCamera').hidden=false;toast(e.message);}
 finally{if(attempt===cameraAttempt){cameraPending=false;updateAvailability();}}
}
async function capture(){
 if(!live){await startCamera();return;}if(shooting||loading||exporting)return;shooting=true;updateAvailability();
 try{const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const x=c.getContext('2d');if(cameraSession.facing==='user'){x.translate(c.width,0);x.scale(-1,1);}x.drawImage(video,0,0,c.width,c.height);const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('拍攝失敗，請再試一次')),'image/jpeg',.98));stopCamera(false);await openPhoto(new File([blob],`PHOTO-${Date.now()}.jpg`,{type:'image/jpeg'}),'剛拍下的這一刻');toast('已拍攝，繼續調色或匯出照片');}
 catch(e){toast(e.message);}finally{shooting=false;updateAvailability();}
}
async function openPhoto(file,name=file.name){
 if(loading||exporting)return;stopCamera(false);loading=true;const seq=++loadSequence;$('loading').hidden=false;$('failure').hidden=true;updateAvailability();
 try{
  const next=await decodePhoto(file);if(seq!==loadSequence){next.width=next.height=1;return;}
  if(!engine)engine=new Renderer($('preview'));const d=previewDimensions(next.width,next.height,1280);engine.setSource(next,d.width,d.height);
  if(source)source.width=source.height=1;source=next;sourceFile=file;$('imageName').textContent=name;$('imageDimensions').textContent=`${next.originalWidth} × ${next.originalHeight}`;
  held=false;split=false;$('imageFrame').hidden=false;$('empty').hidden=true;closePanel();layout();draw();
  const thumb=document.createElement('canvas');thumb.width=80;thumb.height=80;const x=thumb.getContext('2d'),size=Math.min(next.width,next.height);x.drawImage(next,(next.width-size)/2,(next.height-size)/2,size,size,0,0,80,80);$('albumThumb').src=thumb.toDataURL('image/jpeg',.8);$('albumThumb').classList.add('has-photo');
 }catch(e){restoreStill();throw e;}
 finally{loading=false;$('loading').hidden=true;updateAvailability();}
}
$('upload').onclick=()=>$('photoInput').click();$('emptyUpload').onclick=$('upload').onclick;$('camera').onclick=capture;$('startCamera').onclick=()=>startCamera();$('leaveCamera').onclick=()=>stopCamera();$('flipCamera').onclick=()=>startCamera(cameraSession.facing==='user'?'environment':'user');
$('nativeCamera').onclick=()=>$('captureInput').click();
for(const id of ['photoInput','captureInput'])$(id).onchange=guard(async e=>{const file=e.target.files[0];e.target.value='';if(file){await openPhoto(file);toast('已套用「'+state.name+'」');}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(live||cameraPending))stopCamera();});window.addEventListener('pagehide',()=>stopCamera(false));
let dragDepth=0;document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
$('stage').ondragenter=e=>{e.preventDefault();dragDepth++;$('dropzone').hidden=false;};$('stage').ondragleave=()=>{if(--dragDepth<=0){dragDepth=0;$('dropzone').hidden=true;}};
$('stage').ondrop=guard(async e=>{e.preventDefault();dragDepth=0;$('dropzone').hidden=true;const file=e.dataTransfer.files[0];if(file)await openPhoto(file);});
$('mix').oninput=e=>{state.mix=Number(e.target.value)/100;$('mixValue').innerHTML=e.target.value+'<span>%</span>';fill(e.target);render();};$('mix').onchange=commit;
$('reset').onclick=()=>{state=createState(PRESETS.some(p=>p.id===state.id)?state.id:'nocturne');commit();refresh();toast('已還原色彩與曝光');};
$('undo').onclick=()=>{state=history.undo();refresh();};$('redo').onclick=()=>{state=history.redo();refresh();};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();e.shiftKey?$('redo').click():$('undo').click();}});
const release=()=>{held=false;render();};$('hold').onpointerdown=e=>{e.preventDefault();$('hold').setPointerCapture(e.pointerId);held=true;render();};$('hold').onpointerup=release;$('hold').onpointercancel=release;$('hold').onlostpointercapture=release;$('hold').onblur=release;$('hold').onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();held=true;render();}};$('hold').onkeyup=release;
$('saveRecipe').onclick=()=>{download(jsonBlob({format:'eigacam-recipe',version:1,state}),`EIGACAM-${state.name}.json`);toast('配方已下載，不包含照片');};
$('loadRecipe').onclick=()=>$('recipeInput').click();$('recipeInput').onchange=guard(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;const next=validateRecipe(safeState(await readJSON(file)));for(const type of ['tone','color','shadow','bloom','curves','soften','grain','vignette'])if(next.layers.filter(l=>l.type===type).length!==1)throw Error('配方缺少必要圖層，請使用 EIGACAM 匯出的配方。');for(const c of ['m','r','g','b'])for(let i=1;i<5;i++)if(findLayer(next,'curves').params[c+i]<findLayer(next,'curves').params[c+(i-1)])throw Error('曲線控制點必須維持明暗順序。');state=next;commit();refresh();toast('配方已套用');});
function dims(){return outputDimensions(source.originalWidth,source.originalHeight,$('exportSize').value);}
function outputInfo(){if(!source)return true;const d=dims(),limited=d.width>engine.maxSize||d.height>engine.maxSize||d.width*d.height>engine.pixelLimit;$('outputInfo').textContent=`${d.width.toLocaleString()} × ${d.height.toLocaleString()} px · 不放大原圖${limited?' · 超出此裝置範圍，請選較小尺寸':''}`;return limited;}
function deliveryControls(){
 const busy=exporting||sharing;$('savePhoto').disabled=busy;$('download').disabled=!preparedPhoto||busy;
 $('exportSize').disabled=busy;$('quality').disabled=busy;
 $('savePhoto').textContent=exporting?'正在準備照片…':sharing?'分享選單已開啟…':!preparedPhoto?'重新準備照片':canSharePhoto(preparedPhoto)?'儲存／分享照片':'顯示照片以儲存';
}
function showSaveFallback(message){$('saveFallback').hidden=false;$('exportStatus').textContent=message;}
async function preparePhoto(){
 if(!source||exporting||sharing)return;
 preparedPhoto=null;if(preparedURL)URL.revokeObjectURL(preparedURL);preparedURL='';$('savePreview').removeAttribute('src');$('saveFallback').hidden=true;
 $('exportStatus').textContent='';$('exportProgress').hidden=true;
 if(outputInfo()){$('exportStatus').textContent='請選擇較小的照片尺寸，再試一次。';deliveryControls();return;}
 exporting=true;const snapshot=clone(state),file=sourceFile,d=dims(),q=Number($('quality').value);updateAvailability();deliveryControls();$('exportProgress').value=0;$('exportProgress').hidden=false;let exporter,decoded;
 try{const canvas=document.createElement('canvas');exporter=new Renderer(canvas);$('exportStatus').textContent='正在準備原始照片…';decoded=await decodePhoto(file,{target:d,maxEdge:exporter.maxSize,maxPixels:exporter.pixelLimit});exporter.setSource(decoded,d.width,d.height);await exporter.export(snapshot,v=>{$('exportProgress').value=v;$('exportStatus').textContent=`正在處理光影 · ${Math.round(v)}%`;});const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('照片編碼失敗，請降低尺寸。')),'image/jpeg',q));
  preparedPhoto=new File([blob],`EIGACAM-${snapshot.name}-${file.name.replace(/\.[^.]+$/,'')}.jpg`,{type:'image/jpeg'});preparedURL=URL.createObjectURL(preparedPhoto);$('savePreview').src=preparedURL;
  $('exportProgress').value=100;$('exportStatus').textContent=`照片已準備好 · ${d.width} × ${d.height} px`;
  if(!canSharePhoto(preparedPhoto))showSaveFallback('此瀏覽器不支援照片分享，可長按下方照片儲存。');
 }catch(e){$('exportStatus').textContent=e.message||'照片準備失敗，請再試一次。';}
 finally{exporter?.destroy();if(decoded)decoded.width=decoded.height=1;exporting=false;$('exportProgress').hidden=true;updateAvailability();deliveryControls();}
}
$('exportTop').onclick=()=>{if(!source)return;$('exportDialog').showModal();preparePhoto();};$('exportSize').onchange=preparePhoto;$('quality').onchange=preparePhoto;
$('savePhoto').onclick=async()=>{
 if(exporting||sharing)return;if(!preparedPhoto){preparePhoto();return;}
 if(!canSharePhoto(preparedPhoto)){showSaveFallback('長按照片，選擇儲存影像。可用選項依瀏覽器而定。');return;}
 sharing=true;deliveryControls();
 try{
  // No encoding or asynchronous work before this call: preserve iOS user activation.
  const result=await sharePhoto(preparedPhoto);
  if(result.status==='cancelled')$('exportStatus').textContent='已取消分享，照片仍留在這裡。';
  else if(result.status==='unsupported')showSaveFallback('此瀏覽器無法分享照片，請長按下方照片儲存。');
  else $('exportStatus').textContent='已交給系統分享選單。是否存入相簿，請到「照片」確認。';
 }catch{showSaveFallback('無法開啟分享選單，可重試或長按下方照片儲存。');}
 finally{sharing=false;deliveryControls();}
};
$('download').onclick=()=>{if(!preparedPhoto||exporting||sharing)return;download(preparedPhoto,preparedPhoto.name);$('exportStatus').textContent='已下載到檔案。要存入相簿，請使用上方儲存／分享。';};
$('about').onclick=()=>$('aboutDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('retry').onclick=()=>location.reload();$('preview').addEventListener('engine-error',e=>{$('failure').hidden=false;$('failureText').textContent=e.detail;});
refresh();updateAvailability();
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
