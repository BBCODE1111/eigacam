import {StudioRenderer, BRUSH_LAYERS} from './engine.js';
import {Library} from './library.js';
import {importSources, decodeText, extOf} from './importer.js';
import {parseXmp, XMP_FIELDS} from './xmp.js';
import {parseCube} from './cube.js';
import {bakeGrade} from './lr.js';
import {compileLook, parseRecipeFile, describeLook, BUILTIN} from './recipe.js';
import {pointCurve} from '../../src/color.js';
import {decodeImage, release, canvasBlob, download} from '../../src/files.js';
import {canSharePhoto, sharePhoto} from '../../src/photo-delivery.js';
import {zipSync, deflateSync, inflateSync} from '../vendor/fflate.js';

const $ = id => document.getElementById(id);
const mobile = () => matchMedia('(max-width:860px)').matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const signed = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const stem = n => n.replace(/\.[a-z0-9]+$/i, '');
let toastTimer; function toast(text) {const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);}
const busy = text => {$('busy').hidden = !text; if (text) $('busyText').textContent = text;};

// ---------- state ----------
const IDENTITY = () => ({m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]]});
const newAdjust = () => ({exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, saturation: 0, curve: IDENTITY()});
const state = {styleId: null, strength: 100, adjust: newAdjust(), masks: [], sel: null};
const ui = {query: '', pack: '', favOnly: false, overlay: true, erase: false, compare: false, channel: 'm', z: 1, tx: 0, ty: 0};
let lib, mainR, thumbR, photo = null, current = null, styleToken = 0, exporting = false;
let brushCanvas = new Map(), brushData = new Map(); // mask id → canvas / last committed alpha
let history = [], hIndex = -1;

// ---------- styles ----------
function camStyles() {
 const out = BUILTIN.map(l => ({id: 'cam:' + l.id, name: l.name, pack: 'EIGACAM 內建', kind: 'eigacam', def: l, status: 'ok', notes: [], tags: {}, virtual: true}));
 try {
  for (const r of JSON.parse(localStorage.getItem('eigacam.recipes') ?? '[]')) {
   const def = {base: r.base, masks: r.masks, name: r.name};
   try {const d = describeLook(def); out.push({id: 'camr:' + r.id, name: d.name, pack: 'CAM 我的配方', kind: 'eigacam', def, status: 'ok', notes: d.notes, tags: {}, virtual: true});} catch {}
  }
  for (const x of JSON.parse(localStorage.getItem('eigacam.imports') ?? '[]')) {
   try {const p = parseXmp(x.text); out.push({id: 'camx:' + x.id, name: String(x.name ?? p.name ?? 'XMP'), pack: 'CAM 匯入', kind: 'xmp', text: x.text, status: p.partial ? 'partial' : 'ok', notes: p.notes, tags: {}, virtual: true});} catch {}
  }
 } catch {}
 return out;
}
let virtual = [];
const allStyles = () => [...lib.styles, ...virtual];
const styleById = id => id ? allStyles().find(s => s.id === id) : null;

const compiled = new Map();
async function compile(style, size) {
 const key = style.id + ':' + (style.kind === 'cube' ? 0 : size);
 let c = compiled.get(key);
 if (c) {compiled.delete(key); compiled.set(key, c); return c;}
 const text = style.text ?? (style.def ? null : decodeText(await lib.source(style.hash)));
 if (style.kind === 'xmp') {const x = parseXmp(text); c = {lut: bakeGrade(x.grade, size), masks: x.masks.map((m, i) => ({...m, id: 's' + i})), vignette: x.vignette, grain: x.grain};}
 else if (style.kind === 'cube') c = {lut: parseCube(text, style.file).lut, masks: [], vignette: 0, grain: {amount: 0, size: 1.5}};
 else c = compileLook(style.def ?? parseRecipeFile(text)[style.sub ?? 0], size);
 compiled.set(key, c);
 if (compiled.size > 64) compiled.delete(compiled.keys().next().value);
 return c;
}
async function loadCurrentStyle() {
 const style = styleById(state.styleId), token = ++styleToken;
 if (!style) {state.styleId = null; current = null; draw(); renderStyleInfo(); markSelected(); return;}
 try {current = await compile(style, 17);} catch (e) {toast('無法套用這個風格：' + e.message); current = null;}
 if (token !== styleToken) return;
 draw(); renderStyleInfo(); markSelected();
 if (style.kind !== 'cube' && current) setTimeout(async () => { // fast preview first, then the full-precision table
  if (token !== styleToken) return;
  try {const hi = await compile(style, 33); if (token === styleToken) {current = hi; draw();}} catch {}
 }, 80);
}
async function selectStyle(id) {if ((state.styleId ?? '') === (id ?? '')) return; state.styleId = id || null; await loadCurrentStyle(); commit();}

// ---------- rendering ----------
function curveTable() {
 const c = state.adjust.curve;
 if (Object.values(c).every(p => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1)) return null;
 const t = new Float32Array(1024);
 for (let i = 0; i < 256; i++) {const m = pointCurve(c.m, i / 255); t[i * 4] = pointCurve(c.r, m); t[i * 4 + 1] = pointCurve(c.g, m); t[i * 4 + 2] = pointCurve(c.b, m); t[i * 4 + 3] = 1;}
 return t;
}
function renderMasks() {let layer = 0; return state.masks.map(m => m.type === 'brush' ? {...m, layer: layer++} : m);}
const params = (source, width, height, extra = {}) => ({source, width, height, style: current, strength: state.strength / 100, adjust: state.adjust, masks: renderMasks(), ...extra});
const overlayId = () => ui.overlay && document.body.dataset.tab === 'masks' ? state.sel : null;
function renderNow() {if (photo) mainR.render(params('preview', photo.pw, photo.ph, {view: overlayId(), bypass: ui.compare}));}
let drawPending = false;
function draw() {if (drawPending || !photo) return; drawPending = true; requestAnimationFrame(() => {drawPending = false; try {renderNow();} catch (e) {toast(e.message);}});}
function syncBrushLayers(r = mainR) {let layer = 0; for (const m of state.masks) if (m.type === 'brush') {const c = brushCanvas.get(m.id); if (c) r.setBrushLayer(layer, c); layer++;}}

