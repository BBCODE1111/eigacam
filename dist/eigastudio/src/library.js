// Style library on this device (IndexedDB). Metadata and source bytes live in separate stores so
// the list loads instantly while LUT data is fetched only for styles that are actually drawn.
import {deflateSync, inflateSync, zipSync, strToU8} from '../vendor/fflate.js';
import {MANIFEST} from './importer.js';

const req = r => new Promise((res, rej) => {r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);});
const done = tx => new Promise((res, rej) => {tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error ?? Error('儲存失敗'));});

export class Library {
 static async open(name = 'eigastudio') {
  const lib = new Library();
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => {const db = open.result; db.createObjectStore('styles', {keyPath: 'id'}); db.createObjectStore('sources'); db.createObjectStore('meta');};
  lib.db = await req(open);
  lib.styles = (await req(lib.db.transaction('styles').objectStore('styles').getAll())).sort((a, b) => a.addedAt - b.addedAt || a.seq - b.seq);
  lib.hashes = new Set(lib.styles.map(s => s.hash));
  lib.favorites = new Set(await lib.getMeta('favorites') ?? []);
  lib.seq = lib.styles.reduce((m, s) => Math.max(m, s.seq ?? 0), 0);
  navigator.storage?.persist?.().catch(() => {});
  return lib;
 }
 getMeta(key) {return req(this.db.transaction('meta').objectStore('meta').get(key));}
 setMeta(key, value) {const tx = this.db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(value, key); return done(tx);}
 has(hash) {return this.hashes.has(hash);}
 nameTaken(pack, name) {const n = name.toLowerCase(); return this.styles.some(s => s.pack === pack && s.name.toLowerCase() === n);}
 async add(record, bytes) {
  record.seq = ++this.seq;
  const tx = this.db.transaction(['styles', 'sources'], 'readwrite');
  tx.objectStore('styles').put(record);
  if (!this.hashes.has(record.hash)) tx.objectStore('sources').put(deflateSync(bytes, {level: 4}), record.hash);
  await done(tx);
  this.styles.push(record); this.hashes.add(record.hash);
 }
 async source(hash) {const z = await req(this.db.transaction('sources').objectStore('sources').get(hash)); if (!z) throw Error('風格資料遺失，請重新匯入'); return inflateSync(z);}
 async remove(ids) {
  const set = new Set(ids), gone = this.styles.filter(s => set.has(s.id));
  this.styles = this.styles.filter(s => !set.has(s.id));
  const keep = new Set(this.styles.map(s => s.hash)), tx = this.db.transaction(['styles', 'sources'], 'readwrite');
  for (const s of gone) {tx.objectStore('styles').delete(s.id); if (!keep.has(s.hash)) {tx.objectStore('sources').delete(s.hash); this.hashes.delete(s.hash);} this.favorites.delete(s.id);}
  await done(tx); await this.saveFavorites();
 }
 saveFavorites() {return this.setMeta('favorites', [...this.favorites]);}
 async toggleFavorite(id) {this.favorites.has(id) ? this.favorites.delete(id) : this.favorites.add(id); await this.saveFavorites(); return this.favorites.has(id);}
 // Used when restoring a backup: ids are content hashes, so they survive the round trip.
 async setFavorites(ids) {let n = 0; for (const id of ids) if (!this.favorites.has(id)) {this.favorites.add(id); n++;} await this.saveFavorites(); return n;}
 // One ZIP holding every original file plus a manifest; importing it anywhere restores packs, names and favourites.
 async exportZip(onProgress = () => {}) {
  const files = {}, manifest = {app: 'eigastudio', version: 1, exportedAt: new Date().toISOString(), favorites: [...this.favorites], files: {}}, used = new Set(), byHash = new Map();
  const safe = s => s.replace(/[\\:*?"<>|\u0000-\u001f]/g, '_');
  let i = 0;
  for (const s of this.styles) {
   onProgress(++i / this.styles.length);
   if (byHash.has(s.hash)) continue; // multi-style files are stored once
   let path = `styles/${safe(s.pack)}/${safe(s.file)}`;
   if (used.has(path.toLowerCase())) path = path.replace(/(\.[a-z0-9]+)$/i, `~${s.hash.slice(0, 8)}$1`);
   used.add(path.toLowerCase()); byHash.set(s.hash, path);
   files[path] = [await this.source(s.hash), {level: 6}];
   const many = this.styles.filter(x => x.hash === s.hash).length > 1;
   manifest.files[path] = {pack: s.pack, ...(many ? {} : {name: s.name})};
   if (i % 20 === 0) await new Promise(r => setTimeout(r));
  }
  return new Blob([zipSync({[MANIFEST]: [strToU8(JSON.stringify(manifest)), {level: 6}], ...files})], {type: 'application/zip'});
 }
}
