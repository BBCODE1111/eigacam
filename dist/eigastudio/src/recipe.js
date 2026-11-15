// eigacam's own formats, read as they are actually used by the camera app:
//  · a look object from dist/src/looks.js (colour model or `lr` settings, optional masks)
//  · a user recipe from localStorage `eigacam.recipes`: {id, name, base, masks}
//  · a JSON file holding one of those, an array of them, or {looks: [...]} / {recipes: [...]}
import {LOOKS} from '../../src/looks.js';
import {bakeLook} from '../../src/color.js';
import {sanitizeMasks} from '../../src/masks.js';

const CAM_ONLY = [['glow', '光暈'], ['soft', '柔焦'], ['skin', '膚色獨立渲染'], ['clarity', '光影強調'], ['localClarity', '局部柔化'], ['detail', '銳利化']];
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
 const left = CAM_ONLY.filter(([k]) => k === 'glow' ? (look.glow?.halation || look.glow?.bloom) : look[k]).map(x => x[1]);
 return {name: String(look.name ?? look.id ?? 'eigacam 配方').slice(0, 60), notes: left.length ? [`CAM 專用效果不套用：${left.join('、')}（Studio 套用色彩、遮色片、暗角與顆粒）`] : [], partial: left.length > 0};
}
export function compileLook(def, size = 33) {
 const look = resolveDef(def);
 return {lut: bakeLook(look, size), masks: sanitizeMasks(look.masks ?? []), vignette: Math.min(.6, Math.max(0, Number(look.vignette ?? .12) || 0)), grain: {amount: Math.min(.2, Math.max(0, Number(look.grain?.amount) || 0)), size: Math.min(4, Math.max(.5, Number(look.grain?.size) || 1.5))}};
}

export function parseRecipeFile(text) {
 let json; try {json = JSON.parse(text);} catch (e) {throw Error('JSON 格式錯誤：' + e.message.slice(0, 60));}
 const list = Array.isArray(json) ? json : Array.isArray(json?.looks) ? json.looks : Array.isArray(json?.recipes) ? json.recipes : [json];
 if (!list.length || list.length > 200) throw Error('檔案內沒有配方');
 if (!list.some(d => isLook(d) || isRecipe(d))) throw Error('不是 eigacam 配方（需要色彩模型、lr 設定，或 base＋masks）');
 return list;
}
export const BUILTIN = LOOKS;
