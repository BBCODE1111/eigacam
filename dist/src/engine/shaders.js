export const vertex=`#version 300 es
precision highp float;
layout(location=0) in vec2 position;
out vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
export const fragment=`#version 300 es
precision highp float;
precision highp int;
in vec2 uv;out vec4 frag;
uniform sampler2D image,base,aux,farLight,lightSeed,curveMap;
uniform int op,maskCount,maskView;
uniform float exposure,mixAmount,strength,split,originalOnly;
uniform vec2 resolution,direction,footprint;
uniform vec4 p0,p1,p2,p3;
uniform vec4 ma[8],mb[8],mc[8];
vec3 decode(vec3 x){return mix(x/12.92,pow(max((x+.055)/1.055,vec3(0.)),vec3(2.4)),step(vec3(.04045),x));}
vec3 encode(vec3 x){x=max(x,vec3(0.));return mix(x*12.92,1.055*pow(x,vec3(1./2.4))-.055,step(vec3(.0031308),x));}
float lum(vec3 x){return dot(x,vec3(.2126,.7152,.0722));}
vec3 hsv2rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
float hueDistance(float a,float b){return min(abs(a-b),1.-abs(a-b));}
float maskAt(){
 float result=1.;vec2 q=vec2(uv.x,1.-uv.y);float l=lum(encode(texture(base,uv).rgb));
 for(int i=0;i<8;i++){if(i>=maskCount)break;vec4 a=ma[i],b=mb[i],c=mc[i];float m=1.;float f=max(b.x,.001);
  if(a.x<.5){float lo=b.y<=0.?1.:smoothstep(b.y-f*.5,b.y+f*.5,l);float hi=b.z>=1.?1.:1.-smoothstep(b.z-f*.5,b.z+f*.5,l);m=lo*hi;}
  else if(a.x<1.5){float angle=radians(c.x);float d=dot(q-a.zw,vec2(cos(angle),sin(angle)))+.5;m=smoothstep(c.y-f*.5,c.z+f*.5,d);}
  else {vec2 delta=(q-a.zw)*resolution/min(resolution.x,resolution.y);float d=length(delta);m=1.-smoothstep(max(.001,b.w-f*.5),b.w+f*.5,d);}
  if(a.y>.5)m=1.-m;
  if(i==0)result=c.w==1.?1.-m:m;
  else if(c.w<.5)result*=m;else if(c.w<1.5)result*=1.-m;else result=1.-(1.-result)*(1.-m);
 }return clamp(result,0.,1.);
}
float curveCoord(float x){return (clamp(x,0.,1.)*255.+.5)/256.;}
float masterCurve(float x){return texture(curveMap,vec2(curveCoord(x),.5)).a;}
// Integer hashing avoids device-dependent sine precision and keeps the film fixed
// to image coordinates when rendering the preview and a larger export.
float grainHash(ivec2 p){uvec2 q=uvec2(p);uint n=q.x*1597334677u+q.y*3812015801u+2798796415u;n=(n^(n>>16u))*2246822519u;n=(n^(n>>13u))*3266489917u;return float(n^(n>>16u))/4294967295.;}
float grainNoise(vec2 p){ivec2 cell=ivec2(floor(p));vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(grainHash(cell),grainHash(cell+ivec2(1,0)),f.x),mix(grainHash(cell+ivec2(0,1)),grainHash(cell+ivec2(1,1)),f.x),f.y)*2.-1.;}
float filmGrain(vec2 p,float rough){float fine=grainNoise(p);float clusters=grainNoise(p*.47+vec2(83.7,19.2));float micro=grainNoise(p*1.91+vec2(41.3,67.8));return mix(fine*.82+micro*.18,fine*.48+clusters*.52,rough);}

