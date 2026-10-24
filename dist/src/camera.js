// Camera ownership is explicit: stale requests are stopped, and no microphone is requested.
export class CameraSession {
 constructor(mediaDevices,video){this.mediaDevices=mediaDevices;this.video=video;this.generation=0;this.stream=null;this.facing='environment';}
 stop(){this.generation++;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.pause();this.video.srcObject=null;}
 async start(facing='environment'){
  this.stop();const token=this.generation;
  if(!this.mediaDevices?.getUserMedia)throw Error('這個瀏覽器無法即時取景，請匯入照片或使用手機相機。');
  let stream;
  try{stream=await this.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1440},frameRate:{ideal:24,max:30}}});}
  catch(e){if(token!==this.generation)return null;const messages={NotAllowedError:'相機權限未開啟。可到瀏覽器設定允許相機，或先匯入照片。',NotFoundError:'沒有可使用的相機，請匯入照片。',NotReadableError:'相機正在被其他程式使用，請關閉後再試。',OverconstrainedError:'此相機不支援要求的取景模式，請使用手機相機拍照。'};throw Error(messages[e.name]||'無法開啟相機，請再試一次或匯入照片。');}
  if(token!==this.generation){stream.getTracks().forEach(t=>t.stop());return null;}
  this.stream=stream;this.facing=stream.getVideoTracks()[0]?.getSettings?.().facingMode||facing;this.video.srcObject=stream;
  try{await this.video.play();if(token!==this.generation)return null;if(!this.video.videoWidth){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('相機沒有傳回畫面，請再試一次。'));},8000);const ready=()=>{cleanup();resolve();};const cleanup=()=>{clearTimeout(timer);this.video.removeEventListener('loadeddata',ready);};this.video.addEventListener('loadeddata',ready,{once:true});});}}
  catch(e){if(token===this.generation)this.stop();throw e;}
  return token===this.generation?stream:null;
 }
}
export function previewDimensions(width,height,maxEdge=960){const scale=Math.min(1,maxEdge/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
