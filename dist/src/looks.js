// Looks are creative interpretations, not official LUTs of any film, game or studio.
// hues: [OKLCh hue°, width°, hue shift°, chroma ×, lightness +]
// Reference hues: red 29 · skin/orange 55 · yellow 105 · green 142 · cyan 195 · blue 262 · magenta 328
// shadows/highlights: [hue°, OKLab chroma offset] · print: per channel [lift, gamma, gain]
// grain amount is the strength at 100% on the dial; glow covers halation + bloom.
import {createMask} from './masks.js';

export const LOOKS = [
  {
    id: 'nightcity', code: '01', name: '賽博夜城', en: 'NEON CITY', swatch: ['#071a24', '#1fc2d6', '#ff3ea5'],
    desc: '青藍暗部撞上洋紅霓虹，高飽和、深黑和光暈，未來城市的夜。',
    gain: [1, .955, 1.05], sat: 1.22, desatHi: .12,
    hues: [[29, 18, 6, 1.25, 0], [55, 18, -14, 1.15, 0], [105, 22, -4, 1.22, 0], [142, 30, 42, 1.05, 0], [195, 28, 0, 1.4, .02], [262, 28, 18, 1.25, .01], [328, 28, 0, 1.45, .02]],
    shadows: [200, .05], highlights: [338, .022],
    tone: { contrast: 1.34, pivot: .46, black: .004, white: .985, knee: .78 },
    print: [[0, 1, 1], [0, 1.03, .985], [.01, .98, 1]],
    grain: { amount: .03, size: 1.3 }, glow: { halation: .5, bloom: .3, hue: 322 }
  },
  {
    id: 'neonrain', code: '02', name: '霓虹雨夜', en: 'NEON RAIN', swatch: ['#1a0f3a', '#2bb3c0', '#e04ac0'],
    desc: '參考 Lightroom 賽博龐克調色：紫色陰影、洋紅高光、青藍霓虹，黃綠被壓掉。',
    // Values copied from a shared Lightroom preset (slider ranges as in Lightroom).
    lr: {
      basic: {exposure: -.35, contrast: 42, highlights: -40, shadows: -25, whites: 20, blacks: -42, temp: -22, tint: 25, vibrance: 40, saturation: 8},
      hsl: {red: [15, 55, 5], orange: [15, -25, 5], yellow: [-55, -45, -10], green: [55, -45, -20], aqua: [-25, 48, 8], blue: [-20, 40, -12], purple: [-25, 50, 5], magenta: [0, 0, 0]},
      grading: {shadows: {hue: 285, sat: 35, lum: -10}, midtones: {hue: 290, sat: 25, lum: 0}, highlights: {hue: 320, sat: 45, lum: 8}, blending: 55, balance: -20},
      dehaze: 15
    },
    detail: .17, vignette: .2, // texture +12 / clarity +22 → extra sharpening; vignette −20
    grain: {amount: .015, size: 1.2}, glow: {halation: .3, bloom: .2, hue: 300}
  },
  {
    id: 'loveletter', code: '03', name: '情書', en: 'LOVE LETTER', swatch: ['#3a2e24', '#c9b29c', '#f6eaec'],
    desc: '岩井俊二式的柔光：暖米色中間調、褐色微亮的黑、帶粉紫的白，低飽和、濛濛的光暈；冷景會偏向淡藍紫。',
    // Tuned against frames from the film: shadows ≈ rgb(50,40,30), mids ≈ rgb(135,115,100), whites ≈ rgb(247,234,237).
    gain: [1.24, 1.15, 1.03], sat: .72, desatHi: .18, desatSh: .12,
    // Skin, cheeks and lips are protected from the overall desaturation, the way film latitude kept faces warm.
    hues: [[18, 16, 2, 1.12, 0], [29, 20, 2, 1.1, 0], [48, 18, -2, 1.16, .01], [60, 16, -2, 1.08, .015], [105, 25, -6, .75, 0], [142, 30, -22, .6, 0], [195, 30, 0, .7, 0], [262, 30, 10, .85, .03], [328, 25, 0, .8, 0]],
    shadows: [62, .03], highlights: [350, .012],
    tone: {contrast: .8, pivot: .42, black: .06, white: .995, knee: .72},
    print: [[.03, 1, 1], [.015, 1, .985], [0, 1, .985]],
    vignette: .06,
    grain: {amount: .05, size: 1.8}, glow: {halation: .15, bloom: .5, hue: 15}
  }
];

