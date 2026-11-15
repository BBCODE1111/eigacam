// Builds the EIGASTUDIO acceptance pack: 100+ style files in nested folders with duplicates, name
// clashes, damaged files and partially supported presets. Every file carries its expected outcome,
// so the importer's report can be checked exactly. Run directly to write the ZIP to disk:
//   node tests/studio-fixtures.mjs out.zip
import {zipSync, strToU8} from '../dist/eigastudio/vendor/fflate.js';
import {LOOKS} from '../dist/src/looks.js';

const wrap = (attrs, body = '', extraNs = '') => `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"${extraNs}
${Object.entries(attrs).map(([k, v]) => `   ${k.includes(':') ? k : 'crs:' + k}="${v}"`).join('\n')}>
${body}  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
const nameTag = n => `   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${n}</rdf:li></rdf:Alt></crs:Name>\n`;
const curveTag = (tag, pts) => `   <crs:${tag}><rdf:Seq>${pts.map(p => `<rdf:li>${p[0]}, ${p[1]}</rdf:li>`).join('')}</rdf:Seq></crs:${tag}>\n`;
export const preset = (name, attrs, body = '') => wrap({PresetType: 'Normal', Version: '15.0', ProcessVersion: '11.0', HasSettings: 'True', ...attrs}, nameTag(name) + body);
const fade = [[0, 22], [64, 70], [128, 132], [192, 196], [255, 238]];
const aiMask = `   <crs:MaskGroupBasedCorrections><rdf:Seq><rdf:li><rdf:Description crs:What="Correction" crs:CorrectionAmount="1" crs:CorrectionActive="true" crs:CorrectionName="主體" crs:LocalExposure2012="0.2"><crs:CorrectionMasks><rdf:Seq><rdf:li crs:What="Mask/Image" crs:MaskActive="true" crs:MaskSubType="1" crs:MaskValue="1"/></rdf:Seq></crs:CorrectionMasks></rdf:Description></rdf:li></rdf:Seq></crs:MaskGroupBasedCorrections>\n`;
const gradMask = `   <crs:MaskGroupBasedCorrections><rdf:Seq><rdf:li><rdf:Description crs:What="Correction" crs:CorrectionAmount="1" crs:CorrectionActive="true" crs:CorrectionName="天空" crs:LocalExposure2012="-0.125" crs:LocalTemperature="-0.2" crs:LocalSaturation="0.15"><crs:CorrectionMasks><rdf:Seq><rdf:li crs:What="Mask/Gradient" crs:MaskActive="true" crs:MaskValue="1" crs:ZeroX="0.5" crs:ZeroY="0.55" crs:FullX="0.5" crs:FullY="0.1"/></rdf:Seq></crs:CorrectionMasks></rdf:Description></rdf:li></rdf:Seq></crs:MaskGroupBasedCorrections>\n`;
const lookBlock = `   <crs:Look><rdf:Description crs:Name="Kodak Vision 500T" crs:Amount="1" crs:UUID="A1B2C3D4E5F60718293A4B5C6D7E8F90" crs:SupportsAmount="true"><crs:Parameters><rdf:Description crs:Version="15.0" crs:ConvertToGrayscale="False" crs:RGBTable="E1095149FDB39D7A057BAB208837E2E1" crs:Table_E1095149FDB39D7A057BAB208837E2E1="abcdefgh"/></crs:Parameters></rdf:Description></crs:Look>\n`;

export function cube(size, fn, {head = '', title = ''} = {}) {
 let s = `${title ? `TITLE "${title}"\n` : ''}${head}LUT_3D_SIZE ${size}\n`;
 for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) s += fn(r / (size - 1), g / (size - 1), b / (size - 1)).map(v => v.toFixed(6)).join(' ') + '\n';
 return s;
}
const tint = (k, i) => (r, g, b) => [Math.min(1, r ** (1 - k * .3) + i * .002), g, Math.min(1, b ** (1 + k * .4))];

// → [{path, text|bytes, expect: 'ok'|'partial'|'duplicate'|'failed'|'skipped'|'junk', log?, renamed?}]
export function buildPack() {
 const files = [], add = (path, content, expect, extra = {}) => files.push({path, bytes: typeof content === 'string' ? strToU8(content) : content, expect, ...extra});
 const films = ['銀翼殺手', '花樣年華', '重慶森林', '愛在黎明', '寄生上流', '海街日記', '小偷家族', '燃燒女子', '月光下', '樂來越愛', '大國民', '教父', '疾速追殺', '沙丘', '奧本海默', '芭比', '瘋狂麥斯', '星際效應', '全面啟動', '黑暗騎士', '神隱少女', '你的名字', '天氣之子', '鈴芽之旅', '言葉之庭', '秒速五公分', '螢火蟲之墓', '風起', '魔法公主', '霍爾的移動城堡', '攻殼機動隊', '阿基拉', '新世紀', '東京教父', '紅辣椒', '千年女優', '藍色恐懼', '聲之形', '煙花', '夏日大作戰', '狼的孩子', '怪物的孩子', '未來的未來', '龍與雀斑', '竹取物語', '回憶中的瑪妮', '借物少女', '崖上的波妞', '貓的報恩', '心之谷', '側耳傾聽', '紅豬', '天空之城', '風之谷', '龍貓', '魔女宅急便', '平成狸合戰', '兒時點滴', '海潮之聲', '來自紅花坂'];
 // 60 fully supported XMP presets, three folders deep.
 films.forEach((n, i) => {
  const dir = i < 20 ? `電影風格/${i < 10 ? '底片' : '數位'}` : `動畫風格/${i < 44 ? '吉卜力' : '新海誠'}/${i % 2 ? '晴天' : '夜晚'}`;
  const attrs = {Exposure2012: ((i % 9) - 4) / 10, Contrast2012: (i * 7) % 60 - 20, Highlights2012: -(i * 5) % 70, Shadows2012: (i * 3) % 50, Vibrance: (i * 11) % 40 - 10, Saturation: (i % 7) * 4 - 12, IncrementalTemperature: (i % 13) * 5 - 30, IncrementalTint: (i % 5) * 4 - 8, HueAdjustmentGreen: (i * 9) % 60 - 30, SaturationAdjustmentBlue: (i * 13) % 80 - 40, SplitToningShadowHue: (i * 37) % 360, SplitToningShadowSaturation: 10 + i % 25, SplitToningHighlightHue: (i * 53) % 360, SplitToningHighlightSaturation: 5 + i % 20, Sharpness: 40, GrainAmount: i % 3 ? 0 : 20};
  add(`${dir}/${n}.xmp`, preset(n, attrs, i % 4 === 0 ? curveTag('ToneCurvePV2012', fade.map(p => [p[0], Math.min(255, p[1] + i % 10)])) : ''), 'ok');
 });
 // 30 .cube LUTs of several sizes and dialects.
 for (let i = 0; i < 26; i++) add(`LUT/${i < 13 ? '暖色' : '冷色'}/Look ${String(i + 1).padStart(2, '0')}.cube`, cube([5, 9, 17][i % 3], tint((i - 13) / 13, i)), 'ok');
 add('LUT/特殊/Domain 0-2.cube', cube(9, (r, g, b) => [r * .5 + .1, g * .5, b * .5], {head: 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n'}), 'ok');
 add('LUT/特殊/Resolve range.cube', cube(9, (r, g, b) => [r, g * .9, b], {head: 'LUT_3D_INPUT_RANGE 0.0 1.0\n', title: 'Generated by Resolve'}), 'ok');
 add('LUT/特殊/SLog3_to_Rec709.cube', cube(9, (r, g, b) => [r, g, b].map(v => Math.min(1, Math.max(0, (v - .09) * 2.2)))), 'ok', {log: true});
 add('LUT/特殊/Kodak 2383 (LogC).cube', cube(9, (r, g, b) => [r * .98, g, b * .95], {title: 'ARRI LogC to Rec709'}), 'ok', {log: true});
 // 3 eigacam recipes in the project's own format; one file holds two.
 add('eigacam/情書・雪.json', JSON.stringify(LOOKS.find(l => l.id === 'loveletter-snow')), 'ok');
 add('eigacam/Transformer.json', JSON.stringify(LOOKS.find(l => l.id === 'transformer')), 'ok');
 add('eigacam/我的配方.json', JSON.stringify([{id: 'r1', name: '青橙＋壓暗天空', base: 'transformer', masks: [{type: 'linear', name: '天空', x0: .5, y0: 0, x1: .5, y1: .5, adj: {ev: -.6, sat: 10}}]}]), 'ok');
 // Partially supported presets.
 add('部分支援/清晰度與紋理.xmp', preset('清晰度與紋理', {Contrast2012: 20, Clarity2012: 35, Texture: 20}), 'partial');
 add('部分支援/AI 主體遮色片.xmp', preset('AI 主體遮色片', {Exposure2012: .3, Vibrance: 20}, aiMask), 'partial');
 add('部分支援/外部 Profile.xmp', preset('外部 Profile', {Shadows2012: 30, Saturation: -10}, lookBlock), 'partial');
 add('部分支援/絕對色溫.xmp', preset('絕對色溫', {WhiteBalance: 'Custom', Temperature: 5200, Tint: 12, Contrast2012: 15}), 'partial');
 add('部分支援/相機校正.xmp', preset('相機校正', {Highlights2012: -30, RedHue: 20, BlueSaturation: -15}), 'partial');
 add('部分支援/相片 sidecar.xmp', wrap({RawFileName: 'DSC01234.ARW', Version: '15.0', ProcessVersion: '11.0', WhiteBalance: 'As Shot', Temperature: 5600, Tint: 8, Exposure2012: '+0.45', Contrast2012: '+18', HasSettings: 'True', HasCrop: 'False', 'tiff:Make': 'SONY', 'exif:ExposureTime': '1/250'}, '', ' xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"'), 'partial');
 add('部分支援/漸層遮色片.xmp', preset('漸層遮色片', {Contrast2012: 10}, gradMask), 'ok');
 // Same display name, different content, same folder → both kept, the second renamed.
 add('同名/Teal Orange A.xmp', preset('Teal Orange', {Contrast2012: 30, SaturationAdjustmentOrange: 20}), 'ok');
 add('同名/Teal Orange B.xmp', preset('Teal Orange', {Contrast2012: 45, SaturationAdjustmentOrange: 35}), 'ok', {renamed: true});
 add('同名/Teal Orange C.xmp', preset('Teal Orange', {Contrast2012: 10, SaturationAdjustmentAqua: 30}), 'ok', {renamed: true});
 add('同名/底片/銀翼殺手.xmp', preset('銀翼殺手', {Exposure2012: -.5, Contrast2012: 50}), 'ok'); // same name as another pack's style
 add('同名/Look 01.cube', cube(5, (r, g, b) => [b, g, r]), 'ok');
 // Exact duplicates of files above (byte-identical, other folders and names).
 const copy = (from, to) => add(to, files.find(f => f.path === from).bytes, 'duplicate');
 copy('電影風格/底片/銀翼殺手.xmp', '重複/銀翼殺手 拷貝.xmp'); copy('電影風格/底片/花樣年華.xmp', '重複/子資料夾/花樣年華.xmp'); copy('動畫風格/吉卜力/夜晚/神隱少女.xmp', '重複/神隱少女.xmp');
 copy('LUT/暖色/Look 01.cube', '重複/Look 01.cube'); copy('LUT/冷色/Look 20.cube', '重複/深層/更深/Look 20 (1).cube'); copy('eigacam/Transformer.json', '重複/Transformer.json');
 copy('同名/Teal Orange A.xmp', '重複/Teal Orange.xmp'); copy('部分支援/清晰度與紋理.xmp', '重複/清晰度與紋理.xmp');
 // Damaged or unusable files.
 const good = preset('截斷', {Contrast2012: 20});
 add('損壞/截斷.xmp', good.slice(0, good.length - 60), 'failed');
 add('損壞/亂碼.xmp', new Uint8Array(900).map((_, i) => (i * 97 + 13) % 256), 'failed');
 add('損壞/空白.xmp', '', 'failed');
 add('損壞/空白.cube', '', 'failed');
 add('損壞/只有描述.xmp', `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4"><dc:subject><rdf:Bag><rdf:li>旅行</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`, 'failed');
 add('損壞/全部預設值.xmp', preset('全部預設值', {Exposure2012: '0.00', Contrast2012: 0, Saturation: 0, Sharpness: 40, ColorGradeBlending: 50}), 'failed');
 add('損壞/只有 AI 遮色片.xmp', preset('只有 AI 遮色片', {}, aiMask), 'failed');
 add('損壞/只有 profile.xmp', wrap({PresetType: 'Look', Version: '15.0'}, nameTag('只有 profile') + lookBlock), 'failed');
 add('損壞/sidecar 無設定.xmp', wrap({RawFileName: 'IMG_0001.CR3', 'tiff:Make': 'Canon'}, '', ' xmlns:tiff="http://ns.adobe.com/tiff/1.0/"'), 'failed');
 add('損壞/筆數不足.cube', cube(9, (r, g, b) => [r, g, b]).split('\n').slice(0, 300).join('\n'), 'failed');
 add('損壞/非數值.cube', 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 abc\n0 1 1\n1 1 1\n', 'failed');
 add('損壞/1D.cube', 'LUT_1D_SIZE 4\n0 0 0\n.3 .3 .3\n.6 .6 .6\n1 1 1\n', 'failed');
 add('損壞/沒有尺寸.cube', '0 0 0\n1 1 1\n', 'failed');
 add('損壞/不是 JSON.json', '{"name": "壞掉的配方", "tone": ', 'failed');
 add('損壞/別的 JSON.json', JSON.stringify({hello: 'world'}), 'failed');
 add('損壞/找不到基底.json', JSON.stringify({name: '孤兒配方', base: 'no-such-look', masks: []}), 'failed');
 // Not style files.
 add('說明.txt', '這是風格包的說明', 'skipped'); add('預覽/sample.jpg', new Uint8Array([255, 216, 255, 224, 0, 16]), 'skipped'); add('LUT/readme.pdf', '%PDF-1.4', 'skipped');
 add('__MACOSX/電影風格/._銀翼殺手.xmp', 'junk', 'junk'); add('電影風格/.DS_Store', 'junk', 'junk');
 return files;
}
export function expected(files) {
 const e = {ok: 0, partial: 0, duplicate: 0, failed: 0, skipped: 0, log: 0, added: 0, renamed: 0};
 for (const f of files) {if (f.expect === 'junk') continue; e[f.expect]++; if (f.log) e.log++; if (f.renamed) e.renamed++; if (f.expect === 'ok' || f.expect === 'partial') e.added++;}
 return e;
}
// zipName: root folder inside the archive. `corrupt` flips bytes inside one entry's compressed data.
export function buildZip(files, {root = '', corrupt = null} = {}) {
 const zip = zipSync(Object.fromEntries(files.map(f => [root + f.path, [f.bytes, {level: f.path === corrupt ? 9 : 6}]])));
 if (corrupt) {
  const name = strToU8(root + corrupt); let at = -1;
  outer: for (let i = 0; i < zip.length - name.length; i++) {if (zip[i] !== 0x50 || zip[i + 1] !== 0x4b || zip[i + 2] !== 3 || zip[i + 3] !== 4) continue; for (let j = 0; j < name.length; j++) if (zip[i + 30 + j] !== name[j]) continue outer; at = i + 30 + name.length + (zip[i + 28] | zip[i + 29] << 8); break;}
  if (at < 0) throw Error('corrupt target not found');
  for (let k = 2; k < 40; k++) zip[at + k] ^= 0xA5;
 }
 return zip;
}
if (import.meta.url === `file://${process.argv[1]}`) {
 const {writeFileSync} = await import('node:fs');
 const files = buildPack(), out = process.argv[2] ?? 'eigastudio-test-pack.zip';
 writeFileSync(out, buildZip(files, {corrupt: '電影風格/數位/沙丘.xmp'}));
 console.log(out, files.length, 'entries', JSON.stringify(expected(files)));
}