// ---------- photo ----------
function scaled(image, edge) {
 const s = Math.min(1, edge / Math.max(image.width, image.height)), c = document.createElement('canvas');
 c.width = Math.max(1, Math.round(image.width * s)); c.height = Math.max(1, Math.round(image.height * s));
 const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(image, 0, 0, c.width, c.height); return c;
}
async function loadPhoto(blob, name, saved = null) {
 busy('讀取照片');
 try {
  const d = await decodeImage(blob, mainR.maxEdge, mainR.maxPixels);
  const preview = scaled(d.image, mobile() ? 1440 : 2048), thumb = scaled(d.image, 300);
  const bs = 1024 / Math.max(d.width, d.height);
  photo = {blob, name, width: d.width, height: d.height, pw: preview.width, ph: preview.height, tw: Math.round(thumb.width / 1.6), th: Math.round(thumb.height / 1.6), bw: Math.max(1, Math.round(d.width * bs)), bh: Math.max(1, Math.round(d.height * bs))};
  release(d.image);
  mainR.setSource('preview', preview); thumbR.setSource('thumb', thumb);
  preview.width = thumb.width = 1;
  brushCanvas = new Map(); brushData = new Map(); mainR.setBrushSize(photo.bw, photo.bh);
  Object.assign(state, {adjust: newAdjust(), masks: [], sel: null});
  if (saved) restoreSaved(saved);
  history = []; hIndex = -1;
  $('empty').hidden = true; $('view').hidden = false;
  for (const id of ['exportBtn', 'compare']) $(id).disabled = false;
  ui.z = 1; ui.tx = ui.ty = 0; fit(); syncBrushLayers(); updateCurve(); syncPanels();
  await loadCurrentStyle(); commit(false);
  renderGrid();
  if (!saved) lib.setMeta('photo', {blob, name}).catch(() => {});
 } catch (e) {toast(e.message || '無法開啟這張照片');}
 finally {busy(null);}
}

// ---------- history & session ----------
const snapshot = () => ({json: JSON.stringify(state), brush: new Map(brushData)});
function commit(save = true) {
 const s = snapshot(), top = history[hIndex];
 if (top && top.json === s.json && top.brush.size === s.brush.size && [...s.brush].every(([k, v]) => top.brush.get(k) === v)) return;
 history.splice(hIndex + 1); history.push(s); if (history.length > 60) history.shift(); hIndex = history.length - 1;
 updateUndo(); if (save) saveSoon();
}
function applySnapshot(s) {
 Object.assign(state, JSON.parse(s.json));
 for (const m of state.masks) if (m.type === 'brush') {const data = s.brush.get(m.id); if (data && (brushData.get(m.id) !== data || !brushCanvas.has(m.id))) paintAlpha(brushOf(m.id), data);}
 brushData = new Map(s.brush);
 for (const id of [...brushCanvas.keys()]) if (!state.masks.some(m => m.id === id)) brushCanvas.delete(id);
 syncBrushLayers(); updateCurve(); syncPanels(); loadCurrentStyle();
}
function step(d) {const i = hIndex + d; if (i < 0 || i >= history.length) return; hIndex = i; applySnapshot(history[i]); updateUndo(); saveSoon();}
function updateUndo() {$('undo').disabled = hIndex <= 0; $('redo').disabled = hIndex >= history.length - 1;}
let saveTimer;
function saveSoon() {
 clearTimeout(saveTimer);
 saveTimer = setTimeout(() => {
  if (!photo) return;
  const brush = {}; for (const [id, data] of brushData) brush[id] = deflateSync(data, {level: 1});
  lib.setMeta('edit', {json: JSON.stringify(state), brush, bw: photo.bw, bh: photo.bh}).catch(() => {});
 }, 500);
}
function restoreSaved(saved) {
 try {
  const s = JSON.parse(saved.json); Object.assign(state, {...s, adjust: {...newAdjust(), ...s.adjust}});
  for (const m of state.masks) if (m.type === 'brush' && saved.brush?.[m.id] && saved.bw === photo.bw && saved.bh === photo.bh) {const data = inflateSync(saved.brush[m.id]); paintAlpha(brushOf(m.id), data); brushData.set(m.id, data);}
 } catch {}
}

// ---------- brush ----------
function brushOf(id) {
 let c = brushCanvas.get(id);
 if (!c) {c = document.createElement('canvas'); c.width = photo.bw; c.height = photo.bh; c.getContext('2d', {willReadFrequently: true}); brushCanvas.set(id, c);}
 return c;
}
function alphaOf(c) {const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]; return a;}
function paintAlpha(c, a) {const x = c.getContext('2d'), im = x.createImageData(c.width, c.height), d = im.data; for (let i = 0; i < a.length; i++) {d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a[i];} x.putImageData(im, 0, 0);}
function stamp(ctx, x, y, r, feather, erase) {
 const g = ctx.createRadialGradient(x, y, r * Math.min(.97, 1 - feather), x, y, r);
 g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
 ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}
const selected = () => state.masks.find(m => m.id === state.sel) ?? null;
const canPaint = () => {const m = selected(); return !!photo && document.body.dataset.tab === 'masks' && m?.type === 'brush';};
// Pointer position in image space (0..1), read from the canvas as it is drawn on screen — zoom and pan included.
function imagePoint(e) {const r = $('canvas').getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];}
let stroke = null;
function strokeStart(e) {
 const m = selected(), c = brushOf(m.id), [u, v] = imagePoint(e);
 stroke = {m, c, ctx: c.getContext('2d'), x: u * c.width, y: v * c.height, before: brushData.get(m.id) ?? null, layer: state.masks.filter(k => k.type === 'brush').indexOf(m)};
 for (let i = 0; i < 3; i++) strokeStamp(stroke.x, stroke.y);
 strokeFlush();
}
function strokeStamp(x, y) {const {m, c, ctx} = stroke; stamp(ctx, x, y, Math.max(1, m.size / 100 * Math.min(c.width, c.height) / 2), m.feather / 100, ui.erase);}
function strokeMove(e) {
 const {c} = stroke, [u, v] = imagePoint(e), x = u * c.width, y = v * c.height, r = Math.max(1, stroke.m.size / 100 * Math.min(c.width, c.height) / 2);
 const dist = Math.hypot(x - stroke.x, y - stroke.y), gap = Math.max(1, r * .2);
 if (dist < gap) return;
 for (let d = gap; d <= dist; d += gap) strokeStamp(stroke.x + (x - stroke.x) * d / dist, stroke.y + (y - stroke.y) * d / dist);
 stroke.x = x; stroke.y = y; strokeFlush();
}
function strokeFlush() {mainR.setBrushLayer(stroke.layer, stroke.c); draw();}
function strokeEnd(cancel) {
 if (!stroke) return; const s = stroke; stroke = null;
 if (cancel) {if (s.before) paintAlpha(s.c, s.before); else s.ctx.clearRect(0, 0, s.c.width, s.c.height); mainR.setBrushLayer(s.layer, s.c); draw(); return;}
 brushData.set(s.m.id, alphaOf(s.c)); commit();
}

