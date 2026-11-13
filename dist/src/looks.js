// Looks are creative interpretations, not official LUTs of any film, game or studio.
// hues: [OKLCh hue°, width°, hue shift°, chroma ×, lightness +]
// Reference hues: red 29 · skin/orange 55 · yellow 105 · green 142 · cyan 195 · blue 262 · magenta 328
// shadows/highlights: [hue°, OKLab chroma offset] · print: per channel [lift, gamma, gain]
// grain amount is the strength at 100% on the dial; glow covers halation + bloom.
import {createMask} from './masks.js';

export const LOOKS = [
  {
    id: 'nightcity', code: '01', name: '賽博夜城', en: 'NEON CITY', swatch: ['#071a24', '#1fc2d6', '#ff3ea5'],
    desc: '霓虹被放到最大：招牌、燈光的青、藍、洋紅又濃又亮還會暈開，夜色沉成帶青的深黑；人的膚色維持正常。',
    // neon: boosts only colours that are already saturated (signs, lights). Skin is rendered separately (skin).
    gain: [1, 1, 1.03], sat: 1.04, neon: 1.5, desatHi: .04,
    hues: [[18, 14, 0, 1, 0], [29, 16, -2, 1.2, 0], [48, 18, 0, 1, .005], [60, 16, 0, 1, .005], [105, 22, -8, 1.15, 0], [142, 30, 44, 1.2, .01], [195, 28, -4, 1.6, .04], [262, 28, 14, 1.55, .03], [310, 24, 6, 1.65, .04], [338, 22, 0, 1.5, .03]],
    shadows: [208, .045], highlights: [200, .004],
    tone: { contrast: 1.38, pivot: .48, black: .002, white: .99, knee: .8 },
    print: [[0, 1, 1], [0, 1, 1], [.01, .98, 1]],
    skin: .85, clarity: .3, vignette: .22,
    grain: { amount: .03, size: 1.3 }, glow: { halation: .6, bloom: .6, hue: 322, sat: .1 }
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
    id: 'loveletter', code: '03', name: '情書', en: 'LOVE LETTER', swatch: ['#5b6f7a', '#cfe3df', '#fff7ee'],
    desc: '日系的清亮：畫面偏亮、空氣透明，白是乾淨的奶白，綠與藍清爽，暗部帶一點青；膚色明亮紅潤，光是柔的。',
    // Bright and clear rather than drained: colour stays, contrast is gentle, whites are clean.
    gain: [1.27, 1.28, 1.29], sat: 1, desatHi: .12,
    hues: [[18, 16, 2, 1.05, .005], [29, 20, 2, 1, .005], [48, 18, -2, 1.06, .02], [60, 16, -2, 1.02, .02], [105, 25, 4, .92, .02], [142, 30, 14, .95, .035], [195, 30, -4, 1.08, .03], [262, 30, -14, 1.02, .045], [328, 25, 0, .95, .01]],
    shadows: [215, .02], highlights: [82, .008],
    tone: {contrast: .95, pivot: .4, black: .034, white: 1, knee: .8},
    skin: .75, clarity: .22, soft: .5, // diffusion over the scene, film grain in the air, the person stays crisp
    vignette: .04,
    grain: {amount: .055, size: 1.7}, glow: {halation: .14, bloom: .5, hue: 30}
  }
];

// The hazy, warm base tuned to film frames. Snow keeps it; it is not listed on its own.
const HAZE = {
    // Tuned against frames from the film: shadows ≈ rgb(50,40,30), mids ≈ rgb(135,115,100), whites ≈ rgb(247,234,237).
    gain: [1.24, 1.15, 1.03], sat: .72, desatHi: .18, desatSh: .12,
    // Skin, cheeks and lips are protected from the overall desaturation, the way film latitude kept faces warm.
    hues: [[18, 16, 2, 1.12, 0], [29, 20, 2, 1.1, 0], [48, 18, -2, 1.16, .01], [60, 16, -2, 1.08, .015], [105, 25, -6, .75, 0], [142, 30, -22, .6, 0], [195, 30, 0, .7, 0], [262, 30, 10, .85, .03], [328, 25, 0, .8, 0]],
    shadows: [62, .03], highlights: [350, .012],
    tone: {contrast: .94, pivot: .44, black: .035, white: .995, knee: .74},
    skin: .7, clarity: .28, // portrait-first: clean rosy skin, light and shadow carry the mood
    print: [[.03, 1, 1], [.015, 1, .985], [0, 1, .985]],
    vignette: .06,
    grain: {amount: .05, size: 1.8}, glow: {halation: .15, bloom: .5, hue: 15}
  };