// Variants share a base look's colour science (its LUT) and add masks on top.
const variant = (baseId, extra) => {const base = LOOKS.find(l => l.id === baseId); return {...base, lutOf: baseId, ...extra, masks: extra.masks ?? []};};
const full = (name, adj) => createMask('luma', {name, lo: 0, hi: 100, adj});
LOOKS.push(
 variant('loveletter', {
  id: 'loveletter-snow', code: '04', name: '情書・雪', en: 'LOVE LETTER · SNOW', swatch: ['#3b3f63', '#8f9bd0', '#eef0fa'],
  desc: '「お元気ですか」的雪地：淡藍紫的冷光、柔白雪色，膚色仍留一點溫度。',
  masks: [full('冷藍空氣', {temp: -85, tint: 22, sat: -12, ev: .1}), createMask('luma', {name: '雪光', lo: 68, hi: 100, feather: 15, adj: {ev: .2, hue: 228, amount: 40}}), createMask('color', {name: '膚色保護', hue: 22, width: 36, feather: 22, adj: {temp: 70, tint: -18, sat: 12}})],
  glow: {halation: .05, bloom: .55, hue: 225}
 }),
 variant('loveletter', {
  id: 'loveletter-library', code: '05', name: '情書・圖書館', en: 'LOVE LETTER · LIBRARY', swatch: ['#2a140b', '#a95f2c', '#f6c66b'],
  desc: '夜裡的圖書館：鎢絲燈的琥珀橘、濃郁暖色，暗部沉下去，燈泡周圍暈開。',
  masks: [full('鎢絲燈', {temp: 75, sat: 55, contrast: 15}), createMask('luma', {name: '燈光暈', lo: 60, hi: 100, feather: 15, adj: {ev: .15, hue: 32, amount: 45}}), createMask('luma', {name: '暗部沉', lo: 0, hi: 25, feather: 12, adj: {ev: -.45, contrast: 25}})],
  glow: {halation: .3, bloom: .4, hue: 30}
 })
);

LOOKS.push({
 id: 'transformer', code: '06', name: 'Transformer', en: 'TEAL · ORANGE', swatch: ['#0c2f36', '#2a9aa6', '#f0a24a'],
 desc: '好萊塢大片的青橙對比：天空與陰影偏青藍，受光面、膚色和沙土偏暖橙金；中等對比，暗部留細節，高光不過曝。',
 // Blues deepen toward teal, yellows lean orange, greens toward teal; shade goes teal while sunlit surfaces stay amber.
 gain: [.84, .83, .8], sat: 1.08, desatHi: .06, desatSh: .04,
 hues: [[29, 16, 10, 1.15, 0], [55, 20, 0, 1.35, .02], [80, 18, -10, 1.3, .02], [105, 22, -26, 1.05, 0], [142, 30, 48, .6, -.03], [195, 26, 8, 1.4, -.06], [235, 30, -16, 1.55, -.08], [262, 30, -28, 1.45, -.08], [328, 30, 0, .7, 0]],
 shadows: [210, .05], highlights: [70, .012],
 tone: {contrast: 1.28, pivot: .42, black: .01, white: .985, knee: .82},
 print: [[0, 1, 1], [.004, 1, 1], [.01, 1, .99]],
 vignette: .12,
 grain: {amount: .022, size: 1.25}, glow: {halation: .12, bloom: .14, hue: 40}
});

export const findLook = id => LOOKS.find(l => l.id === id) ?? LOOKS[0];
