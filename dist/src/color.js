// Colour science for EIGACAM looks. Every look is a pure function from scene-linear
// sRGB to display sRGB, baked once into a 3D LUT that the GPU samples per pixel.
// Colour work happens in OKLab/OKLCh so hue and saturation moves stay perceptually even.

export const LUT_SIZE = 33;
// Log shaper for the LUT input: keeps shadow precision and 2 stops of headroom (0..4 linear).
const SHAPER_K = 15, SHAPER_MAX = 4, SHAPER_LOG = Math.log2(1 + SHAPER_K * SHAPER_MAX);
export const shaperEncode = x => Math.min(1, Math.max(0, Math.log2(1 + SHAPER_K * Math.max(0, x)) / SHAPER_LOG));
export const shaperDecode = s => (2 ** (s * SHAPER_LOG) - 1) / SHAPER_K;

export const toLinear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export const toDisplay = v => v <= .0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - .055;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const luminance = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
export function oklabToLinear(L, a, b) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
}
// Pull out-of-gamut colours toward their own luminance instead of clipping channels (keeps hue).
function gamutCompress(rgb) {
  const y = Math.max(0, luminance(...rgb)), lo = Math.min(...rgb);
  if (lo >= 0) return rgb;
  const t = y / Math.max(1e-6, y - lo);
  return rgb.map(v => Math.max(0, y + (v - y) * t));
}
const hueDistance = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// Display-space tone: smooth highlight shoulder, S-contrast around a pivot, then print black/white.
export function toneCurve(v, t) {
  const k = t.knee ?? .8;
  if (v > k) v = k + (1 - k) * Math.tanh((v - k) / (1 - k));
  v = Math.min(1, Math.max(0, v));
  const c = t.contrast ?? 1, p = t.pivot ?? .45;
  v = v < p ? p * (v / p) ** c : 1 - (1 - p) * ((1 - v) / (1 - p)) ** c;
  return (t.black ?? 0) + ((t.white ?? 1) - (t.black ?? 0)) * v;
}

export function lookTransform(rgb, look) {
  if (look.lr) return lightroomTransform(rgb, look.lr);
  let [r, g, b] = rgb.map((v, i) => v * (look.gain?.[i] ?? 1));
  if (look.mono) { const y = r * look.mono[0] + g * look.mono[1] + b * look.mono[2]; r = g = b = y; }
  let [L, A, B] = linearToOklab(Math.max(0, r), Math.max(0, g), Math.max(0, b));
  if (!look.mono) {
    let C = Math.hypot(A, B), h = Math.atan2(B, A) * 180 / Math.PI;
    const presence = smooth(0, .035, C); // neutrals are never pushed around by hue bands
    let dh = 0, sm = 1, dl = 0;
    for (const [center, width, shift, sat, light] of look.hues ?? []) {
      const w = Math.exp(-.5 * (hueDistance(h, center) / width) ** 2) * presence;
      dh += w * shift; sm *= 1 + w * (sat - 1); dl += w * (light ?? 0);
    }
    h += dh; C *= sm * (look.sat ?? 1); L += dl * Math.min(1, C / .08);
    C *= Math.max(0, 1 - (look.desatHi ?? 0) * smooth(.72, 1, L) - (look.desatSh ?? 0) * (1 - smooth(.08, .38, L)));
    A = C * Math.cos(h * Math.PI / 180); B = C * Math.sin(h * Math.PI / 180);
    const ws = (1 - smooth(.05, .62, L)), wh = smooth(.45, .98, L);
    for (const [weight, tone] of [[ws, look.shadows], [wh, look.highlights]]) if (tone) { A += weight * tone[1] * Math.cos(tone[0] * Math.PI / 180); B += weight * tone[1] * Math.sin(tone[0] * Math.PI / 180); }
  }
  const lin = gamutCompress(oklabToLinear(L, A, B));
  const tone = look.tone ?? {};
  return lin.map((v, i) => {
    let d = toneCurve(toDisplay(v), tone);
    const pr = look.print?.[i];
    if (pr) d = pr[0] + (pr[2] - pr[0]) * Math.max(0, d) ** pr[1];
    return Math.min(1, Math.max(0, d));
  });
}