void main(){
 vec3 inputColor=texture(image,uv).rgb;vec3 outColor=inputColor;
 if(op==0){frag=vec4(decode(inputColor)*exp2(exposure),1.);return;}
 // Highlight selection is evaluated on actual image luminance; energy stays linear through both blur passes.
 if(op==8){float l=lum(encode(inputColor));float m=smoothstep(p0.x-p0.y*.5,p0.x+p0.y*.5,l);frag=vec4(inputColor*m,1.);return;}
 // V2 optics measure the exposed original, before highlight compression.
 // A chromatic light (e.g. a red sign) may be bright even at low luminance.
 if(op==13){vec3 sum=vec3(0.);for(int x=0;x<4;x++){for(int y=0;y<4;y++){vec2 offset=(vec2(float(x),float(y))+.5)/4.-.5;vec3 sampleColor=texture(image,uv+offset*footprint).rgb;vec3 encoded=encode(sampleColor);float l=max(lum(encoded),max(encoded.r,max(encoded.g,encoded.b))*.82);float m=smoothstep(p0.x-p0.y*.5,p0.x+p0.y*.5,l);sum+=sampleColor*m;}}frag=vec4(sum/16.,1.);return;}
 if(op==14){vec2 d=footprint*.25;frag=vec4((texture(image,uv+d).rgb+texture(image,uv-d).rgb+texture(image,uv+vec2(d.x,-d.y)).rgb+texture(image,uv+vec2(-d.x,d.y)).rgb)*.25,1.);return;}
 if(op==15){frag=vec4(inputColor,1.);return;}
 if(op==9){vec3 sum=vec3(0.);float weights=0.;for(int i=-12;i<=12;i++){float w=exp(-float(i*i)/32.);sum+=texture(image,uv+direction*float(i)/12.).rgb*w;weights+=w;}frag=vec4(sum/weights,1.);return;}
 if(op==10){
  vec3 original=texture(base,uv).rgb;vec3 color=mix(original,inputColor,mixAmount);
  if(originalOnly>.5||(split>=0.&&uv.x<split))color=decode(texture(aux,uv).rgb);
  color=clamp(encode(color),0.,1.);
  if(maskView==1){float m=maskAt();color=mix(color,vec3(.9,.22,.18),m*.48);}
  frag=vec4(color,1.);return;
 }
 if(op==16){vec3 c=clamp(encode(inputColor),0.,1.);c=vec3(masterCurve(c.r),masterCurve(c.g),masterCurve(c.b));c=vec3(texture(curveMap,vec2(curveCoord(c.r),.5)).r,texture(curveMap,vec2(curveCoord(c.g),.5)).g,texture(curveMap,vec2(curveCoord(c.b),.5)).b);outColor=decode(c);
 }else if(op==1){
  vec3 c=encode(inputColor*exp2(p0.x));float l=clamp(lum(c),0.,1.);
  c=(c-.5)*(1.+p0.y/100.)+.5;
  c+=p0.z/100.*pow(l,2.)*.35+p0.w/100.*pow(1.-l,2.)*.3;
  c+=p1.x/100.*pow(l,4.)*.5+p1.y/100.*pow(1.-l,4.)*.35;
  c*=vec3(1.+p1.z*.0015,1.+p1.w*.0005,1.-p1.z*.0015);
  c.g-=p1.w*.0006;outColor=decode(clamp(c,0.,1.));
 }else if(op==2){
  vec3 c=clamp(encode(inputColor),0.,1.);float l=lum(c);c+=(c-vec3(.5))*(c*(1.-c))*p0.y*.025;
  vec3 hsv=rgb2hsv(clamp(c,0.,1.));float orange=exp(-pow(hueDistance(hsv.x,.075)/.075,2.));float aqua=exp(-pow(hueDistance(hsv.x,.55)/.13,2.));
  hsv.x=fract(hsv.x+(p2.x*orange+p3.x*aqua)/360.);hsv.y=clamp(hsv.y*(1.+p0.x/100.)*(1.+p2.y*orange/100.+p3.y*aqua/100.),0.,1.);hsv.z=clamp(hsv.z*(1.+p2.z*orange/100.+p3.z*aqua/100.),0.,1.);c=hsv2rgb(hsv);
  vec3 shadow=hsv2rgb(vec3(p0.z/360.,.65,1.));vec3 highlight=hsv2rgb(vec3(p1.x/360.,.55,1.));
  c*=mix(vec3(1.),shadow/max(lum(shadow),.01),p0.w/100.*pow(1.-l,2.));
  c*=mix(vec3(1.),highlight/max(lum(highlight),.01),p1.y/100.*pow(l,2.));outColor=decode(clamp(c,0.,1.));
 }else if(op==3){vec3 tint=hsv2rgb(vec3(p1.x/360.,p1.y,1.));outColor=inputColor+texture(aux,uv).rgb*p0.w*tint;
 }else if(op==4){vec3 c=encode(inputColor);float l=lum(c);float m=1.-smoothstep(p0.x-p0.y*.5,p0.x+p0.y*.5,l);vec3 tint=hsv2rgb(vec3(p1.x/360.,.7,1.));vec3 local=(c-.2)*(1.+p0.w)+.2+p0.z;local*=mix(vec3(1.),tint/max(lum(tint),.01),p1.y);outColor=decode(clamp(mix(c,local,m),0.,1.));
 }else if(op==5){outColor=mix(inputColor,texture(aux,uv).rgb,p0.w);
  }else if(op==6){
  // Size is measured relative to a 1000px short edge, not output pixels.
  vec2 coord=vec2(uv.x,1.-uv.y)*resolution/min(resolution.x,resolution.y)*1000./p0.y;
  // Integrate the pixel footprint: fine grain does not alias in small previews.
  vec2 d=vec2(250./(min(resolution.x,resolution.y)*p0.y));
  float noise=(filmGrain(coord+d,p0.z)+filmGrain(coord-d,p0.z)+filmGrain(coord+vec2(d.x,-d.y),p0.z)+filmGrain(coord+vec2(-d.x,d.y),p0.z))*.25;
  vec3 c=clamp(encode(inputColor),0.,1.);float y=lum(c);
  float weight=(.38+.62*pow(max(0.,1.-abs(y-.46)*1.85),.7))*smoothstep(0.,.12,y)*(1.-.7*smoothstep(.78,1.,y));
  outColor=decode(clamp(c+noise*p0.x*.8*weight,0.,1.));
 }else if(op==7){vec2 q=vec2(uv.x,1.-uv.y);float d=length((q-p1.xy)*vec2(1.4142));float m=smoothstep(p0.y*.7,p0.y*.7+p0.z*.7,d);outColor=inputColor*(1.-m*p0.x);
 }else if(op==11){
  vec3 c=clamp(encode(inputColor),0.,1.);float y=lum(c);
  float shaped=y+p0.y*.9*(y-.4)*y*(1.-y)-p0.x*.12*sin(y*3.14159265);
  shaped+=p0.w*.035*(1.-exp(-y*12.))*exp(-y*8.);
  shaped-=p0.z*.14*smoothstep(.5,1.,shaped);
  c*=max(shaped,0.)/max(y,.00001);
  float saturation=(.9+p1.x*.2)*mix(.72,1.,smoothstep(.03,.32,y));
  c=mix(vec3(lum(c)),c,saturation);outColor=decode(clamp(c,0.,1.));
 }else if(op==12){
  vec3 nearGlow=texture(aux,uv).rgb,wideGlow=texture(farLight,uv).rgb,seed=texture(lightSeed,uv).rgb;
  vec3 tint=hsv2rgb(vec3(p1.x/360.,p1.y,1.));
  vec3 warmEdge=hsv2rgb(vec3(p1.x/360.,min(1.,p1.y+.3),1.));
  vec3 edge=max(nearGlow-seed,vec3(0.));
  vec3 light=(nearGlow*.65+wideGlow*p2.x*.85)*tint+edge*p1.w*.9*warmEdge;
  float protect=1.-smoothstep(.48,1.,lum(encode(inputColor)))*p2.y;
  outColor=inputColor+light*p0.w*protect;
 }
 frag=vec4(mix(inputColor,outColor,maskAt()*strength),1.);
}`;