// ---------- stage: fit, zoom, pan, paint ----------
let fitW = 1, fitH = 1, fitL = 0, fitT = 0;
function fit() {
 if (!photo) return;
 const r = $('stage').getBoundingClientRect(), pad = 6, s = Math.min((r.width - pad * 2) / photo.pw, (r.height - pad * 2) / photo.ph);
 fitW = photo.pw * s; fitH = photo.ph * s; fitL = (r.width - fitW) / 2; fitT = (r.height - fitH) / 2;
 Object.assign($('view').style, {width: fitW + 'px', height: fitH + 'px', left: fitL + 'px', top: fitT + 'px'});
 applyZoom(); renderHandles();
}
function applyZoom() {
 ui.z = clamp(ui.z, 1, 8); ui.tx = clamp(ui.tx, -(ui.z - 1) * fitW, 0); ui.ty = clamp(ui.ty, -(ui.z - 1) * fitH, 0);
 $('view').style.transform = `translate(${ui.tx}px,${ui.ty}px) scale(${ui.z})`;
 $('zoomBadge').hidden = ui.z <= 1.01; $('zoomBadge').textContent = Math.round(ui.z * 100) + '%';
 for (const h of $('handles').querySelectorAll('.h')) h.setAttribute('r', 9 / ui.z);
}
function zoomAt(px, py, z) { // keep the image point under (px,py) (stage coordinates) in place
 z = clamp(z, 1, 8); const ux = (px - fitL - ui.tx) / ui.z, uy = (py - fitT - ui.ty) / ui.z;
 ui.z = z; ui.tx = px - fitL - z * ux; ui.ty = py - fitT - z * uy; applyZoom();
}
const pointers = new Map(); let gesture = null;
function stagePoint(e) {const r = $('stage').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top];}
function initStage() {
 const stage = $('stage');
 stage.addEventListener('pointerdown', e => {
  if (!photo || e.target.closest('.h,.hit,button')) return;
  stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, stagePoint(e));
  if (pointers.size === 2) {
   strokeEnd(true); const [a, b] = [...pointers.values()];
   gesture = {type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: ui.z, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2};
  } else if (pointers.size === 1) {
   if (canPaint() && e.button === 0) {gesture = {type: 'paint'}; strokeStart(e);}
   else gesture = {type: 'pan', x: e.clientX, y: e.clientY, tx: ui.tx, ty: ui.ty};
  }
 });
 stage.addEventListener('pointermove', e => {
  cursor(e);
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, stagePoint(e));
  if (gesture?.type === 'paint' && stroke) {for (const c of e.getCoalescedEvents?.() ?? [e]) strokeMove(c);}
  else if (gesture?.type === 'pan') {ui.tx = gesture.tx + e.clientX - gesture.x; ui.ty = gesture.ty + e.clientY - gesture.y; applyZoom();}
  else if (gesture?.type === 'pinch' && pointers.size >= 2) {
   const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
   ui.tx += mx - gesture.mx; ui.ty += my - gesture.my; gesture.mx = mx; gesture.my = my;
   zoomAt(mx, my, gesture.z * d / Math.max(1, gesture.d));
  }
 });
 const end = e => {
  if (!pointers.delete(e.pointerId)) return;
  if (gesture?.type === 'paint') strokeEnd(e.type === 'pointercancel');
  gesture = pointers.size ? {type: 'none'} : null;
 };
 stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
 stage.addEventListener('pointerleave', () => {$('brushCursor').hidden = true;});
 stage.addEventListener('wheel', e => {if (!photo) return; e.preventDefault(); const [x, y] = stagePoint(e); zoomAt(x, y, ui.z * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0018))); cursor(e);}, {passive: false});
 stage.addEventListener('dblclick', e => {if (canPaint() || !photo) return; const [x, y] = stagePoint(e); zoomAt(x, y, ui.z > 1.01 ? 1 : 2.5);});
 new ResizeObserver(fit).observe(stage);
}
function cursor(e) {
 const el = $('brushCursor'), m = selected();
 if (!canPaint() || e.pointerType === 'touch') {el.hidden = true; return;}
 const r = $('canvas').getBoundingClientRect(), [x, y] = stagePoint(e), d = m.size / 100 * Math.min(r.width, r.height);
 Object.assign(el.style, {left: x + 'px', top: y + 'px', width: d + 'px', height: d + 'px'}); el.hidden = false;
}

// ---------- gradient handles ----------
function renderHandles() {
 const svg = $('handles'), m = selected();
 svg.setAttribute('viewBox', `0 0 ${fitW} ${fitH}`);
 if (!photo || !m || m.type === 'brush' || document.body.dataset.tab !== 'masks') {svg.innerHTML = ''; return;}
 const X = v => v * fitW, Y = v => v * fitH, r = 9 / ui.z;
 const dot = (key, x, y, big) => `<circle class="h" data-h="${key}" cx="${X(x)}" cy="${Y(y)}" r="${r}" stroke-width="${1 / ui.z}" ${big ? '' : 'fill-opacity=".55"'}/>`;
 svg.innerHTML = m.type === 'linear'
  ? `<line x1="${X(m.x0)}" y1="${Y(m.y0)}" x2="${X(m.x1)}" y2="${Y(m.y1)}"/>${dot('p0', m.x0, m.y0, true)}${dot('p1', m.x1, m.y1)}`
  : `<ellipse cx="${X(m.cx)}" cy="${Y(m.cy)}" rx="${X(m.rx)}" ry="${Y(m.ry)}"/>${dot('c', m.cx, m.cy, true)}${dot('rx', m.cx + m.rx, m.cy)}${dot('ry', m.cx, m.cy + m.ry)}`;
}
function initHandles() {
 const svg = $('handles'); let drag = null;
 svg.addEventListener('pointerdown', e => {const h = e.target.closest('.h'); if (!h) return; e.stopPropagation(); e.preventDefault(); drag = h.dataset.h; svg.setPointerCapture(e.pointerId);});
 svg.addEventListener('pointermove', e => {
  if (!drag) return; const m = selected(); if (!m) return; const [u, v] = imagePoint(e);
  if (drag === 'p0') {m.x0 = u; m.y0 = v;} else if (drag === 'p1') {m.x1 = u; m.y1 = v;}
  else if (drag === 'c') {m.cx = u; m.cy = v;} else if (drag === 'rx') m.rx = Math.max(.02, Math.abs(u - m.cx)); else m.ry = Math.max(.02, Math.abs(v - m.cy));
  renderHandles(); draw();
 });
 const end = () => {if (drag) {drag = null; commit();}};
 svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
}

