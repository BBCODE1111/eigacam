// Bulk style import: files and ZIP archives → validated library records plus a report.
// Pure logic (no DOM), so the same code runs in the browser and under `node --test`.
import {Unzip, UnzipInflate} from '../vendor/fflate.js';
import {parseXmp, XmpError} from './xmp.js';
import {parseCube} from './cube.js';
import {parseRecipeFile, describeLook} from './recipe.js';

export const MANIFEST = 'eigastudio-library.json';
const LIMITS = {xmp: 4e6, cube: 48e6, json: 4e6};
const KINDS = {xmp: 'xmp', cube: 'cube', json: 'eigacam'};
const JUNK = /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
export const extOf = name => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
export const baseName = path => path.split('/').pop();
const stem = name => name.replace(/\.[a-z0-9]+$/i, '');

export async function sha256(bytes) {
 const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
 let s = ''; for (const b of d) s += b.toString(16).padStart(2, '0');
 return s;
}
export function decodeText(bytes) {
 if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
 if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
 return new TextDecoder('utf-8').decode(bytes);
}

// One file → the styles it holds. Throws with a readable reason when nothing usable is inside.
export function analyze(name, bytes) {
 const ext = extOf(name), kind = KINDS[ext];
 if (!kind) throw Error('不支援的檔案類型');
 if (!bytes.length) throw Error('空白檔案（0 位元組）');
 if (bytes.length > LIMITS[ext]) throw Error(`檔案過大（${(bytes.length / 1e6).toFixed(1)} MB）`);
 const text = decodeText(bytes);
 if (kind === 'xmp') {
  const x = parseXmp(text);
  return [{kind, name: x.name || stem(name), status: x.partial ? 'partial' : 'ok', notes: x.notes, tags: {...(x.flags.profile ? {profile: x.flags.profile} : {}), ...(x.flags.aiMask ? {aiMask: true} : {}), ...(x.flags.sidecar ? {sidecar: true} : {}), masks: x.masks.length}}];
 }
 if (kind === 'cube') {
  const c = parseCube(text, name);
  const notes = [...c.notes]; if (c.log) notes.unshift(`預期輸入為 ${c.log}：這類 LUT 是給相機 Log 影片用的，套在一般 SDR 照片上通常會對比過強、顏色過濃`);
  return [{kind, name: stem(name), status: 'ok', notes, tags: {size: c.lut.size, ...(c.log ? {log: c.log} : {})}}];
 }
 const out = [], errors = [];
 parseRecipeFile(text).forEach((def, sub) => {
  try {const d = describeLook(def); out.push({kind, sub, name: d.name, status: d.partial ? 'partial' : 'ok', notes: d.notes, tags: {masks: (def.masks ?? []).length}});}
  catch (e) {errors.push(e.message);}
 });
 if (!out.length) throw Error(errors[0] ?? '檔案內沒有可用的配方');
 if (errors.length) out[0].notes = [...out[0].notes, `同檔另有 ${errors.length} 個配方無效：${errors[0]}`];
 return out;
}

// Streams a ZIP without holding the whole archive in memory. `read(offset, length)` returns bytes.
// Each wanted entry is handed to onEntry; a damaged entry is reported and the rest carries on.
export async function expandZip({size, read}, {want, onEntry, onError, onProgress, maxEntry = 64e6, maxEntries = 20000}) {
 const queue = []; let seen = 0, fatal = null;
 const uz = new Unzip(); uz.register(UnzipInflate);
 uz.onfile = f => {
  if (f.name.endsWith('/')) return;
  if (++seen > maxEntries) return;
  if (!want(f.name)) {queue.push({name: f.name, skipped: true}); return;}
  if (f.originalSize > maxEntry) {queue.push({name: f.name, error: `解壓後超過 ${maxEntry / 1e6} MB`}); return;}
  const chunks = []; let total = 0, done = false;
  f.ondata = (err, chunk, final) => {
   if (done) return;
   if (err) {done = true; queue.push({name: f.name, error: 'ZIP 內的資料損壞，無法解壓'}); return;}
   total += chunk.length;
   if (total > maxEntry) {done = true; try {f.terminate();} catch {} queue.push({name: f.name, error: `解壓後超過 ${maxEntry / 1e6} MB`}); return;}
   chunks.push(chunk);
   if (final) {done = true; const bytes = new Uint8Array(total); let o = 0; for (const c of chunks) {bytes.set(c, o); o += c.length;} queue.push({name: f.name, bytes});}
  };
  try {f.start();} catch (e) {done = true; queue.push({name: f.name, error: f.compression !== 0 && f.compression !== 8 ? `不支援的壓縮方式（${f.compression}）` : 'ZIP 內的資料損壞，無法解壓'});}
 };
 const STEP = 1 << 18;
 for (let off = 0; off < size && !fatal; off += STEP) {
  const chunk = await read(off, Math.min(STEP, size - off));
  try {uz.push(chunk, off + STEP >= size);} catch (e) {fatal = e;}
  while (queue.length) {const e = queue.shift(); if (e.error) await onError(e.name, e.error); else await onEntry(e.name, e.bytes, e.skipped);}
  onProgress?.(Math.min(1, (off + STEP) / size));
 }
 return {entries: seen, fatal};
}

