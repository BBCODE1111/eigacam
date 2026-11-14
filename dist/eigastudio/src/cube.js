// .cube 3D LUT reader (Adobe / Resolve dialects). The table is display-referred: the shader feeds it
// sRGB-encoded values mapped through DOMAIN_MIN..DOMAIN_MAX. Data order is red-fastest, which is
// exactly the layout of a WebGL 3D texture, so no reordering is needed.
const MAX_SIZE = 65;
const LOG_HINTS = [
 [/(?<![a-z])s[-_ ]?log ?3/i, 'Sony S-Log3'], [/(?<![a-z])s[-_ ]?log ?2/i, 'Sony S-Log2'], [/(?<![a-z])s[-_ ]?log/i, 'Sony S-Log'], [/(?<![a-z])log[-_ ]?c(?![a-z])|\barri\b|alexa/i, 'ARRI LogC'],
 [/(?<![a-z])v[-_ ]?log/i, 'Panasonic V-Log'], [/(?<![a-z])f[-_ ]?log/i, 'Fujifilm F-Log'], [/(?<![a-z])n[-_ ]?log/i, 'Nikon N-Log'], [/(?<![a-z])c[-_ ]?log|canon ?log/i, 'Canon Log'],
 [/(?<![a-z])d[-_ ]?log|d[-_ ]?cinelike/i, 'DJI D-Log'], [/bmd ?film|blackmagic|bmdfilm|pocket ?film/i, 'Blackmagic Film'], [/log3g10|red ?log|rwg/i, 'RED Log3G10'],
 [/apple ?log/i, 'Apple Log'], [/protune|gopro/i, 'GoPro Protune'], [/cineon/i, 'Cineon Log'], [/\baces ?cc|acescct|\baces\b/i, 'ACES'],
 [/\bhlg\b|st ?2084|\bpq\b|rec\.?2020|bt\.?2020|hdr10/i, 'HDR（HLG／PQ／Rec.2020）'], [/log ?(to|2) ?(rec|709)|[-_ ]log[-_ .]|\blog\b/i, 'Log（未指明機型）']
];

export function detectLog(...texts) {
 const hay = texts.filter(Boolean).join(' \n ');
 for (const [re, label] of LOG_HINTS) if (re.test(hay)) return label;
 return null;
}

