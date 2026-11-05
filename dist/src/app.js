import {Renderer} from './engine/renderer.js';
import {CameraSession, fitInside} from './camera.js';
import {LOOKS, findLook} from './looks.js';
import {bakeLook, parseCube, cropFor, outputSize} from './color.js';
import {develop, renderSettings} from './develop.js';
import {addShot, updateShot, listShots, getFile, deleteShots, persist} from './roll.js';
import {canSharePhoto, sharePhoto} from './photo-delivery.js';
import {canvasBlob, download, decodeImage} from './files.js';
import {MASK_TYPES, ADJUSTMENTS, GEOMETRY, MAX_MASKS, createMask, duplicateMask, sanitizeMasks} from './masks.js';

const $ = id => document.getElementById(id);
const video = $('cameraVideo'), camera = new CameraSession(navigator.mediaDevices, video);

// ---------- preferences ----------
const PARAMS = [
 {key: 'ev', code: 'EV', label: '曝光', min: -2, max: 2, step: .1, def: 0, fmt: v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)},
 {key: 'ratio', code: 'FRAME', label: '畫幅', type: 'aspect', def: 0},
 {key: 'strength', code: 'MIX', label: '濃度', min: 0, max: 100, step: 1, def: 100, fmt: v => v + '%'},
 {key: 'warmth', code: 'WB', label: '色溫', min: -50, max: 50, step: 1, def: 0, fmt: v => v > 0 ? '暖' + v : v < 0 ? '冷' + -v : '±0'},
 {key: 'grain', code: 'GRAIN', label: '顆粒', min: 0, max: 200, step: 5, def: 100, fmt: v => v + '%'},
 {key: 'glow', code: 'GLOW', label: '光暈', min: 0, max: 200, step: 5, def: 100, fmt: v => v + '%'},
 {key: 'sharpen', code: 'SHARP', label: '銳利', min: 0, max: 100, step: 5, def: 35, fmt: v => String(v)},
 {key: 'beauty', code: 'SKIN', label: '美肌', min: 0, max: 100, step: 5, def: 40, fmt: v => String(v)},
 {key: 'masks', code: 'MASK', label: '遮色片', type: 'masks'}
];
const ASPECTS = [{value: 0, label: '原生', code: 'FULL'}, {value: 16 / 9, label: '16:9', code: 'HDTV'}, {value: 1.85, label: '1.85', code: 'FLAT'}, {value: 2.39, label: '2.39', code: 'SCOPE'}];
const defaults = Object.fromEntries([['look', 'nightcity'], ['hq', false], ...PARAMS.map(p => [p.key, p.def])]);
const store = {get(k) {try {return JSON.parse(localStorage.getItem(k));} catch {return null;}}, set(k, v) {try {localStorage.setItem(k, JSON.stringify(v));} catch {}}};
const prefs = {...defaults, ...(store.get('eigacam.prefs') ?? {})};
const savePrefs = () => store.set('eigacam.prefs', prefs);
const dials = () => Object.fromEntries(PARAMS.filter(p => !p.type).map(p => [p.key, prefs[p.key]]));

// ---------- looks & LUTs ----------
let custom = null; // {look, lut}
try {const saved = localStorage.getItem('eigacam.cube'); if (saved) {const lut = parseCube(saved); custom = {lut, look: customLook(lut)};}} catch {}
function customLook(lut) {return {id: 'custom', code: 'LUT', name: '自訂 LUT', en: (lut.title || 'CUSTOM CUBE').toUpperCase().slice(0, 24), swatch: ['#222', '#777', '#ddd'], desc: '你匯入的 .cube LUT。', grain: {amount: .04, size: 1.5}, glow: {halation: .1, bloom: .05, hue: 20}};}
// User recipes: a base look plus the user's own masks, kept on this device.
let recipes = (store.get('eigacam.recipes') ?? []).filter(r => r && typeof r.id === 'string' && typeof r.base === 'string').map(r => ({id: r.id.slice(0, 40), name: String(r.name ?? '我的配方').slice(0, 24), base: r.base, masks: sanitizeMasks(r.masks)}));
const saveRecipes = () => store.set('eigacam.recipes', recipes);
function baseLook(id) {return id === 'custom' && custom ? custom.look : findLook(id);}
function recipeLook(r, i) {const base = baseLook(r.base); return {...base, id: r.id, code: 'R' + (i + 1), name: r.name, en: 'MY RECIPE · ' + base.en, desc: `以「${base.name}」為底，加上 ${r.masks.length} 個遮色片。`, lutOf: base.lutOf ?? base.id, masks: r.masks, recipe: r};}
const allLooks = () => [...LOOKS, ...recipes.map(recipeLook), ...(custom ? [custom.look] : [])];
function lookById(id) {const i = recipes.findIndex(r => r.id === id); return i >= 0 ? recipeLook(recipes[i], i) : baseLook(id);}
const luts = new Map();
function lutFor(id) {
 const look = lookById(id), key = look.lutOf ?? look.id; // variants and recipes share their base LUT
 if (key === 'custom') return custom ? custom.lut : lutFor(LOOKS[0].id);
 if (!luts.has(key)) luts.set(key, bakeLook(findLook(key))); return luts.get(key);
}
if (!allLooks().some(l => l.id === prefs.look)) prefs.look = LOOKS[0].id; // removed looks fall back to the first one

