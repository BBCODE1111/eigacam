// Looks are creative interpretations, not official LUTs of any film, game or studio.
// hues: [OKLCh hue°, width°, hue shift°, chroma ×, lightness +]
// Reference hues: red 29 · skin/orange 55 · yellow 105 · green 142 · cyan 195 · blue 262 · magenta 328
// shadows/highlights: [hue°, OKLab chroma offset] · print: per channel [lift, gamma, gain]
// grain amount is the strength at 100% on the dial; glow covers halation + bloom.
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
    id: 'loveletter', code: '03', name: '情書', en: 'LOVE LETTER', swatch: ['#9fb8bd', '#dfe6e3', '#f4efe6'],
    desc: '雪地小樽的冬天：偏亮、低反差、青白的雪光與柔焦，膚色保有一點溫度，像九〇年代岩井俊二的底片。',
    gain: [1.3, 1.34, 1.38], sat: .8, desatHi: .45, desatSh: .1,
    hues: [[29, 20, 2, .8, 0], [55, 20, -2, .95, .03], [105, 25, -4, .82, .01], [142, 30, 18, .7, .02], [195, 30, 0, .95, .02], [262, 30, -18, .75, .03], [328, 25, 0, .8, 0]],
    shadows: [198, .022], highlights: [205, .01],
    tone: {contrast: .8, pivot: .4, black: .1, white: .99, knee: .7},
    vignette: .06,
    grain: {amount: .055, size: 1.8}, glow: {halation: .08, bloom: .45, hue: 40}
  }
];

export const findLook = id => LOOKS.find(l => l.id === id) ?? LOOKS[0];