// Bake a look into RGBA float data ordered r fastest, then g, then b (3D texture layout).
export function bakeLook(look, size = LUT_SIZE) {
  const data = new Float32Array(size ** 3 * 4);
  const axis = Array.from({ length: size }, (_, i) => shaperDecode(i / (size - 1)));
  let o = 0;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const out = lookTransform([axis[ri], axis[gi], axis[bi]], look);
    data[o++] = out[0]; data[o++] = out[1]; data[o++] = out[2]; data[o++] = 1;
  }
  return { size, data, input: 'shaper' };
}

// Adobe/Resolve .cube files: display-referred input in DOMAIN_MIN..DOMAIN_MAX.
export function parseCube(text) {
  let size = 0, min = [0, 0, 0], max = [1, 1, 1], title = '';
  const values = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size = Number(rest[0]);
    else if (key === 'DOMAIN_MIN') min = rest.map(Number);
    else if (key === 'DOMAIN_MAX') max = rest.map(Number);
    else if (key === 'LUT_1D_SIZE') throw Error('只支援 3D LUT（.cube 的 LUT_3D_SIZE）。');
    else if (/^[-+.\d]/.test(key)) { const v = [key, ...rest].slice(0, 3).map(Number); if (v.some(n => !Number.isFinite(n))) throw Error('LUT 數值格式錯誤。'); values.push(v); }
  }
  if (!Number.isInteger(size) || size < 2 || size > 65) throw Error('LUT 尺寸無效（需介於 2–65）。');
  if (values.length !== size ** 3) throw Error(`LUT 資料數量不符：需要 ${size ** 3} 組，實際 ${values.length} 組。`);
  if (min.length !== 3 || max.length !== 3 || min.some((v, i) => !(max[i] > v))) throw Error('LUT DOMAIN 設定無效。');
  const data = new Float32Array(size ** 3 * 4);
  values.forEach((v, i) => { data.set([v[0], v[1], v[2], 1], i * 4); });
  return { size, data, input: 'display', domainMin: min, domainMax: max, title };
}

