// Studio renderer. One fragment shader produces the preview, every thumbnail and the full-size export,
// so colour and masks cannot drift apart between them. Mask selection, the per-mask adjustment and the
// LUT lookup are the same maths as eigacam's camera shader (dist/src/engine/shaders.js); Studio adds
// global tone controls, a point curve, painted masks and a per-mask amount.
export const MAX_SLOTS = 16, BRUSH_LAYERS = 8;

const vertex = `#version 300 es
layout(location=0) in vec2 position;out vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;

const fragment = `#version 300 es
precision highp float;precision highp int;precision highp sampler3D;precision highp sampler2DArray;
in vec2 uv;out vec4 frag;
uniform sampler2D src,curveTex;uniform sampler3D lut;uniform sampler2DArray brushTex;
uniform vec2 outSize;uniform float srcAspect,bypass,strength,lutOn,lutSize,lutDisplay,curveOn;
uniform vec3 domainMin,domainMax,gain,overlayColor;
uniform float contrast,highlights,shadows,saturation,vignette,grainAmount,grainSize;
uniform int maskCount,maskView;
uniform vec4 mA[${MAX_SLOTS}],mB[${MAX_SLOTS}],mC[${MAX_SLOTS}],mD[${MAX_SLOTS}];

vec3 decode(vec3 x){return mix(x/12.92,pow(max((x+.055)/1.055,vec3(0.)),vec3(2.4)),step(vec3(.04045),x));}
vec3 encode(vec3 x){x=max(x,vec3(0.));return mix(x*12.92,1.055*pow(x,vec3(1./2.4))-.055,step(vec3(.0031308),x));}
float lum(vec3 x){return dot(x,vec3(.2126,.7152,.0722));}
vec3 hsv2rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
// a: type, invert, feather, amount · b: geometry · c: ev, temp, tint, sat · d: contrast, hue, tint amount, brush layer
// type 0 linear · 1 radial · 2 luminance range · 3 colour range · 4 painted
float maskValue(int i,vec2 img,vec3 base){
 vec4 a=mA[i],b=mB[i];float m=1.;
 if(a.x<.5){vec2 s=vec2(srcAspect,1.);vec2 ab=(b.zw-b.xy)*s;float t=dot((img-b.xy)*s,ab)/max(dot(ab,ab),1e-6);m=1.-smoothstep(0.,1.,t);}
 else if(a.x<1.5){float r=length((img-b.xy)/max(b.zw,vec2(1e-3)));m=1.-smoothstep(1.-max(a.z,.02),1.,r);}
 else if(a.x<2.5){float L=lum(clamp(encode(base),0.,1.)),f=max(b.z,.005);float lo=b.x<=0.?1.:smoothstep(b.x-f,b.x+f,L);float hi=b.y>=1.?1.:1.-smoothstep(b.y-f,b.y+f,L);m=lo*hi;}
 else if(a.x<3.5){vec3 h=rgb2hsv(clamp(encode(base),0.,1.));float d=abs(h.x-b.x);d=min(d,1.-d);m=(1.-smoothstep(b.y*.5,b.y*.5+max(b.z,.003),d))*smoothstep(.05,.18,h.y);}
 else m=texture(brushTex,vec3(img,mD[i].w)).a;
 return a.y>.5?1.-m:m;
}
vec3 adjust(vec3 c,float m,int i){
 vec4 k=mC[i],l=mD[i];
 c*=exp2(k.x*m);
 vec3 g=vec3(exp(.5*k.y),exp(-.35*k.z),exp(-.6*k.y));g/=dot(g,vec3(.2126,.7152,.0722));c*=mix(vec3(1.),g,m);
 float y=lum(c);c=max(mix(vec3(y),c,1.+k.w*m),0.);
 c=.18*pow(max(c,vec3(1e-6))/.18,vec3(1.+l.x*.6*m));
 vec3 gel=hsv2rgb(vec3(l.y,1.,1.));gel/=max(lum(gel),.05);c*=mix(vec3(1.),mix(vec3(1.),gel,.55),l.z*m);
 return c;
}
uint hashU(uvec2 q){uint n=q.x*1597334677u+q.y*3812015801u+2798796415u;n=(n^(n>>16u))*2246822519u;n=(n^(n>>13u))*3266489917u;return n^(n>>16u);}
float hash(ivec2 p){return float(hashU(uvec2(p)))/4294967295.;}
float noise(vec2 p){ivec2 c=ivec2(floor(p));vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(c),hash(c+ivec2(1,0)),f.x),mix(hash(c+ivec2(0,1)),hash(c+ivec2(1,1)),f.x),f.y)*2.-1.;}
float grain(vec2 p){return noise(p)*.62+noise(p*.5+vec2(83.7,19.2))*.28+noise(p*1.9+vec2(41.3,67.8))*.18;}
vec3 lookup(vec3 lin){
 vec3 s=lutDisplay>.5?(clamp(encode(lin),0.,1.)-domainMin)/(domainMax-domainMin):log2(1.+15.*max(lin,vec3(0.)))/log2(61.);
 s=clamp(s,0.,1.)*(lutSize-1.)/lutSize+.5/lutSize;
 return texture(lut,s).rgb;
}
float enc1(float x){return x<=.0031308?x*12.92:1.055*pow(x,1./2.4)-.055;}
float dec1(float x){return x<=.04045?x/12.92:pow((x+.055)/1.055,2.4);}
void main(){
 vec2 img=vec2(uv.x,1.-uv.y);
 vec4 s=texture(src,uv);
 if(bypass>.5){frag=vec4(s.rgb,1.);return;}
 vec3 c=decode(s.rgb)*gain;
 if(contrast!=0.||highlights!=0.||shadows!=0.){ // tone on display luminance, applied as a ratio so hue holds
  float y0=lum(c),Y=clamp(enc1(y0),0.,1.),Y0=Y;float k=1.+contrast*.5;
  Y=Y<.5?.5*pow(Y/.5,k):1.-.5*pow((1.-Y)/.5,k);
  Y+=highlights*.14*6.75*Y*Y*(1.-Y);Y+=shadows*.14*6.75*Y*(1.-Y)*(1.-Y);
  Y=clamp(Y,0.,1.);c*=dec1(Y)/max(dec1(Y0),1e-6);
 }
 if(saturation!=0.){float y=lum(c);c=max(mix(vec3(y),c,1.+saturation),0.);}
 if(curveOn>.5){vec3 d=clamp(encode(c),0.,1.)*(255./256.)+.5/256.;c=decode(vec3(texture(curveTex,vec2(d.r,.5)).r,texture(curveTex,vec2(d.g,.5)).g,texture(curveTex,vec2(d.b,.5)).b));}
 vec3 base=c;float shown=0.;
 for(int i=0;i<${MAX_SLOTS};i++){if(i>=maskCount)break;float m=maskValue(i,img,base);c=adjust(c,m*mA[i].w,i);if(i==maskView-1)shown=m;}
 vec3 neutral=clamp(encode(c),0.,1.);
 vec3 color=neutral;
 if(lutOn>.5){
  color=mix(neutral,lookup(c),strength);
  vec2 q=uv-.5;q.x*=outSize.x/outSize.y;float r=length(q)/length(vec2(.5*outSize.x/outSize.y,.5));
  color*=1.-vignette*strength*smoothstep(.35,1.05,r);
  if(grainAmount>0.){
   vec2 g=img*outSize/min(outSize.x,outSize.y)*1000./grainSize;vec2 o=vec2(250./(min(outSize.x,outSize.y)*grainSize));
   float gn=(grain(g+o)+grain(g-o)+grain(g+vec2(o.x,-o.y))+grain(g+vec2(-o.x,o.y)))*.25;
   float y=lum(color);float w=(.35+.65*pow(max(0.,1.-abs(y-.45)*1.8),.7))*smoothstep(0.,.1,y)*(1.-.7*smoothstep(.8,1.,y));
   color+=gn*grainAmount*strength*w;
  }
 }
 if(maskView>0)color=mix(color,overlayColor,shown*.55);
 frag=vec4(clamp(color,0.,1.),1.);
}`;

const NEUTRAL = ['ev', 'temp', 'tint', 'sat', 'contrast', 'amount'];
export const maskIsNeutral = m => NEUTRAL.every(k => !m.adj?.[k]);
const TYPES = ['linear', 'radial', 'luma', 'color', 'brush'];

// styleMasks follow the style's strength; user masks are always at full amount.
export function packMasks(styleMasks, userMasks, strength, viewId) {
 const live = [...(styleMasks ?? []).filter(m => m.enabled !== false && !maskIsNeutral(m)).map(m => ({m, amount: strength})), ...(userMasks ?? []).filter(m => m.id === viewId || (m.enabled !== false && !maskIsNeutral(m))).map(m => ({m, amount: m.enabled === false ? 0 : 1}))].slice(0, MAX_SLOTS);
 const a = new Float32Array(MAX_SLOTS * 4), b = new Float32Array(MAX_SLOTS * 4), c = new Float32Array(MAX_SLOTS * 4), d = new Float32Array(MAX_SLOTS * 4);
 live.forEach(({m, amount}, i) => {
  const o = i * 4, geo = m.type === 'linear' ? [m.x0, m.y0, m.x1, m.y1] : m.type === 'radial' ? [m.cx, m.cy, m.rx, m.ry] : m.type === 'luma' ? [m.lo / 100, m.hi / 100, m.feather / 100, 0] : m.type === 'color' ? [m.hue / 360, m.width / 360, m.feather / 360, 0] : [0, 0, 0, 0];
  a.set([TYPES.indexOf(m.type), m.invert ? 1 : 0, m.type === 'radial' ? m.feather / 100 : 0, amount], o); b.set(geo, o);
  c.set([m.adj.ev ?? 0, (m.adj.temp ?? 0) / 100, (m.adj.tint ?? 0) / 100, (m.adj.sat ?? 0) / 100], o);
  d.set([(m.adj.contrast ?? 0) / 100, (m.adj.hue ?? 0) / 360, (m.adj.amount ?? 0) / 100, m.layer ?? 0], o);
 });
 return {count: live.length, a, b, c, d, view: viewId ? live.findIndex(x => x.m.id === viewId) + 1 : 0};
}
// Global white balance gains for the 色溫 / 色調 sliders (−100..100) and exposure in EV.
export function globalGain(adjust) {
 const t = (adjust.temp ?? 0) / 100 * .6, tint = (adjust.tint ?? 0) / 100 * .6;
 const g = [Math.exp(.5 * t), Math.exp(-.35 * tint), Math.exp(-.6 * t)], n = .2126 * g[0] + .7152 * g[1] + .0722 * g[2], e = 2 ** (adjust.exposure ?? 0);
 return g.map(v => v / n * e);
}

export class StudioRenderer {
 constructor(canvas) {
  this.canvas = canvas;
  const g = this.gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
  if (!g) throw Error('這個瀏覽器未啟用 WebGL2，請使用新版 Safari 或 Chrome。');
  g.getExtension('EXT_color_buffer_float'); g.getExtension('OES_texture_float_linear');
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
  const limit = Math.min(g.getParameter(g.MAX_TEXTURE_SIZE), g.getParameter(g.MAX_RENDERBUFFER_SIZE), ...g.getParameter(g.MAX_VIEWPORT_DIMS));
  this.maxEdge = Math.min(coarse ? 8192 : 16384, limit); this.maxPixels = coarse ? 12_600_000 : 40_000_000;
  const compile = (type, text) => {const s = g.createShader(type); g.shaderSource(s, text); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s)); return s;};
  const p = this.program = g.createProgram();
  g.attachShader(p, compile(g.VERTEX_SHADER, vertex)); g.attachShader(p, compile(g.FRAGMENT_SHADER, fragment)); g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(p));
  g.useProgram(p);
  const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  this.locs = new Map(); this.sources = new Map(); this.luts = new Map();
  for (const [name, unit] of [['src', 0], ['lut', 3], ['curveTex', 5], ['brushTex', 6]]) g.uniform1i(this.loc(name), unit);
  // Placeholders so every sampler is always complete.
  this.neutralLut = this.makeLut({size: 2, data: new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1])});
  this.curveTex = this.tex2D(); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));
  this.brushTex = null; this.setBrushSize(1, 1);
  canvas.addEventListener('webglcontextlost', e => {e.preventDefault(); this.lost = true; canvas.dispatchEvent(new CustomEvent('engine-error', {detail: 'GPU 中斷了，請重新整理頁面。'}));});
 }
 loc(name) {if (!this.locs.has(name)) this.locs.set(name, this.gl.getUniformLocation(this.program, name)); return this.locs.get(name);}
 tex2D() {
  const g = this.gl, t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  return t;
 }
 // Named sources: the preview, the thumbnail and a temporary full-size image can coexist.
 setSource(key, image, width = image.width, height = image.height) {
  if (width > this.maxEdge || height > this.maxEdge) throw Error('影像超出此裝置的處理範圍。');
  const g = this.gl; let s = this.sources.get(key);
  if (!s) this.sources.set(key, s = {tex: this.tex2D()});
  s.width = width; s.height = height;
  g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, s.tex);
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, image); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
  g.generateMipmap(g.TEXTURE_2D); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
 }
 dropSource(key) {const s = this.sources.get(key); if (s) {this.gl.deleteTexture(s.tex); this.sources.delete(key);}}
 makeLut(lut) {
  const g = this.gl, t = g.createTexture(); g.bindTexture(g.TEXTURE_3D, t);
  for (const p of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T, g.TEXTURE_WRAP_R]) g.texParameteri(g.TEXTURE_3D, p, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_3D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_3D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texImage3D(g.TEXTURE_3D, 0, g.RGBA16F, lut.size, lut.size, lut.size, 0, g.RGBA, g.FLOAT, lut.data);
  return t;
 }
 lutTexture(lut) { // small LRU: a library can hold hundreds of styles
  let t = this.luts.get(lut);
  if (t) {this.luts.delete(lut); this.luts.set(lut, t); return t;}
  t = this.makeLut(lut); this.luts.set(lut, t);
  if (this.luts.size > 36) {const [old, tex] = this.luts.entries().next().value; this.gl.deleteTexture(tex); this.luts.delete(old);}
  return t;
 }
 // curve: Float32Array(256*4) of display-domain outputs per channel, or null.
 setCurve(table) {
  const g = this.gl; this.hasCurve = !!table; if (!table) return;
  g.activeTexture(g.TEXTURE5); g.bindTexture(g.TEXTURE_2D, this.curveTex);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, 256, 1, 0, g.RGBA, g.FLOAT, table);
 }
 setBrushSize(width, height) {
  const g = this.gl; if (this.brushTex && this.brushW === width && this.brushH === height) return;
  if (this.brushTex) g.deleteTexture(this.brushTex);
  this.brushTex = g.createTexture(); this.brushW = width; this.brushH = height;
  g.activeTexture(g.TEXTURE6); g.bindTexture(g.TEXTURE_2D_ARRAY, this.brushTex);
  g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texStorage3D(g.TEXTURE_2D_ARRAY, 1, g.RGBA8, width, height, BRUSH_LAYERS);
 }
 // Painted masks are canvases whose alpha is the selection; row 0 is the top of the image.
 setBrushLayer(layer, canvas) {
  const g = this.gl; this.setBrushSize(canvas.width, canvas.height);
  g.activeTexture(g.TEXTURE6); g.bindTexture(g.TEXTURE_2D_ARRAY, this.brushTex);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  g.texSubImage3D(g.TEXTURE_2D_ARRAY, 0, 0, 0, layer, canvas.width, canvas.height, 1, g.RGBA, g.UNSIGNED_BYTE, canvas);
 }
 // p: {source, width, height, style?, strength, adjust, masks, view, bypass}
 render(p) {
  const g = this.gl, s = this.sources.get(p.source); if (this.lost || !s) return false;
  if (this.canvas.width !== p.width || this.canvas.height !== p.height) {
   if (p.width > this.maxEdge || p.height > this.maxEdge || p.width * p.height > this.maxPixels) throw Error('輸出尺寸超出此裝置的處理範圍。');
   this.canvas.width = p.width; this.canvas.height = p.height;
   if (g.drawingBufferWidth < p.width || g.drawingBufferHeight < p.height) throw Error('瀏覽器無法配置這麼大的畫面。');
  }
  const style = p.style, lut = style?.lut, adjust = p.adjust ?? {}, strength = style ? (p.strength ?? 1) : 0;
  const f = (n, v) => g.uniform1f(this.loc(n), v);
  g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, s.tex);
  g.activeTexture(g.TEXTURE3); g.bindTexture(g.TEXTURE_3D, lut ? this.lutTexture(lut) : this.neutralLut);
  g.activeTexture(g.TEXTURE5); g.bindTexture(g.TEXTURE_2D, this.curveTex);
  g.activeTexture(g.TEXTURE6); g.bindTexture(g.TEXTURE_2D_ARRAY, this.brushTex);
  g.uniform2f(this.loc('outSize'), p.width, p.height); f('srcAspect', s.width / s.height); f('bypass', p.bypass ? 1 : 0);
  f('strength', strength); f('lutOn', lut ? 1 : 0); f('lutSize', lut?.size ?? 2); f('lutDisplay', lut?.input === 'display' ? 1 : 0);
  g.uniform3f(this.loc('domainMin'), ...(lut?.domainMin ?? [0, 0, 0])); g.uniform3f(this.loc('domainMax'), ...(lut?.domainMax ?? [1, 1, 1]));
  g.uniform3f(this.loc('gain'), ...globalGain(adjust)); g.uniform3f(this.loc('overlayColor'), ...(p.overlay ?? [1, .18, .28]));
  f('contrast', (adjust.contrast ?? 0) / 100); f('highlights', (adjust.highlights ?? 0) / 100); f('shadows', (adjust.shadows ?? 0) / 100); f('saturation', (adjust.saturation ?? 0) / 100);
  f('curveOn', p.curve !== false && this.hasCurve ? 1 : 0);
  f('vignette', style?.vignette ?? 0); f('grainAmount', style?.grain?.amount ?? 0); f('grainSize', style?.grain?.size ?? 1.5);
  const m = packMasks(style?.masks, p.masks, strength, p.view ?? null);
  g.uniform1i(this.loc('maskCount'), m.count); g.uniform1i(this.loc('maskView'), m.view);
  for (const k of ['a', 'b', 'c', 'd']) g.uniform4fv(this.loc(`m${k.toUpperCase()}[0]`), m[k]);
  g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, p.width, p.height); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  if (g.isContextLost()) throw Error('GPU 中斷了，請重新整理頁面。');
  return true;
 }
}