// ---------- sliders ----------
function slider(parent, {label, min, max, step, fmt, get, set, reset = 0}) {
 const el = document.createElement('div'); el.className = 'slider';
 el.innerHTML = `<label>${label}</label><output></output><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}">`;
 const input = el.querySelector('input'), out = el.querySelector('output');
 const sync = () => {const v = get(); input.value = v; out.textContent = fmt(v);};
 input.addEventListener('input', () => {set(Number(input.value)); out.textContent = fmt(Number(input.value)); draw();});
 input.addEventListener('change', () => commit());
 el.querySelector('label').addEventListener('dblclick', () => {set(reset); sync(); draw(); commit();});
 parent.append(el); return sync;
}
const ADJUST = [['exposure', '曝光', -3, 3, .05, v => signed(v, 2)], ['contrast', '對比', -100, 100, 1, signed], ['highlights', '高光', -100, 100, 1, signed], ['shadows', '陰影', -100, 100, 1, signed], ['temp', '色溫', -100, 100, 1, signed], ['tint', '色調', -100, 100, 1, signed], ['saturation', '飽和度', -100, 100, 1, signed]];
const MASK_ADJ = [['ev', '曝光', -4, 4, .05, v => signed(v, 2)], ['temp', '色溫', -100, 100, 1, signed], ['tint', '色調', -100, 100, 1, signed], ['sat', '飽和度', -100, 100, 1, signed], ['contrast', '對比', -100, 100, 1, signed]];
let syncers = [], maskSyncers = [];
function initPanels() {
 syncers = ADJUST.map(([key, label, min, max, st, fmt]) => slider($('adjustSliders'), {label, min, max, step: st, fmt, get: () => state.adjust[key], set: v => {state.adjust[key] = v;}}));
 $('adjustReset').onclick = () => {state.adjust = newAdjust(); updateCurve(); syncPanels(); draw(); commit();};
 const ms = $('maskSliders'), geo = (key, label, min, max, fmt, reset) => {
  const sync = slider(ms, {label, min, max, step: 1, fmt, reset, get: () => selected()?.[key] ?? reset, set: v => {const m = selected(); if (m) m[key] = v;}});
  const el = ms.lastElementChild; el.dataset.geo = key; return sync;
 };
 maskSyncers = [geo('size', '筆刷大小', 2, 60, v => Math.round(v) + '%', 18), geo('feather', '羽化', 0, 100, v => Math.round(v) + '%', 60),
  ...MASK_ADJ.map(([key, label, min, max, st, fmt]) => slider(ms, {label, min, max, step: st, fmt, get: () => selected()?.adj[key] ?? 0, set: v => {const m = selected(); if (!m) return; m.adj[key] = v; if (ui.overlay) {ui.overlay = false; $('maskOverlay').setAttribute('aria-pressed', 'false');}}}))];
 document.querySelector('.add-mask').addEventListener('click', e => {const t = e.target.closest('[data-add]')?.dataset.add; if (t) addMask(t);});
 $('maskList').addEventListener('click', e => {const id = e.target.closest('[data-id]')?.dataset.id; if (id) {state.sel = id; syncPanels(); draw();}});
 $('brushMode').addEventListener('click', e => {const b = e.target.closest('[data-mode]'); if (!b) return; ui.erase = b.dataset.mode === 'erase'; syncPanels();});
 $('maskOverlay').onclick = () => {ui.overlay = !ui.overlay; syncPanels(); draw();};
 $('maskInvert').onclick = () => {const m = selected(); if (m) {m.invert = !m.invert; syncPanels(); draw(); commit();}};
 $('maskEnable').onclick = () => {const m = selected(); if (m) {m.enabled = !m.enabled; syncPanels(); draw(); commit();}};
 $('maskDelete').onclick = () => {const m = selected(); if (!m) return; state.masks = state.masks.filter(x => x !== m); brushCanvas.delete(m.id); brushData.delete(m.id); state.sel = state.masks.at(-1)?.id ?? null; syncBrushLayers(); syncPanels(); draw(); commit();};
 initCurve();
}
function addMask(type) {
 if (!photo) return toast('先選一張照片');
 if (state.masks.length >= BRUSH_LAYERS) return toast(`最多 ${BRUSH_LAYERS} 個遮色片`);
 const n = state.masks.filter(m => m.type === type).length + 1, id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
 const base = {id, type, enabled: true, invert: false, adj: {ev: 0, temp: 0, tint: 0, sat: 0, contrast: 0, hue: 0, amount: 0}};
 const m = type === 'brush' ? {...base, name: '筆刷 ' + n, size: 18, feather: 60} : type === 'linear' ? {...base, name: '線性 ' + n, x0: .5, y0: .12, x1: .5, y1: .6} : {...base, name: '放射 ' + n, cx: .5, cy: .45, rx: .26, ry: Math.min(.45, .26 * photo.pw / photo.ph), feather: 50};
 state.masks.push(m); state.sel = id; ui.overlay = true; ui.erase = false;
 if (type === 'brush') {brushOf(id); brushData.set(id, new Uint8Array(photo.bw * photo.bh));}
 syncBrushLayers(); syncPanels(); draw(); commit();
}
function syncPanels() {
 $('strength').value = state.strength; $('strengthOut').textContent = state.strength + '%';
 syncers.forEach(f => f()); drawCurve();
 const m = selected();
 $('maskList').innerHTML = state.masks.map(k => `<button data-id="${k.id}" role="option" aria-selected="${k.id === state.sel}" class="${k.enabled ? '' : 'off'}">${esc(k.name)}</button>`).join('');
 $('maskEditor').hidden = !m; $('maskHint').hidden = !!m;
 if (m) {
  $('brushMode').hidden = m.type !== 'brush';
  for (const b of $('brushMode').children) b.setAttribute('aria-pressed', String((b.dataset.mode === 'erase') === ui.erase));
  $('maskOverlay').setAttribute('aria-pressed', String(ui.overlay)); $('maskInvert').setAttribute('aria-pressed', String(m.invert)); $('maskEnable').setAttribute('aria-pressed', String(m.enabled));
  for (const el of $('maskSliders').querySelectorAll('[data-geo]')) el.hidden = el.dataset.geo === 'size' ? m.type !== 'brush' : m.type === 'linear';
  maskSyncers.forEach(f => f());
 }
 renderHandles();
}

