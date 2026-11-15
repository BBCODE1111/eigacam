// Slider-based grade used for imported .xmp presets. One hard rule: all-zero settings are an exact
// identity, so a preset that only moves one slider changes nothing else.
import {toLinear, toDisplay, pointCurve, shaperDecode} from '../../src/color.js';

const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const CENTERS = [0, 30, 60, 120, 180, 240, 270, 300];
const luma = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t);};

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
function band(h, values) {
 for (let i = 0; i < 8; i++) {
  const a = CENTERS[i], b = i < 7 ? CENTERS[i + 1] : 360;
  if (h >= a && h < b) {const t = (h - a) / (b - a); return values[i] * (1 - t) + values[(i + 1) % 8] * t;}
 }
 return values[0];
}

// Display-luminance tone panel. Amplitudes are bounded so every slider stays monotonic.
export function toneY(Y, t) {
 const c = 1 + (t.contrast ?? 0) / 100 * .5 + (t.dehaze ?? 0) / 100 * .25;
 if (c !== 1) Y = Y < .5 ? .5 * (Y / .5) ** c : 1 - .5 * ((1 - Y) / .5) ** c;
 Y += (t.highlights ?? 0) / 100 * .14 * 6.75 * Y * Y * (1 - Y);
 Y += (t.shadows ?? 0) / 100 * .14 * 6.75 * Y * (1 - Y) ** 2;
 Y += (t.whites ?? 0) / 100 * .12 * Y ** 3;
 Y += (t.blacks ?? 0) / 100 * .08 * (1 - Y) ** 4;
 Y -= (t.dehaze ?? 0) / 100 * .03 * (1 - Y) ** 2;
 const p = t.parametric;
 if (p) { // region curve: four bumps between the split points, pinned at black and white
  const [s1, s2, s3] = p.splits ?? [.25, .5, .75], pin = 4 * Y * (1 - Y);
  const bump = (centre, width) => Math.exp(-(((Y - centre) / width) ** 2)) * pin;
  Y += ((p.shadows ?? 0) * bump(s1 / 2, s1 * .7) + (p.darks ?? 0) * bump((s1 + s2) / 2, (s2 - s1) * .8) + (p.lights ?? 0) * bump((s2 + s3) / 2, (s3 - s2) * .8) + (p.highlights ?? 0) * bump((s3 + 1) / 2, (1 - s3) * .7)) / 100 * .1;
 }
 return clamp01(Y);
}

// rgb: scene-linear sRGB. Returns display sRGB 0..1.
export function gradeTransform(rgb, g) {
 const b = g.basic ?? {}, t = (b.temp ?? 0) / 100, tint = (b.tint ?? 0) / 100, ev = b.exposure ?? 0;
 let gains = [Math.exp(.3 * t), Math.exp(-.28 * tint), Math.exp(-.3 * t)];
 const gl = luma(...gains); gains = gains.map(v => v / gl * 2 ** ev);
 let lin = rgb.map((v, i) => Math.max(0, v) * gains[i]);
 const y0 = luma(...lin), Yd = toDisplay(y0);
 let Y = Yd;
 if (ev > 0 && Y > .85) {const k = .85, rolled = k + (1 - k) * Math.tanh((Y - k) / (1 - k)); Y += (rolled - Y) * Math.min(1, ev);} // pushed exposure rolls off instead of clipping
 const Yc = clamp01(Y), Yt = toneY(Yc, {...b, dehaze: g.dehaze, parametric: g.parametric});
 if (Yt !== Yc || Y !== Yd) {const k = toLinear(Yt) / Math.max(y0, 1e-9); lin = lin.map(v => v * k);} // luminance ratio keeps hue
 let d = lin.map(v => clamp01(toDisplay(Math.max(0, v))));

 const hsl = g.hsl, vib = (b.vibrance ?? 0) / 100, sat = (b.saturation ?? 0) / 100 + (g.dehaze ?? 0) / 100 * .2;
 if (g.mono) {
  const [h, s] = rgbToHsv(...d), mix = g.grayMixer ? band(h, BANDS.map(n => g.grayMixer[n] ?? 0)) / 100 * .5 * Math.min(1, s * 2.5) : 0;
  const y = clamp01(luma(...d) * (1 + mix)); d = [y, y, y];
 } else if (hsl || vib || sat) {
  let [h, s, v] = rgbToHsv(...d);
  const presence = Math.min(1, s * 2.5);
  let k = (1 + sat) * (1 + vib * (1 - s) * 1.2), lumScale = 1;
  if (hsl) {
   const pick = i => BANDS.map(n => hsl[n]?.[i] ?? 0), dh = band(h, pick(0)), ds = band(h, pick(1)), dl = band(h, pick(2));
   if (dh) {const y = luma(...d); d = hsvToRgb((h + dh * .3 * presence + 360) % 360, s, v); const y2 = luma(...d); if (y2 > 1e-6) d = d.map(x => x * y / y2);}
   k *= 1 + ds / 100 * presence; lumScale = 1 + dl / 100 * .35 * presence;
  }
  const y = luma(...d); k = Math.max(0, k);
  d = d.map(x => (y + (x - y) * k) * lumScale);
 }
 if (g.curves) d = d.map((x, i) => pointCurve(g.curves['rgb'[i]], pointCurve(g.curves.m, clamp01(x))));
 const cg = g.grading;
 if (cg) {
  const Yd = clamp01(luma(...d)), blend = (cg.blending ?? 50) / 100, centre = .5 - (cg.balance ?? 0) / 100 * .25, width = .12 + .3 * blend;
  const zones = {shadows: 1 - smooth(Math.max(.01, centre - width - .2), centre + width * .5, Yd), highlights: smooth(centre - width * .5, Math.min(.99, centre + width + .2), Yd), midtones: Math.exp(-(((Yd - centre) / (.18 + width * .5)) ** 2)), global: 1};
  for (const [zone, m] of Object.entries(zones)) {
   const w = cg[zone]; if (!w || (!w.sat && !w.lum)) continue;
   const tintRgb = hsvToRgb(w.hue ?? 0, 1, 1), tl = luma(...tintRgb), amt = (w.sat ?? 0) / 100 * .22 * m;
   d = d.map((x, i) => x + (tintRgb[i] - tl) * amt + (w.lum ?? 0) / 100 * .1 * m);
  }
 }
 return d.map(clamp01);
}

// Bake any scene-linear → display function into the 3D texture layout eigacam's shader samples
// (r fastest, log shaper on the input axis).
export function bake(fn, size = 33) {
 const data = new Float32Array(size ** 3 * 4), axis = Array.from({length: size}, (_, i) => shaperDecode(i / (size - 1)));
 let o = 0;
 for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
  const out = fn([axis[ri], axis[gi], axis[bi]]);
  data[o++] = out[0]; data[o++] = out[1]; data[o++] = out[2]; data[o++] = 1;
 }
 return {size, data, input: 'shaper'};
}
export const bakeGrade = (grade, size = 33) => bake(rgb => gradeTransform(rgb, grade), size);
