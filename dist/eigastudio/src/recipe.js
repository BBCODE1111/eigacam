// eigacam's own formats, read as they are actually used by the camera app:
//  · a look object from dist/src/looks.js (colour model or `lr` settings, optional masks)
//  · a user recipe from localStorage `eigacam.recipes`: {id, name, base, masks}
//  · a JSON file holding one of those, an array of them, or {looks: [...]} / {recipes: [...]}
import {LOOKS} from '../../src/looks.js';
import {bakeLook} from '../../src/color.js';
import {sanitizeMasks} from '../../src/masks.js';
import {renderSettings} from '../../src/develop.js';

const isLook = o => o && typeof o === 'object' && (o.lr || o.tone || o.hues || o.gain || o.print || o.mono);
const isRecipe = o => o && typeof o === 'object' && typeof o.base === 'string' && Array.isArray(o.masks);
const num = v => typeof v === 'number' && Number.isFinite(v);

// Looks arrive from files, so validate shape before the colour model touches them.
function checkLook(look) {
 const fail = why => {throw Error(`配方內容無效：${why}`);};
 if (look.gain && !(Array.isArray(look.gain) && look.gain.length === 3 && look.gain.every(num))) fail('gain 需為三個數值');
 if (look.hues && !(Array.isArray(look.hues) && look.hues.length <= 32 && look.hues.every(h => Array.isArray(h) && h.length >= 4 && h.every(num)))) fail('hues 格式錯誤');
 for (const k of ['shadows', 'highlights']) if (look[k] && !(Array.isArray(look[k]) && look[k].length === 2 && look[k].every(num))) fail(`${k} 格式錯誤`);
 if (look.print && !(Array.isArray(look.print) && look.print.length === 3 && look.print.every(p => Array.isArray(p) && p.length === 3 && p.every(num)))) fail('print 格式錯誤');
 if (look.tone && typeof look.tone !== 'object') fail('tone 格式錯誤');
 if (look.lr && typeof look.lr !== 'object') fail('lr 格式錯誤');
 for (const v of bakeLook(look, 3).data) if (!Number.isFinite(v)) fail('色彩模型算出非數值');
}

export function resolveDef(def) {
 if (isRecipe(def)) {
  const base = LOOKS.find(l => l.id === def.base);
  if (!base) throw Error(`找不到基底色彩「${def.base}」（配方以 CAM 內建色彩為底）`);
  return {...base, name: def.name ?? `${base.name} 配方`, masks: def.masks};
 }
 if (!isLook(def)) throw Error('不是 eigacam 配方（需要色彩模型、lr 設定，或 base＋masks）');
 return def;
}

// → {name, compile(size)} with notes about camera-only features Studio leaves out.
export function describeLook(def) {
 const look = resolveDef(def); checkLook(look);
 return {name: String(look.name ?? look.id ?? 'eigacam 配方').slice(0, 60), notes: [], partial: false};
}
export function compileLook(def, size = 33) {
 const look = resolveDef(def);
 // Same settings the camera uses with its dials at their defaults (glow at the look's own default, no beauty smoothing).
 const s = renderSettings(look, {ev: 0, strength: 100, grain: 100, glow: look.glowDefault ?? 100, sharpen: 35, warmth: 0, beauty: 0});
 const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
 const fx = {sharpen: n(s.sharpen, 0, 1), clarity: n(s.clarity, 0, 1), soft: n(s.soft, 0, 1.5), localClarity: n(s.localClarity, -1, 0), localClarityLow: n(s.localClarityLow, .05, 1) || .595, halation: n(s.halation, 0, 2), bloom: n(s.bloom, 0, 2), glowHue: n(s.glowHue, 0, 360), glowSat: n(s.glowSat ?? .55, 0, 1), skinKeep: n(s.skinKeep, 0, 1)};
 return {lut: bakeLook(look, size), masks: sanitizeMasks(look.masks ?? []), vignette: n(s.vignette, 0, .6), grain: {amount: n(s.grain, 0, .2), size: n(s.grainSize, .5, 4) || 1.5}, fx};
}

export function parseRecipeFile(text) {
 let json; try {json = JSON.parse(text);} catch (e) {throw Error('JSON 格式錯誤：' + e.message.slice(0, 60));}
 const list = Array.isArray(json) ? json : Array.isArray(json?.looks) ? json.looks : Array.isArray(json?.recipes) ? json.recipes : [json];
 if (!list.length || list.length > 200) throw Error('檔案內沒有配方');
 if (!list.some(d => isLook(d) || isRecipe(d))) throw Error('不是 eigacam 配方（需要色彩模型、lr 設定，或 base＋masks）');
 return list;
}
export const BUILTIN = LOOKS;