// ---------- UI helpers ----------
let toastTimer;
function toast(text) {$('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3600);}
const guard = fn => async (...a) => {try {await fn(...a);} catch (e) {console.error(e); toast(e.message || '發生錯誤，請再試一次。');}};

// ---------- preview renderer ----------
let preview = null, live = false, pending = false, frameHandle = 0, idleSource = null, still = null, studio = null;
function ensurePreview() {if (!preview) preview = new Renderer($('preview')); return preview;}
$('preview').addEventListener('engine-error', e => toast(e.detail));
function sourceSize() {return live ? {width: video.videoWidth, height: video.videoHeight} : still ?? idleSource ?? {width: 3, height: 4};}

function layout() {
 const box = $('viewfinder').getBoundingClientRect(), src = sourceSize();
 const s = Math.min(box.width / src.width, box.height / src.height);
 const w = Math.floor(src.width * s), h = Math.floor(src.height * s);
 $('frame').style.width = w + 'px'; $('frame').style.height = h + 'px';
 const crop = cropFor(src.width, src.height, prefs.ratio), win = $('window').style;
 win.left = crop.x * 100 + '%'; win.top = crop.y * 100 + '%'; win.width = crop.w * 100 + '%'; win.height = crop.h * 100 + '%';
 const aspect = ASPECTS.find(a => a.value === prefs.ratio) ?? ASPECTS[0];
 const out = outputSize(src.width, src.height, crop, 8192, 40_000_000);
 $('frameLabel').textContent = live ? `${aspect.code} ${prefs.ratio ? aspect.label + ':1' : ''} · ${out.width}×${out.height}`.replace('16:9:1', '16:9') : '';
 $('matte').classList.toggle('full', !prefs.ratio);
 if (preview && (live || still)) {
  const dpr = Math.min(devicePixelRatio || 1, 3), size = fitInside(Math.round(w * dpr), Math.round(h * dpr), 1600);
  const fit = fitInside(src.width, src.height, Math.max(size.width, size.height));
  try {preview.resize(fit.width, fit.height);} catch (e) {toast(e.message);}
 }
 drawHandles(); if (!live) requestDraw();
}
new ResizeObserver(layout).observe($('viewfinder'));

// The masks in effect: the studio's working copy while editing, otherwise the look's own.
const activeMasks = () => studio ? studio.masks : lookById(prefs.look).masks ?? [];
function drawPreview() {
 if (!preview) return;
 if (live) {if (video.readyState < 2) return; preview.setSource(video);} else if (!still) return;
 const look = lookById(prefs.look); preview.setLUT(lutFor(look.id));
 preview.render(renderSettings(look, dials(), {mirror: live && camera.facing === 'user', masks: activeMasks(), maskView: studio?.show ? studio.selected : 0, grainSeed: live ? [Math.random() * 999, Math.random() * 999] : [0, 0]}));
}
let drawQueued = false;
function requestDraw() {if (live || drawQueued) return; drawQueued = true; requestAnimationFrame(() => {drawQueued = false; try {drawPreview();} catch (e) {toast(e.message);}});}
function loop() {
 if (!live) return;
 try {drawPreview();} catch (e) {stopCamera(); toast(e.message); return;}
 frameHandle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
}

// ---------- camera lifecycle ----------
function setState(name) {$('hudState').textContent = name; $('app').dataset.state = name.toLowerCase();}
function updateControls() {
 $('flip').disabled = !live; $('vfIdle').hidden = live || pending || !!still; $('frame').hidden = !live && !still;
 $('hudRes').textContent = live ? `${video.videoWidth}×${video.videoHeight}` : '— × —';
 $('hqToggle').setAttribute('aria-pressed', prefs.hq); $('app').classList.toggle('hq', prefs.hq);
 $('shutter').setAttribute('aria-label', prefs.hq ? '用 HQ 系統相機拍攝' : live ? '拍攝' : '開啟相機');
 setState(pending ? 'WAIT' : live ? 'LIVE' : 'STBY');
}
async function startCamera(facing = camera.facing || 'environment') {
 if (pending) return; pending = true; updateControls();
 try {
  const stream = await camera.start(facing, matchMedia('(orientation: portrait)').matches);
  if (!stream) return;
  ensurePreview(); live = true; still = null;
  stream.getVideoTracks().forEach(t => t.onended = () => {if (live) {stopCamera(); toast('相機已停止');}});
  layout(); setupZoom(); loop();
  store.set('eigacam.cameraGranted', true);
 } catch (e) {stopCamera(); $('idleText').textContent = e.message; toast(e.message);}
 finally {pending = false; updateControls();}
}
function stopCamera() {
 live = false; camera.stop(); if (studio && !still) loadStill();
 if (frameHandle) {video.cancelVideoFrameCallback?.(frameHandle); cancelAnimationFrame(frameHandle); frameHandle = 0;}
 $('zoom').hidden = true; updateControls();
}
function setupZoom() {
 const range = camera.zoomRange(), box = $('zoom'); box.replaceChildren();
 if (!range) {box.hidden = true; return;}
 const stops = [...new Set([range.min < 1 ? range.min : null, 1, 2, 3, 5].filter(v => v !== null && v >= range.min && v <= range.max))];
 if (stops.length < 2) {box.hidden = true; return;}
 for (const v of stops) {
  const b = document.createElement('button'); b.textContent = (Math.round(v * 10) / 10) + '×'; b.dataset.zoom = v;
  b.classList.toggle('active', Math.abs(v - range.value) < .05);
  b.onclick = guard(async () => {await camera.setZoom(v); box.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));});
  box.append(b);
 }
 box.hidden = false;
}

