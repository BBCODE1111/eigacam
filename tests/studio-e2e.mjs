// Browser acceptance run for EIGASTUDIO (headless Chromium via Playwright).
//   python3 -m http.server 8766 &   then   node tests/studio-e2e.mjs
// Covers: bulk ZIP import report, thumbnails on two photos, no stacking, 0% strength, persistence,
// library backup/restore, face brush + zoom + export position, recipe parity with the camera shader,
// and the phone-sized flow. Screenshots go to docs/eigastudio/.
import {createRequire} from 'node:module';
import {mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, basename} from 'node:path';
import assert from 'node:assert/strict';
import {buildPack, buildZip, expected} from './studio-fixtures.mjs';
const {chromium} = createRequire(import.meta.url)('playwright');

const URL0 = process.env.STUDIO_URL ?? 'http://localhost:8766/dist/eigastudio/', SHOTS = new URL('../docs/eigastudio/', import.meta.url).pathname, ASSETS = new URL('../dist/assets/', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'eigastudio-')), CORRUPT = '電影風格/底片/銀翼殺手.xmp';
const files = buildPack(), want = expected(files), packPath = join(tmp, 'pack.zip'), PACK = '電影動畫大全.zip';
writeFileSync(packPath, buildZip(files, {corrupt: CORRUPT}));
const results = []; const pass = (name, detail = '') => {results.push([name, detail]); console.log('✓', name, detail);};

const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
async function open(ctx) {
 const p = await ctx.newPage();
 p.on('pageerror', e => {console.log('PAGE ERROR', e.message); process.exitCode = 1;});
 p.on('console', m => {if (m.type() === 'error') console.log('console error:', m.text());});
 await p.goto(URL0); await p.waitForSelector('body[data-ready]');
 return p;
}
const idle = p => p.waitForFunction(() => eigastudio.photo && eigastudio.queue === 0 && document.getElementById('busy').hidden, null, {timeout: 120000});
const setPhoto = async (p, name) => {await p.setInputFiles('#photoInput', ASSETS + name); await p.waitForFunction(n => eigastudio.photo?.name === n, name); await idle(p);};
// Files are handed over as buffers: this container's C locale mangles non-ASCII paths on disk.
const importFile = async (p, path, name = basename(path)) => {await p.setInputFiles('#styleInput', {name, mimeType: 'application/octet-stream', buffer: readFileSync(path)}); await p.waitForFunction(() => !document.getElementById('importClose').disabled, null, {timeout: 180000}); return p.evaluate(() => eigastudio.lastReport);};
// Mean display-space RGB of a region (normalised image coordinates) of the preview canvas, rendered synchronously.
const region = (p, u, v, r = .012) => p.evaluate(([u, v, r]) => {
 eigastudio.renderNow(); const c = document.getElementById('canvas'), w = Math.max(2, Math.round(c.width * r * 2)), x = document.createElement('canvas'); x.width = x.height = w;
 const g = x.getContext('2d'); g.drawImage(c, Math.round(u * c.width - w / 2), Math.round(v * c.height - w / 2), w, w, 0, 0, w, w);
 const d = g.getImageData(0, 0, w, w).data, s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k]; return s.map(t => t / (d.length / 4));
}, [u, v, r]);
const frame = p => p.evaluate(() => {eigastudio.renderNow(); const c = document.getElementById('canvas'), x = document.createElement('canvas'); x.width = 96; x.height = 96; const g = x.getContext('2d'); g.drawImage(c, 0, 0, 96, 96); return [...g.getImageData(0, 0, 96, 96).data];});
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const lin = v => {v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;};
const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const pick = async (p, id) => {await p.evaluate(async id => {const before = eigastudio.state.styleId; document.querySelector('#packFilter').value = ''; const el = [...document.querySelectorAll('.tile')].find(t => t.dataset.id === id); el.scrollIntoView(); el.click();}, id); await p.waitForFunction(id => (eigastudio.state.styleId ?? '') === id && (!id || eigastudio.current), id); await p.waitForTimeout(350);};
const setSlider = (p, sel, value) => p.evaluate(([sel, value]) => {const i = document.querySelector(sel); i.value = value; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true}));}, [sel, value]);
const idOf = (p, name, pack) => p.evaluate(([name, pack]) => eigastudio.allStyles().find(s => s.name === name && (!pack || s.pack.endsWith(pack)))?.id, [name, pack]);
const imgPoint = async (p, u, v) => {const b = await p.locator('#canvas').boundingBox(); return [b.x + b.width * u, b.y + b.height * v];};
const thumbHashes = p => p.evaluate(() => Object.fromEntries(eigastudio.tiles.filter(t => t.done).map(t => {const d = t.canvas.getContext('2d').getImageData(0, 0, t.canvas.width, t.canvas.height).data; let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) | 0; return [t.style?.id ?? 'none', h];})));