// Variants share a base look's colour science (its LUT) and add masks on top.
const variant = (baseId, extra) => {const base = LOOKS.find(l => l.id === baseId); return {...base, lutOf: baseId, ...extra, masks: extra.masks ?? []};};
const full = (name, adj) => createMask('luma', {name, lo: 0, hi: 100, adj});
LOOKS.push(
 {...HAZE,
  id: 'loveletter-snow', code: '04', name: '情書・雪', en: 'LOVE LETTER · SNOW', swatch: ['#3b3f63', '#8f9bd0', '#eef0fa'],
  desc: '「お元気ですか」的雪地：淡藍紫的冷光、柔白雪色，膚色仍留一點溫度。',
  masks: [full('冷藍空氣', {temp: -85, tint: 22, sat: -12, ev: .1}), createMask('luma', {name: '雪光', lo: 68, hi: 100, feather: 15, adj: {ev: .2, hue: 228, amount: 40}}), createMask('color', {name: '膚色保護', hue: 22, width: 36, feather: 22, adj: {temp: 70, tint: -18, sat: 12}})],
  glow: {halation: .05, bloom: .55, hue: 225}
 },
 {
  id: 'loveletter-library', code: '05', name: '情書・圖書館', en: 'LOVE LETTER · LIBRARY', swatch: ['#3a2212', '#c98a4a', '#ffe3a3'],
  desc: '傍晚的圖書館：鎢絲燈的暖金色包住整個畫面，顏色還在、不混濁，暗部是溫暖的深褐；臉透著暖光。',
  // Warm, but clear: colours keep their identity under the amber light instead of collapsing to brown.
  gain: [1.13, 1, .8], sat: 1.04, desatHi: .08, desatSh: .1,
  hues: [[18, 14, 2, 1, 0], [29, 18, 2, 1.04, 0], [48, 18, -2, .96, .015], [62, 16, -2, .96, .015], [80, 18, -4, 1.08, .01], [105, 22, -10, 1, 0], [142, 30, -18, .8, 0], [195, 30, 0, .8, 0], [262, 30, -10, .82, 0]],
  shadows: [45, .022], highlights: [80, .02],
  tone: {contrast: 1.1, pivot: .45, black: .018, white: .985, knee: .76},
  print: [[.008, 1, 1], [.003, 1.01, .99], [0, 1.05, .93]],
  vignette: .2, skin: .6, clarity: .3, soft: .55,
  masks: [createMask('luma', {name: '燈光暈', lo: 72, hi: 100, feather: 14, adj: {hue: 40, amount: 18}})],
  grain: {amount: .065, size: 1.8}, glow: {halation: .4, bloom: .45, hue: 30}
 }
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

// XMP-derived variants. Curve strength is adapted for already-developed phone photos.
LOOKS.push(...[
  {
    "id": "kirinoma-dusk",
    "code": "07",
    "name": "暮色原味",
    "en": "VINTAGE CINEMA · DUSK",
    "swatch": [
      "#464f50",
      "#a3a08d",
      "#dcd9c6"
    ],
    "desc": "低飽和灰綠、抬起的暗部與收斂的白，柔光輕輕包住暮色。",
    "lr": {
      "basic": {
        "highlights": -41,
        "shadows": 62,
        "whites": -77,
        "blacks": 73,
        "temp": 0
      },
      "hsl": {
        "red": [
          23.0,
          -23.0,
          -10.0
        ],
        "orange": [
          4.0,
          -36.0,
          4.0
        ],
        "yellow": [
          -30.0,
          -27.0,
          10.0
        ],
        "green": [
          -50.0,
          -77.0,
          0.0
        ],
        "aqua": [
          -25.0,
          -40.0,
          0.0
        ],
        "blue": [
          -7.0,
          -32.0,
          0.0
        ],
        "purple": [
          0.0,
          0.0,
          0.0
        ],
        "magenta": [
          0.0,
          0.0,
          0.0
        ]
      },
      "curves": {
        "m": [
          [
            0.0,
            0.22745098039215686
          ],
          [
            0.3843137254901961,
            0.23921568627450981
          ],
          [
            0.6,
            0.28627450980392155
          ],
          [
            1.0,
            0.8274509803921568
          ]
        ],
        "r": [
          [
            0.0,
            0.0
          ],
          [
            0.11764705882352941,
            0.050980392156862744
          ],
          [
            0.4392156862745098,
            0.47058823529411764
          ],
          [
            0.6705882352941176,
            0.7686274509803922
          ],
          [
            1.0,
            1.0
          ]
        ],
        "g": [
          [
            0.0,
            0.0
          ],
          [
            0.1411764705882353,
            0.054901960784313725
          ],
          [
            0.25882352941176473,
            0.2
          ],
          [
            0.4470588235294118,
            0.4823529411764706
          ],
          [
            0.6980392156862745,
            0.792156862745098
          ],
          [
            1.0,
            1.0
          ]
        ],
        "b": [
          [
            0.0,
            0.023529411764705882
          ],
          [
            0.1411764705882353,
            0.10588235294117647
          ],
          [
            0.49019607843137253,
            0.5019607843137255
          ],
          [
            0.6235294117647059,
            0.6823529411764706
          ],
          [
            1.0,
            1.0
          ]
        ]
      },
      "curveMix": 0.65,
      "grading": {
        "shadows": {
          "hue": 188,
          "sat": 7
        },
        "highlights": {
          "hue": 182,
          "sat": 4
        },
        "balance": -62,
        "blending": 50
      }
    },
    "skin": 0.12,
    "clarity": 0,
    "soft": 0.24,
    "localClarity": -0.5,
    "localClarityLow": 0.595,
    "detail": -0.12,
    "vignette": 0,
    "grain": {
      "amount": 0.035,
      "size": 1.4
    },
    "glow": {
      "halation": 0.035,
      "bloom": 0.1,
      "hue": 45,
      "sat": 0.08
    },
    "source": {
      "preset": 1,
      "curveAdaptation": 0.65,
      "note": "XMP basic + colour; sRGB approximation, no Adobe profile/calibration/embedded filters"
    }
  },
  {
    "id": "kirinoma-sun",
    "code": "08",
    "name": "暖膚日光",
    "en": "VINTAGE CINEMA · SUN",
    "swatch": [
      "#66574c",
      "#c6ae88",
      "#eee2cc"
    ],
    "desc": "暖膚與奶油白，保留日光亮度，葉綠收成柔和的橄欖色。",
    "lr": {
      "basic": {
        "highlights": -41,
        "shadows": 62,
        "whites": -77,
        "blacks": 73,
        "temp": 8
      },
      "hsl": {
        "red": [
          0.0,
          -11.0,
          -10.0
        ],
        "orange": [
          -14.0,
          -31.0,
          0.0
        ],
        "yellow": [
          -30.0,
          -27.0,
          10.0
        ],
        "green": [
          -50.0,
          -77.0,
          0.0
        ],
        "aqua": [
          -25.0,
          -40.0,
          0.0
        ],
        "blue": [
          -7.0,
          -32.0,
          0.0
        ],
        "purple": [
          0.0,
          0.0,
          0.0
        ],
        "magenta": [
          0.0,
          0.0,
          0.0
        ]
      },
      "curves": {
        "m": [
          [
            0.0,
            0.1843137254901961
          ],
          [
            0.24705882352941178,
            0.21568627450980393
          ],
          [
            0.5843137254901961,
            0.32941176470588235
          ],
          [
            1.0,
            0.8235294117647058
          ]
        ],
        "r": [
          [
            0.0,
            0.0
          ],
          [
            0.09803921568627451,
            0.03529411764705882
          ],
          [
            0.4392156862745098,
            0.47058823529411764
          ],
          [
            0.6705882352941176,
            0.7686274509803922
          ],
          [
            1.0,
            1.0
          ]
        ],
        "g": [
          [
            0.0,
            0.0
          ],
          [
            0.1411764705882353,
            0.054901960784313725
          ],
          [
            0.25882352941176473,
            0.2
          ],
          [
            0.4470588235294118,
            0.4823529411764706
          ],
          [
            0.6980392156862745,
            0.792156862745098
          ],
          [
            1.0,
            1.0
          ]
        ],
        "b": [
          [
            0.0,
            0.0
          ],
          [
            0.13333333333333333,
            0.08235294117647059
          ],
          [
            0.49019607843137253,
            0.5019607843137255
          ],
          [
            0.6352941176470588,
            0.6549019607843137
          ],
          [
            1.0,
            1.0
          ]
        ]
      },
      "curveMix": 0.48,
      "grading": {
        "shadows": {
          "hue": 205,
          "sat": 7
        },
        "highlights": {
          "hue": 42,
          "sat": 6
        },
        "balance": -62,
        "blending": 50
      }
    },
    "skin": 0.12,
    "clarity": 0,
    "soft": 0.18,
    "localClarity": -0.5,
    "localClarityLow": 0.595,
    "detail": -0.12,
    "vignette": 0,
    "grain": {
      "amount": 0.035,
      "size": 1.4
    },
    "glow": {
      "halation": 0.035,
      "bloom": 0.1,
      "hue": 45,
      "sat": 0.08
    },
    "source": {
      "preset": 22,
      "curveAdaptation": 0.48,
      "note": "XMP basic + colour; sRGB approximation, no Adobe profile/calibration/embedded filters"
    }
  },
  {
    "id": "kirinoma-blue",
    "code": "09",
    "name": "冷青夜色",
    "en": "VINTAGE CINEMA · BLUE",
    "swatch": [
      "#384e59",
      "#8ba4a2",
      "#d8dedb"
    ],
    "desc": "冷青空氣、低飽和藍綠與更深的中間調，適合陰天與傍晚。",
    "lr": {
      "basic": {
        "highlights": -41,
        "shadows": 62,
        "whites": -77,
        "blacks": 73,
        "temp": -7
      },
      "hsl": {
        "red": [
          0.0,
          -11.0,
          -10.0
        ],
        "orange": [
          -14.0,
          -12.0,
          0.0
        ],
        "yellow": [
          -61.0,
          -10.0,
          10.0
        ],
        "green": [
          -50.0,
          -77.0,
          0.0
        ],
        "aqua": [
          -25.0,
          -40.0,
          0.0
        ],
        "blue": [
          -7.0,
          -32.0,
          0.0
        ],
        "purple": [
          0.0,
          0.0,
          0.0
        ],
        "magenta": [
          0.0,
          0.0,
          0.0
        ]
      },
      "curves": {
        "m": [
          [
            0.0,
            0.2196078431372549
          ],
          [
            0.24705882352941178,
            0.22745098039215686
          ],
          [
            0.4980392156862745,
            0.2980392156862745
          ],
          [
            0.8862745098039215,
            0.6980392156862745
          ],
          [
            1.0,
            0.8313725490196079
          ]
        ],
        "r": [
          [
            0.0,
            0.0
          ],
          [
            0.17254901960784313,
            0.09019607843137255
          ],
          [
            0.4588235294117647,
            0.49019607843137253
          ],
          [
            0.6784313725490196,
            0.7568627450980392
          ],
          [
            1.0,
            1.0
          ]
        ],
        "g": [
          [
            0.0,
            0.0
          ],
          [
            0.1843137254901961,
            0.09019607843137255
          ],
          [
            0.44313725490196076,
            0.49411764705882355
          ],
          [
            0.6784313725490196,
            0.7568627450980392
          ],
          [
            1.0,
            1.0
          ]
        ],
        "b": [
          [
            0.0,
            0.0
          ],
          [
            0.1843137254901961,
            0.12156862745098039
          ],
          [
            0.4745098039215686,
            0.48627450980392156
          ],
          [
            0.6901960784313725,
            0.7372549019607844
          ],
          [
            1.0,
            1.0
          ]
        ]
      },
      "curveMix": 0.72,
      "grading": {
        "shadows": {
          "hue": 188,
          "sat": 12
        },
        "highlights": {
          "hue": 205,
          "sat": 6
        },
        "balance": -62,
        "blending": 50
      }
    },
    "skin": 0.12,
    "clarity": 0,
    "soft": 0.32,
    "localClarity": -0.5,
    "localClarityLow": 0.35,
    "detail": -0.12,
    "vignette": 0,
    "grain": {
      "amount": 0.035,
      "size": 1.4
    },
    "glow": {
      "halation": 0.035,
      "bloom": 0.1,
      "hue": 45,
      "sat": 0.08
    },
    "source": {
      "preset": 37,
      "curveAdaptation": 0.72,
      "note": "XMP basic + colour; sRGB approximation, no Adobe profile/calibration/embedded filters"
    }
  }
]);

export const findLook = id => LOOKS.find(l => l.id === id) ?? LOOKS[0];
