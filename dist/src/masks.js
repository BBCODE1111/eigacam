// Local adjustments ("masks"): each mask selects part of the frame and carries its own adjustments.
// Geometry lives in full-frame image coordinates (0..1, top-left origin) so preview, crop and
// full-resolution develop all agree.
export const MAX_MASKS = 8;
export const MASK_TYPES = {
 linear: {label: '漸層', code: 'GRAD'},
 radial: {label: '圓形', code: 'RADIAL'},
 luma: {label: '明暗', code: 'LUMA'},
 color: {label: '顏色', code: 'COLOR'}
};
// [label, min, max, step, default, format]
const signed = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
export const ADJUSTMENTS = {
 ev: ['曝光', -2, 2, .05, 0, v => signed(v, 2)],
 temp: ['色溫', -100, 100, 1, 0, v => signed(v)],
 tint: ['色調', -100, 100, 1, 0, v => signed(v)],
 sat: ['飽和', -100, 100, 1, 0, v => signed(v)],
 contrast: ['對比', -100, 100, 1, 0, v => signed(v)],
 hue: ['染色色相', 0, 360, 1, 30, v => Math.round(v) + '°'],
 amount: ['染色強度', 0, 100, 1, 0, v => Math.round(v) + '%']
};
export const GEOMETRY = {
 linear: {},
 radial: {feather: ['柔邊', 0, 100, 1, 50, v => Math.round(v) + '%']},
 luma: {lo: ['下限', 0, 100, 1, 65, v => Math.round(v)], hi: ['上限', 0, 100, 1, 100, v => Math.round(v)], feather: ['柔邊', 0, 50, 1, 15, v => Math.round(v)]},
 color: {hue: ['選取色相', 0, 360, 1, 210, v => Math.round(v) + '°'], width: ['範圍', 5, 120, 1, 40, v => Math.round(v) + '°'], feather: ['柔邊', 0, 60, 1, 20, v => Math.round(v) + '°']}
};
const SHAPES = {
 linear: {x0: .5, y0: 0, x1: .5, y1: .55},
 radial: {cx: .5, cy: .45, rx: .28, ry: .28},
 luma: {}, color: {}
};
let counter = 0;
const uid = () => `m${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function createMask(type, overrides = {}) {
 if (!MASK_TYPES[type]) throw Error('不支援的遮色片類型');
 const geometry = Object.fromEntries(Object.entries(GEOMETRY[type]).map(([k, s]) => [k, s[4]]));
 const adj = Object.fromEntries(Object.entries(ADJUSTMENTS).map(([k, s]) => [k, s[4]]));
 return {id: uid(), type, name: MASK_TYPES[type].label, enabled: true, invert: false, ...SHAPES[type], ...geometry, ...overrides, adj: {...adj, ...(overrides.adj ?? {})}};
}
// Duplicate keeps every setting but gets its own id, so it can be inverted or retuned independently.
export function duplicateMask(mask, {invert = false} = {}) {
 const copy = JSON.parse(JSON.stringify(mask));
 copy.id = uid(); copy.name = mask.name.replace(/ 拷貝( \d+)?$/, '') + ' 拷貝';
 if (invert) copy.invert = !copy.invert;
 return copy;
}
const clamp = (v, lo, hi, d) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
// Validates masks loaded from storage; anything malformed is dropped or clamped, never sent raw to the GPU.
export function sanitizeMasks(list) {
 if (!Array.isArray(list)) return [];
 return list.filter(m => m && MASK_TYPES[m.type]).slice(0, MAX_MASKS).map(m => {
  const base = createMask(m.type);
  const out = {...base, id: typeof m.id === 'string' ? m.id.slice(0, 40) : base.id, name: String(m.name ?? base.name).slice(0, 24), enabled: m.enabled !== false, invert: m.invert === true};
  for (const k of Object.keys(SHAPES[m.type])) out[k] = clamp(Number(m[k]), -1, 2, base[k]);
  for (const [k, s] of Object.entries(GEOMETRY[m.type])) out[k] = clamp(Number(m[k]), s[1], s[2], s[4]);
  for (const [k, s] of Object.entries(ADJUSTMENTS)) out.adj[k] = clamp(Number(m.adj?.[k]), s[1], s[2], s[4]);
  return out;
 });
}
export function isNeutral(mask) {return ['ev', 'temp', 'tint', 'sat', 'contrast', 'amount'].every(k => mask.adj[k] === 0);}

// Packs masks into four vec4 uniform arrays for the shader.
// a: type, invert, geometry…  b: geometry…  c: ev, temp, tint, sat  d: contrast, hue, amount, 0
// viewId: a mask whose selection should be shown even before it has any adjustment.
export function packMasks(masks, viewId = null) {
 const live = (masks ?? []).filter(m => m.id === viewId || (m.enabled && !isNeutral(m))).slice(0, MAX_MASKS);
 const a = new Float32Array(MAX_MASKS * 4), b = new Float32Array(MAX_MASKS * 4), c = new Float32Array(MAX_MASKS * 4), d = new Float32Array(MAX_MASKS * 4);
 live.forEach((m, i) => {
  const o = i * 4, type = ['linear', 'radial', 'luma', 'color'].indexOf(m.type);
  const geo = m.type === 'linear' ? [m.x0, m.y0, m.x1, m.y1] : m.type === 'radial' ? [m.cx, m.cy, m.rx, m.ry] : m.type === 'luma' ? [m.lo / 100, m.hi / 100, m.feather / 100, 0] : [m.hue / 360, m.width / 360, m.feather / 360, 0];
  a.set([type, m.invert ? 1 : 0, m.type === 'radial' ? m.feather / 100 : 0, 0], o);
  b.set(geo, o);
  c.set([m.adj.ev, m.adj.temp / 100, m.adj.tint / 100, m.adj.sat / 100], o);
  d.set([m.adj.contrast / 100, m.adj.hue / 360, m.adj.amount / 100, 0], o);
 });
 live.forEach((m, i) => {if (!m.enabled) {c.fill(0, i * 4, i * 4 + 4); d.fill(0, i * 4, i * 4 + 4);}}); // shown but switched off
 return {count: live.length, a, b, c, d, view: viewId ? live.findIndex(m => m.id === viewId) + 1 : 0};
}