// ---------- curve editor ----------
const CH = {m: '#e8e8ee', r: '#ff6b6b', g: '#6fd08c', b: '#6aa8ff'};
function updateCurve() {mainR.setCurve(curveTable());}
function drawCurve() {
 const svg = $('curve'), pts = state.adjust.curve[ui.channel];
 let d = ''; for (let i = 0; i <= 64; i++) d += `${i ? 'L' : 'M'}${(i / 64 * 100).toFixed(2)} ${(100 - pointCurve(pts, i / 64) * 100).toFixed(2)}`;
 svg.innerHTML = [25, 50, 75].map(v => `<line class="gridline" x1="${v}" y1="0" x2="${v}" y2="100"/><line class="gridline" x1="0" y1="${v}" x2="100" y2="${v}"/>`).join('') + `<line class="gridline" x1="0" y1="100" x2="100" y2="0"/><path d="${d}" stroke="${CH[ui.channel]}"/>` + pts.map((p, i) => `<circle data-i="${i}" cx="${p[0] * 100}" cy="${100 - p[1] * 100}" r="2.6" stroke="${CH[ui.channel]}"/>`).join('');
 for (const b of $('curveChannels').children) b.setAttribute('aria-pressed', String(b.dataset.ch === ui.channel));
}
function initCurve() {
 const svg = $('curve'); let drag = -1, removed = false;
 const at = e => {const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];};
 svg.addEventListener('pointerdown', e => {
  const pts = state.adjust.curve[ui.channel], [x, y] = at(e); svg.setPointerCapture(e.pointerId); removed = false;
  drag = pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < .07);
  if (drag < 0 && pts.length < 12) {const i = pts.findIndex(p => p[0] > x); if (i > 0 && x - pts[i - 1][0] > .03 && pts[i][0] - x > .03) {pts.splice(i, 0, [x, clamp(y, 0, 1)]); drag = i;}}
  updateCurve(); drawCurve(); draw();
 });
 svg.addEventListener('pointermove', e => {
  if (drag < 0 || removed) return; const pts = state.adjust.curve[ui.channel], [x, y] = at(e), end = drag === 0 || drag === pts.length - 1;
  if (!end && (y < -.18 || y > 1.18 || x < -.18 || x > 1.18)) {pts.splice(drag, 1); removed = true;}
  else pts[drag] = [end ? pts[drag][0] : clamp(x, pts[drag - 1][0] + .02, pts[drag + 1][0] - .02), clamp(y, 0, 1)];
  updateCurve(); drawCurve(); draw();
 });
 const end = () => {if (drag >= 0 || removed) {drag = -1; commit();}};
 svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
 $('curveChannels').addEventListener('click', e => {const c = e.target.closest('[data-ch]')?.dataset.ch; if (c) {ui.channel = c; drawCurve();}});
 $('curveReset').onclick = () => {state.adjust.curve[ui.channel] = [[0, 0], [1, 1]]; updateCurve(); drawCurve(); draw(); commit();};
}

// ---------- library grid & thumbnails ----------
let tiles = [], io = null, queue = new Set(), pumping = false, gen = 0;
function visibleStyles() {
 const q = ui.query.trim().toLowerCase();
 return allStyles().filter(s => (!q || s.name.toLowerCase().includes(q)) && (!ui.pack || s.pack === ui.pack || s.pack.startsWith(ui.pack + '/')) && (!ui.favOnly || lib.favorites.has(s.id)));
}
function renderPackFilter() {
 const counts = new Map();
 for (const s of allStyles()) {const parts = s.pack.split('/'); for (let i = 1; i <= parts.length; i++) {const p = parts.slice(0, i).join('/'); counts.set(p, (counts.get(p) ?? 0) + 1);}}
 if (ui.pack && !counts.has(ui.pack)) ui.pack = '';
 $('packFilter').innerHTML = `<option value="">全部風格（${allStyles().length}）</option>` + [...counts].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant')).map(([p, n]) => `<option value="${esc(p)}" ${p === ui.pack ? 'selected' : ''}>${'　'.repeat(p.split('/').length - 1)}${esc(p.split('/').pop())}（${n}）</option>`).join('');
}
function renderGrid() {
 const grid = $('styleGrid'); io?.disconnect(); queue.clear(); gen++; tiles = []; grid.textContent = '';
 io = new IntersectionObserver(entries => {
  for (const e of entries) {
   const t = tiles[e.target.dataset.i]; if (!t) continue;
   if (e.isIntersecting) {t.visible = true; if (!t.done) queue.add(t);}
   else {t.visible = false; queue.delete(t); if (t.done) {t.canvas.width = t.canvas.height = 1; t.done = false;}} // keep memory bounded for big libraries
  }
  pump();
 }, {root: grid, rootMargin: '300px'});
 const list = visibleStyles(), frag = document.createDocumentFragment();
 const add = (style, name) => {
  const el = document.createElement('div'), i = tiles.length, id = style?.id ?? '';
  el.className = 'tile'; el.dataset.i = i; el.dataset.id = id; el.tabIndex = 0; el.setAttribute('role', 'option'); el.setAttribute('aria-selected', String((state.styleId ?? '') === id)); el.title = name;
  const badges = style ? [style.tags?.log ? '<i>Log</i>' : '', style.status === 'partial' ? '<i>部分</i>' : ''].join('') : '';
  el.innerHTML = `<canvas width="1" height="1"></canvas><span class="t-name">${esc(name)}</span><span class="t-badges">${badges}</span>${style ? `<button class="t-fav" aria-label="收藏" aria-pressed="${lib.favorites.has(id)}">★</button>` : ''}`;
  tiles.push({el, style, canvas: el.firstChild, done: false, gen}); frag.append(el); io.observe(el);
 };
 if (!ui.query && !ui.favOnly) add(null, '原圖');
 let pack = null;
 for (const s of list) {
  if (s.pack !== pack) {pack = s.pack; const h = document.createElement('div'); h.className = 'pack-head'; h.textContent = pack; frag.append(h);}
  add(s, s.name);
 }
 if (!list.length) {const p = document.createElement('p'); p.className = 'empty-lib'; p.textContent = ui.query || ui.favOnly || ui.pack ? '沒有符合的風格。' : '還沒有匯入風格。按上方「匯入風格」，選多個 .xmp／.cube 檔或一個 ZIP。'; frag.append(p);}
 grid.append(frag); renderStyleInfo();
}
function markSelected() {for (const t of tiles) t.el.setAttribute('aria-selected', String((state.styleId ?? '') === (t.style?.id ?? '')));}
async function pump() {
 if (pumping || !photo) return; pumping = true;
 let t0 = performance.now();
 while (queue.size && !exporting) {
  const t = queue.values().next().value; queue.delete(t);
  if (t.gen !== gen || t.done) continue;
  try {
   const c = t.style ? await compile(t.style, 17) : null;
   if (t.gen !== gen || exporting) {if (t.gen === gen) queue.add(t); continue;}
   thumbR.render({source: 'thumb', width: photo.tw, height: photo.th, style: c, strength: 1, curve: false, bypass: !t.style});
   t.canvas.width = photo.tw; t.canvas.height = photo.th; t.canvas.getContext('2d').drawImage(thumbR.canvas, 0, 0); t.done = true;
  } catch (e) {t.done = true; t.el.title = `${t.style?.name}：${e.message}`; t.el.querySelector('.t-badges').innerHTML = '<i>無法預覽</i>';}
  if (performance.now() - t0 > 12) {await new Promise(r => requestAnimationFrame(r)); t0 = performance.now();}
 }
 pumping = false;
}
function renderStyleInfo() {
 const s = styleById(state.styleId), el = $('styleInfo');
 if (!s) {el.innerHTML = photo ? '尚未套用風格' : ''; return;}
 const kind = {xmp: 'XMP 預設', cube: `.cube LUT${s.tags?.size ? ' ' + s.tags.size + '³' : ''}`, eigacam: 'eigacam 配方'}[s.kind];
 el.innerHTML = `<b>${esc(s.name)}</b> · ${esc(s.pack)} · ${kind}${s.virtual ? '' : '<button class="link del" id="deleteStyle">刪除</button>'}${s.notes?.length ? `<span class="note">${esc(s.notes[0])}${s.notes.length > 1 ? `（另 ${s.notes.length - 1} 項）` : ''}</span>` : ''}`;
 if (!s.virtual) $('deleteStyle').onclick = async () => {if (!confirm(`從風格庫刪除「${s.name}」？`)) return; await lib.remove([s.id]); state.styleId = null; await loadCurrentStyle(); refreshLibrary();};
}
function refreshLibrary() {virtual = camStyles(); renderPackFilter(); renderGrid();}
function initLibrary() {
 const grid = $('styleGrid');
 grid.addEventListener('click', async e => {
  const el = e.target.closest('.tile'); if (!el) return;
  if (e.target.closest('.t-fav')) {const on = await lib.toggleFavorite(el.dataset.id); e.target.setAttribute('aria-pressed', String(on)); if (ui.favOnly && !on) renderGrid(); return;}
  selectStyle(el.dataset.id);
 });
 grid.addEventListener('keydown', e => {if (e.key === 'Enter' || e.key === ' ') {const el = e.target.closest('.tile'); if (el) {e.preventDefault(); selectStyle(el.dataset.id);}}});
 let searchTimer; $('search').addEventListener('input', e => {clearTimeout(searchTimer); searchTimer = setTimeout(() => {ui.query = e.target.value; renderGrid();}, 120);});
 $('packFilter').addEventListener('change', e => {ui.pack = e.target.value; renderGrid();});
 $('favOnly').onclick = () => {ui.favOnly = !ui.favOnly; $('favOnly').setAttribute('aria-pressed', String(ui.favOnly)); renderGrid();};
 $('strength').addEventListener('input', e => {state.strength = Number(e.target.value); $('strengthOut').textContent = state.strength + '%'; draw();});
 $('strength').addEventListener('change', () => commit());
}