// Centered crop for a cinema aspect ratio, oriented like the source (portrait stays portrait).
export function cropFor(width, height, ratio) {
  if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
  const landscape = width >= height, target = landscape ? ratio : 1 / ratio, current = width / height;
  if (Math.abs(current - target) < 1e-3) return { x: 0, y: 0, w: 1, h: 1 };
  if (current > target) { const w = target / current; return { x: (1 - w) / 2, y: 0, w, h: 1 }; }
  const h = current / target; return { x: 0, y: (1 - h) / 2, w: 1, h };
}
export function outputSize(width, height, crop, maxEdge, maxPixels) {
  let w = width * crop.w, h = height * crop.h;
  const s = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

// ---------- Lightroom-style develop settings ----------
// An approximation of Lightroom's Basic, HSL/Color, Color Grading and Dehaze panels, so presets
// people share as slider values can be typed in directly. Values use Lightroom's own ranges.
const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const HSL_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300];
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-9) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max > 1e-9 ? d / max : 0, max];
}
function hsvToRgb(h, s, v) {
  const f = n => {const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));};
  return [f(5), f(3), f(1)];
}
// Piecewise-linear interpolation between neighbouring Lightroom colour bands.
function bandValue(h, values) {
  for (let i = 0; i < 8; i++) {
    const a = HSL_CENTERS[i], b = i < 7 ? HSL_CENTERS[i + 1] : 360;
    if (h >= a && h < b) {const t = (h - a) / (b - a); return values[i] * (1 - t) + values[(i + 1) % 8] * t;}
  }
  return values[0];
}
const display = v => toDisplay(Math.max(0, v));
export function lightroomTransform(rgb, lr) {
  const b = lr.basic ?? {}, t = (b.temp ?? 0) / 100, tint = (b.tint ?? 0) / 100;
  let gains = [Math.exp(.3 * t), Math.exp(-.28 * tint), Math.exp(-.3 * t)];
  const gl = luminance(...gains); gains = gains.map(v => v / gl);
  let lin = rgb.map((v, i) => Math.max(0, v) * gains[i] * 2 ** (b.exposure ?? 0));
  // Tone panel on display luminance, applied as a ratio so hues are preserved.
  let Y = toDisplay(luminance(...lin));
  const Y0 = Math.max(Y, 1e-6);
  const k = .85; if (Y > k) Y = k + (1 - k) * Math.tanh((Y - k) / (1 - k));
  const c = 1 + (b.contrast ?? 0) / 100 * .5 + (lr.dehaze ?? 0) / 100 * .25;
  Y = Y < .5 ? .5 * (Y / .5) ** c : 1 - .5 * ((1 - Y) / .5) ** c;
  Y += (b.highlights ?? 0) / 100 * .11 * 6.75 * Y * Y * (1 - Y);
  Y += (b.shadows ?? 0) / 100 * .1 * 6.75 * Y * (1 - Y) ** 2;
  Y += (b.whites ?? 0) / 100 * .12 * Y ** 3;
  Y += (b.blacks ?? 0) / 100 * .08 * (1 - Y) ** 4;
  Y -= (lr.dehaze ?? 0) / 100 * .03 * (1 - Y) ** 2;
  Y = Math.min(1, Math.max(0, Y));
  const ratio = toLinear(Y) / Math.max(toLinear(Y0), 1e-9);
  let d = lin.map(v => display(v * ratio));
  // HSL / Color mixer.
  let [h, s, v] = rgbToHsv(...d.map(x => Math.min(1, x)));
  const hsl = lr.hsl ?? {}, pick = i => HSL_BANDS.map(n => hsl[n]?.[i] ?? 0);
  const dh = bandValue(h, pick(0)), ds = bandValue(h, pick(1)), dl = bandValue(h, pick(2));
  const presence = Math.min(1, s * 2.5);
  h = (h + dh * .3 * presence + 360) % 360;
  s *= 1 + ds / 100 * (ds > 0 ? .9 : 1) * presence;
  s = Math.min(1, s);
  const vib = (b.vibrance ?? 0) / 100, sat = (b.saturation ?? 0) / 100 + (lr.dehaze ?? 0) / 100 * .2;
  s = Math.min(1, Math.max(0, s * (1 + vib * (1 - s) * 1.2) * (1 + sat)));
  d = hsvToRgb(h, s, v);
  const lumScale = 1 + dl / 100 * .35 * presence;
  d = d.map(x => x * lumScale);
  // Color grading: shadows / midtones / highlights wheels, blending and balance.
  const g = lr.grading;
  if (g) {
    const Yd = Math.min(1, Math.max(0, luminance(...d))), blend = (g.blending ?? 50) / 100, centre = .5 - (g.balance ?? 0) / 100 * .25, width = .12 + .3 * blend;
    const masks = {
      shadows: 1 - smooth(Math.max(.01, centre - width - .2), centre + width * .5, Yd),
      highlights: smooth(centre - width * .5, Math.min(.99, centre + width + .2), Yd),
      midtones: Math.exp(-(((Yd - centre) / (.18 + width * .5)) ** 2))
    };
    for (const [zone, m] of Object.entries(masks)) {
      const w = g[zone]; if (!w) continue;
      const tint = hsvToRgb(w.hue ?? 0, 1, 1), tl = luminance(...tint), amt = (w.sat ?? 0) / 100 * .22 * m;
      d = d.map((x, i) => x + (tint[i] - tl) * amt + (w.lum ?? 0) / 100 * .1 * m);
    }
  }
  return d.map(x => Math.min(1, Math.max(0, x)));
}
