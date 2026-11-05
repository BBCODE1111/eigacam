import {vertex, fragment} from './shaders.js';
import {packMasks} from '../masks.js';

const coarse = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const g = this.gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
    if (!g) throw Error('這個瀏覽器未啟用 WebGL2，請使用新版 Safari 或 Chrome。');
    if (!g.getExtension('EXT_color_buffer_float') && !g.getExtension('EXT_color_buffer_half_float')) throw Error('裝置無法提供浮點影像處理，請使用新版 Safari 或 Chrome。');
    const limit = Math.min(g.getParameter(g.MAX_TEXTURE_SIZE), g.getParameter(g.MAX_RENDERBUFFER_SIZE), ...g.getParameter(g.MAX_VIEWPORT_DIMS));
    this.maxEdge = Math.min(coarse() ? 8192 : 16384, limit);
    this.maxPixels = coarse() ? 12_600_000 : 40_000_000;
    const compile = (type, text) => {const s = g.createShader(type); g.shaderSource(s, text); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s)); return s;};
    const program = this.program = g.createProgram();
    g.attachShader(program, compile(g.VERTEX_SHADER, vertex)); g.attachShader(program, compile(g.FRAGMENT_SHADER, fragment)); g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(program));
    g.useProgram(program);
    this.buffer = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    this.locations = new Map();
    for (const [name, unit] of [['src', 0], ['nearTex', 1], ['farTex', 2], ['lut', 3]]) g.uniform1i(this.loc(name), unit);
    this.sourceTexture = this.texture2D();
    this.lutTextures = new WeakMap();
    this.targets = null; this.width = 0; this.height = 0;
    canvas.addEventListener('webglcontextlost', e => {e.preventDefault(); this.lost = true; canvas.dispatchEvent(new CustomEvent('engine-error', {detail: 'GPU 中斷了，請重新整理頁面。'}));});
  }
  loc(name) {if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name)); return this.locations.get(name);}
  texture2D(mip = false) {
    const g = this.gl, t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, mip ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  }
  // Source pixels stay at full resolution; mipmaps keep downscaled previews clean.
  setSource(image, width = image.videoWidth || image.width, height = image.videoHeight || image.height) {
    if (this.lost) throw Error('GPU 中斷了，請重新整理頁面。');
    if (width > this.maxEdge || height > this.maxEdge) throw Error('影像超出此裝置的處理範圍。');
    const g = this.gl; this.sourceWidth = width; this.sourceHeight = height;
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.sourceTexture);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true); g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.BROWSER_DEFAULT_WEBGL);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, image);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.generateMipmap(g.TEXTURE_2D); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
  }
  setLUT(lut) {
    const g = this.gl; let t = this.lutTextures.get(lut);
    if (!t) {
      t = g.createTexture(); g.bindTexture(g.TEXTURE_3D, t);
      for (const p of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T, g.TEXTURE_WRAP_R]) g.texParameteri(g.TEXTURE_3D, p, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_3D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_3D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texImage3D(g.TEXTURE_3D, 0, g.RGBA16F, lut.size, lut.size, lut.size, 0, g.RGBA, g.FLOAT, lut.data);
      this.lutTextures.set(lut, t);
    }
    this.lut = lut; g.activeTexture(g.TEXTURE3); g.bindTexture(g.TEXTURE_3D, t);
  }
  target(width, height) {
    const g = this.gl, tex = this.texture2D(); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, width, height, 0, g.RGBA, g.HALF_FLOAT, null);
    const fb = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, fb); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) throw Error('無法配置影像記憶體。');
    return {tex, fb, width, height};
  }
  releaseTargets() {const g = this.gl; for (const t of Object.values(this.targets ?? {})) {g.deleteTexture(t.tex); g.deleteFramebuffer(t.fb);} this.targets = null;}
  resize(width, height) {
    if (width === this.width && height === this.height && this.targets) return;
    if (width > this.maxEdge || height > this.maxEdge || width * height > this.maxPixels) throw Error('輸出尺寸超出此裝置的處理範圍。');
    this.releaseTargets(); this.canvas.width = width; this.canvas.height = height; this.width = width; this.height = height;
    const g = this.gl;
    if (g.drawingBufferWidth < width || g.drawingBufferHeight < height) throw Error('瀏覽器無法配置這麼大的畫面，請改用較小尺寸。');
    // Glow buffers are small and resolution-independent: radii are fractions of the short edge.
    const near = Math.min(1, 720 / Math.max(width, height), .5), far = Math.min(1, 160 / Math.max(width, height));
    const size = s => [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
    this.targets = {nearA: this.target(...size(near)), nearB: this.target(...size(near)), farA: this.target(...size(far)), farB: this.target(...size(far))};
  }
  pass(op, target, input) {
    const g = this.gl; g.uniform1i(this.loc('op'), op);
    if (input) {g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, input);}
    g.bindFramebuffer(g.FRAMEBUFFER, target?.fb ?? null); g.viewport(0, 0, target?.width ?? this.width, target?.height ?? this.height);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  }
  blur(a, b, radius) {
    const g = this.gl, short = Math.min(this.width, this.height);
    g.uniform2f(this.loc('direction'), radius * short / this.width, 0); this.pass(2, b, a.tex);
    g.uniform2f(this.loc('direction'), 0, radius * short / this.height); this.pass(2, a, b.tex);
  }
  // settings: crop{x,y,w,h}, mirror, exposure(EV), warmth(-1..1), sharpen(0..1), strength(0..1),
  // grain, grainSize, halation, bloom, glowHue, vignette, grainSeed
  render(s) {
    if (this.lost || !this.sourceWidth || !this.lut) return;
    const g = this.gl, crop = s.crop ?? {x: 0, y: 0, w: 1, h: 1}, T = this.targets;
    const w = s.warmth ?? 0, gains = [Math.exp(.16 * w), 1, Math.exp(-.2 * w)], norm = .2126 * gains[0] + .7152 + .0722 * gains[2];
    const hue = (s.glowHue ?? 20) / 60, gs = s.glowSat ?? .55, k = n => {const v = (n + hue) % 6; return 1 - gs * Math.max(0, Math.min(v, 4 - v, 1));};
    const tint = [k(5), k(3), k(1)], tintL = .2126 * tint[0] + .7152 * tint[1] + .0722 * tint[2];
    g.uniform4f(this.loc('crop'), crop.x, crop.y, crop.w, crop.h);
    g.uniform1f(this.loc('mirror'), s.mirror ? 1 : 0);
    g.uniform2f(this.loc('outSize'), this.width, this.height);
    g.uniform3f(this.loc('wb'), ...gains.map(v => v / norm));
    g.uniform3f(this.loc('glowTint'), ...tint.map(v => v / tintL));
    g.uniform1f(this.loc('exposure'), 2 ** (s.exposure ?? 0));
    g.uniform1f(this.loc('threshold'), .78);
    const lut = this.lut;
    g.uniform1f(this.loc('lutSize'), lut.size); g.uniform1f(this.loc('lutDisplay'), lut.input === 'display' ? 1 : 0);
    g.uniform3f(this.loc('domainMin'), ...(lut.domainMin ?? [0, 0, 0])); g.uniform3f(this.loc('domainMax'), ...(lut.domainMax ?? [1, 1, 1]));
    const glow = (s.halation ?? 0) + (s.bloom ?? 0) > 0;
    for (const unit of [1, 2]) {g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, null);} // no feedback loops
    if (glow) {
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.sourceTexture);
      this.pass(1, T.nearA); this.blur(T.nearA, T.nearB, .007);
      g.uniform2f(this.loc('direction'), 0, 0); this.pass(2, T.farA, T.nearA.tex); this.blur(T.farA, T.farB, .045);
    }
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, T.nearA.tex);
    g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D, T.farA.tex);
    g.uniform1f(this.loc('halation'), glow ? s.halation : 0); g.uniform1f(this.loc('bloom'), glow ? s.bloom : 0);
    g.uniform1f(this.loc('sharpen'), s.sharpen ?? 0); g.uniform1f(this.loc('strength'), s.strength ?? 1);
    g.uniform1f(this.loc('grainAmount'), s.grain ?? 0); g.uniform1f(this.loc('grainSize'), s.grainSize ?? 1.5);
    g.uniform2f(this.loc('grainSeed'), ...(s.grainSeed ?? [0, 0])); g.uniform1f(this.loc('vignette'), s.vignette ?? 0);
    const masks = packMasks(s.masks, s.maskView || null);
    g.uniform1i(this.loc('maskCount'), masks.count); g.uniform1f(this.loc('srcAspect'), this.sourceWidth / this.sourceHeight);
    g.uniform1i(this.loc('maskView'), masks.view);
    for (const k of ['a', 'b', 'c', 'd']) g.uniform4fv(this.loc(`m${k.toUpperCase()}[0]`), masks[k]);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.sourceTexture);
    this.pass(0, null);
    if (g.isContextLost()) throw Error('GPU 中斷了，請重新整理頁面。');
  }
  destroy() {
    const g = this.gl; this.releaseTargets(); g.deleteTexture(this.sourceTexture); g.deleteBuffer(this.buffer); g.deleteProgram(this.program);
    g.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
