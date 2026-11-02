import {Renderer} from './engine/renderer.js';
import {CameraSession, fitInside} from './camera.js';
import {LOOKS, findLook} from './looks.js';
import {bakeLook, parseCube, cropFor, outputSize} from './color.js';
import {develop, renderSettings} from './develop.js';
import {addShot, updateShot, listShots, getFile, deleteShots, persist} from './roll.js';
import {canSharePhoto, sharePhoto} from './photo-delivery.js';
import {canvasBlob, download} from './files.js';

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
 {key: 'sharpen', code: 'SHARP', label: '銳利', min: 0, max: 100, step: 5, def: 35, fmt: v => String(v)}
];
const ASPECTS = [{value: 0, label: '原生', code: 'FULL'}, {value: 16 / 9, label: '16:9', code: 'HDTV'}, {value: 1.85, label: '1.85', code: 'FLAT'}, {value: 2.39, label: '2.39', code: 'SCOPE'}];
const defaults = Object.fromEntries([['look', 'nightcity'], ['hq', false], ...PARAMS.map(p => [p.key, p.def])]);
const store = {get(k) {try {return JSON.parse(localStorage.getItem(k));} catch {return null;}}, set(k, v) {try {localStorage.setItem(k, JSON.stringify(v));} catch {}}};
const prefs = {...defaults, ...(store.get('eigacam.prefs') ?? {})};
const savePrefs = () => store.set('eigacam.prefs', prefs);
const dials = () => Object.fromEntries(PARAMS.filter(p => p.type !== 'aspect').map(p => [p.key, prefs[p.key]]));

// ---------- looks & LUTs ----------
let custom = null; // {look, lut}
try {const saved = localStorage.getItem('eigacam.cube'); if (saved) {const lut = parseCube(saved); custom = {lut, look: customLook(lut)};}} catch {}
function customLook(lut) {return {id: 'custom', code: 'LUT', name: '自訂 LUT', en: (lut.title || 'CUSTOM CUBE').toUpperCase().slice(0, 24), swatch: ['#222', '#777', '#ddd'], desc: '你匯入的 .cube LUT。', grain: {amount: .04, size: 1.5}, glow: {halation: .1, bloom: .05, hue: 20}};}
const allLooks = () => custom ? [...LOOKS, custom.look] : LOOKS;
const lookById = id => id === 'custom' && custom ? custom.look : findLook(id);
const luts = new Map();
function lutFor(id) {if (id === 'custom' && custom) return custom.lut; if (!luts.has(id)) luts.set(id, bakeLook(findLook(id))); return luts.get(id);}
if (prefs.look !== 'custom' || !custom) prefs.look = findLook(prefs.look).id; // removed looks fall back to the first one

