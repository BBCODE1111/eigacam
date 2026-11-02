import {Renderer} from './engine/renderer.js';
import {cropFor, outputSize} from './color.js';
import {decodeImage, release, canvasBlob} from './files.js';

// Maps the user's dials and the look's own character to renderer settings.
export function renderSettings(look, dials, extra = {}) {
 const glow = dials.glow / 100;
 return {
  exposure: dials.ev, warmth: dials.warmth / 50, strength: dials.strength / 100, sharpen: dials.sharpen / 100,
  grain: (look.grain?.amount ?? 0) * dials.grain / 100, grainSize: look.grain?.size ?? 1.5,
  halation: (look.glow?.halation ?? 0) * glow, bloom: (look.glow?.bloom ?? 0) * glow, glowHue: look.glow?.hue ?? 20,
  vignette: look.vignette ?? .12, ...extra
 };
}

let shared;
function exporter() {
 if (shared && !shared.lost) return shared;
 shared = new Renderer(document.createElement('canvas'));
 return shared;
}

// Develops a full-resolution JPEG: decode once, crop to the cinema frame, grade on the GPU.
export async function develop(blob, {lut, settings, ratio}) {
 const r = exporter();
 const decoded = await decodeImage(blob, r.maxEdge, r.maxPixels);
 try {
  const crop = cropFor(decoded.width, decoded.height, ratio);
  const size = outputSize(decoded.width, decoded.height, crop, r.maxEdge, r.maxPixels);
  r.setSource(decoded.image, decoded.width, decoded.height); r.setLUT(lut); r.resize(size.width, size.height);
  r.render({...settings, crop});
  const jpeg = await canvasBlob(r.canvas, 'image/jpeg', .94);
  const thumb = document.createElement('canvas'), t = 240 / Math.max(size.width, size.height);
  thumb.width = Math.round(size.width * t); thumb.height = Math.round(size.height * t);
  const x = thumb.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(r.canvas, 0, 0, thumb.width, thumb.height);
  return {jpeg, thumb: await canvasBlob(thumb, 'image/jpeg', .8), width: size.width, height: size.height};
 } finally {release(decoded.image);}
}