// Report shape shared by the UI and the tests.
export const newReport = () => ({total: 0, ok: 0, partial: 0, duplicate: 0, failed: 0, skipped: 0, log: 0, added: 0, packs: {}, items: [], favorites: 0});

// sources: [{name, path?, size, read(offset,len), bytes?}] — loose files (path = folder path when known) or ZIPs.
// store: {has(hash), nameTaken(pack, name), add(record, bytes), setFavorites(ids)}.
export async function importSources(sources, store, onProgress = () => {}) {
 const report = newReport(), batch = new Set(), names = new Set();
 let manifest = null, progress = {file: '', done: 0, of: sources.length, fraction: 0};
 const tick = () => onProgress(report, progress);
 const pack = p => (report.packs[p] ??= {ok: 0, partial: 0, duplicate: 0, failed: 0});
 const note = (path, packName, status, detail, name) => {
  report.total++; report[status]++; if (status !== 'skipped') pack(packName)[status]++;
  if (status !== 'ok' || detail?.length) report.items.push({path, pack: packName, status, name, detail: [detail].flat().filter(Boolean)});
 };
 const uniqueName = (packName, name) => {
  const taken = x => names.has(packName + '\n' + x.toLowerCase()) || store.nameTaken(packName, x);
  let out = name, n = 1; while (taken(out)) out = `${name} (${++n})`;
  names.add(packName + '\n' + out.toLowerCase()); return out;
 };
 const handle = async (path, bytes, packName, displayName) => {
  const file = baseName(path);
  try {
   const hash = await sha256(bytes);
   if (batch.has(hash) || await store.has(hash)) {note(path, packName, 'duplicate', '內容與已有的風格完全相同，已略過'); batch.add(hash); return;}
   const styles = analyze(file, bytes); batch.add(hash);
   for (const s of styles) {
    const id = hash.slice(0, 20) + (s.sub ? '-' + s.sub : ''), wanted = (styles.length === 1 && displayName) || s.name, name = uniqueName(packName, wanted);
    await store.add({id, hash, sub: s.sub ?? 0, name, pack: packName, file, kind: s.kind, status: s.status, notes: s.notes, tags: s.tags, size: bytes.length, addedAt: Date.now()}, bytes);
    report.added++; if (s.tags?.log) report.log++;
    note(path, packName, s.status, [...(name !== wanted ? [`同名但內容不同，已保留為「${name}」`] : []), ...s.notes], name);
   }
  } catch (e) {note(path, packName, 'failed', e instanceof XmpError || e instanceof Error ? e.message : String(e));}
  tick();
 };
 for (const src of sources) {
  progress = {...progress, file: src.name, fraction: 0}; tick();
  const ext = extOf(src.name);
  if (ext === 'zip') {
   const root = stem(src.name), dirOf = p => {const parts = p.split('/').slice(0, -1); if (parts[0] === root) parts.shift(); return [root, ...parts].join('/');};
   let any = false;
   const res = await expandZip(src, {
    want: n => !JUNK.test(n) && (n === MANIFEST || extOf(n) in KINDS),
    onProgress: f => {progress = {...progress, fraction: f}; tick();},
    onError: async (n, why) => {any = true; note(`${src.name}/${n}`, dirOf(n), 'failed', why); tick();},
    onEntry: async (n, bytes, skipped) => {
     if (JUNK.test(n)) return;
     if (skipped) {note(`${src.name}/${n}`, dirOf(n), 'skipped', extOf(n) === 'zip' ? 'ZIP 內的 ZIP 不會展開，請先解開' : '不是風格檔'); return;}
     any = true;
     if (n === MANIFEST) {try {const m = JSON.parse(decodeText(bytes)); if (m?.app === 'eigastudio' && m.files && typeof m.files === 'object') manifest = m;} catch {} return;}
     const m = manifest?.files[n];
     await handle(`${src.name}/${n}`, bytes, m?.pack ? String(m.pack).slice(0, 200) : dirOf(n), m?.name ? String(m.name).slice(0, 80) : null);
    }
   }).catch(e => ({fatal: e, entries: 0}));
   if (res.fatal || !res.entries) note(src.name, stem(src.name), 'failed', res.entries ? 'ZIP 結構損壞，後半部無法讀取' : '不是有效的 ZIP，或檔案已損壞');
   else if (!any) note(src.name, root, 'failed', 'ZIP 內沒有 .xmp、.cube 或 eigacam 配方');
  } else if (JUNK.test(src.name)) {
  } else if (!(ext in KINDS)) note(src.path ? `${src.path}/${src.name}` : src.name, src.path || '單檔匯入', 'skipped', '不是風格檔');
  else if (src.size > LIMITS[ext]) note(src.name, src.path || '單檔匯入', 'failed', `檔案過大（${(src.size / 1e6).toFixed(1)} MB）`);
  else {
   let bytes; try {bytes = src.bytes ?? await src.read(0, src.size);} catch {note(src.name, src.path || '單檔匯入', 'failed', '無法讀取檔案'); continue;}
   await handle(src.path ? `${src.path}/${src.name}` : src.name, bytes, src.path || '單檔匯入');
  }
  progress = {...progress, done: progress.done + 1, fraction: 1}; tick();
 }
 if (manifest?.favorites?.length) report.favorites = await store.setFavorites(manifest.favorites.filter(x => typeof x === 'string').slice(0, 5000)) ?? 0;
 return report;
}