// ---------- UI helpers ----------
let toastTimer;
function toast(text) {$('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3600);}
const guard = fn => async (...a) => {try {await fn(...a);} catch (e) {console.error(e); toast(e.message || '發生錯誤，請再試一次。');}};

// ---------- preview renderer ----------
let preview = null, live = false, pending = false, frameHandle = 0, idleSource = null;
function ensurePreview() {if (!preview) preview = new Renderer($('preview')); return preview;}
$('preview').addEventListener('engine-error', e => toast(e.detail));
function sourceSize() {return live ? {width: video.videoWidth, height: video.videoHeight} : idleSource ?? {width: 3, height: 4};}

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
 if (preview && live) {
  const dpr = Math.min(devicePixelRatio || 1, 3), size = fitInside(Math.round(w * dpr), Math.round(h * dpr), 1600);
  const fit = fitInside(src.width, src.height, Math.max(size.width, size.height));
  try {preview.resize(fit.width, fit.height);} catch (e) {toast(e.message);}
 }
}
new ResizeObserver(layout).observe($('viewfinder'));

function drawPreview() {
 if (!preview || !live || video.readyState < 2) return;
 const look = lookById(prefs.look);
 preview.setSource(video); preview.setLUT(lutFor(look.id));
 preview.render(renderSettings(look, dials(), {mirror: camera.facing === 'user', grainSeed: [Math.random() * 999, Math.random() * 999]}));
}
function loop() {
 if (!live) return;
 try {drawPreview();} catch (e) {stopCamera(); toast(e.message); return;}
 frameHandle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
}

// ---------- camera lifecycle ----------
function setState(name) {$('hudState').textContent = name; $('app').dataset.state = name.toLowerCase();}
function updateControls() {
 $('flip').disabled = !live; $('vfIdle').hidden = live || pending; $('frame').hidden = !live;
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
  ensurePreview(); live = true;
  stream.getVideoTracks().forEach(t => t.onended = () => {if (live) {stopCamera(); toast('相機已停止');}});
  layout(); setupZoom(); loop();
  store.set('eigacam.cameraGranted', true);
 } catch (e) {stopCamera(); $('idleText').textContent = e.message; toast(e.message);}
 finally {pending = false; updateControls();}
}
function stopCamera() {
 live = false; camera.stop();
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
   const out = await develop(job.blob, {lut: lutFor(look.id), ratio: job.ratio, settings: renderSettings(look, job.dials, {mirror: job.mirror})});
   const shot = {id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: Date.now(), look: look.id, lookName: look.name, dials: job.dials, ratio: job.ratio, mirror: job.mirror, width: out.width, height: out.height, thumb: out.thumb};
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
 const job = {look: prefs.look, dials: dials(), ratio: prefs.ratio, mirror: camera.facing === 'user'};
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
 for (const blob of list) enqueue({blob, look: prefs.look, dials: dials(), ratio: prefs.ratio, mirror: false});
 if (list.length) toast(`${label} ${list.length} 張，正以「${lookById(prefs.look).name}」沖印`);
}
const resume = () => {const r = resumeAfterNative; resumeAfterNative = false; if (r) startCamera();};
$('captureInput').addEventListener('change', e => {importFiles(e.target.files, 'HQ 拍攝'); e.target.value = ''; resume();});
$('captureInput').addEventListener('cancel', resume);
$('photoInput').addEventListener('change', e => {importFiles(e.target.files, '已匯入'); e.target.value = '';});

// ---------- look reel ----------
let flashTimer;
function selectLook(id, announce = true) {
 prefs.look = id; savePrefs(); const look = lookById(id);
 $('hudLook').textContent = `${look.code} ${look.en}`;
 document.querySelectorAll('#reel .look').forEach(b => {const on = b.dataset.look === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); if (on) b.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'smooth'});});
 if (announce && live) {const f = $('lookFlash'); f.innerHTML = `<b>${look.code}</b><strong>${look.name}</strong><span>${look.en}</span>`; f.classList.add('on'); clearTimeout(flashTimer); flashTimer = setTimeout(() => f.classList.remove('on'), 1100);}
 if (!live) drawPreview();
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
$('viewfinder').addEventListener('pointerdown', e => {if (e.target.closest('button')) return; swipe = {x: e.clientX, y: e.clientY};});
$('viewfinder').addEventListener('pointerup', e => {
 if (!swipe) return; const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
 if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
 const list = allLooks(), i = list.findIndex(l => l.id === prefs.look);
 selectLook(list[(i + (dx < 0 ? 1 : -1) + list.length) % list.length].id);
});