export function parseCube(text, fileName = '') {
 text = String(text);
 if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
 let size = 0, min = [0, 0, 0], max = [1, 1, 1], title = '', count = 0, values = null, videoRange = false;
 const comments = [];
 let pos = 0; const n = text.length;
 while (pos < n) {
  let end = text.indexOf('\n', pos); if (end < 0) end = n;
  const line = text.slice(pos, end).trim(); pos = end + 1;
  if (!line) continue;
  const c = line.charCodeAt(0);
  if (c === 35) {if (comments.length < 40) comments.push(line); continue;}
  if ((c >= 48 && c <= 57) || c === 45 || c === 46 || c === 43) {
   if (!values) throw Error(size ? 'LUT 內部錯誤' : '缺少 LUT_3D_SIZE（資料出現在尺寸宣告之前）');
   const p = line.split(/\s+/);
   if (p.length < 3) throw Error(`第 ${count + 1} 筆資料不是三個數值`);
   const r = +p[0], g = +p[1], b = +p[2];
   if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))) throw Error(`第 ${count + 1} 筆資料不是數值`);
   if (count < size ** 3) {const o = count * 4; values[o] = r; values[o + 1] = g; values[o + 2] = b; values[o + 3] = 1;}
   count++; continue;
  }
  const [key, ...rest] = line.split(/\s+/);
  if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
  else if (key === 'LUT_3D_SIZE') {
   size = Number(rest[0]);
   if (!Number.isInteger(size) || size < 2 || size > 256) throw Error(`LUT_3D_SIZE 無效（${rest[0] ?? '空白'}）`);
   values = new Float32Array(size ** 3 * 4);
  } else if (key === 'LUT_1D_SIZE') throw Error('這是 1D LUT；只支援 3D LUT（LUT_3D_SIZE）');
  else if (key === 'DOMAIN_MIN') min = rest.slice(0, 3).map(Number);
  else if (key === 'DOMAIN_MAX') max = rest.slice(0, 3).map(Number);
  else if (key === 'LUT_3D_INPUT_RANGE') {const a = Number(rest[0]), b = Number(rest[1]); min = [a, a, a]; max = [b, b, b];}
  else if (key === 'LUT_IN_VIDEO_RANGE' || key === 'LUT_OUT_VIDEO_RANGE') videoRange = true;
  else if (/^[A-Z_0-9]+$/.test(key)) continue; // unknown keyword: ignore, like other readers do
  else throw Error(`無法辨識的內容：「${line.slice(0, 24)}」`);
 }
 if (!size) throw Error('缺少 LUT_3D_SIZE，不是 3D LUT 或檔案損壞');
 if (count !== size ** 3) throw Error(`資料筆數不符：${size}³ 需要 ${size ** 3} 筆，實際 ${count} 筆（檔案可能被截斷）`);
 if (min.length !== 3 || max.length !== 3 || min.some((v, i) => !Number.isFinite(v) || !Number.isFinite(max[i]) || !(max[i] > v))) throw Error('DOMAIN_MIN／DOMAIN_MAX 無效');
 const notes = [];
 let lut = {size, data: values, input: 'display', domainMin: min, domainMax: max};
 if (size > MAX_SIZE) {lut = resample(lut, MAX_SIZE); notes.push(`${size}³ 已重新取樣為 ${MAX_SIZE}³`);}
 if (videoRange) notes.push('標示為視訊範圍（16–235）；以全範圍套用，黑白位可能偏移');
 let log = detectLog(fileName, title, comments.join('\n'));
 if (!log && looksLikeLog(lut)) log = '疑似 Log 輸入（依內容判斷）';
 if (max.some(v => v > 1.001) || min.some(v => v < -.001)) notes.push(`輸入範圍 ${min[0]}–${max[0]}：SDR 照片只會用到其中 0–1 的部分`);
 return {lut, title, log, notes};
}

// Nearest lattice sample of a neutral grey — enough for the log heuristic.
function grey(lut, v) {
 const i = Math.round((v - lut.domainMin[0]) / (lut.domainMax[0] - lut.domainMin[0]) * (lut.size - 1)), k = Math.min(lut.size - 1, Math.max(0, i));
 const o = (k + k * lut.size + k * lut.size * lut.size) * 4;
 return (lut.data[o] + lut.data[o + 1] + lut.data[o + 2]) / 3;
}
// Log-to-display tables crush the low end to black and reach white long before the top of the input.
const looksLikeLog = lut => grey(lut, .1) < .03 && grey(lut, .62) > .9;

function resample(lut, size) {
 const {size: n, data} = lut, out = new Float32Array(size ** 3 * 4), s = (n - 1) / (size - 1);
 const at = (r, g, b, c) => data[(r + g * n + b * n * n) * 4 + c];
 let o = 0;
 for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
  const fr = r * s, fg = g * s, fb = b * s, r0 = Math.min(n - 2, fr | 0), g0 = Math.min(n - 2, fg | 0), b0 = Math.min(n - 2, fb | 0), tr = fr - r0, tg = fg - g0, tb = fb - b0;
  for (let c = 0; c < 3; c++) {
   const c00 = at(r0, g0, b0, c) * (1 - tr) + at(r0 + 1, g0, b0, c) * tr, c10 = at(r0, g0 + 1, b0, c) * (1 - tr) + at(r0 + 1, g0 + 1, b0, c) * tr;
   const c01 = at(r0, g0, b0 + 1, c) * (1 - tr) + at(r0 + 1, g0, b0 + 1, c) * tr, c11 = at(r0, g0 + 1, b0 + 1, c) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1, c) * tr;
   out[o++] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
  }
  out[o++] = 1;
 }
 return {...lut, size, data: out};
}