// ============ desktop browser ============
{
 const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true});
 let p = await open(ctx);
 await setPhoto(p, 'portrait.jpg');

 // --- bulk import ---
 const t0 = Date.now(), r = await importFile(p, packPath, PACK), ms = Date.now() - t0;
 assert.deepEqual({ok: r.ok, partial: r.partial, duplicate: r.duplicate, failed: r.failed, skipped: r.skipped, log: r.log, added: r.added}, {ok: want.ok, partial: want.partial, duplicate: want.duplicate - 1, failed: want.failed + 1, skipped: want.skipped, log: want.log, added: want.added});
 assert.ok(Object.keys(r.packs).length >= 15);
 await p.screenshot({path: SHOTS + 'import-report.jpg', type: 'jpeg', quality: 78});
 pass('整包匯入', `${files.length} 個檔案（含子資料夾 ${Object.keys(r.packs).length} 個分組）→ 成功 ${r.ok}、部分 ${r.partial}、重複 ${r.duplicate}、失敗 ${r.failed}、非風格檔 ${r.skipped}、Log ${r.log}；${ms} ms`);
 await p.click('#importClose'); await idle(p);
 const again = await importFile(p, packPath, PACK); assert.equal(again.added, 0); assert.equal(again.duplicate, r.added + r.duplicate);
 pass('重複匯入同一包', `新增 0、重複 ${again.duplicate}`); await p.click('#importClose');
 const count = await p.evaluate(() => eigastudio.lib.styles.length); assert.equal(count, want.added);

 // --- thumbnails computed from the photo, lazily ---
 await idle(p);
 const tiles = await p.evaluate(() => ({all: eigastudio.tiles.length, done: eigastudio.tiles.filter(t => t.done).length}));
 assert.ok(tiles.done > 8 && tiles.done < tiles.all, 'only tiles near the viewport are rendered');
 const h1 = await thumbHashes(p); assert.ok(new Set(Object.values(h1)).size >= Object.keys(h1).length - 1, 'thumbnails differ per style');
 pass('縮圖只算看得到的', `${tiles.all} 個縮圖中先算 ${tiles.done} 個，各不相同`);

 // --- favourites, then a second photo ---
 const fav = [await idOf(p, '花樣年華'), await idOf(p, 'Look 03')];
 await p.evaluate(async ids => {for (const id of ids) await eigastudio.lib.toggleFavorite(id);}, fav);
 const a = await idOf(p, '花樣年華'), b = await idOf(p, 'Look 03'), c = await idOf(p, '情書・雪', 'eigacam');
 await pick(p, ''); const plainA = await frame(p);
 await pick(p, a); const fa = await frame(p);
 await pick(p, b); const fb = await frame(p);
 await pick(p, c); await pick(p, b); await pick(p, a); const fa2 = await frame(p);
 assert.ok(maxDiff(fa, fb) > 12 && maxDiff(fa, plainA) > 12); assert.equal(maxDiff(fa, fa2), 0);
 pass('切換風格不疊色', 'A→B→C→B→A 後與第一次的 A 逐像素相同（差 0）');
 await setSlider(p, '#strength', 0); const zero = await frame(p); assert.equal(maxDiff(zero, plainA), 0);
 await setSlider(p, '#strength', 50); const half = await frame(p); assert.ok(maxDiff(half, plainA) > 4 && maxDiff(half, fa) > 4);
 await setSlider(p, '#strength', 100); assert.equal(maxDiff(await frame(p), fa), 0);
 pass('強度', '0% 與未套用風格逐像素相同；50% 介於兩者之間；回到 100% 與原本相同');
 await p.screenshot({path: SHOTS + 'desktop-portrait.jpg', type: 'jpeg', quality: 78});

 await setPhoto(p, 'street.jpg');
 const h2 = await thumbHashes(p), shared = Object.keys(h1).filter(k => k in h2);
 assert.ok(shared.length > 8 && shared.every(k => h1[k] !== h2[k]), 'every thumbnail was recomputed from the new photo');
 assert.equal(await p.evaluate(() => eigastudio.lib.styles.length), count); assert.deepEqual(await p.evaluate(() => [...eigastudio.lib.favorites]), fav);
 assert.equal(await p.evaluate(() => eigastudio.state.styleId), a);
 const sa = await frame(p); await pick(p, b); await pick(p, a); assert.equal(maxDiff(sa, await frame(p)), 0);
 await setSlider(p, '#strength', 0); const sz = await frame(p); await pick(p, ''); assert.equal(maxDiff(sz, await frame(p)), 0); await setSlider(p, '#strength', 100);
 pass('換第二張照片', `${shared.length} 個可見縮圖全部重算且與第一張不同；風格庫 ${count} 個與收藏 ${fav.length} 個保留；不疊色、0% 還原同樣成立`);
 await pick(p, a); await p.screenshot({path: SHOTS + 'desktop-street.jpg', type: 'jpeg', quality: 78});

 // --- search / pack filter / favourites filter ---
 await p.fill('#search', '之'); await p.waitForTimeout(300); const found = await p.evaluate(() => eigastudio.tiles.map(t => t.style.name)); assert.ok(found.length >= 5 && found.every(n => n.includes('之')));
 await p.fill('#search', ''); await p.waitForTimeout(300); await p.selectOption('#packFilter', '電影動畫大全/LUT'); const lut = await p.evaluate(() => eigastudio.tiles.filter(t => t.style).length); assert.equal(lut, 30);
 await p.selectOption('#packFilter', ''); await p.click('#favOnly'); assert.deepEqual(await p.evaluate(() => eigastudio.tiles.map(t => t.style.id)), fav); await p.click('#favOnly');
 pass('搜尋、風格包篩選、收藏', `搜尋「之」${found.length} 個；LUT 包 ${lut} 個；只看收藏 ${fav.length} 個`);

 // --- persistence across a reload ---
 await p.waitForTimeout(900); await p.close(); p = await open(ctx); await idle(p);
 assert.equal(await p.evaluate(() => eigastudio.lib.styles.length), count); assert.deepEqual(await p.evaluate(() => [...eigastudio.lib.favorites]), fav);
 assert.deepEqual(await p.evaluate(() => [eigastudio.photo.name, eigastudio.state.styleId]), ['street.jpg', a]);
 pass('重開網站', `風格 ${count} 個、收藏 ${fav.length} 個、上次的照片與選用的風格都還在`);

 // --- library backup → wipe → restore ---
 const before = await p.evaluate(() => eigastudio.lib.styles.map(s => [s.id, s.pack, s.name]).sort());
 await p.click('#menuBtn'); const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=backup]')]);
 const backup = join(tmp, 'backup.zip'); await dl.saveAs(backup);
 p.once('dialog', d => d.accept()); await p.click('#menuBtn'); await p.click('[data-act=clear]'); await p.waitForFunction(() => eigastudio.lib.styles.length === 0);
 assert.equal(await p.evaluate(() => eigastudio.lib.favorites.size), 0);
 const rr = await importFile(p, backup, dl.suggestedFilename()); await p.click('#importClose');
 assert.equal(rr.added, count); assert.equal(rr.failed, 0); assert.equal(rr.favorites, fav.length);
 assert.deepEqual(await p.evaluate(() => eigastudio.lib.styles.map(s => [s.id, s.pack, s.name]).sort()), before); assert.deepEqual((await p.evaluate(() => [...eigastudio.lib.favorites])).sort(), [...fav].sort());
 pass('風格庫匯出再還原', `備份 ${(readFileSync(backup).length / 1024).toFixed(0)} KB；清空後還原 ${rr.added} 個風格，分組、名稱與 ${rr.favorites} 個收藏完全一致`);

 // --- real preset on a real photo ---
 const neon = await importFile(p, new URL('../dist/presets/EIGACAM-Neon-Rain.xmp', import.meta.url).pathname); await p.click('#importClose'); assert.equal(neon.partial, 1);
 await idle(p); await pick(p, await idOf(p, 'EIGACAM Neon Rain (Cyberpunk)')); await p.screenshot({path: SHOTS + 'xmp-neon-rain.jpg', type: 'jpeg', quality: 78});
 pass('實際 XMP 預設', 'dist/presets/EIGACAM-Neon-Rain.xmp：部分支援（忽略清晰度／紋理），已套在 street.jpg 上截圖');

 // --- eigacam recipe parity: Studio vs the camera app's own renderer ---
 const parity = await p.evaluate(async () => {
  const {Renderer} = await import('../src/engine/renderer.js'), {bakeLook} = await import('../src/color.js'), {LOOKS} = await import('../src/looks.js'), {renderSettings} = await import('../src/develop.js');
  const img = await createImageBitmap(await (await fetch('../assets/cafe.jpg')).blob()), src = document.createElement('canvas'); src.width = 480; src.height = Math.round(480 * img.height / img.width); src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
  const out = {};
  for (const id of ['loveletter', 'loveletter-library', 'loveletter-snow', 'nightcity', 'transformer', 'neonrain']) {
   const look = LOOKS.find(l => l.id === id), cam = new Renderer(document.createElement('canvas'));
   cam.setSource(src, src.width, src.height); cam.setLUT(bakeLook(look)); cam.resize(src.width, src.height);
   // The camera with its dials at their defaults (beauty off, no grain so the noise does not dominate the comparison): every look effect is on.
   cam.render(renderSettings(look, {ev: 0, strength: 100, grain: 0, glow: look.glowDefault ?? 100, sharpen: 35, warmth: 0, beauty: 0}));
   const t = eigastudio.thumbR; t.setSource('parity', src, src.width, src.height);
   const style = await eigastudio.compile(eigastudio.styleById('cam:' + id), 33);
   t.render({source: 'parity', width: src.width, height: src.height, style: {...style, grain: {amount: 0}}, strength: 1, curve: false});
   const read = c => {const x = document.createElement('canvas'); x.width = c.width; x.height = c.height; const g = x.getContext('2d'); g.drawImage(c, 0, 0); return g.getImageData(0, 0, c.width, c.height).data;};
   const a = read(cam.canvas), b = read(t.canvas); let max = 0, sum = 0, big = 0; for (let i = 0; i < a.length; i++) {if ((i & 3) === 3) continue; const d = Math.abs(a[i] - b[i]); max = Math.max(max, d); sum += d; if (d > 3) big++;}
   out[id] = [max, +(sum / (a.length * .75)).toFixed(3), +(big / (a.length * .75) * 100).toFixed(3)]; t.dropSource('parity'); cam.destroy();
  }
  return out;
 });
 for (const [id, [, mean, big]] of Object.entries(parity)) assert.ok(mean < .8 && big < .5, `${id} differs: mean ${mean}, ${big}% of values by more than 3`);
 pass('CAM 與 Studio 畫面一致', `同一張照片、同一個 eigacam 色彩，含柔焦、光暈、銳利化、膚色保護：${Object.entries(parity).map(([k, v]) => `${k} 平均差 ${v[1]}/255（差超過 3 的 ${v[2]}%）`).join('、')}`);

 // --- face: +0.5 EV with a brush, background untouched ---
 await setPhoto(p, 'portrait.jpg'); await pick(p, '');
 const FACE = [.49, .31], BG = [.12, .12], HAND = [.76, .45];
 const face0 = lum(await region(p, ...FACE)), bg0 = lum(await region(p, ...BG)), hand0 = lum(await region(p, ...HAND));
 await p.click('.tabs [data-tab=masks]'); await p.click('[data-add=brush]');
 await setSlider(p, '#maskSliders .slider:nth-child(3) input', .5); // 曝光
 let [x, y] = await imgPoint(p, ...FACE);
 await p.mouse.move(x - 14, y - 10); await p.mouse.down(); for (const [dx, dy] of [[14, -10], [14, 10], [-14, 10], [-14, -10], [0, 0], [10, 0], [-10, 0]]) await p.mouse.move(x + dx, y + dy, {steps: 4}); await p.mouse.up();
 const face1 = lum(await region(p, ...FACE)), bg1 = lum(await region(p, ...BG));
 assert.ok(Math.abs(face1 / face0 - Math.SQRT2) < .06, `face ratio ${face1 / face0}`); assert.ok(Math.abs(bg1 / bg0 - 1) < .01);
 pass('臉部刷亮半級', `臉部線性亮度 ×${(face1 / face0).toFixed(3)}（+0.5 EV 理論值 ×1.414）；背景 ×${(bg1 / bg0).toFixed(3)}`);
 // zoom in, then paint the hand: the stroke must land under the pointer
 const [zx, zy] = await imgPoint(p, .7, .4); await p.mouse.move(zx, zy); await p.mouse.wheel(0, -520); await p.waitForTimeout(100);
 const zoom = await p.evaluate(() => eigastudio.ui.z); assert.ok(zoom > 2);
 [x, y] = await imgPoint(p, ...HAND); await p.mouse.move(x - 8, y); await p.mouse.down(); for (const [dx, dy] of [[8, 0], [0, 8], [-8, 0], [0, -8], [0, 0]]) await p.mouse.move(x + dx, y + dy, {steps: 4}); await p.mouse.up();
 await p.screenshot({path: SHOTS + 'desktop-brush-zoom.jpg', type: 'jpeg', quality: 78});
 const hand1 = lum(await region(p, ...HAND, .006)), hand0s = hand0, face2 = lum(await region(p, ...FACE));
 const handRatio = hand1 / lum(await (async () => {await p.click('#maskEnable'); const v = await region(p, ...HAND, .006); await p.click('#maskEnable'); return v;})());
 assert.ok(Math.abs(handRatio - Math.SQRT2) < .08, `hand ratio ${handRatio}`); assert.ok(Math.abs(face2 / face1 - 1) < .01);
 pass('縮放後筆刷跟手', `放大到 ${Math.round(zoom * 100)}% 後在手部下筆，該處 ×${handRatio.toFixed(3)}；臉部維持不變`);
 // undo / redo
 await p.click('#undo'); const u1 = lum(await region(p, ...HAND, .006)); await p.click('#redo'); const u2 = lum(await region(p, ...HAND, .006));
 assert.ok(u1 < u2 * .8 && Math.abs(u2 / hand1 - 1) < .01); pass('復原與重做', '復原移除最後一筆，重做後恢復');
 // overlay shows the selection in colour
 await p.click('#maskOverlay'); const ov = await region(p, ...FACE); assert.ok(ov[0] > ov[1] * 1.3, 'red overlay on the painted area'); await p.screenshot({path: SHOTS + 'desktop-mask-overlay.jpg', type: 'jpeg', quality: 78}); await p.click('#maskOverlay');
 // export from the original and compare positions
 const exportMeasure = async () => {
  await p.click('#exportBtn'); await p.waitForSelector('#exportDlg[open]', {timeout: 120000});
  const m = await p.evaluate(async pts => {
   const f = eigastudio.exportFiles[0], im = await createImageBitmap(f), c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
   return {w: im.width, h: im.height, size: f.size, name: f.name, pts: pts.map(([u, v, r]) => {const w = Math.round(im.width * r * 2), d = g.getImageData(Math.round(u * im.width - w / 2), Math.round(v * im.height - w / 2), w, w).data, s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k]; return s.map(t => t / (d.length / 4));})};
  }, [[...FACE, .012], [...BG, .012], [...HAND, .006]]);
  return m;
 };
 const withMask = await exportMeasure();
 const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#exportDownload')]); const jpg = join(tmp, 'export.jpg'); await dl2.saveAs(jpg);
 await p.click('#exportDlg .dlg-actions button:last-child');
 await p.click('#maskEnable'); const noMask = await exportMeasure(); await p.click('#exportDlg .dlg-actions button:last-child'); await p.click('#maskEnable');
 const er = withMask.pts.map((c, i) => lum(c) / lum(noMask.pts[i]));
 assert.ok(Math.abs(er[0] - Math.SQRT2) < .06 && Math.abs(er[1] - 1) < .01 && Math.abs(er[2] - Math.SQRT2) < .09, `export ratios ${er}`);
 const natural = await p.evaluate(() => [eigastudio.photo.width, eigastudio.photo.height, eigastudio.photo.pw, eigastudio.photo.ph]);
 assert.deepEqual([withMask.w, withMask.h], natural.slice(0, 2)); assert.ok(natural[0] > natural[2], 'export is larger than the preview');
 const head = readFileSync(jpg); assert.ok(head[0] === 0xFF && head[1] === 0xD8);
 pass('匯出位置一致', `匯出 ${withMask.w}×${withMask.h}（預覽 ${natural[2]}×${natural[3]}）；同位置：臉 ×${er[0].toFixed(3)}、背景 ×${er[1].toFixed(3)}、手 ×${er[2].toFixed(3)}；下載 ${dl2.suggestedFilename()} ${(head.length / 1e6).toFixed(2)} MB`);

 // --- gradients, invert, global adjustments, curve ---
 await p.click('[data-add=linear]'); await setSlider(p, '#maskSliders .slider:nth-child(3) input', -1);
 const top = lum(await region(p, .12, .05)), bottom = lum(await region(p, .12, .9)); await p.click('#maskEnable'); const top0 = lum(await region(p, .12, .05)), bottom0 = lum(await region(p, .12, .9)); await p.click('#maskEnable');
 assert.ok(top / top0 < .6 && Math.abs(bottom / bottom0 - 1) < .02);
 await p.click('#maskInvert'); const topI = lum(await region(p, .12, .05)), bottomI = lum(await region(p, .12, .9)); assert.ok(Math.abs(topI / top0 - 1) < .03 && bottomI / bottom0 < .6);
 await p.click('[data-add=radial]'); await setSlider(p, '#maskSliders .slider:nth-child(6) input', -100); // 飽和度
 const cc = await region(p, .5, .45), sat = c => Math.max(...c) - Math.min(...c); assert.ok(sat(cc) < 6, 'radial mask desaturates its centre');
 assert.equal(await p.evaluate(() => eigastudio.state.masks.length), 3);
 pass('線性／放射漸層、反轉、多個遮色片', `線性 −1 EV：上緣 ×${(top / top0).toFixed(2)}、下緣 ×${(bottom / bottom0).toFixed(2)}，反轉後對調；放射遮色片中心去飽和；共 3 個遮色片並存`);
 await p.click('.tabs [data-tab=adjust]');
 const g0 = lum(await region(p, ...BG)); await setSlider(p, '#adjustSliders .slider:nth-child(1) input', 1); const g1 = lum(await region(p, ...BG)); assert.ok(Math.abs(g1 / g0 - 2) < .1);
 await setSlider(p, '#adjustSliders .slider:nth-child(1) input', 0); await setSlider(p, '#adjustSliders .slider:nth-child(7) input', -100); assert.ok(sat(await region(p, ...FACE)) < 3);
 await setSlider(p, '#adjustSliders .slider:nth-child(7) input', 0); await setSlider(p, '#adjustSliders .slider:nth-child(5) input', 60); const warm = await region(p, ...BG); assert.ok(warm[0] > warm[2]);
 await p.click('#adjustReset');
 const cb = await p.locator('#curve').boundingBox(), before2 = await region(p, ...FACE); await p.mouse.move(cb.x + cb.width * .5, cb.y + cb.height * .5); await p.mouse.down(); await p.mouse.move(cb.x + cb.width * .5, cb.y + cb.height * .3, {steps: 3}); await p.mouse.up();
 const after2 = await region(p, ...FACE); assert.ok(after2[1] > before2[1] + 10); await p.screenshot({path: SHOTS + 'desktop-adjust.jpg', type: 'jpeg', quality: 78});
 pass('全圖調整與曲線', `曝光 +1 → 線性 ×${(g1 / g0).toFixed(2)}；飽和度 −100 → 灰階；色溫 +60 → 偏暖；曲線中點上拉後畫面變亮`);
 await ctx.close();
}