// ---------- parameter strip, ruler dial, aspect picker ----------
let activeParam = '';
function paramText(p) {return p.type === 'aspect' ? (ASPECTS.find(a => a.value === prefs.ratio) ?? ASPECTS[0]).label : p.fmt(prefs[p.key]);}
function buildParams() {
 $('params').replaceChildren(...PARAMS.map(p => {
  const b = document.createElement('button'); b.className = 'param'; b.dataset.param = p.key; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span>${p.label}</span><b></b>`; b.onclick = () => openParam(activeParam === p.key ? '' : p.key); return b;
 }));
 syncParams();
}
function syncParams() {
 document.querySelectorAll('.param').forEach(b => {const p = PARAMS.find(x => x.key === b.dataset.param); b.querySelector('b').textContent = paramText(p); b.classList.toggle('changed', prefs[p.key] !== p.def); b.setAttribute('aria-pressed', activeParam === p.key); b.classList.toggle('active', activeParam === p.key);});
}
function openParam(key) {
 activeParam = key; const p = PARAMS.find(x => x.key === key);
 $('reel').hidden = !!key; $('dial').hidden = !p || p.type === 'aspect'; $('aspects').hidden = p?.type !== 'aspect';
 if (p && p.type !== 'aspect') {$('dialLabel').textContent = `${p.label} · ${p.code}`; drawRuler();}
 if (p?.type === 'aspect') buildAspects();
 if (!key) selectLook(prefs.look, false);
 syncParams();
}
const ppu = p => 720 / ((p.max - p.min) / p.step) / p.step; // pixels per unit: whole range ≈ 720px
function drawRuler() {
 const p = PARAMS.find(x => x.key === activeParam); if (!p || p.type) return;
 const track = $('rulerTrack'), k = ppu(p), minor = p.step * k, major = minor * ((p.max - p.min) / p.step >= 100 ? 10 : 5);
 track.style.width = (p.max - p.min) * k + 'px';
 track.style.setProperty('--minor', minor + 'px'); track.style.setProperty('--major', major + 'px');
 track.style.transform = `translateX(${-(prefs[p.key] - p.min) * k}px)`;
 track.style.setProperty('--zero', (p.def - p.min) * k + 'px');
 $('dialValue').textContent = p.fmt(prefs[p.key]);
 $('ruler').setAttribute('aria-valuemin', p.min); $('ruler').setAttribute('aria-valuemax', p.max); $('ruler').setAttribute('aria-valuenow', prefs[p.key]); $('ruler').setAttribute('aria-label', p.label);
}
function setParam(p, v) {
 v = Math.round(Math.min(p.max, Math.max(p.min, v)) / p.step) * p.step; v = Number(v.toFixed(2));
 if (v === prefs[p.key]) return; prefs[p.key] = v; savePrefs(); drawRuler(); syncParams();
 if (Math.abs(v - p.def) < 1e-9) navigator.vibrate?.(6);
}
let drag = null;
$('ruler').addEventListener('pointerdown', e => {const p = PARAMS.find(x => x.key === activeParam); if (!p) return; drag = {x: e.clientX, v: prefs[p.key], p}; $('ruler').setPointerCapture(e.pointerId);});
$('ruler').addEventListener('pointermove', e => {if (drag) setParam(drag.p, drag.v - (e.clientX - drag.x) / ppu(drag.p));});
const endDrag = () => {drag = null;}; $('ruler').addEventListener('pointerup', endDrag); $('ruler').addEventListener('pointercancel', endDrag);
$('ruler').addEventListener('keydown', e => {const p = PARAMS.find(x => x.key === activeParam); if (!p) return; const d = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1}[e.key]; if (d) {e.preventDefault(); setParam(p, prefs[p.key] + d * p.step * (e.shiftKey ? 10 : 1));}});
$('dialReset').onclick = () => {const p = PARAMS.find(x => x.key === activeParam); if (p) setParam(p, p.def);};
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
  Object.assign(shot, {look: look.id, lookName: look.name, thumb: out.thumb, width: out.width, height: out.height});
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

// ---------- wiring ----------
$('shutter').onclick = shoot;
$('startCamera').onclick = () => startCamera();
$('idleHQ').onclick = nativeCapture; $('idleImport').onclick = () => $('photoInput').click();
$('flip').onclick = () => startCamera(camera.facing === 'user' ? 'environment' : 'user');
$('hqToggle').onclick = () => {prefs.hq = !prefs.hq; savePrefs(); updateControls(); toast(prefs.hq ? 'HQ 開啟：快門會打開系統相機，用最高畫質拍，回來自動沖印' : 'HQ 關閉：直接用取景畫面拍攝');};
$('hudLook').onclick = () => openParam('');
document.addEventListener('keydown', e => {if (e.target.closest('input, [role=slider]')) return; if (e.code === 'Space' || e.key === 'Enter' && e.target === document.body) {e.preventDefault(); shoot();} if (e.key === 'Escape') {if (!$('viewer').hidden) $('viewerBack').click(); else if (!$('roll').hidden) closeSheet('roll'); else openParam('');}});
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
