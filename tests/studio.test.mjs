import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gradeTransform, bakeGrade, toneY} from '../dist/eigastudio/src/lr.js';
import {parseXmp, XMP_FIELDS} from '../dist/eigastudio/src/xmp.js';
import {parseCube, detectLog} from '../dist/eigastudio/src/cube.js';
import {compileLook, describeLook, parseRecipeFile} from '../dist/eigastudio/src/recipe.js';
import {importSources, analyze, MANIFEST} from '../dist/eigastudio/src/importer.js';
import {packMasks, globalGain} from '../dist/eigastudio/src/engine.js';
import {bakeLook, toDisplay, toLinear, shaperEncode} from '../dist/src/color.js';
import {LOOKS} from '../dist/src/looks.js';
import {zipSync, strToU8} from '../dist/eigastudio/vendor/fflate.js';
import {buildPack, buildZip, expected, preset, cube} from './studio-fixtures.mjs';

const lum = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
const colours = [[0, 0, 0], [.02, .02, .02], [.18, .18, .18], [.5, .2, .1], [.05, .4, .8], [1, 1, 1], [.9, .1, .1]];
const memoryStore = () => {const s = {records: [], bytes: new Map(), favorites: new Set(), has: h => s.records.some(r => r.hash === h), nameTaken: (p, n) => s.records.some(r => r.pack === p && r.name.toLowerCase() === n.toLowerCase()), add: async (r, b) => {s.records.push(r); s.bytes.set(r.hash, b);}, setFavorites: async ids => {ids.forEach(i => s.favorites.add(i)); return ids.length;}}; return s;};
const zipSource = (name, bytes) => ({name, size: bytes.length, read: async (o, l) => bytes.subarray(o, o + l)});

