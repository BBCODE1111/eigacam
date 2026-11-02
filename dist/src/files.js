// Decode any image the browser understands (Safari also opens HEIC), apply EXIF orientation once,
// and downscale only when the device cannot hold the full image.
export async function decodeImage(blob, maxEdge = 8192, maxPixels = 12_600_000) {
 if (!blob || !(blob.type === '' || /^image\//.test(blob.type))) throw Error('請選擇照片檔（JPEG、HEIC、PNG 或 WebP）。');
 if (blob.size > 80 * 1024 * 1024) throw Error('照片超過 80 MB，請先縮小。');
 let image;
 try {image = await createImageBitmap(blob, {imageOrientation: 'from-image'});}
 catch {image = await new Promise((resolve, reject) => {const im = new Image(), url = URL.createObjectURL(blob); im.onload = () => {URL.revokeObjectURL(url); resolve(im);}; im.onerror = () => {URL.revokeObjectURL(url); reject(Error('無法開啟這張照片。HEIC/RAW 請先轉為 JPEG。'));}; im.src = url;});}
 const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
 const s = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
 // Always hand WebGL a canvas: ImageBitmap uploads ignore UNPACK_FLIP_Y and would arrive upside down.
 const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * s)); canvas.height = Math.max(1, Math.round(height * s));
 const x = canvas.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(image, 0, 0, canvas.width, canvas.height); image.close?.();
 return {image: canvas, width: canvas.width, height: canvas.height, originalWidth: width, originalHeight: height};
}
export function release(image) {if (!image) return; if (image.close) image.close(); else if (image instanceof HTMLCanvasElement) image.width = image.height = 1;}
export function canvasBlob(canvas, type = 'image/jpeg', quality = .94) {return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('照片編碼失敗，記憶體可能不足。')), type, quality));}
export function download(blob, name) {const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);}