// ---------- import ----------
const fileSource = (f, path = '') => ({name: f.name, path, size: f.size, read: (o, l) => f.slice(o, o + l).arrayBuffer().then(b => new Uint8Array(b))});
const dirOf = rel => rel ? rel.split('/').slice(0, -1).join('/') : '';
const STATUS = {ok: '成功', partial: '部分支援', duplicate: '重複略過', failed: '失敗', skipped: '非風格檔'};
function renderReport(r, p, finished) {
 $('importBar').style.width = (finished ? 100 : Math.round(((p?.done ?? 0) + (p?.fraction ?? 0)) / Math.max(1, p?.of ?? 1) * 100)) + '%';
 $('importNow').textContent = finished ? `已處理 ${r.total} 個檔案，加入 ${r.added} 個風格。${r.favorites ? `已還原 ${r.favorites} 個收藏。` : ''}` : `處理中：${p?.file ?? ''}`;
 $('importCounts').innerHTML = [['ok', '成功'], ['partial', '部分支援'], ['duplicate', '重複'], ['failed', '失敗'], ['log', '需 Log 輸入'], ['skipped', '非風格檔']].filter(([k]) => r[k] || ['ok', 'partial', 'duplicate', 'failed'].includes(k)).map(([k, l]) => `<span class="${k}">${l}<b>${r[k]}</b></span>`).join('');
 if (!finished) return;
 const packs = Object.entries(r.packs);
 $('importPacks').innerHTML = packs.length ? `<table><tr><th>風格包／資料夾</th><th>成功</th><th>部分</th><th>重複</th><th>失敗</th></tr>${packs.map(([n, c]) => `<tr><td>${esc(n)}</td><td class="n">${c.ok}</td><td class="n">${c.partial}</td><td class="n">${c.duplicate}</td><td class="n">${c.failed}</td></tr>`).join('')}</table>` : '';
 const group = (status, open) => {
  const items = r.items.filter(i => i.status === status); if (!items.length) return '';
  return `<details ${open ? 'open' : ''}><summary>${STATUS[status]}${status === 'ok' ? '（有附註）' : ''} ${items.length} 個</summary><ul>${items.slice(0, 400).map(i => `<li>${esc(i.path)}<br><em>${i.detail.map(esc).join('；')}</em></li>`).join('')}${items.length > 400 ? `<li>…另有 ${items.length - 400} 個</li>` : ''}</ul></details>`;
 };
 $('importItems').innerHTML = group('failed', true) + group('partial', r.failed === 0) + group('ok') + group('duplicate') + group('skipped');
}
let importing = false, lastReport = null;
async function runImport(sources) {
 if (importing || !sources.length) return; importing = true;
 const dlg = $('importDlg'); $('importClose').disabled = true; $('importPacks').innerHTML = $('importItems').innerHTML = ''; $('importTitle').textContent = '匯入風格';
 if (!dlg.open) dlg.showModal();
 let last = 0;
 try {
  const report = lastReport = await importSources(sources, lib, (r, p) => {const now = performance.now(); if (now - last > 80) {last = now; renderReport(r, p, false);}});
  renderReport(report, null, true); refreshLibrary();
 } catch (e) {$('importNow').textContent = '匯入中斷：' + e.message;}
 importing = false; $('importClose').disabled = false;
}
async function dropped(e) {
 const items = [...(e.dataTransfer?.items ?? [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean), out = [];
 const walk = async (entry, path) => {
  if (entry.isFile) out.push([await new Promise((res, rej) => entry.file(res, rej)), path]);
  else if (entry.isDirectory) {const reader = entry.createReader(); for (;;) {const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); if (!batch.length) break; for (const c of batch) await walk(c, path ? `${path}/${entry.name}` : entry.name);}}
 };
 if (items.length) for (const it of items) await walk(it, ''); else for (const f of e.dataTransfer?.files ?? []) out.push([f, '']);
 const images = out.filter(([f]) => /^image\//.test(f.type)), styles = out.filter(([f]) => !/^image\//.test(f.type));
 if (styles.length) await runImport(styles.map(([f, p]) => fileSource(f, p)));
 if (images.length && (!styles.length || !photo)) await loadPhoto(images[0][0], images[0][0].name);
}

// ---------- export ----------
async function renderFull(blob, {masks, brush}) {
 exporting = true;
 try {
  const style = styleById(state.styleId), full = style ? await compile(style, 33) : null;
  const d = await decodeImage(blob, thumbR.maxEdge, thumbR.maxPixels);
  try {
   thumbR.setSource('full', d.image, d.width, d.height); thumbR.setCurve(curveTable());
   if (brush) syncBrushLayers(thumbR);
   thumbR.render({...params('full', d.width, d.height), style: full, masks, curve: true});
   return {jpeg: await canvasBlob(thumbR.canvas, 'image/jpeg', .92), width: d.width, height: d.height};
  } finally {release(d.image); thumbR.dropSource('full'); thumbR.canvas.width = thumbR.canvas.height = 2;}
 } finally {exporting = false; pump();}
}
let exportFiles = [];
function showExport(title, info) {
 $('exportTitle').textContent = title; $('exportInfo').textContent = info; $('exportProgress').hidden = true;
 const img = $('exportPreview'); if (img.src) URL.revokeObjectURL(img.src);
 img.hidden = !exportFiles.length; if (exportFiles.length) img.src = URL.createObjectURL(exportFiles[0]);
 $('exportShare').hidden = !canSharePhoto(exportFiles); $('exportDownload').hidden = !exportFiles.length;
 $('exportDownload').textContent = exportFiles.length > 1 ? '下載 ZIP' : '下載 JPEG';
 if (!$('exportDlg').open) $('exportDlg').showModal();
}
async function exportPhoto() {
 if (!photo || exporting) return; busy('以原圖重新運算');
 try {
  const r = await renderFull(photo.blob, {masks: renderMasks(), brush: true});
  exportFiles = [new File([r.jpeg], stem(photo.name || 'photo') + '-eigastudio.jpg', {type: 'image/jpeg'})];
  showExport('照片已完成', `${r.width} × ${r.height} · ${(r.jpeg.size / 1e6).toFixed(1)} MB · JPEG 92%`);
 } catch (e) {toast('匯出失敗：' + (e.message || e));}
 finally {busy(null);}
}
async function runBatch(files) {
 if (!files.length || exporting) return;
 exportFiles = []; $('exportTitle').textContent = '批次調色'; $('exportPreview').hidden = true; $('exportShare').hidden = $('exportDownload').hidden = true; $('exportProgress').hidden = false; $('exportDlg').showModal();
 const masks = state.masks.filter(m => m.type !== 'brush'), names = new Set(); let failed = 0;
 for (let i = 0; i < files.length; i++) {
  $('exportInfo').textContent = `處理中 ${i + 1}／${files.length}：${files[i].name}`; $('exportBar').style.width = i / files.length * 100 + '%';
  try {
   const r = await renderFull(files[i], {masks, brush: false}); let name = stem(files[i].name) + '-eigastudio.jpg';
   for (let n = 2; names.has(name.toLowerCase()); n++) name = `${stem(files[i].name)}-eigastudio-${n}.jpg`;
   names.add(name.toLowerCase()); exportFiles.push(new File([r.jpeg], name, {type: 'image/jpeg'}));
  } catch {failed++;}
  await new Promise(r => setTimeout(r));
 }
 showExport('批次調色完成', `完成 ${exportFiles.length} 張${failed ? `，${failed} 張無法處理` : ''}。套用目前的風格、強度、全圖調整與漸層遮色片；筆刷遮色片是照片專用，不會套用。`);
}
function initExport() {
 $('exportBtn').onclick = exportPhoto;
 $('exportShare').onclick = () => sharePhoto(exportFiles).then(r => {if (r.status === 'shared') toast('已交給系統分享／儲存');}).catch(() => toast('分享失敗，請改用下載'));
 $('exportDownload').onclick = async () => {
  if (exportFiles.length === 1) return download(exportFiles[0], exportFiles[0].name);
  const entries = {}; for (const f of exportFiles) entries[f.name] = [new Uint8Array(await f.arrayBuffer()), {level: 0}];
  download(new Blob([zipSync(entries)], {type: 'application/zip'}), `eigastudio-batch-${new Date().toISOString().slice(0, 10)}.zip`);
 };
}

// ---------- menu ----------
let installEvent = null;
function compatTable() {
 const L = {ok: ['已實作', 'st-ok'], approx: ['近似轉換', 'st-approx'], none: ['未支援', 'st-none'], skip: ['略過', 'st-skip']};
 return `<p class="hint">XMP 預設多半是為 RAW 設計的；這裡用 EIGASTUDIO 自己的調色運算，把各欄位套用在已顯影的 JPEG／PNG 上。</p>
 <table><tr><th>.xmp 預設欄位</th><th>狀態</th><th>說明</th></tr>${XMP_FIELDS.map(f => `<tr><td>${esc(f.label)}</td><td class="${L[f.status][1]}">${L[f.status][0]}</td><td>${esc(f.note ?? '')}</td></tr>`).join('')}</table>
 <table><tr><th>.cube 3D LUT</th><th>狀態</th><th>說明</th></tr>
 <tr><td>LUT_3D_SIZE 2–65</td><td class="st-ok">已實作</td><td>紅色最快的格點順序；GPU 三線性內插。超過 65 會重新取樣</td></tr>
 <tr><td>DOMAIN_MIN／MAX、LUT_3D_INPUT_RANGE</td><td class="st-ok">已實作</td><td>輸入先依範圍正規化</td></tr>
 <tr><td>Log 輸入的 LUT</td><td class="st-approx">可匯入，標示「Log」</td><td>依檔名、TITLE、註解與內容判斷；直接套在 SDR 照片上通常過濃</td></tr>
 <tr><td>LUT_1D_SIZE、其他格式（.3dl、.look）</td><td class="st-none">未支援</td><td></td></tr></table>
 <table><tr><th>eigacam 配方</th><th>狀態</th><th>說明</th></tr>
 <tr><td>色彩模型（gain、hues、tone、print）與 lr 設定</td><td class="st-ok">已實作</td><td>直接使用 CAM 的 color.js 烘焙成同一張 3D LUT</td></tr>
 <tr><td>遮色片（漸層、圓形、明暗、顏色）、暗角、顆粒、柔焦、光暈、光影強調、局部柔化、銳利化、膚色保護</td><td class="st-ok">已實作</td><td>與 CAM 相同的設定與著色器運算，CAM 參數轉盤維持預設時兩邊畫面一致</td></tr>
 <tr><td>美肌、室內模式、拍攝模式</td><td class="st-skip">CAM 專用</td><td>屬於拍攝時的設定，不是色彩本身</td></tr></table>`;
}
function initMenu() {
 addEventListener('beforeinstallprompt', e => {e.preventDefault(); installEvent = e; $('installBtn').hidden = false;});
 $('menuBtn').onclick = async () => {
  $('deletePackBtn').hidden = !ui.pack || !lib.styles.some(s => s.pack === ui.pack || s.pack.startsWith(ui.pack + '/')); $('deletePackBtn').textContent = `刪除風格包「${ui.pack}」`;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  $('storageInfo').textContent = `風格庫：${lib.styles.length} 個匯入的風格、${lib.favorites.size} 個收藏${est?.usage ? `，占用約 ${(est.usage / 1e6).toFixed(1)} MB` : ''}。資料只存在這台裝置的瀏覽器；清除網站資料會一併刪除，請定期匯出備份。iPhone 可用 Safari「分享 → 加入主畫面」。`;
  $('menuDlg').showModal();
 };
 $('menuDlg').addEventListener('click', async e => {
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return; $('menuDlg').close();
  if (act === 'batch') {if (!state.styleId && JSON.stringify(state.adjust) === JSON.stringify(newAdjust())) return toast('先選一個風格或做一些調整'); $('batchInput').click();}
  else if (act === 'folder') $('folderInput').click();
  else if (act === 'restore') $('styleInput').click();
  else if (act === 'compat') {$('compatBody').innerHTML = compatTable(); $('compatDlg').showModal();}
  else if (act === 'install') {installEvent?.prompt(); installEvent = null; $('installBtn').hidden = true;}
  else if (act === 'backup') {
   if (!lib.styles.length) return toast('風格庫是空的');
   busy('打包風格庫'); try {download(await lib.exportZip(), `eigastudio-library-${new Date().toISOString().slice(0, 10)}.zip`); toast('已匯出；在另一台裝置用「匯入風格」選這個 ZIP 即可還原');} catch (err) {toast('匯出失敗：' + err.message);} busy(null);
  } else if (act === 'deletePack' || act === 'clear') {
   const ids = lib.styles.filter(s => act === 'clear' || s.pack === ui.pack || s.pack.startsWith(ui.pack + '/')).map(s => s.id);
   if (!ids.length || !confirm(`確定刪除 ${ids.length} 個風格？這個動作無法復原。`)) return;
   await lib.remove(ids); compiled.clear(); if (!styleById(state.styleId)) {state.styleId = null; await loadCurrentStyle();} refreshLibrary();
  }
 });
}

// ---------- boot ----------
function setTab(tab) {document.body.dataset.tab = tab; renderHandles(); draw(); if (tab === 'styles') requestAnimationFrame(() => pump());}
async function boot() {
 try {mainR = new StudioRenderer($('canvas')); thumbR = new StudioRenderer(document.createElement('canvas'));}
 catch (e) {$('empty').querySelector('p').textContent = e.message; $('emptyOpen').disabled = $('emptySample').disabled = true; return;}
 for (const r of [mainR, thumbR]) r.canvas.addEventListener('engine-error', e => toast(e.detail));
 lib = await Library.open().catch(() => null);
 if (!lib) {$('empty').querySelector('p').textContent = '這個瀏覽器無法使用裝置儲存空間（可能是私密瀏覽模式），風格庫無法保存。'; return;}
 initStage(); initHandles(); initPanels(); initLibrary(); initExport(); initMenu();
 document.querySelector('.tabs').addEventListener('click', e => {const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) setTab(t);});
 if (!mobile()) document.body.dataset.tab = 'adjust';
 for (const id of ['openPhoto', 'emptyOpen']) $(id).onclick = () => $('photoInput').click();
 $('emptySample').onclick = async () => {busy('讀取範例'); try {await loadPhoto(await (await fetch('../assets/portrait.jpg')).blob(), 'portrait.jpg');} catch {toast('無法讀取範例照片');} busy(null);};
 $('photoInput').onchange = e => {const f = e.target.files[0]; e.target.value = ''; if (f) loadPhoto(f, f.name);};
 $('importBtn').onclick = () => $('styleInput').click();
 $('styleInput').onchange = e => {const files = [...e.target.files]; e.target.value = ''; runImport(files.map(f => fileSource(f)));};
 $('folderInput').onchange = e => {const files = [...e.target.files]; e.target.value = ''; runImport(files.map(f => fileSource(f, dirOf(f.webkitRelativePath))));};
 $('batchInput').onchange = e => {const files = [...e.target.files]; e.target.value = ''; runBatch(files);};
 $('importClose').onclick = () => {if (lastReport?.added && !photo) toast('風格已存入風格庫，選一張照片就能看到效果');};
 $('undo').onclick = () => step(-1); $('redo').onclick = () => step(1);
 const cmp = on => {if (ui.compare !== on) {ui.compare = on; $('compare').setAttribute('aria-pressed', String(on)); draw();}};
 $('compare').addEventListener('pointerdown', e => {e.preventDefault(); $('compare').setPointerCapture(e.pointerId); cmp(true);});
 for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('compare').addEventListener(ev, () => cmp(false));
 addEventListener('keydown', e => {
  if (e.target.matches('input[type=search]')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {e.preventDefault(); step(e.shiftKey ? 1 : -1);}
  else if (e.key === '\\') cmp(true);
 });
 addEventListener('keyup', e => {if (e.key === '\\') cmp(false);});
 let depth = 0;
 addEventListener('dragenter', e => {e.preventDefault(); depth++; $('dropHint').hidden = false;});
 addEventListener('dragleave', () => {if (--depth <= 0) {depth = 0; $('dropHint').hidden = true;}});
 addEventListener('dragover', e => e.preventDefault());
 addEventListener('drop', e => {e.preventDefault(); depth = 0; $('dropHint').hidden = true; dropped(e);});
 refreshLibrary();
 const saved = await lib.getMeta('photo').catch(() => null);
 if (saved?.blob) await loadPhoto(saved.blob, saved.name, await lib.getMeta('edit').catch(() => null) ?? {json: '{}'});
 if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
 // Hook for the automated checks in tests/studio-e2e.mjs.
 globalThis.eigastudio = {state, ui, lib, mainR, thumbR, renderNow, compile, styleById, allStyles, runImport, loadPhoto, exportPhoto, renderFull, renderMasks, get photo() {return photo;}, get exportFiles() {return exportFiles;}, get lastReport() {return lastReport;}, get current() {return current;}, get queue() {return queue.size + (pumping ? 1 : 0);}, get tiles() {return tiles;}};
 document.body.dataset.ready = '1';
}
boot();
