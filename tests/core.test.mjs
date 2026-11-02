import test from 'node:test';
import assert from 'node:assert/strict';
import {LOOKS, findLook} from '../dist/src/looks.js';
import {bakeLook, lookTransform, toneCurve, shaperEncode, shaperDecode, linearToOklab, oklabToLinear, parseCube, cropFor, outputSize, LUT_SIZE} from '../dist/src/color.js';
import {renderSettings} from '../dist/src/develop.js';

test('nine looks with unique ids, sequential codes and complete metadata', () => {
 assert.equal(LOOKS.length, 9);
 assert.equal(new Set(LOOKS.map(l => l.id)).size, 9);
 LOOKS.forEach((l, i) => {assert.equal(l.code, String(i + 1).padStart(2, '0')); assert.ok(l.name && l.en && l.desc); assert.equal(l.swatch.length, 3); assert.ok(l.tone || l.lr); assert.ok(l.grain); assert.ok(l.glow);});
 assert.equal(findLook('nightcity').name, '賽博夜城'); assert.equal(findLook('missing').id, 'print');
});
test('every baked LUT is finite, in range and the right size', () => {
 for (const l of LOOKS) {const lut = bakeLook(l, 9); assert.equal(lut.size, 9); assert.equal(lut.data.length, 9 ** 3 * 4); for (const v of lut.data) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);}
 assert.equal(LUT_SIZE, 33);
});
test('looks never invert tones: brighter grey in, brighter out', () => {
 for (const l of LOOKS) {let prev = -1; for (let i = 0; i <= 60; i++) {const x = shaperDecode(i / 60), [r, g, b] = lookTransform([x, x, x], l), y = .2126 * r + .7152 * g + .0722 * b; assert.ok(y >= prev - 1e-6, `${l.id} at ${x}`); prev = y;}}
});
test('looks keep black near black and white near white', () => {
 for (const l of LOOKS) {const black = lookTransform([0, 0, 0], l), white = lookTransform([1, 1, 1], l); assert.ok(Math.max(...black) < .09, l.id); assert.ok(.2126 * white[0] + .7152 * white[1] + .0722 * white[2] > .85, l.id); assert.ok(Math.min(...white) > .8, l.id);}
});
test('monochrome look is truly neutral', () => {
 const mono = findLook('mono'); for (const c of [[.8, .1, .1], [.1, .6, .9], [.3, .3, .05]]) {const [r, g, b] = lookTransform(c, mono); assert.ok(Math.abs(r - g) < 1e-5 && Math.abs(g - b) < 1e-5);}
});
test('tone curve is monotonic with a soft shoulder above white', () => {
 const t = {contrast: 1.3, pivot: .45, black: .02, white: .98, knee: .8}; let prev = -1;
 for (let i = 0; i <= 400; i++) {const y = toneCurve(i / 100, t); assert.ok(y >= prev - 1e-12); assert.ok(y <= .98 + 1e-12); prev = y;}
 assert.ok(toneCurve(1, t) > .9);
});
test('shaper and OKLab round-trip', () => {
 for (const x of [0, .001, .18, 1, 3.5]) assert.ok(Math.abs(shaperDecode(shaperEncode(x)) - x) < 1e-9);
 for (const c of [[.2, .4, .6], [1, 0, 0], [.05, .05, .05]]) {const back = oklabToLinear(...linearToOklab(...c)); back.forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 1e-6));}
});
test('.cube parser reads 3D LUTs and rejects malformed files', () => {
 const lines = []; for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g} ${b}`);
 const lut = parseCube(`# comment\nTITLE "Test LUT"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n${lines.join('\n')}\n`);
 assert.equal(lut.size, 2); assert.equal(lut.title, 'Test LUT'); assert.equal(lut.input, 'display'); assert.deepEqual([...lut.data.slice(4, 8)], [1, 0, 0, 1]);
 assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0'), /資料數量/);
 assert.throws(() => parseCube('LUT_1D_SIZE 4\n0 0 0'), /3D/);
 assert.throws(() => parseCube(`LUT_3D_SIZE 2\n${lines.join('\n').replace('1 1 1', '1 1 x')}`), /數值/);
});
test('cinema crops follow the photo orientation and never upscale', () => {
 assert.deepEqual(cropFor(4032, 3024, 0), {x: 0, y: 0, w: 1, h: 1});
 const scope = cropFor(4032, 3024, 2.39); assert.equal(scope.w, 1); assert.ok(Math.abs(4032 / (3024 * scope.h) - 2.39) < 1e-9); assert.ok(Math.abs(scope.y - (1 - scope.h) / 2) < 1e-12);
 const tall = cropFor(3024, 4032, 2.39); assert.equal(tall.h, 1); assert.ok(Math.abs((4032) / (3024 * tall.w) - 2.39) < 1e-9);
 assert.deepEqual(outputSize(4032, 3024, cropFor(4032, 3024, 2.39), 8192, 40e6), {width: 4032, height: 1687});
 const capped = outputSize(8000, 6000, {x: 0, y: 0, w: 1, h: 1}, 8192, 12e6); assert.ok(capped.width * capped.height <= 12e6);
});
test('dials map to renderer settings relative to each look', () => {
 const look = findLook('nightcity'), s = renderSettings(look, {ev: .5, strength: 50, grain: 200, glow: 0, sharpen: 35, warmth: -25});
 assert.equal(s.exposure, .5); assert.equal(s.strength, .5); assert.equal(s.grain, look.grain.amount * 2); assert.equal(s.halation, 0); assert.equal(s.bloom, 0); assert.equal(s.warmth, -.5); assert.equal(s.sharpen, .35);
});
test('Lightroom-style looks follow their slider values', async () => {
 const {lightroomTransform} = await import('../dist/src/color.js');
 const grey = [.18, .18, .18], plain = lightroomTransform(grey, {}); plain.forEach(v => assert.ok(Math.abs(v - .4614) < .01));
 const warm = lightroomTransform(grey, {basic: {temp: 50}}); assert.ok(warm[0] > warm[2]);
 const dark = lightroomTransform([.01, .01, .01], {basic: {blacks: -60}}); assert.ok(dark[0] < lightroomTransform([.01, .01, .01], {})[0]);
 const desat = lightroomTransform([.4, .35, .02], {hsl: {yellow: [0, -100, 0], orange: [0, -100, 0]}}); assert.ok(Math.max(...desat) - Math.min(...desat) < .05);
 const rain = findLook('neonrain'); const shadow = lookTransform([.02, .02, .02], rain); assert.ok(shadow[2] > shadow[1], 'purple shadows'); const hi = lookTransform([.7, .7, .7], rain); assert.ok(hi[0] > hi[1] && hi[2] > hi[1], 'magenta highlights');
});
