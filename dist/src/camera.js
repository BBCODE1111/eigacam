// Camera ownership is explicit: stale requests are stopped, and no microphone is requested.
export class CameraSession {
 constructor(mediaDevices, video) {this.mediaDevices = mediaDevices; this.video = video; this.generation = 0; this.stream = null; this.facing = 'environment';}
 get track() {return this.stream?.getVideoTracks()[0] ?? null;}
 stop() {this.generation++; this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.video.pause?.(); this.video.srcObject = null;}
 async start(facing = 'environment', portrait = false) {
  this.stop(); const token = this.generation;
  if (!this.mediaDevices?.getUserMedia) throw Error('這個瀏覽器無法即時取景，請改用 HQ 系統相機或匯入照片。');
  // Ask for the full 4:3 sensor. No frame-rate constraint: it steers browsers to smaller video modes.
  const [w, h] = portrait ? [3024, 4032] : [4032, 3024];
  let stream;
  try {stream = await this.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: facing}, width: {ideal: w}, height: {ideal: h}, resizeMode: {ideal: 'none'}}});}
  catch (e) {if (token !== this.generation) return null; const messages = {NotAllowedError: '相機權限未開啟。請到瀏覽器設定允許相機，或改用 HQ 系統相機。', NotFoundError: '找不到可用的相機，請匯入照片。', NotReadableError: '相機正被其他 App 使用，關閉後再試一次。', OverconstrainedError: '這支相機不支援要求的取景模式。'}; throw Error(messages[e.name] || '無法開啟相機，請再試一次。');}
  if (token !== this.generation) {stream.getTracks().forEach(t => t.stop()); return null;}
  this.stream = stream; const track = this.track;
  this.facing = track?.getSettings?.().facingMode || facing;
  await this.upgrade(track, token);
  if (token !== this.generation) return null;
  this.video.srcObject = stream;
  try {
   await this.video.play(); if (token !== this.generation) return null;
   if (!this.video.videoWidth) await new Promise((resolve, reject) => {const timer = setTimeout(() => {cleanup(); reject(Error('相機沒有傳回畫面，請再試一次。'));}, 8000); const ready = () => {cleanup(); resolve();}; const cleanup = () => {clearTimeout(timer); this.video.removeEventListener('loadeddata', ready);}; this.video.addEventListener('loadeddata', ready, {once: true});});
  } catch (e) {if (token === this.generation) this.stop(); throw e;}
  return token === this.generation ? stream : null;
 }
 // Some browsers open a small mode first even when a larger one exists; climb to the largest reported size.
 async upgrade(track, token) {
  try {
   const caps = track?.getCapabilities?.(), now = track?.getSettings?.() ?? {};
   const mw = caps?.width?.max, mh = caps?.height?.max;
   if (!mw || !mh || token !== this.generation) return;
   const long = Math.min(4032, Math.max(mw, mh)), short = Math.min(3024, Math.min(mw, mh));
   if ((now.width ?? 0) * (now.height ?? 0) >= long * short * .9) return;
   const portrait = (now.height ?? 0) > (now.width ?? 0);
   await track.applyConstraints({width: {ideal: portrait ? short : long}, height: {ideal: portrait ? long : short}, resizeMode: {ideal: 'none'}});
  } catch {}
 }
 zoomRange() {try {const z = this.track?.getCapabilities?.().zoom; return z && z.max > z.min ? {min: z.min, max: z.max, value: this.track.getSettings().zoom ?? z.min} : null;} catch {return null;}}
 async setZoom(value) {const r = this.zoomRange(); if (!r) return; await this.track.applyConstraints({advanced: [{zoom: Math.min(r.max, Math.max(r.min, value))}]});}
 async takePhoto(ImageCaptureType = globalThis.ImageCapture) {
  const token = this.generation, track = this.track;
  if (!track || typeof ImageCaptureType !== 'function') return null;
  try {
   const camera = new ImageCaptureType(track); if (typeof camera.takePhoto !== 'function') return null;
   const settings = {};
   try {const caps = await camera.getPhotoCapabilities?.(); if (Number.isFinite(caps?.imageWidth?.max)) settings.imageWidth = caps.imageWidth.max; if (Number.isFinite(caps?.imageHeight?.max)) settings.imageHeight = caps.imageHeight.max; if (caps?.fillLightMode?.includes('off')) settings.fillLightMode = 'off';} catch {}
   if (token !== this.generation) return null;
   const blob = await camera.takePhoto(settings);
   if (token !== this.generation || !blob?.size || !/^image\//.test(blob.type)) return null;
   return blob;
  } catch {return null;} // The full-resolution video frame remains as fallback.
 }
}
export function fitInside(width, height, maxEdge) {const s = Math.min(1, maxEdge / Math.max(width, height)); return {width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s))};}