test('grade: zero settings are an exact identity', () => {
 for (const c of colours) gradeTransform(c, {basic: {}}).forEach((v, i) => assert.equal(v, Math.min(1, toDisplay(c[i]))));
 const x = parseXmp(preset('只有 HSL', {SaturationAdjustmentBlue: -60}));
 assert.deepEqual(gradeTransform([.18, .18, .18], x.grade), [.18, .18, .18].map(toDisplay), 'neutrals untouched by an HSL-only preset');
});
test('grade: each slider moves the picture the way its name says', () => {
 const g = (b, extra = {}) => gradeTransform([.18, .18, .18], {basic: b, ...extra}), base = toDisplay(.18);
 assert.ok(Math.abs(toLinear(g({exposure: 1})[0]) / .18 - 2) < .02, '+1 EV doubles linear mid-grey');
 assert.ok(g({shadows: 60})[0] > base && gradeTransform([.01, .01, .01], {basic: {shadows: 60}})[0] > toDisplay(.01));
 assert.ok(gradeTransform([.8, .8, .8], {basic: {highlights: -60}})[0] < toDisplay(.8));
 assert.ok(Math.abs(gradeTransform([.9, .9, .9], {basic: {shadows: 60}})[0] - toDisplay(.9)) < .02, 'shadows leave highlights alone');
 const warm = g({temp: 40}); assert.ok(warm[0] > warm[2]);
 const grey = gradeTransform([.5, .2, .1], {basic: {saturation: -100}}); assert.ok(Math.abs(grey[0] - grey[2]) < 1e-6);
 const blue = [.05, .2, .8], out = gradeTransform(blue, {basic: {}, hsl: {blue: [0, -80, 0]}}), spread = c => Math.max(...c) - Math.min(...c);
 assert.ok(spread(out) < spread(blue.map(toDisplay)) * .5, 'blue saturation −80 mutes blue');
 assert.deepEqual(gradeTransform([.5, .2, .1], {basic: {}, hsl: {blue: [0, -80, 0]}}).map(v => +v.toFixed(3)), [.5, .2, .1].map(v => +toDisplay(v).toFixed(3)), 'and leaves orange alone');
 for (const s of [{contrast: 100}, {highlights: 100}, {shadows: -100}, {whites: 100, blacks: -100}]) {let prev = -1; for (let i = 0; i <= 100; i++) {const y = toneY(i / 100, s); assert.ok(y >= prev - 1e-9, 'tone stays monotonic'); prev = y;}}
});
test('grade: point curves hit their knots exactly, per channel', () => {
 const x = parseXmp(preset('曲線', {}, `<crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 30</rdf:li><rdf:li>128, 140</rdf:li><rdf:li>255, 230</rdf:li></rdf:Seq></crs:ToneCurvePV2012><crs:ToneCurvePV2012Blue><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>128, 100</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012Blue>`));
 const at = v => gradeTransform([v, v, v].map(toLinear), x.grade);
 assert.ok(Math.abs(at(0)[0] - 30 / 255) < 1e-6); assert.ok(Math.abs(at(128 / 255)[0] - 140 / 255) < 1e-6); assert.ok(Math.abs(at(1)[1] - 230 / 255) < 1e-6);
 assert.ok(at(128 / 255)[2] < at(128 / 255)[0], 'blue curve applied after the master curve');
 const lut = bakeGrade(x.grade, 9); assert.equal(lut.data.length, 9 ** 3 * 4); assert.equal(lut.input, 'shaper');
});
test('xmp: reads the real EIGACAM preset and reports what it leaves out', () => {
 const x = parseXmp(readFileSync(new URL('../dist/presets/EIGACAM-Neon-Rain.xmp', import.meta.url), 'utf8'));
 assert.equal(x.grade.basic.contrast, 42); assert.equal(x.grade.hsl.yellow[0], -55); assert.equal(x.grade.grading.highlights.hue, 320);
 assert.equal(x.partial, true); assert.match(x.notes.join(), /清晰度／紋理/);
 assert.ok(x.vignette > 0 && x.grain.amount > 0);
});
test('xmp: sidecars, metadata-only files, profiles and AI masks are told apart', () => {
 const by = Object.fromEntries(buildPack().filter(f => f.path.endsWith('.xmp')).map(f => [f.path.split('/').pop(), new TextDecoder().decode(f.bytes)]));
 const code = n => {try {parseXmp(by[n]); return 'parsed';} catch (e) {return e.code;}};
 assert.equal(code('只有描述.xmp'), 'metadata-only'); assert.equal(code('全部預設值.xmp'), 'no-adjustments'); assert.equal(code('只有 AI 遮色片.xmp'), 'unsupported-only');
 assert.equal(code('只有 profile.xmp'), 'unsupported-only'); assert.equal(code('sidecar 無設定.xmp'), 'no-adjustments'); assert.equal(code('截斷.xmp'), 'truncated'); assert.equal(code('亂碼.xmp'), 'not-xmp');
 const side = parseXmp(by['相片 sidecar.xmp']); assert.equal(side.flags.sidecar, true); assert.equal(side.grade.basic.exposure, .45); assert.equal(side.partial, true);
 assert.ok(!side.notes.some(n => /絕對色溫/.test(n)), 'As Shot white balance is not reported as ignored');
 const ai = parseXmp(by['AI 主體遮色片.xmp']); assert.equal(ai.flags.aiMask, true); assert.equal(ai.masks.length, 0); assert.match(ai.notes.join(), /AI 遮色片/);
 const prof = parseXmp(by['外部 Profile.xmp']); assert.equal(prof.flags.profile, 'Kodak Vision 500T'); assert.equal(prof.grade.basic.shadows, 30);
 assert.match(parseXmp(by['絕對色溫.xmp']).notes.join(), /絕對色溫/);
 const grad = parseXmp(by['漸層遮色片.xmp']); assert.equal(grad.partial, false); assert.equal(grad.masks.length, 1);
 assert.deepEqual([grad.masks[0].type, grad.masks[0].y0, grad.masks[0].y1, grad.masks[0].adj.ev, grad.masks[0].adj.temp], ['linear', .1, .55, -.5, -20]);
});
test('xmp: the compatibility table covers every field the converter reads', () => {
 const keys = new Set(XMP_FIELDS.flatMap(f => f.keys));
 for (const k of ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'HueAdjustmentRed', 'SaturationAdjustmentMagenta', 'ToneCurvePV2012Blue', 'SplitToningShadowHue', 'IncrementalTemperature']) assert.ok(keys.has(k), k);
 assert.ok(XMP_FIELDS.every(f => ['ok', 'approx', 'none', 'skip'].includes(f.status)));
});
test('cube: red varies fastest and lands in texture order', () => {
 const {lut} = parseCube(cube(3, (r, g, b) => [r, g * .5, b * .25]));
 const at = (r, g, b) => [...lut.data.subarray((r + g * 3 + b * 9) * 4, (r + g * 3 + b * 9) * 4 + 3)];
 assert.deepEqual(at(2, 0, 0), [1, 0, 0]); assert.deepEqual(at(0, 2, 0), [0, .5, 0]); assert.deepEqual(at(0, 0, 2), [0, 0, .25]); assert.deepEqual(at(1, 2, 2), [.5, .5, .25]);
 assert.equal(lut.input, 'display');
});
test('cube: input range, dialect keywords and damaged files', () => {
 const d = parseCube(cube(2, (r, g, b) => [r, g, b], {head: 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n'})); assert.deepEqual(d.lut.domainMax, [2, 2, 2]); assert.match(d.notes.join(), /輸入範圍/);
 assert.deepEqual(parseCube('﻿# c\r\nTITLE "x"\r\nLUT_3D_INPUT_RANGE 0.0 1.0\r\nLUT_3D_SIZE 2\r\n' + '0 0 0\r\n'.repeat(8)).lut.domainMax, [1, 1, 1]);
 assert.throws(() => parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n'), /1D/); assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n'), /筆數不符/);
 assert.throws(() => parseCube('LUT_3D_SIZE 2\n' + '0 0 x\n'.repeat(8)), /不是數值/); assert.throws(() => parseCube(''), /LUT_3D_SIZE/);
 const big = parseCube(`LUT_3D_SIZE 70\n${'0.5 0.25 0.125\n'.repeat(70 ** 3)}`); assert.equal(big.lut.size, 65); assert.ok(Math.abs(big.lut.data[4 * 1000 + 1] - .25) < 1e-6);
});
test('cube: log-input LUTs are recognised from name, title or content', () => {
 assert.equal(detectLog('SLog3_to_Rec709.cube'), 'Sony S-Log3'); assert.equal(detectLog('', 'ARRI LogC to Rec709'), 'ARRI LogC'); assert.equal(detectLog('V-Log to V709.cube'), 'Panasonic V-Log');
 for (const n of ['Analog Film.cube', 'Catalog 03.cube', 'Teal Orange.cube', 'Kodak 2383.cube', 'Dialogue.cube']) assert.equal(detectLog(n), null, n);
 assert.match(parseCube(cube(9, (r, g, b) => [r, g, b].map(v => Math.min(1, Math.max(0, (v - .12) * 2.4)))), 'Mystery.cube').log, /疑似/);
 assert.equal(parseCube(cube(9, (r, g, b) => [r ** 1.1, g, b]), 'Warm.cube').log, null);
});
test('eigacam recipes: every existing look compiles to the camera app\'s own LUT', () => {
 for (const look of LOOKS) {
  const viaFile = parseRecipeFile(JSON.stringify(look))[0], c = compileLook(viaFile, 9), ref = bakeLook(look, 9);
  assert.deepEqual([...c.lut.data], [...ref.data], look.id);
  assert.equal(c.masks.length, (look.masks ?? []).length); describeLook(viaFile);
 }
 const recipe = compileLook({base: 'transformer', masks: [{type: 'radial', adj: {ev: .5}}]}, 5);
 assert.equal(recipe.masks[0].adj.ev, .5); assert.equal(recipe.masks[0].type, 'radial');
 assert.throws(() => describeLook({base: 'nope', masks: []}), /找不到基底/); assert.throws(() => describeLook({hello: 1}), /不是 eigacam 配方/);
});
test('engine: style masks follow strength, user masks do not; neutral masks cost nothing', () => {
 const adj = {ev: .5, temp: 0, tint: 0, sat: 0, contrast: 0, hue: 0, amount: 0}, zero = {...adj, ev: 0};
 const p = packMasks([{type: 'linear', x0: 0, y0: 0, x1: 1, y1: 1, adj}], [{id: 'a', type: 'brush', layer: 2, enabled: true, adj}, {id: 'b', type: 'radial', cx: .5, cy: .5, rx: .2, ry: .2, feather: 50, enabled: true, adj: zero}], .4, null);
 assert.equal(p.count, 2); assert.ok(Math.abs(p.a[3] - .4) < 1e-6); assert.equal(p.a[4], 4); assert.equal(p.a[7], 1); assert.equal(p.d[7], 2);
 assert.equal(packMasks([], [{id: 'b', type: 'radial', cx: .5, cy: .5, rx: .2, ry: .2, feather: 50, enabled: true, adj: zero}], 1, 'b').view, 1, 'a neutral mask is still shown while selected');
 assert.deepEqual(globalGain({}), [1, 1, 1]); assert.ok(Math.abs(globalGain({exposure: 1})[1] - 2) < 1e-9);
});

test('import: the 130-file acceptance pack is sorted into the right outcomes', async () => {
 const files = buildPack(), want = expected(files), store = memoryStore(), corrupt = '電影風格/底片/銀翼殺手.xmp';
 assert.ok(files.length >= 130 && new Set(files.map(f => f.path.split('/').slice(0, -1).join('/'))).size >= 15, 'at least 100 files in nested folders');
 let ticks = 0;
 const r = await importSources([zipSource('電影動畫大全.zip', buildZip(files, {corrupt}))], store, () => ticks++);
 // The damaged entry fails, and its byte-identical copy elsewhere in the pack is therefore the first good one.
 assert.deepEqual({ok: r.ok, partial: r.partial, duplicate: r.duplicate, failed: r.failed, skipped: r.skipped, log: r.log, added: r.added}, {ok: want.ok, partial: want.partial, duplicate: want.duplicate - 1, failed: want.failed + 1, skipped: want.skipped, log: want.log, added: want.added});
 assert.equal(r.total, r.ok + r.partial + r.duplicate + r.failed + r.skipped); assert.ok(ticks > 50, 'progress is reported while the pack is read');
 assert.equal(store.records.length, r.added);
 const fail = r.items.filter(i => i.status === 'failed'); assert.ok(fail.every(i => i.detail[0]?.length > 3), 'every failure carries a reason');
 assert.match(fail.find(i => i.path.endsWith(corrupt)).detail[0], /損壞/);
 assert.ok(!r.items.some(i => /__MACOSX|DS_Store/.test(i.path)), 'macOS debris is not counted');
 // Grouped by folder inside the pack.
 assert.equal(store.records.filter(s => s.pack === '電影動畫大全/動畫風格/吉卜力/夜晚').length, 12); assert.ok(r.packs['電影動畫大全/LUT/暖色'].ok === 13);
 // Same name, different content: all kept, later ones renamed. Same name in another folder is left alone.
 assert.deepEqual(store.records.filter(s => s.pack === '電影動畫大全/同名').map(s => s.name).sort(), ['Look 01', 'Teal Orange', 'Teal Orange (2)', 'Teal Orange (3)']);
 assert.equal(store.records.filter(s => s.name === '銀翼殺手').length, 2);
 assert.equal(new Set(store.records.map(s => s.id)).size, store.records.length, 'ids are unique');
 const partial = r.items.filter(i => i.status === 'partial'); assert.ok(partial.every(i => i.detail.length), 'partial imports say what was ignored');
 assert.ok(store.records.find(s => s.name === 'SLog3_to_Rec709').tags.log);

 // Importing the same pack again adds nothing.
 const again = await importSources([zipSource('電影動畫大全.zip', buildZip(files, {corrupt}))], store);
 assert.equal(again.added, 0); assert.equal(again.duplicate, r.added + r.duplicate); assert.equal(again.failed, r.failed); assert.equal(store.records.length, r.added);
});
test('import: loose files, bad archives and a mixed selection', async () => {
 const store = memoryStore(), src = (name, text, path = '') => {const b = typeof text === 'string' ? strToU8(text) : text; return {name, path, size: b.length, bytes: b, read: async (o, l) => b.subarray(o, o + l)};};
 const r = await importSources([src('A.xmp', preset('A', {Contrast2012: 10})), src('A copy.xmp', preset('A', {Contrast2012: 10})), src('B.cube', cube(2, (r, g, b) => [r, g, b]), '我的 LUT'), src('photo.jpg', 'x'), src('broken.zip', new Uint8Array(500).fill(7)), src('empty.zip', zipSync({'readme.txt': strToU8('hi')}))], store);
 assert.deepEqual([r.ok, r.duplicate, r.skipped, r.failed, r.added], [2, 1, 2, 2, 2]);
 assert.equal(store.records.find(s => s.kind === 'cube').pack, '我的 LUT'); assert.equal(store.records.find(s => s.kind === 'xmp').pack, '單檔匯入');
 assert.match(r.items.find(i => i.path === 'broken.zip').detail[0], /不是有效的 ZIP/); assert.match(r.items.find(i => i.path === 'empty.zip').detail[0], /沒有/);
});
test('import: a library backup restores packs, names and favourites on another device', async () => {
 const a = memoryStore(); await importSources([zipSource('包.zip', buildZip(buildPack().slice(0, 30)))], a);
 const fav = [a.records[2].id, a.records[7].id], manifest = {app: 'eigastudio', version: 1, favorites: fav, files: {}}, entries = {};
 for (const s of a.records) {const path = `styles/${s.pack}/${s.file}`; entries[path] = a.bytes.get(s.hash); manifest.files[path] = {pack: s.pack, name: s.name + '★'};}
 const backup = zipSync({[MANIFEST]: strToU8(JSON.stringify(manifest)), ...entries}), b = memoryStore();
 const r = await importSources([zipSource('eigastudio-library-2026-11-14.zip', backup)], b);
 assert.equal(r.added, a.records.length); assert.equal(r.favorites, 2); assert.deepEqual([...b.favorites], fav);
 assert.deepEqual(b.records.map(s => [s.id, s.pack, s.name]), a.records.map(s => [s.id, s.pack, s.name + '★']));
});
test('import: analyze names the style and its support level', () => {
 const a = analyze('x.xmp', strToU8(preset('內部名稱', {Contrast2012: 5, Clarity2012: 10})))[0];
 assert.deepEqual([a.name, a.status, a.kind], ['內部名稱', 'partial', 'xmp']);
 assert.throws(() => analyze('x.xmp', new Uint8Array(0)), /空白/); assert.throws(() => analyze('x.txt', strToU8('a')), /不支援/);
 assert.ok(shaperEncode(1) < 1);
});