// ---------- capture & develop ----------
const queue = []; let developing = false, memoryRoll = null;
function updateBusy() {const n = queue.length + (developing ? 1 : 0); $('busy').hidden = !n; $('busy').lastChild.textContent = n > 1 ? `沖印中 · ${n}` : '沖印中'; $('rollButton').classList.toggle('developing', !!n);}
function enqueue(job) {queue.push(job); updateBusy(); pump();}
async function pump() {
 if (developing) return; developing = true; updateBusy();
 while (queue.length) {
  const job = queue.shift(); updateBusy();
  try {
   const look = lookById(job.look);
   const out = await develop(job.blob, {lut: lutFor(look.id), ratio: job.ratio, settings: renderSettings(look, job.dials, {mirror: job.mirror, masks: job.masks})});
   const shot = {id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: Date.now(), look: look.id, lookName: look.name, dials: job.dials, ratio: job.ratio, mirror: job.mirror, masks: job.masks, width: out.width, height: out.height, thumb: out.thumb};
   await saveShot(shot, job.blob, out.jpeg);
   setRollThumb(out.thumb, true);
  } catch (e) {console.error(e); toast('沖印失敗：' + (e.message || '記憶體不足'));}
 }
 developing = false; updateBusy();
}
async function saveShot(shot, original, developed) {
 if (!memoryRoll) {try {await addShot(shot, original, developed); return;} catch (e) {memoryRoll = new Map(); toast(e.message);}}
 memoryRoll.set(shot.id, {shot, original, developed});
}
async function shots() {return memoryRoll ? [...memoryRoll.values()].map(v => v.shot).sort((a, b) => b.created - a.created) : listShots().catch(() => []);}
async function fileOf(id, kind) {return memoryRoll ? memoryRoll.get(id)?.[kind] : getFile(id, kind);}

function grabFrame() {
 const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
 c.getContext('2d').drawImage(video, 0, 0); return canvasBlob(c, 'image/jpeg', .97).finally(() => {c.width = c.height = 1;});
}
let shooting = false;
const shoot = guard(async () => {
 if (prefs.hq) {nativeCapture(); return;}
 if (!live) {await startCamera(); return;}
 if (shooting) return; shooting = true;
 const job = {look: prefs.look, dials: dials(), ratio: prefs.ratio, mirror: camera.facing === 'user', masks: structuredClone(activeMasks())};
 $('shutterFlash').classList.remove('on'); void $('shutterFlash').offsetWidth; $('shutterFlash').classList.add('on');
 setState('REC'); navigator.vibrate?.(12);
 try {
  // Android Chrome can take a real still photo; elsewhere keep the full-resolution sensor frame.
  const still = 'ImageCapture' in globalThis ? await camera.takePhoto() : null;
  job.blob = still ?? await grabFrame();
  enqueue(job);
 } finally {shooting = false; setTimeout(() => live && setState('LIVE'), 300);}
});
let resumeAfterNative = false;
function nativeCapture() {resumeAfterNative = live; stopCamera(); $('captureInput').click();}
function importFiles(files, label) {
 const list = [...files].filter(f => /^image\//.test(f.type) || f.type === '');
 for (const blob of list) enqueue({blob, look: prefs.look, dials: dials(), ratio: prefs.ratio, mirror: false, masks: structuredClone(activeMasks())});
 if (list.length) toast(`${label} ${list.length} 張，正以「${lookById(prefs.look).name}」沖印`);
}
const resume = () => {const r = resumeAfterNative; resumeAfterNative = false; if (r) startCamera();};
$('captureInput').addEventListener('change', e => {importFiles(e.target.files, 'HQ 拍攝'); e.target.value = ''; resume();});
$('captureInput').addEventListener('cancel', resume);
$('photoInput').addEventListener('change', e => {importFiles(e.target.files, '已匯入'); e.target.value = '';});

// ---------- look reel ----------
let flashTimer;
function selectLook(id, announce = true) {
 prefs.look = id; savePrefs(); const look = lookById(id); syncParams?.();
 $('hudLook').textContent = `${look.code} ${look.en}`;
 document.querySelectorAll('#reel .look').forEach(b => {const on = b.dataset.look === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); if (on) b.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'smooth'});});
 if (announce && live) {const f = $('lookFlash'); f.innerHTML = `<b>${look.code}</b><strong>${look.name}</strong><span>${look.en}</span>`; f.classList.add('on'); clearTimeout(flashTimer); flashTimer = setTimeout(() => f.classList.remove('on'), 1100);}
 if (!live) requestDraw();
}
function lookButton(look, onPick, current) {
 const b = document.createElement('button'); b.className = 'look'; b.dataset.look = look.id; b.setAttribute('role', 'option'); b.title = look.desc;
 b.style.setProperty('--sw', `linear-gradient(90deg, ${look.swatch.join(',')})`);
 b.innerHTML = `<i></i><span class="code">${look.code}</span><strong>${look.name}</strong>`;
 b.classList.toggle('active', look.id === current); b.onclick = () => onPick(look.id); return b;
}
function buildReel() {
 const reel = $('reel'); reel.replaceChildren(...allLooks().map(l => lookButton(l, selectLook, prefs.look)));
 const add = document.createElement('button'); add.className = 'look add'; add.innerHTML = '<i></i><span class="code">.CUBE</span><strong>匯入 LUT</strong>'; add.onclick = () => $('cubeInput').click(); reel.append(add);
 selectLook(prefs.look, false);
}
$('cubeInput').addEventListener('change', guard(async e => {
 const file = e.target.files[0]; e.target.value = ''; if (!file) return;
 if (file.size > 12 * 1024 * 1024) throw Error('LUT 檔太大（上限 12 MB）。');
 const text = await file.text(), lut = parseCube(text);
 custom = {lut, look: customLook(lut)}; custom.look.en = (lut.title || file.name.replace(/\.cube$/i, '')).toUpperCase().slice(0, 24);
 try {localStorage.setItem('eigacam.cube', text);} catch {toast('LUT 太大，無法記住，重新整理後需再匯入');}
 buildReel(); selectLook('custom'); toast('已載入 LUT：' + custom.look.en);
}));
// Swipe across the viewfinder to change looks, like changing film stock.
let swipe = null;
$('viewfinder').addEventListener('pointerdown', e => {if (studio || e.target.closest('button, .handle')) return; swipe = {x: e.clientX, y: e.clientY};});
$('viewfinder').addEventListener('pointerup', e => {
 if (!swipe) return; const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
 if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
 const list = allLooks(), i = list.findIndex(l => l.id === prefs.look);
 selectLook(list[(i + (dx < 0 ? 1 : -1) + list.length) % list.length].id);
});

