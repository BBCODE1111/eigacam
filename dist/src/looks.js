// Looks are creative interpretations, not official LUTs of any film, game or studio.
// hues: [OKLCh hue°, width°, hue shift°, chroma ×, lightness +]
// Reference hues: red 29 · skin/orange 55 · yellow 105 · green 142 · cyan 195 · blue 262 · magenta 328
// shadows/highlights: [hue°, OKLab chroma offset] · print: per channel [lift, gamma, gain]
// grain amount is the strength at 100% on the dial; glow covers halation + bloom.
export const LOOKS = [
  {
    id: 'print', code: '01', name: '院線拷貝', en: 'CINEMA PRINT', swatch: ['#1d2a2c', '#8a6f52', '#efd9b4'],
    desc: '電影院拷貝的厚黑與暖亮部，綠轉橄欖、紅色飽滿，萬用的電影感。',
    gain: [1.01, 1, .97], sat: .96, desatHi: .35, desatSh: .15,
    hues: [[29, 20, 2, 1.12, -.01], [55, 18, -2, 1, 0], [142, 30, 14, .72, -.02], [195, 25, 6, .9, 0], [262, 25, -8, .88, 0]],
    shadows: [205, .018], highlights: [70, .014],
    tone: { contrast: 1.22, pivot: .43, black: .018, white: .975, knee: .8 },
    print: [[0, 1, 1], [0, 1, .99], [.012, 1.02, .96]],
    grain: { amount: .05, size: 1.6 }, glow: { halation: .22, bloom: .08, hue: 18 }
  },
  {
    id: 'blockbuster', code: '02', name: '好萊塢大片', en: 'TEAL & ORANGE', swatch: ['#0f2c35', '#3d7d86', '#e59a5b'],
    desc: '膚色往暖橙、環境往青藍，動作片和夜景最有份量。',
    gain: [1, 1, 1.01], sat: 1.04, desatHi: .25,
    hues: [[55, 22, -3, 1.12, .01], [105, 25, -14, .82, 0], [142, 32, 38, .7, -.02], [195, 30, 4, 1.15, 0], [262, 28, -32, 1.08, 0], [328, 25, 0, .8, 0]],
    shadows: [215, .045], highlights: [62, .026],
    tone: { contrast: 1.3, pivot: .44, black: .012, white: .985, knee: .8 },
    grain: { amount: .035, size: 1.4 }, glow: { halation: .15, bloom: .06, hue: 25 }
  },
  {
    id: 'nightcity', code: '03', name: '賽博夜城', en: 'NEON CITY', swatch: ['#071a24', '#1fc2d6', '#ff3ea5'],
    desc: '青藍暗部撞上洋紅霓虹，高飽和、深黑和光暈，未來城市的夜。',
    gain: [1, .955, 1.05], sat: 1.22, desatHi: .12,
    hues: [[29, 18, 6, 1.25, 0], [55, 18, -14, 1.15, 0], [105, 22, -4, 1.22, 0], [142, 30, 42, 1.05, 0], [195, 28, 0, 1.4, .02], [262, 28, 18, 1.25, .01], [328, 28, 0, 1.45, .02]],
    shadows: [200, .05], highlights: [338, .022],
    tone: { contrast: 1.34, pivot: .46, black: .004, white: .985, knee: .78 },
    print: [[0, 1, 1], [0, 1.03, .985], [.01, .98, 1]],
    grain: { amount: .03, size: 1.3 }, glow: { halation: .5, bloom: .3, hue: 322 }
  },
  {
    id: 'kowloon', code: '04', name: '九龍夜色', en: 'KOWLOON NIGHT', swatch: ['#13261c', '#9b8a2c', '#e8b75a'],
    desc: '鎢絲燈的黃綠、濃紅與煙霧感黑位，像九〇年代港片的夜。',
    gain: [1.03, 1.01, .9], sat: 1.08, desatHi: .2,
    hues: [[29, 18, 4, 1.28, 0], [55, 18, 0, 1.04, 0], [105, 25, -6, 1.15, 0], [142, 28, -14, 1.12, 0], [195, 28, -22, .85, 0], [262, 30, -45, .75, 0]],
    shadows: [150, .045], highlights: [85, .035],
    tone: { contrast: 1.18, pivot: .44, black: .045, white: .955, knee: .78 },
    grain: { amount: .075, size: 2 }, glow: { halation: .38, bloom: .2, hue: 32 }
  },
  {
    id: 'anime', code: '05', name: '晴空動畫', en: 'ANIME SKY', swatch: ['#2b3a7a', '#4fb2ef', '#fff2d6'],
    desc: '透亮的天藍、清澈綠意與發光的亮部，像動畫電影的晴天。',
    gain: [1.09, 1.11, 1.15], sat: 1.16, desatHi: .1,
    hues: [[55, 20, 0, .95, .015], [105, 22, -4, 1.1, .01], [142, 30, 6, 1.18, .02], [195, 30, 4, 1.35, .02], [262, 30, -14, 1.35, .03], [328, 25, 0, 1.05, 0]],
    shadows: [250, .02], highlights: [78, .012],
    tone: { contrast: 1.04, pivot: .45, black: .03, white: 1, knee: .84 },
    grain: { amount: 0, size: 1.2 }, glow: { halation: .05, bloom: .35, hue: 45 }
  },
  {
    id: 'pastel', code: '06', name: '日系淡彩', en: 'PASTEL FILM', swatch: ['#a9c3bb', '#d7cfc0', '#f6efe2'],
    desc: '奶白亮部、薄荷綠陰影、低反差，柔和但不灰濛。',
    gain: [1.04, 1.05, 1.05], sat: .84, desatHi: .25,
    hues: [[29, 20, 4, .86, .01], [55, 20, 0, .92, .03], [105, 25, 6, .85, .02], [142, 30, 18, .78, .03], [195, 30, -6, .9, .02], [262, 28, -14, .82, .02]],
    shadows: [182, .018], highlights: [88, .014],
    tone: { contrast: .9, pivot: .42, black: .06, white: .985, knee: .76 },
    grain: { amount: .045, size: 1.5 }, glow: { halation: .06, bloom: .15, hue: 40 }
  },
  {
    id: 'bleach', code: '07', name: '銀殘留', en: 'BLEACH BYPASS', swatch: ['#16191b', '#6d7472', '#d9dcd6'],
    desc: '保留銀粒的低飽和高反差，金屬冷調，戰爭片與犯罪片的質地。',
    sat: .5, desatHi: .3, hues: [[55, 22, 0, 1.25, 0]],
    shadows: [225, .014], highlights: [80, .006],
    tone: { contrast: 1.5, pivot: .46, black: .006, white: .99, knee: .82 },
    grain: { amount: .07, size: 1.8 }, glow: { halation: 0, bloom: .04, hue: 40 }
  },
  {
    id: 'mono', code: '08', name: '黑白銀鹽', en: 'SILVER MONO', swatch: ['#0c0c0c', '#7a7a7a', '#ededed'],
    desc: '紅濾鏡黑白：天空沉下來、膚色透亮，扎實的黑與細膩顆粒。',
    mono: [.42, .5, .08],
    tone: { contrast: 1.35, pivot: .45, black: .012, white: .985, knee: .8 },
    grain: { amount: .09, size: 1.7 }, glow: { halation: 0, bloom: .05, hue: 0 }
  },
  {
    id: 'neonrain', code: '09', name: '霓虹雨夜', en: 'NEON RAIN', swatch: ['#1a0f3a', '#2bb3c0', '#e04ac0'],
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
  }
];

export const findLook = id => LOOKS.find(l => l.id === id) ?? LOOKS[0];
