// The film roll: every shot is kept on this device (IndexedDB) until the user deletes it.
// Metadata and thumbnails live apart from the large original / developed files.
const DB = 'eigacam-roll', VERSION = 1;
let opening;
function open() {
 return opening ??= new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, VERSION);
  req.onupgradeneeded = () => {const db = req.result; if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots', {keyPath: 'id'}); if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');};
  req.onsuccess = () => resolve(req.result); req.onerror = () => {opening = null; reject(Error('無法使用裝置儲存空間，照片只會保留到關閉頁面。'));};
 });
}
const done = tx => new Promise((resolve, reject) => {tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error ?? Error('儲存失敗，裝置空間可能不足。'));});
const result = req => new Promise((resolve, reject) => {req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);});

export async function addShot(shot, original, developed) {
 const db = await open(), tx = db.transaction(['shots', 'files'], 'readwrite');
 tx.objectStore('shots').put(shot); tx.objectStore('files').put(original, shot.id + ':original'); tx.objectStore('files').put(developed, shot.id + ':developed');
 await done(tx); return shot;
}
export async function updateShot(shot, developed) {
 const db = await open(), tx = db.transaction(['shots', 'files'], 'readwrite');
 tx.objectStore('shots').put(shot); if (developed) tx.objectStore('files').put(developed, shot.id + ':developed');
 await done(tx);
}
export async function listShots() {const db = await open(); const all = await result(db.transaction('shots').objectStore('shots').getAll()); return all.sort((a, b) => b.created - a.created);}
export async function getFile(id, kind) {const db = await open(); return result(db.transaction('files').objectStore('files').get(id + ':' + kind));}
export async function deleteShots(ids) {
 const db = await open(), tx = db.transaction(['shots', 'files'], 'readwrite');
 for (const id of ids) {tx.objectStore('shots').delete(id); tx.objectStore('files').delete(id + ':original'); tx.objectStore('files').delete(id + ':developed');}
 await done(tx);
}
export async function persist() {try {return await navigator.storage?.persist?.();} catch {return false;}}