// ============ phone-sized viewport with touch (emulation, not a real phone) ============
{
 const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});
 const p = await open(ctx), cdp = await ctx.newCDPSession(p);
 const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: pts.map(([x, y], id) => ({x, y, id}))});
 await p.screenshot({path: SHOTS + 'mobile-empty.jpg', type: 'jpeg', quality: 78});
 await setPhoto(p, 'portrait.jpg');
 const r = await importFile(p, packPath, PACK); assert.equal(r.added, want.added); await p.screenshot({path: SHOTS + 'mobile-import.jpg', type: 'jpeg', quality: 78}); await p.tap('#importClose'); await idle(p);
 const box = await p.locator('#exportBtn').boundingBox(); assert.ok(box.x + box.width <= 390, 'header fits the phone width');
 // swipe through the strip
 const strip = await p.locator('#styleGrid').boundingBox(), sy = strip.y + strip.height / 2; const done0 = await p.evaluate(() => eigastudio.tiles.filter(t => t.done).length);
 for (let k = 0; k < 4; k++) {await touch('touchStart', [[340, sy]]); for (let i = 1; i <= 8; i++) await touch('touchMove', [[340 - i * 36, sy]]); await touch('touchEnd', []); await p.waitForTimeout(250);}
 await idle(p); const scrolled = await p.evaluate(() => document.getElementById('styleGrid').scrollLeft); assert.ok(scrolled > 400);
 const live = await p.evaluate(() => eigastudio.tiles.filter(t => t.done).length), total = await p.evaluate(() => eigastudio.tiles.length); assert.ok(live < total / 2, 'off-screen thumbnails are released');
 const tile = p.locator('.tile[aria-selected=false]').nth(await p.evaluate(() => eigastudio.tiles.findIndex(t => t.visible && t.done && t.style) + 2)); await tile.tap(); await p.waitForFunction(() => eigastudio.state.styleId && eigastudio.current); await p.waitForTimeout(400);
 await setSlider(p, '#strength', 80); await p.screenshot({path: SHOTS + 'mobile-styles.jpg', type: 'jpeg', quality: 78});
 pass('手機尺寸：選照片 → 匯入 ZIP → 滑動挑色', `橫向滑過風格列（捲動 ${Math.round(scrolled)}px），同時存在的縮圖 ${live}/${total}；點選後套用並調強度 80%`);
 // local adjustment with a finger
 await p.tap('.tabs [data-tab=masks]'); await p.tap('[data-add=brush]'); await setSlider(p, '#maskSliders .slider:nth-child(3) input', .5);
 const FACE = [.49, .31], BG = [.12, .12];
 // The chosen style is a non-linear LUT, so the exposure ratio is measured on the picture before the style (strength 0), then strength goes back.
 await setSlider(p, '#strength', 0); await p.tap('#maskEnable'); const f0 = lum(await region(p, ...FACE)), b0 = lum(await region(p, ...BG)); await p.tap('#maskEnable');
 let [x, y] = await imgPoint(p, ...FACE); await touch('touchStart', [[x - 8, y - 6]]); for (const [dx, dy] of [[8, -6], [8, 6], [-8, 6], [-8, -6], [0, 0], [5, 0], [-5, 0]]) await touch('touchMove', [[x + dx, y + dy]]); await touch('touchEnd', []);
 const f1 = lum(await region(p, ...FACE)), b1 = lum(await region(p, ...BG)); assert.ok(Math.abs(f1 / f0 - Math.SQRT2) < .08 && Math.abs(b1 / b0 - 1) < .01, `mobile face ${f1 / f0}`);
 // two-finger pinch zooms instead of painting, then paint again while zoomed
 const data0 = await p.evaluate(() => {const m = eigastudio.state.masks[0]; return m.id;});
 [x, y] = await imgPoint(p, .6, .5); await touch('touchStart', [[x - 30, y], [x + 30, y]]); for (let i = 1; i <= 6; i++) await touch('touchMove', [[x - 30 - i * 14, y], [x + 30 + i * 14, y]]); await touch('touchEnd', []);
 const z = await p.evaluate(() => eigastudio.ui.z); assert.ok(z > 1.8); assert.ok(Math.abs(lum(await region(p, ...FACE)) / f1 - 1) < .01, 'pinch did not paint');
 const HAND = [.76, .45]; await p.tap('#maskEnable'); const h0 = lum(await region(p, ...HAND, .006)); await p.tap('#maskEnable');
 [x, y] = await imgPoint(p, ...HAND); await touch('touchStart', [[x - 6, y]]); for (const [dx, dy] of [[6, 0], [0, 6], [-6, 0], [0, -6], [0, 0]]) await touch('touchMove', [[x + dx, y + dy]]); await touch('touchEnd', []);
 const h1 = lum(await region(p, ...HAND, .006)); assert.ok(Math.abs(h1 / h0 - Math.SQRT2) < .1, `mobile hand ${h1 / h0}`);
 await setSlider(p, '#strength', 80); await p.screenshot({path: SHOTS + 'mobile-mask.jpg', type: 'jpeg', quality: 78});
 pass('手機尺寸：手指局部調整', `臉 ×${(f1 / f0).toFixed(3)}、背景 ×${(b1 / b0).toFixed(3)}；雙指放大到 ${Math.round(z * 100)}% 不會誤畫；放大後在手部下筆 ×${(h1 / h0).toFixed(3)}`);
 await p.tap('.tabs [data-tab=adjust]'); await setSlider(p, '#adjustSliders .slider:nth-child(2) input', 20); await p.screenshot({path: SHOTS + 'mobile-adjust.jpg', type: 'jpeg', quality: 78});
 // save
 await p.tap('#exportBtn'); await p.waitForSelector('#exportDlg[open]', {timeout: 120000}); await p.screenshot({path: SHOTS + 'mobile-export.jpg', type: 'jpeg', quality: 78});
 const info = await p.evaluate(() => ({name: eigastudio.exportFiles[0].name, size: eigastudio.exportFiles[0].size, share: !document.getElementById('exportShare').hidden, text: document.getElementById('exportInfo').textContent}));
 const [dl] = await Promise.all([p.waitForEvent('download'), p.tap('#exportDownload')]); assert.match(dl.suggestedFilename(), /-eigastudio\.jpg$/);
 pass('手機尺寸：儲存', `${info.text}；下載 ${dl.suggestedFilename()}；系統分享按鈕${info.share ? '有' : '未'}出現（無頭 Chromium 沒有 Web Share，需實機確認）`);
 await ctx.close();
}
await browser.close();
writeFileSync(SHOTS + 'acceptance.json', JSON.stringify({date: new Date().toISOString().slice(0, 10), environment: 'headless Chromium (Playwright), SwiftShader WebGL2', results}, null, 1));
console.log(process.exitCode ? 'FAILED' : `\n全部 ${results.length} 項通過`);