// ---------- parameter strip, ruler dial, aspect picker ----------
let activeParam = '';
function paramText(p) {if (p.type === 'masks') {const n = activeMasks().length; return n ? String(n) : '+';} return p.type === 'aspect' ? (ASPECTS.find(a => a.value === prefs.ratio) ?? ASPECTS[0]).label : p.fmt(prefs[p.key]);}
function buildParams() {
 $('params').replaceChildren(...PARAMS.map(p => {
  const b = document.createElement('button'); b.className = 'param'; b.dataset.param = p.key; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span>${p.label}</span><b></b>`; b.onclick = () => openParam(activeParam === p.key ? '' : p.key); return b;
 }));
 syncParams();
}
function syncParams() {
 document.querySelectorAll('#params .param').forEach(b => {const p = PARAMS.find(x => x.key === b.dataset.param); b.querySelector('b').textContent = paramText(p); b.classList.toggle('changed', p.type === 'masks' ? activeMasks().length > 0 : prefs[p.key] !== p.def); b.setAttribute('aria-pressed', activeParam === p.key); b.classList.toggle('active', activeParam === p.key);});
}
function openParam(key) {
 const p = PARAMS.find(x => x.key === key);
 if (p?.type === 'masks') {openStudio(); return;}
 activeParam = key;
 $('reel').hidden = !!key; $('aspects').hidden = p?.type !== 'aspect';
 mainDial.show(p && !p.type ? {...p, label: `${p.label} · ${p.code}`, get: () => prefs[p.key], set: v => {prefs[p.key] = v; savePrefs(); syncParams(); requestDraw();}} : null);
 if (p?.type === 'aspect') buildAspects();
 if (!key) selectLook(prefs.look, false);
 syncParams();
}
// A camera-style ruler: drag the scale under a fixed needle. Shared by the main dials and the mask studio.
class Dial {
 constructor(root) {
  this.root = root; this.ruler = root.querySelector('.ruler'); this.track = root.querySelector('.ruler-track');
  this.label = root.querySelector('.dial-label'); this.output = root.querySelector('output'); this.spec = null; let drag = null;
  this.ruler.addEventListener('pointerdown', e => {if (!this.spec) return; drag = {x: e.clientX, v: this.spec.get()}; this.ruler.setPointerCapture(e.pointerId);});
  this.ruler.addEventListener('pointermove', e => {if (drag) this.set(drag.v - (e.clientX - drag.x) / this.ppu());});
  const end = () => {if (drag) this.spec?.commit?.(); drag = null;}; this.ruler.addEventListener('pointerup', end); this.ruler.addEventListener('pointercancel', end);
  this.ruler.addEventListener('keydown', e => {const d = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1}[e.key]; if (d && this.spec) {e.preventDefault(); this.set(this.spec.get() + d * this.spec.step * (e.shiftKey ? 10 : 1));}});
  root.querySelector('.dial-reset').onclick = () => {if (this.spec) {this.set(this.spec.def); this.spec.commit?.();}};
 }
 ppu() {const p = this.spec; return 720 / ((p.max - p.min) / p.step) / p.step;} // whole range ≈ 720px
 show(spec) {this.spec = spec; this.root.hidden = !spec; if (spec) {this.label.textContent = spec.label; this.draw();}}
 set(v) {
  const p = this.spec; v = Math.round(Math.min(p.max, Math.max(p.min, v)) / p.step) * p.step; v = Number(v.toFixed(3));
  if (v === p.get()) return; p.set(v); this.draw(); if (Math.abs(v - p.def) < 1e-9) navigator.vibrate?.(6);
 }
 draw() {
  const p = this.spec; if (!p) return; const k = this.ppu(), minor = p.step * k, major = minor * ((p.max - p.min) / p.step >= 100 ? 10 : 5), v = p.get();
  const t = this.track.style; t.width = (p.max - p.min) * k + 'px'; t.setProperty('--minor', minor + 'px'); t.setProperty('--major', major + 'px');
  t.transform = `translateX(${-(v - p.min) * k}px)`; t.setProperty('--zero', (p.def - p.min) * k + 'px');
  this.output.textContent = p.fmt(v);
  for (const [a, x] of [['aria-valuemin', p.min], ['aria-valuemax', p.max], ['aria-valuenow', v], ['aria-label', p.label]]) this.ruler.setAttribute(a, x);
 }
}
const mainDial = new Dial($('dial')), maskDial = new Dial($('maskDial'));
function drawRuler() {mainDial.draw();}
function buildAspects() {
 $('aspects').replaceChildren(...ASPECTS.map(a => {
  const b = document.createElement('button'); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', a.value === prefs.ratio);
  b.innerHTML = `<i style="--r:${a.value || 4 / 3}"></i><strong>${a.label}</strong><span>${a.code}</span>`;
  b.onclick = () => {prefs.ratio = a.value; savePrefs(); buildAspects(); syncParams(); layout();}; return b;
 }));
}

// ---------- film roll ----------
let rollURLs = [], selecting = false, selected = new Map(), viewing = null;
function setRollThumb(blob, pulse) {
 const img = $('rollThumb'); if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
 if (!blob) {img.removeAttribute('src'); img.dataset.url = ''; $('rollButton').classList.remove('has'); return;}
 img.dataset.url = URL.createObjectURL(blob); img.src = img.dataset.url; $('rollButton').classList.add('has');
 if (pulse) {$('rollButton').classList.remove('pulse'); void $('rollButton').offsetWidth; $('rollButton').classList.add('pulse');}
 refreshRollCount();
}
async function refreshRollCount() {const list = await shots(); $('rollCount').hidden = !list.length; $('rollCount').textContent = list.length;}
function openSheet(id) {$(id).hidden = false; requestAnimationFrame(() => $(id).classList.add('open'));}
function closeSheet(id) {$(id).classList.remove('open'); setTimeout(() => {$(id).hidden = true;}, 220);}
async function renderRoll() {
 rollURLs.forEach(u => URL.revokeObjectURL(u)); rollURLs = [];
 const list = await shots(), grid = $('rollGrid');
 $('rollEmpty').hidden = !!list.length; $('rollTitleCount').textContent = list.length ? `${list.length} 張` : ''; $('rollSelect').hidden = !list.length;
 grid.replaceChildren(...list.map(shot => {
  const b = document.createElement('button'); b.className = 'cell'; b.dataset.id = shot.id;
  const url = URL.createObjectURL(shot.thumb); rollURLs.push(url);
  b.innerHTML = `<img src="${url}" alt=""><span>${lookById(shot.look).code}</span><i></i>`;
  b.classList.toggle('selected', selected.has(shot.id));
  b.onclick = () => selecting ? toggleSelect(shot, b) : openViewer(shot); return b;
 }));
 syncSelection();
}
async function toggleSelect(shot, cell) {
 if (selected.has(shot.id)) selected.delete(shot.id); else {selected.set(shot.id, null); fileOf(shot.id, 'developed').then(blob => {if (selected.has(shot.id) && blob) {selected.set(shot.id, new File([blob], fileName(shot), {type: 'image/jpeg'})); syncSelection();}});}
 cell.classList.toggle('selected', selected.has(shot.id)); syncSelection();
}
function syncSelection() {
 $('rollSelect').textContent = selecting ? '完成' : '選取'; $('roll').classList.toggle('selecting', selecting);
 const ready = [...selected.values()].filter(Boolean);
 $('rollShare').hidden = $('rollDelete').hidden = !selecting; $('rollImport').hidden = selecting;
 $('rollShare').textContent = `儲存 ${selected.size} 張`; $('rollShare').disabled = !selected.size || ready.length !== selected.size; $('rollDelete').disabled = !selected.size;
}
const fileName = shot => `EIGACAM-${lookById(shot.look).en.replace(/[^A-Z0-9]+/g, '-')}-${new Date(shot.created).toISOString().slice(0, 19).replace(/[-:T]/g, '')}.jpg`;
$('rollButton').onclick = guard(async () => {selecting = false; selected.clear(); await renderRoll(); openSheet('roll');});
$('rollSelect').onclick = () => {selecting = !selecting; selected.clear(); document.querySelectorAll('.cell').forEach(c => c.classList.remove('selected')); syncSelection();};
$('rollImport').onclick = () => $('photoInput').click();
$('rollShare').onclick = async () => {
 const files = [...selected.values()].filter(Boolean); if (!files.length) return;
 if (!canSharePhoto(files)) {files.forEach(f => download(f, f.name)); toast('此瀏覽器不能分享照片，已改為下載檔案'); return;}
 try {const r = await sharePhoto(files); if (r.status === 'shared') toast('已交給系統；iPhone 請選「儲存影像」');} catch {toast('無法開啟分享選單，請再試一次');}
};
$('rollDelete').onclick = guard(async () => {
 if (!confirm(`刪除 ${selected.size} 張照片？這個動作無法復原。`)) return;
 const ids = [...selected.keys()]; if (memoryRoll) ids.forEach(id => memoryRoll.delete(id)); else await deleteShots(ids);
 selected.clear(); selecting = false; await renderRoll(); const [first] = await shots(); setRollThumb(first?.thumb);
});
document.querySelectorAll('[data-close-sheet]').forEach(b => b.onclick = () => closeSheet(b.closest('.sheet').id));

// ---------- viewer ----------
let viewerFile = null, viewerURL = '';
async function openViewer(shot) {
 viewing = shot; viewerFile = null; $('viewerStatus').textContent = ''; $('viewerShare').disabled = true;
 const look = lookById(shot.look);
 $('viewerTitle').textContent = `${look.code} ${look.name}`;
 const aspect = ASPECTS.find(a => a.value === shot.ratio) ?? ASPECTS[0];
 $('viewerMeta').textContent = `${shot.width} × ${shot.height} · ${aspect.code} · ${new Date(shot.created).toLocaleString('zh-TW', {dateStyle: 'medium', timeStyle: 'short'})}`;
 $('viewerReel').replaceChildren(...allLooks().map(l => lookButton(l, redevelop, shot.look)));
 openSheet('viewer'); await showDeveloped(shot);
}
async function showDeveloped(shot) {
 const blob = await fileOf(shot.id, 'developed'); if (!blob || viewing !== shot) return;
 if (viewerURL) URL.revokeObjectURL(viewerURL); viewerURL = URL.createObjectURL(blob); $('viewerImage').src = viewerURL;
 viewerFile = new File([blob], fileName(shot), {type: 'image/jpeg'}); $('viewerShare').disabled = false;
}
const redevelop = guard(async lookId => {
 const shot = viewing; if (!shot || shot.look === lookId || !$('viewerBusy').hidden) return;
 $('viewerBusy').hidden = false; $('viewerShare').disabled = true;
 try {
  const original = await fileOf(shot.id, 'original'), look = lookById(lookId);
  const out = await develop(original, {lut: lutFor(look.id), ratio: shot.ratio, settings: renderSettings(look, shot.dials, {mirror: shot.mirror})});
  Object.assign(shot, {look: look.id, lookName: look.name, masks: look.masks ?? [], thumb: out.thumb, width: out.width, height: out.height});
  if (memoryRoll) Object.assign(memoryRoll.get(shot.id), {shot, developed: out.jpeg}); else await updateShot(shot, out.jpeg);
  $('viewerTitle').textContent = `${look.code} ${look.name}`;
  document.querySelectorAll('#viewerReel .look').forEach(b => b.classList.toggle('active', b.dataset.look === look.id));
  await showDeveloped(shot); renderRoll(); const [first] = await shots(); setRollThumb(first?.thumb);
 } finally {$('viewerBusy').hidden = true;}
});
$('viewerBack').onclick = () => {closeSheet('viewer'); viewing = null;};
$('viewerShare').onclick = async () => {
 if (!viewerFile) return;
 if (!canSharePhoto(viewerFile)) {download(viewerFile, viewerFile.name); $('viewerStatus').textContent = '此瀏覽器不能分享照片，已下載檔案。'; return;}
 try {const r = await sharePhoto(viewerFile); $('viewerStatus').textContent = r.status === 'shared' ? '已交給系統分享選單。iPhone 請選「儲存影像」。' : r.status === 'cancelled' ? '已取消，照片仍在底片盒。' : '';}
 catch {$('viewerStatus').textContent = '無法開啟分享選單，可改用「下載檔案」。';}
};
$('viewerDownload').onclick = () => {if (viewerFile) download(viewerFile, viewerFile.name);};
$('viewerDelete').onclick = guard(async () => {
 if (!viewing || !confirm('刪除這張照片？')) return;
 if (memoryRoll) memoryRoll.delete(viewing.id); else await deleteShots([viewing.id]);
 closeSheet('viewer'); viewing = null; await renderRoll(); const [first] = await shots(); setRollThumb(first?.thumb); refreshRollCount();
});


// ---------- mask studio ----------
// Masks are edited live over the viewfinder. Without a camera, the latest shot (or a sample) stands in.
async function loadStill() {
 try {
  const [latest] = await shots(); const blob = latest ? await fileOf(latest.id, 'original') : await (await fetch('./assets/portrait.jpg')).blob();
  const decoded = await decodeImage(blob, 2400, 4_000_000); if (live || !studio) return;
  ensurePreview().setSource(decoded.image, decoded.width, decoded.height);
  still = {width: decoded.width, height: decoded.height}; decoded.image.width = decoded.image.height = 1;
  updateControls(); layout(); requestDraw();
 } catch (e) {toast('無法載入預覽照片：' + e.message);}
}
function selectedMask() {return studio?.masks.find(m => m.id === studio.selected) ?? null;}
function openStudio() {
 const look = lookById(prefs.look);
 studio = {masks: structuredClone(look.masks ?? []), selected: look.masks?.[0]?.id ?? '', show: false, key: 'ev', dirty: false};
 openParam(''); $('app').classList.add('studio'); $('studio').hidden = false;
 if (!live && !still) loadStill();
 renderStudio(); requestDraw();
}
function closeStudio(save) {
 if (!studio) return;
 if (save === undefined && studio.dirty) save = confirm('要把這些遮色片存成配方嗎？\n按「取消」會放棄變更。');
 if (save) saveRecipe();
 studio = null; $('app').classList.remove('studio'); $('studio').hidden = true; $('handles').replaceChildren();
 if (!live) {still = null; updateControls();}
 syncParams(); selectLook(prefs.look, false); requestDraw();
}
function saveRecipe() {
 if (!studio) return; const look = lookById(prefs.look);
 if (look.recipe) {look.recipe.masks = structuredClone(studio.masks); toast(`已更新「${look.name}」`);}
 else {
  const name = (prompt('幫這個配方取個名字', `${look.name}・自訂`) ?? '').trim(); if (!name) return;
  const r = {id: 'r' + Date.now().toString(36), name: name.slice(0, 24), base: look.id, masks: structuredClone(studio.masks)};
  recipes.push(r); prefs.look = r.id; savePrefs(); toast(`已存成「${r.name}」，在色彩列表的最後`);
 }
 saveRecipes(); studio.dirty = false; buildReel(); renderStudio();
}
function changed() {studio.dirty = true; renderStudio(); requestDraw(); syncParams();}
function renderStudio() {
 if (!studio) return; const look = lookById(prefs.look), m = selectedMask();
 $('studioTitle').textContent = `遮色片 · ${look.name}${studio.dirty ? ' *' : ''}`;
 $('studioDelete').hidden = !look.recipe; $('studioSave').textContent = look.recipe ? '儲存' : '另存配方';
 const list = $('maskList'); list.replaceChildren();
 for (const mask of studio.masks) {
  const b = document.createElement('button'); b.className = 'mask-chip'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', mask.id === studio.selected);
  b.classList.toggle('active', mask.id === studio.selected); b.classList.toggle('off', !mask.enabled);
  b.innerHTML = `<span>${MASK_TYPES[mask.type].code}${mask.invert ? ' · 反' : ''}</span><strong></strong>`; b.querySelector('strong').textContent = mask.name;
  b.onclick = () => {studio.selected = mask.id; renderStudio(); requestDraw();}; list.append(b);
 }
 for (const [type, info] of Object.entries(MASK_TYPES)) {
  const b = document.createElement('button'); b.className = 'mask-chip add'; b.innerHTML = `<span>新增</span><strong>＋${info.label}</strong>`;
  b.disabled = studio.masks.length >= MAX_MASKS; b.onclick = () => addMask(type); list.append(b);
 }
 $('maskActions').hidden = !m; $('maskParams').hidden = !m; $('maskDial').hidden = !m; $('studioHint').hidden = !!m;
 if (m) {
  const flags = {show: studio.show, invert: m.invert, toggle: m.enabled};
  $('maskActions').querySelectorAll('[data-act]').forEach(b => {if (b.dataset.act in flags) b.setAttribute('aria-pressed', flags[b.dataset.act]);});
  $('maskActions').querySelector('[data-act=toggle]').textContent = m.enabled ? '啟用中' : '已停用';
  const specs = maskSpecs(m); if (!specs.some(x => x.key === studio.key)) studio.key = 'ev';
  $('maskParams').replaceChildren(...specs.map(x => {
   const b = document.createElement('button'); b.className = 'param'; b.classList.toggle('active', x.key === studio.key); b.classList.toggle('changed', x.get() !== x.def);
   b.innerHTML = `<span>${x.label}</span><b>${x.fmt(x.get())}</b>`; b.onclick = () => {studio.key = x.key; renderStudio();}; return b;
  }));
  const spec = specs.find(x => x.key === studio.key);
  if (maskDial.spec?.id !== m.id + spec.key) maskDial.show({...spec, id: m.id + spec.key}); else maskDial.draw();
 }
 drawHandles();
}
function maskSpecs(m) {
 const geo = Object.entries(GEOMETRY[m.type]).map(([key, [label, min, max, step, def, fmt]]) => ({key, label, min, max, step, def, fmt, get: () => m[key], set: v => {m[key] = v; changed();}}));
 const adj = Object.entries(ADJUSTMENTS).map(([key, [label, min, max, step, def, fmt]]) => ({key, label, min, max, step, def, fmt, get: () => m.adj[key], set: v => {m.adj[key] = v; changed();}}));
 return [...adj.slice(0, 5), ...geo, ...adj.slice(5)];
}
function addMask(type) {
 const src = sourceSize(), aspect = src.width / src.height, n = studio.masks.filter(m => m.type === type).length + 1;
 const extra = type === 'radial' ? {ry: .28 * aspect} : {};
 const m = createMask(type, {name: MASK_TYPES[type].label + (n > 1 ? ' ' + n : ''), ...extra});
 studio.masks.push(m); studio.selected = m.id; studio.show = true; studio.key = type === 'luma' ? 'lo' : type === 'color' ? 'hue' : 'ev';
 changed(); toast(type === 'linear' || type === 'radial' ? '拖曳取景器上的圓點調整範圍；紅色是選到的區域' : '調整範圍；紅色是選到的區域');
}
$('maskActions').addEventListener('click', e => {
 const act = e.target.closest('[data-act]')?.dataset.act, m = selectedMask(); if (!act || !m) return;
 const i = studio.masks.indexOf(m);
 if (act === 'show') {studio.show = !studio.show; renderStudio(); requestDraw(); return;}
 if (act === 'invert') m.invert = !m.invert;
 if (act === 'toggle') m.enabled = !m.enabled;
 if ((act === 'dup' || act === 'dupinv') && studio.masks.length < MAX_MASKS) {const copy = duplicateMask(m, {invert: act === 'dupinv'}); studio.masks.splice(i + 1, 0, copy); studio.selected = copy.id; toast(act === 'dupinv' ? '已複製並反轉：現在調整的是另一側' : '已複製遮色片');}
 if ((act === 'dup' || act === 'dupinv') && studio.masks.length >= MAX_MASKS) toast(`最多 ${MAX_MASKS} 個遮色片`);
 if (act === 'delete') {studio.masks.splice(i, 1); studio.selected = studio.masks[Math.max(0, i - 1)]?.id ?? '';}
 changed();
});
$('studioSave').onclick = saveRecipe;
$('studioDone').onclick = () => closeStudio();
$('studioDelete').onclick = () => {
 const look = lookById(prefs.look); if (!look.recipe || !confirm(`刪除配方「${look.name}」？`)) return;
 recipes = recipes.filter(r => r !== look.recipe); saveRecipes(); prefs.look = look.recipe.base; savePrefs(); closeStudio(false); buildReel();
};

// On-viewfinder handles for gradient and radial masks, in image coordinates.
function toScreen(x, y) {return [(live && camera.facing === 'user' ? 1 - x : x) * 100, y * 100];}
function fromPointer(e) {const r = $('frame').getBoundingClientRect(); let x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height; if (live && camera.facing === 'user') x = 1 - x; return [Math.min(1.2, Math.max(-.2, x)), Math.min(1.2, Math.max(-.2, y))];}
function drawHandles() {
 const box = $('handles'); box.replaceChildren(); const m = selectedMask();
 if (!m || !['linear', 'radial'].includes(m.type)) return;
 const dot = (name, x, y, label) => {const d = document.createElement('div'); d.className = 'handle'; d.dataset.handle = name; const [sx, sy] = toScreen(x, y); d.style.left = sx + '%'; d.style.top = sy + '%'; if (label) d.dataset.label = label; box.append(d);};
 if (m.type === 'linear') {
  const [ax, ay] = toScreen(m.x0, m.y0), [bx, by] = toScreen(m.x1, m.y1);
  box.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/></svg>`);
  dot('a', m.x0, m.y0, '100%'); dot('b', m.x1, m.y1, '0%');
 } else {
  const [cx, cy] = toScreen(m.cx, m.cy), ring = document.createElement('div'); ring.className = 'ring';
  Object.assign(ring.style, {left: cx - m.rx * 100 + '%', top: cy - m.ry * 100 + '%', width: m.rx * 200 + '%', height: m.ry * 200 + '%'}); box.append(ring);
  dot('c', m.cx, m.cy); dot('rx', m.cx + (live && camera.facing === 'user' ? -m.rx : m.rx), m.cy, '↔'); dot('ry', m.cx, m.cy + m.ry, '↕');
 }
}
let handleDrag = null;
$('handles').addEventListener('pointerdown', e => {
 const h = e.target.closest('.handle'), m = selectedMask(); if (!h || !m) return;
 e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId);
 const [x, y] = fromPointer(e); handleDrag = {name: h.dataset.handle, m, x, y, start: structuredClone(m)};
});
$('handles').addEventListener('pointermove', e => {
 if (!handleDrag) return; const {name, m, start} = handleDrag, [x, y] = fromPointer(e), dx = x - handleDrag.x, dy = y - handleDrag.y;
 if (name === 'a') {m.x0 = start.x0 + dx; m.y0 = start.y0 + dy;}
 if (name === 'b') {m.x1 = start.x1 + dx; m.y1 = start.y1 + dy;}
 if (name === 'c') {m.cx = start.cx + dx; m.cy = start.cy + dy;}
 if (name === 'rx') m.rx = Math.max(.02, Math.abs(x - m.cx));
 if (name === 'ry') m.ry = Math.max(.02, Math.abs(y - m.cy));
 studio.dirty = true; drawHandles(); requestDraw();
});
const endHandle = () => {if (handleDrag) {handleDrag = null; renderStudio();}};
$('handles').addEventListener('pointerup', endHandle); $('handles').addEventListener('pointercancel', endHandle);

