// .xmp grading preset reader (camera-raw-settings schema). The file is untrusted input: every number is clamped.
// XMP_FIELDS is the single source for both the converter and the compatibility table shown to the user.

const COLOURS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
const per = prefix => COLOURS.map(c => prefix + c);
// status: ok = 依欄位值直接套用 · approx = 以自家公式換算 · none = 未支援（會列為「已忽略」）· skip = 與調色無關，不提示
export const XMP_FIELDS = [
 {label: '曲線（點曲線，含 RGB 各通道）', keys: ['ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue'], status: 'ok', note: '節點照原值套用；節點間用保形三次插值，不同軟體的曲線內插可能略有差異'},
 {label: '飽和度', keys: ['Saturation'], status: 'ok', note: '以亮度為軸的線性飽和度'},
 {label: '黑白', keys: ['ConvertToGrayscale', 'Treatment'], status: 'ok', note: 'Rec.709 亮度轉灰階'},
 {label: '曝光', keys: ['Exposure2012'], status: 'approx', note: '線性光 ×2^EV，正值加高光滾降'},
 {label: '對比', keys: ['Contrast2012'], status: 'approx', note: '以中灰為支點的 S 曲線'},
 {label: '高光／陰影', keys: ['Highlights2012', 'Shadows2012'], status: 'approx', note: '亮度區段加權，不含局部色調對應'},
 {label: '白色／黑色', keys: ['Whites2012', 'Blacks2012'], status: 'approx'},
 {label: '色溫／色調（相對值）', keys: ['IncrementalTemperature', 'IncrementalTint'], status: 'approx', note: 'JPEG／PNG 用的相對白平衡'},
 {label: '鮮豔度', keys: ['Vibrance'], status: 'approx', note: '低飽和顏色加得多，沒有膚色保護'},
 {label: '色彩混合 HSL', keys: [...per('HueAdjustment'), ...per('SaturationAdjustment'), ...per('LuminanceAdjustment')], status: 'approx', note: '八個色相帶線性內插'},
 {label: '黑白混色', keys: per('GrayMixer'), status: 'approx'},
 {label: '顏色分級／分離色調', keys: ['SplitToningShadowHue', 'SplitToningShadowSaturation', 'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'SplitToningBalance', 'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat', 'ColorGradeShadowLum', 'ColorGradeMidtoneLum', 'ColorGradeHighlightLum', 'ColorGradeBlending', 'ColorGradeGlobalHue', 'ColorGradeGlobalSat', 'ColorGradeGlobalLum'], status: 'approx'},
 {label: '參數曲線（區段）', keys: ['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights', 'ParametricShadowSplit', 'ParametricMidtoneSplit', 'ParametricHighlightSplit'], status: 'approx'},
 {label: '去朦朧', keys: ['Dehaze'], status: 'approx', note: '以對比與飽和度模擬，沒有霧氣估計'},
 {label: '暗角', keys: ['PostCropVignetteAmount'], status: 'approx', note: '只取數量；中點、圓度、羽化用固定值'},
 {label: '顆粒', keys: ['GrainAmount', 'GrainSize'], status: 'approx'},
 {label: '線性漸層／放射漸層遮色片', keys: ['GradientBasedCorrections', 'CircularGradientBasedCorrections', 'MaskGroupBasedCorrections'], status: 'approx', note: '轉成 Studio 遮色片：曝光、色溫、色調、飽和、對比、染色；放射漸層的旋轉角度忽略'},
 {label: '清晰度／紋理', keys: ['Clarity2012', 'Texture'], status: 'none', note: '需要多尺度局部對比'},
 {label: '絕對色溫／色調（Kelvin）', keys: ['Temperature', 'Tint'], status: 'none', note: '只對 RAW 有意義；JPEG 沒有原始白平衡可換算'},
 {label: '相機校正', keys: ['ShadowTint', 'RedHue', 'RedSaturation', 'GreenHue', 'GreenSaturation', 'BlueHue', 'BlueSaturation'], status: 'none'},
 {label: 'Profile／Look 查色表', keys: ['Look', 'CameraProfile', 'LookTable', 'RGBTable', 'Table_'], status: 'none', note: '專用編碼或外部 profile，無法解碼'},
 {label: 'AI 遮色片（主體、天空、背景、人物）', keys: ['Mask/Image'], status: 'none', note: '需要影像辨識模型'},
 {label: '筆刷遮色片、範圍遮色片、組合遮色片', keys: ['PaintBasedCorrections', 'Mask/Paint', 'Mask/RangeMask'], status: 'none'},
 {label: '點顏色、鏡頭模糊、修復', keys: ['PointColors', 'LensBlur', 'RetouchInfo', 'RetouchAreas'], status: 'none'},
 {label: '舊版處理版本的色調欄位', keys: ['Exposure', 'Brightness', 'Contrast', 'Shadows', 'FillLight', 'HighlightRecovery'], status: 'none', note: 'PV2010 以前；請以新版處理版本重新匯出預設'},
 {label: '銳利化、雜訊、鏡頭校正、裁切、幾何', keys: ['Sharpness', 'LuminanceSmoothing', 'ColorNoiseReduction', 'LensProfileEnable', 'CropTop', 'PerspectiveVertical'], status: 'skip', note: '不屬於調色，匯入時略過且不提示'}
];
const DEFAULTS = {ColorGradeBlending: 50, ParametricShadowSplit: 25, ParametricMidtoneSplit: 50, ParametricHighlightSplit: 75, GrainSize: 25, Brightness: 50, Contrast: 25, Shadows: 5};
const DEPENDENT = new Set(['SplitToningShadowHue', 'SplitToningHighlightHue', 'ColorGradeMidtoneHue', 'ColorGradeGlobalHue', 'SplitToningBalance', 'ColorGradeBlending', 'GrainSize', 'ParametricShadowSplit', 'ParametricMidtoneSplit', 'ParametricHighlightSplit']); // only matter together with another field
const FIELD = new Map(); for (const row of XMP_FIELDS) for (const k of row.keys) FIELD.set(k, row);
const BLOCKS = ['Look', 'MaskGroupBasedCorrections', 'GradientBasedCorrections', 'CircularGradientBasedCorrections', 'PaintBasedCorrections', 'RetouchInfo', 'RetouchAreas', 'PointColors', 'RangeMaskMapInfo'];
const STOCK_PROFILE = /^(Adobe (Standard|Color|Monochrome|Landscape|Portrait|Vivid|Neutral)|Embedded|Color|Monochrome|ACR \d.*|Default Color)$/i;

export class XmpError extends Error {constructor(code, message) {super(message); this.code = code;}}
const unescape = s => s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([\da-f]+));/gi, (_, n, d, x) => d ? String.fromCodePoint(+d) : x ? String.fromCodePoint(parseInt(x, 16)) : ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"})[n.toLowerCase()]);
const attrs = tag => Object.fromEntries([...tag.matchAll(/\bcrs:([\w]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function parseXmp(text) {
 text = String(text);
 if (text.length > 4_000_000) throw new XmpError('too-large', 'XMP 超過 4 MB，不像是預設檔');
 if (text.includes('\u0000') || !/<x:xmpmeta|<rdf:RDF/.test(text)) throw new XmpError('not-xmp', '不是有效的 XMP（找不到 x:xmpmeta／rdf:RDF）');
 if (!/<\/rdf:RDF>/.test(text)) throw new XmpError('truncated', 'XMP 不完整（缺少結尾標籤），檔案可能損壞');
 const hasCrs = /\bcrs:\w+/.test(text.replace(/xmlns:crs="[^"]*"/g, ''));
 const sidecar = !/crs:PresetType/.test(text) && (/crs:RawFileName/.test(text) || /\b(exif:DateTimeOriginal|exif:ExposureTime|tiff:Make|aux:Lens)\b/.test(text));
 if (!hasCrs) throw new XmpError('metadata-only', sidecar ? '相片 sidecar 只有拍攝與描述資料，沒有調色設定' : '只有描述資料（評等、關鍵字、版權等），沒有 Camera Raw 調色欄位');

 // Nested blocks carry their own parameter sets; lift them out before reading the global sliders.
 const blocks = {}; let flat = text;
 for (const tag of BLOCKS) flat = flat.replace(new RegExp(`<crs:${tag}[\\s>][\\s\\S]*?</crs:${tag}>`, 'g'), m => {(blocks[tag] ??= []).push(m); return '';});
 const raw = attrs(flat);
 for (const m of flat.matchAll(/<crs:(\w+)>\s*([^<]+?)\s*<\/crs:\1>/g)) raw[m[1]] ??= m[2];
 const seqs = {};
 for (const m of flat.matchAll(/<crs:(\w+)>\s*<rdf:Seq>([\s\S]*?)<\/rdf:Seq>\s*<\/crs:\1>/g)) seqs[m[1]] = [...m[2].matchAll(/<rdf:li>\s*([^<]*?)\s*<\/rdf:li>/g)].map(x => x[1]);
 const name = unescape(text.match(/<crs:Name>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]{1,120})<\/rdf:li>/)?.[1]?.trim() ?? '');

 const applied = new Set(), ignored = new Map(); // label → detail
 const num = (k, lo = -100, hi = 100) => {const v = parseFloat(raw[k]); return Number.isFinite(v) ? clampN(v, lo, hi) : (DEFAULTS[k] ?? 0);};
 const active = k => k in raw && Number.isFinite(parseFloat(raw[k])) && Math.abs(parseFloat(raw[k]) - (DEFAULTS[k] ?? 0)) > 1e-6;
 const pv2012 = ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012'].some(k => k in raw);
 for (const k of Object.keys(raw)) {
  const row = FIELD.get(k); if (!row || row.status === 'skip' || DEPENDENT.has(k) || !active(k)) continue;
  if (row.status !== 'none') {applied.add(row.label); continue;}
  if (['Temperature', 'Tint'].includes(k)) {if (raw.WhiteBalance && raw.WhiteBalance !== 'As Shot') ignored.set(row.label, `${k} ${raw[k]}`); continue;}
  if (row.keys.includes('Brightness')) {if (!pv2012) ignored.set(row.label, ''); continue;}
  ignored.set(row.label, ((ignored.get(row.label) ?? '') + ` ${k} ${raw[k]}`).trim());
 }

 const curve = k => {
  const pts = (seqs[k] ?? []).slice(0, 32).map(s => s.split(',').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite)).map(p => [clampN(p[0] / 255, 0, 1), clampN(p[1] / 255, 0, 1)]).sort((a, b) => a[0] - b[0]).filter((p, i, a) => !i || p[0] > a[i - 1][0]);
  return pts.length >= 2 && !pts.every(p => Math.abs(p[0] - p[1]) < .004) ? pts : null;
 };
 const identity = [[0, 0], [1, 1]], curves = {m: curve('ToneCurvePV2012'), r: curve('ToneCurvePV2012Red'), g: curve('ToneCurvePV2012Green'), b: curve('ToneCurvePV2012Blue')};
 const hasCurves = Object.values(curves).some(Boolean);
 if (hasCurves) applied.add(FIELD.get('ToneCurvePV2012').label);

 const look = blocks.Look?.[0], lookName = look ? unescape(attrs(look).Name ?? look.match(/<crs:Name>([^<]*)</)?.[1] ?? '') : '';
 let mono = /^true$/i.test(raw.ConvertToGrayscale ?? '') || /black\s*&\s*white/i.test(raw.Treatment ?? '') || /monochrome/i.test(lookName);
 if (mono) applied.add(FIELD.get('Treatment').label);
 const flags = {sidecar, profile: null, aiMask: false};
 if (lookName && !STOCK_PROFILE.test(lookName)) flags.profile = lookName;
 else if (raw.CameraProfile && !STOCK_PROFILE.test(raw.CameraProfile) && !/^Camera /i.test(raw.CameraProfile)) flags.profile = raw.CameraProfile;
 const embeddedTable = /crs:(RGBTable|LookTable)\s*=|<crs:(RGBTable|LookTable)>|crs:Table_[0-9A-F]{8}/.test(text);
 if (flags.profile) ignored.set(FIELD.get('Look').label, `依賴 profile「${flags.profile}」${embeddedTable ? '（內嵌查色表未解碼）' : '（需另外安裝）'}`);
 else if (embeddedTable) {flags.profile = '內嵌查色表'; ignored.set(FIELD.get('Look').label, '內嵌查色表未解碼');}

 const hslOn = COLOURS.some(c => ['Hue', 'Saturation', 'Luminance'].some(p => active(p + 'Adjustment' + c)));
 const grade = {
  basic: {exposure: num('Exposure2012', -5, 5), contrast: num('Contrast2012'), highlights: num('Highlights2012'), shadows: num('Shadows2012'), whites: num('Whites2012'), blacks: num('Blacks2012'), temp: num('IncrementalTemperature'), tint: num('IncrementalTint'), vibrance: num('Vibrance'), saturation: num('Saturation')},
  dehaze: num('Dehaze')
 };
 if (hslOn) grade.hsl = Object.fromEntries(COLOURS.map(c => [c.toLowerCase(), [num('HueAdjustment' + c), num('SaturationAdjustment' + c), num('LuminanceAdjustment' + c)]]));
 if (mono) {grade.mono = true; if (COLOURS.some(c => active('GrayMixer' + c))) grade.grayMixer = Object.fromEntries(COLOURS.map(c => [c.toLowerCase(), num('GrayMixer' + c)]));}
 const wheels = {shadows: {hue: num('SplitToningShadowHue', 0, 360), sat: num('SplitToningShadowSaturation', 0, 100), lum: num('ColorGradeShadowLum')}, midtones: {hue: num('ColorGradeMidtoneHue', 0, 360), sat: num('ColorGradeMidtoneSat', 0, 100), lum: num('ColorGradeMidtoneLum')}, highlights: {hue: num('SplitToningHighlightHue', 0, 360), sat: num('SplitToningHighlightSaturation', 0, 100), lum: num('ColorGradeHighlightLum')}, global: {hue: num('ColorGradeGlobalHue', 0, 360), sat: num('ColorGradeGlobalSat', 0, 100), lum: num('ColorGradeGlobalLum')}};
 if (Object.values(wheels).some(w => w.sat || w.lum)) grade.grading = {...wheels, blending: num('ColorGradeBlending', 0, 100), balance: num('SplitToningBalance')};
 if (['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights'].some(active)) grade.parametric = {shadows: num('ParametricShadows'), darks: num('ParametricDarks'), lights: num('ParametricLights'), highlights: num('ParametricHighlights'), splits: [num('ParametricShadowSplit', 5, 90) / 100, num('ParametricMidtoneSplit', 10, 95) / 100, num('ParametricHighlightSplit', 15, 98) / 100].sort((a, b) => a - b)};
 if (hasCurves) grade.curves = Object.fromEntries(Object.entries(curves).map(([k, v]) => [k, v ?? identity]));

 const masks = [];
 for (const tag of ['MaskGroupBasedCorrections', 'GradientBasedCorrections', 'CircularGradientBasedCorrections', 'PaintBasedCorrections']) for (const block of blocks[tag] ?? []) localCorrections(block, masks, ignored, flags);
 if (masks.length) applied.add(FIELD.get('MaskGroupBasedCorrections').label);
 for (const tag of ['PointColors', 'RetouchInfo', 'RetouchAreas']) if (blocks[tag]?.some(b => /<rdf:li/.test(b))) ignored.set(FIELD.get('PointColors').label, '');
 if (sidecar && ['CropTop', 'CropLeft', 'CropBottom', 'CropRight'].some(k => k in raw) && /^true$/i.test(raw.HasCrop ?? '')) ignored.set('相片專用的裁切', '');

 if (!applied.size) {
  if (ignored.size) throw new XmpError('unsupported-only', `沒有可套用的調整：只包含尚未支援的項目（${[...ignored.keys()].join('、')}）`);
  throw new XmpError('no-adjustments', sidecar ? '相片 sidecar 的調色欄位都是預設值，沒有可套用的調整' : '所有調色欄位都是預設值，沒有可套用的調整');
 }
 const notes = [];
 if (sidecar) notes.push('這是相片 sidecar（不是預設檔）：已取用其中的調色設定，該相片專用的白平衡與裁切不套用');
 for (const [label, detail] of ignored) notes.push(`已忽略：${label}${detail ? `（${detail}）` : ''}`);
 return {
  name, grade, masks: masks.slice(0, 8), notes, flags, applied: [...applied], ignored: [...ignored.keys()],
  vignette: clampN(-num('PostCropVignetteAmount') / 100 * .5, -.5, .5),
  grain: {amount: num('GrainAmount', 0, 100) / 100 * .14, size: 1.2 + num('GrainSize', 0, 100) / 100},
  partial: sidecar || ignored.size > 0
 };
}

// Local corrections. Only single linear / radial gradients become Studio masks; everything else is reported.
function localCorrections(block, masks, ignored, flags) {
 const tags = [...block.matchAll(/<[^<>]*crs:What\s*=\s*"([^"]+)"[^<>]*>/g)].map(m => ({what: m[1], a: attrs(m[0])}));
 const none = FIELD.get('PaintBasedCorrections').label, ai = FIELD.get('Mask/Image').label;
 for (let i = 0; i < tags.length; i++) {
  if (tags[i].what !== 'Correction') continue;
  const c = tags[i].a, shapes = [];
  for (let j = i + 1; j < tags.length && tags[j].what !== 'Correction'; j++) shapes.push(tags[j]);
  const f = k => {const v = parseFloat(c[k]); return Number.isFinite(v) ? v : 0;}, amount = c.CorrectionAmount === undefined ? 1 : clampN(f('CorrectionAmount'), 0, 1);
  if (/^false$/i.test(c.CorrectionActive ?? '') || amount === 0) continue;
  const label = c.CorrectionName ? `「${unescape(c.CorrectionName).slice(0, 20)}」` : '';
  if (shapes.some(s => s.what === 'Mask/Image')) {flags.aiMask = true; ignored.set(ai, ((ignored.get(ai) ?? '') + ' ' + label).trim()); continue;}
  if (shapes.length !== 1 || !['Mask/Gradient', 'Mask/CircularGradient'].includes(shapes[0].what)) {ignored.set(none, ((ignored.get(none) ?? '') + ' ' + (label || shapes.map(s => s.what.replace('Mask/', '')).join('+') || '空遮色片')).trim()); continue;}
  const s = shapes[0].a, g = k => {const v = parseFloat(s[k]); return Number.isFinite(v) ? clampN(v, -1, 2) : NaN;};
  const adj = {ev: clampN(f('LocalExposure2012') * 4 * amount, -4, 4), temp: clampN(f('LocalTemperature') * 100 * amount, -100, 100), tint: clampN(f('LocalTint') * 100 * amount, -100, 100), sat: clampN(f('LocalSaturation') * 100 * amount, -100, 100), contrast: clampN(f('LocalContrast2012') * 100 * amount, -100, 100), hue: clampN(f('LocalToningHue'), 0, 360), amount: clampN(f('LocalToningSaturation') * 100 * amount, 0, 100)};
  const extra = ['LocalHighlights2012', 'LocalShadows2012', 'LocalWhites2012', 'LocalBlacks2012', 'LocalClarity2012', 'LocalDehaze', 'LocalTexture', 'LocalSharpness', 'LocalLuminanceNoise'].filter(k => f(k) !== 0);
  if (extra.length) ignored.set('遮色片內未支援的調整', extra.map(k => k.replace(/^Local|2012$/g, '')).join('、'));
  if (!['ev', 'temp', 'tint', 'sat', 'contrast', 'amount'].some(k => adj[k] !== 0)) continue;
  const invert = /^true$/i.test(s.MaskInverted ?? '');
  let mask;
  if (shapes[0].what === 'Mask/Gradient') {
   mask = {type: 'linear', x0: g('FullX'), y0: g('FullY'), x1: g('ZeroX'), y1: g('ZeroY'), invert};
  } else {
   const [t, l, b, r] = ['Top', 'Left', 'Bottom', 'Right'].map(g);
   mask = {type: 'radial', cx: (l + r) / 2, cy: (t + b) / 2, rx: Math.abs(r - l) / 2, ry: Math.abs(b - t) / 2, feather: clampN(parseFloat(s.Feather ?? '50') || 0, 0, 100), invert: /^true$/i.test(s.Flipped ?? 'true') ? invert : !invert};
  }
  if (Object.values(mask).some(v => typeof v === 'number' && !Number.isFinite(v))) {ignored.set(none, '遮色片座標不完整'); continue;}
  masks.push({...mask, name: (c.CorrectionName ? unescape(c.CorrectionName) : mask.type === 'linear' ? '漸層' : '放射').slice(0, 24), enabled: true, adj});
 }
}
