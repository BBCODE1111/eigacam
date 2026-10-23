import {curveLUT} from '../curves.js';
import {vertex,fragment} from './shaders.js';
const OPS={tone:1,color:2,glow:3,shadow:4,soften:5,grain:6,vignette:7,film:11,bloom:12,curves:16};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
export class Renderer {
  constructor(canvas){
    this.canvas=canvas;this.gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    if(!this.gl)throw Error('這個瀏覽器未啟用 WebGL2，請使用新版 Safari、Chrome 或 Edge。');
    const g=this.gl;this.float=!!g.getExtension('EXT_color_buffer_float');
    // Never fall back to an 8-bit linear pipeline: it destroys shadow precision.
    if(!this.float)throw Error('裝置無法提供浮點影像處理，請啟用硬體加速或換用新版 Safari。');
    this.maxSize=Math.min(matchMedia('(pointer: coarse)').matches?4096:16384,g.getParameter(g.MAX_TEXTURE_SIZE),g.getParameter(g.MAX_RENDERBUFFER_SIZE),...g.getParameter(g.MAX_VIEWPORT_DIMS));
    this.pixelLimit=matchMedia('(pointer: coarse)').matches?12_000_000:36_000_000;
    this.targets=[];this.uniforms=new Map();
    const compile=(type,src)=>{const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
    const vs=compile(g.VERTEX_SHADER,vertex),fs=compile(g.FRAGMENT_SHADER,fragment);
    this.program=g.createProgram();g.attachShader(this.program,vs);g.attachShader(this.program,fs);g.linkProgram(this.program);
    if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));g.deleteShader(vs);g.deleteShader(fs);g.useProgram(this.program);
    this.buffer=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),g.STATIC_DRAW);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,0,0);
    g.uniform1i(this.loc('image'),0);g.uniform1i(this.loc('base'),1);g.uniform1i(this.loc('aux'),2);
    g.uniform1i(this.loc('farLight'),3);g.uniform1i(this.loc('lightSeed'),4);
    g.uniform1i(this.loc('curveMap'),5);this.curveTexture=g.createTexture();
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;canvas.dispatchEvent(new CustomEvent('engine-error',{detail:'GPU 工作階段中斷，請儲存專案並重新整理。'}));});
  }
  loc(name){if(!this.uniforms.has(name))this.uniforms.set(name,this.gl.getUniformLocation(this.program,name));return this.uniforms.get(name);}
  f(name,v){this.gl.uniform1f(this.loc(name),v);}
  i(name,v){this.gl.uniform1i(this.loc(name),v);}
  vec(name,...v){this.gl[`uniform${v.length}f`](this.loc(name),...v);}
  texture(width,height,data=null){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);if(data){g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,true);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,data);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);}else g.texImage2D(g.TEXTURE_2D,0,g.RGBA16F,width,height,0,g.RGBA,g.HALF_FLOAT,null);return t;}
  target(width,height){const g=this.gl,tex=this.texture(width,height),fb=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,fb);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,tex,0);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE){g.deleteTexture(tex);g.deleteFramebuffer(fb);throw Error('無法配置影像記憶體，請選擇較小輸出尺寸。');}const t={tex,fb,width,height};this.targets.push(t);return t;}
  releaseTargets(){const g=this.gl;for(const t of this.targets){g.deleteTexture(t.tex);g.deleteFramebuffer(t.fb);}this.targets=[];if(this.source)g.deleteTexture(this.source);this.source=null;}
  setSource(source,width,height){
    if(width>this.maxSize||height>this.maxSize||width*height>this.pixelLimit)throw Error('此尺寸超出裝置安全範圍，請在輸出尺寸選擇 3840、2560 或 1920 px。');
    this.releaseTargets();this.canvas.width=width;this.canvas.height=height;this.width=width;this.height=height;
    const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d',{colorSpace:'srgb'});ctx.imageSmoothingQuality='high';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(source,0,0,width,height);
    this.source=this.texture(width,height,c);c.width=c.height=1;
    this.base=this.target(width,height);this.ping=this.target(width,height);this.pong=this.target(width,height);
    // Blur buffers remain bounded; their coordinates and radii are normalized to the original image.
    const s=Math.min(1,1400/Math.max(width,height));this.blurA=this.target(Math.max(1,Math.round(width*s)),Math.max(1,Math.round(height*s)));this.blurB=this.target(this.blurA.width,this.blurA.height);
    this.opticalSeed=this.target(this.blurA.width,this.blurA.height);this.opticalNear=this.target(this.blurA.width,this.blurA.height);
    this.opticalLevels=[{image:this.opticalSeed,a:this.blurA,b:this.blurB}];
    for(let i=0;i<6;i++){const last=this.opticalLevels.at(-1).image;const w=Math.max(1,Math.round(last.width/2)),h=Math.max(1,Math.round(last.height/2));this.opticalLevels.push({image:this.target(w,h),a:this.target(w,h),b:this.target(w,h)});}
    this.bind(1,this.base.tex);this.i('maskCount',0);this.i('maskView',0);
    if(this.gl.getError()!==this.gl.NO_ERROR)throw Error('影像記憶體不足，請選擇較小的尺寸。');
  }
  bind(unit,tex){const g=this.gl;g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,tex);}
  draw(op,source,target=null,aux=this.source,far=this.source,seed=this.source){
    const g=this.gl;this.i('op',op);this.bind(0,source);this.bind(1,target===this.base?this.source:this.base.tex);this.bind(2,aux);
    this.bind(3,far);this.bind(4,seed);
    g.bindFramebuffer(g.FRAMEBUFFER,target?.fb??null);g.viewport(0,0,target?.width??this.width,target?.height??this.height);this.vec('resolution',this.width,this.height);this.vec('footprint',1/(target?.width??this.width),1/(target?.height??this.height));g.drawArrays(g.TRIANGLE_STRIP,0,4);
  }
  masks(masks=[]){
    this.i('maskCount',masks.length);const a=[],b=[],c=[];
    for(let i=0;i<8;i++){const m=masks[i];a.push(m?['luminance','linear','radial'].indexOf(m.type):0,m?.invert?1:0,m?.x??.5,m?.y??.5);b.push(m?.feather??.1,m?.low??0,m?.high??1,m?.radius??.5);c.push(m?.angle??0,m?.start??0,m?.end??1,m?['intersect','subtract','union'].indexOf(m.combine):0);}
    this.gl.uniform4fv(this.loc('ma[0]'),a);this.gl.uniform4fv(this.loc('mb[0]'),b);this.gl.uniform4fv(this.loc('mc[0]'),c);
  }
  params(layer){
    const p=layer.params;let v=[];
    switch(layer.type){
      case 'curves':{
        const key=JSON.stringify(p);this.bind(5,this.curveTexture);
        if(key!==this.curveKey){const g=this.gl;g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,256,1,0,g.RGBA,g.UNSIGNED_BYTE,curveLUT(p));this.curveKey=key;}break;
      }
      case 'film':v=[[p.density,p.contrast,p.shoulder,p.toe],[p.chroma,0,0,0]];break;
      case 'bloom':v=[[p.threshold,p.feather,p.radius,p.amount],[p.hue,p.saturation,p.spread,p.halation],[p.atmosphere,p.protect,0,0]];break;
      case 'tone':v=[[p.exposure,p.contrast,p.highlights,p.shadows],[p.whites,p.blacks,p.temperature,p.tint]];break;
      case 'color':v=[[p.saturation,p.curve,p.shadowHue,p.shadowSat],[p.highlightHue,p.highlightSat,0,0],[p.orangeHue,p.orangeSat,p.orangeLum,0],[p.aquaHue,p.aquaSat,p.aquaLum,0]];break;
      case 'glow':v=[[p.threshold,p.feather,p.radius,p.amount],[p.hue,p.saturation,0,0]];break;
      case 'shadow':v=[[p.threshold,p.feather,p.brightness,p.contrast],[p.hue,p.saturation,0,0]];break;
      case 'soften':v=[[0,0,p.radius,p.amount]];break;
      case 'grain':v=[[p.amount,p.size,p.roughness,0]];break;
      case 'vignette':v=[[p.amount,p.range,p.feather,0],[p.x,p.y,0,0]];break;
    }
    for(let i=0;i<4;i++)this.vec(`p${i}`,...(v[i]??[0,0,0,0]));this.f('strength',layer.strength);this.masks(layer.masks);
  }
  blur(input,radius,highlight=false){
    if(highlight)this.draw(8,input,this.blurA);else {this.vec('direction',0,0);this.draw(9,input,this.blurA);}
    this.vec('direction',radius*Math.min(this.width,this.height)/this.width,0);this.draw(9,this.blurA.tex,this.blurB);
    this.vec('direction',0,radius*Math.min(this.width,this.height)/this.height);this.draw(9,this.blurB.tex,this.blurA);return this.blurA.tex;
  }
  opticalBlur(radius){
    // Choose a level where the complete radius fits into the 25-tap kernel.
    // Progressive 2x downsampling preserves light energy and avoids repeated-light streaks.
    let index=this.opticalLevels.findIndex(level=>radius*Math.min(this.width,this.height)*level.image.width/this.width<=12);
    if(index<0)index=this.opticalLevels.length-1;
    while(this.opticalBuilt<index){const next=this.opticalBuilt+1;this.draw(14,this.opticalLevels[this.opticalBuilt].image.tex,this.opticalLevels[next].image);this.opticalBuilt=next;}
    const level=this.opticalLevels[index];
    this.vec('direction',radius*Math.min(this.width,this.height)/this.width,0);this.draw(9,level.image.tex,level.a);
    this.vec('direction',0,radius*Math.min(this.width,this.height)/this.height);this.draw(9,level.a.tex,level.b);
    return level.b.tex;
  }
  start(state){if(this.lost)throw Error('GPU 工作階段已中斷，請重新整理。');this.f('exposure',state.exposure);this.draw(0,this.source,this.base);this.current=this.base;}
  layer(layer){
    if(!layer.enabled||layer.strength===0)return;
    this.params(layer);let aux=this.source,far=this.source,seed=this.source;
    if(layer.type==='bloom'){
      this.draw(13,this.base.tex,this.opticalSeed);this.opticalBuilt=0;
      const near=this.opticalBlur(layer.params.radius);this.draw(15,near,this.opticalNear);
      far=this.opticalBlur(layer.params.radius*layer.params.spread);
      aux=this.opticalNear.tex;seed=this.opticalSeed.tex;
    }else if(layer.type==='glow'||layer.type==='soften')aux=this.blur(this.current.tex,layer.params.radius,layer.type==='glow');
    const target=this.current===this.ping?this.pong:this.ping;this.draw(OPS[layer.type],this.current.tex,target,aux,far,seed);this.current=target;
  }
  finish(state,options={}){
    this.masks(options.maskLayer?.masks??[]);this.i('maskView',options.showMask?1:0);this.f('mixAmount',state.mix);this.f('split',options.split??-1);this.f('originalOnly',options.original?1:0);this.draw(10,this.current.tex,null,this.source);this.gl.flush();
  }
  render(state,options={}){if(!this.source)return;this.start(state);for(const l of state.layers)this.layer(l);this.finish(state,options);}
  async export(state,onProgress){this.start(state);onProgress(10);await tick();for(let i=0;i<state.layers.length;i++){this.layer(state.layers[i]);onProgress(10+70*(i+1)/state.layers.length);await tick();}this.finish(state);onProgress(85);await tick();if(this.gl.isContextLost()||this.gl.getError()!==this.gl.NO_ERROR)throw Error('GPU 匯出失敗，請降低輸出尺寸。');}
  destroy(){this.releaseTargets();this.gl.deleteTexture(this.curveTexture);this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