// ---------- wiring ----------
$('shutter').onclick = shoot;
$('startCamera').onclick = () => startCamera();
$('idleHQ').onclick = nativeCapture; $('idleImport').onclick = () => $('photoInput').click();
$('flip').onclick = () => startCamera(camera.facing === 'user' ? 'environment' : 'user');
$('hqToggle').onclick = () => {prefs.hq = !prefs.hq; savePrefs(); updateControls(); toast(prefs.hq ? 'HQ 開啟：快門會打開系統相機，用最高畫質拍，回來自動沖印' : 'HQ 關閉：直接用取景畫面拍攝');};
$('hudLook').onclick = () => openParam('');
document.addEventListener('keydown', e => {if (e.target.closest('input, [role=slider]')) return; if (e.code === 'Space' || e.key === 'Enter' && e.target === document.body) {e.preventDefault(); shoot();} if (e.key === 'Escape') {if (studio) closeStudio(); else if (!$('viewer').hidden) $('viewerBack').click(); else if (!$('roll').hidden) closeSheet('roll'); else openParam('');}});
document.addEventListener('visibilitychange', () => {if (document.hidden && (live || pending)) {stopCamera(); resumeAfterNative = resumeAfterNative || 'visibility';} else if (!document.hidden && resumeAfterNative === 'visibility') {resumeAfterNative = false; startCamera();}});
window.addEventListener('pagehide', () => camera.stop());

buildParams(); buildReel(); updateControls(); layout();
shots().then(list => {setRollThumb(list[0]?.thumb); refreshRollCount();});
persist();
// Re-open the camera automatically when permission was already granted.
(async () => {try {const s = await navigator.permissions?.query({name: 'camera'}); if (s?.state === 'granted' || (s == null && store.get('eigacam.cameraGranted'))) startCamera();} catch {}})();
// Bake the other looks while idle so swiping between them is instant.
const idle = globalThis.requestIdleCallback ?? (f => setTimeout(f, 200));
LOOKS.forEach((l, i) => idle(() => lutFor(l.id), {timeout: 2000 + i * 300}));
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
