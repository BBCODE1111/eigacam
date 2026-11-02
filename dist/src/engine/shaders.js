export const vertex = `#version 300 es
layout(location=0) in vec2 position;
out vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;

// One shader, three operations: highlight extraction, separable blur and the final develop pass.
export const fragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 uv;out vec4 frag;
uniform int op;
uniform sampler2D src,nearTex,farTex;
uniform sampler3D lut;
uniform vec4 crop;          // x,y,w,h in image space (top-left origin)
uniform float mirror;
uniform vec2 outSize,direction,grainSeed;
uniform vec3 wb,glowTint;
uniform float exposure,sharpen,strength,grainAmount,grainSize,halation,bloom,vignette,threshold,lutSize,lutDisplay;
uniform vec3 domainMin,domainMax;

vec3 decode(vec3 x){return mix(x/12.92,pow(max((x+.055)/1.055,vec3(0.)),vec3(2.4)),step(vec3(.04045),x));}
vec3 encode(vec3 x){x=max(x,vec3(0.));return mix(x*12.92,1.055*pow(x,vec3(1./2.4))-.055,step(vec3(.0031308),x));}
float lum(vec3 x){return dot(x,vec3(.2126,.7152,.0722));}
vec2 sourceUV(vec2 p){vec2 q=vec2(mirror>.5?1.-p.x:p.x,1.-p.y);vec2 img=crop.xy+q*crop.zw;return vec2(img.x,1.-img.y);}
vec3 scene(vec2 t){return decode(texture(src,t).rgb)*exposure*wb;}

uint hashU(uvec2 q){uint n=q.x*1597334677u+q.y*3812015801u+2798796415u;n=(n^(n>>16u))*2246822519u;n=(n^(n>>13u))*3266489917u;return n^(n>>16u);}
float hash(ivec2 p){return float(hashU(uvec2(p)))/4294967295.;}
float noise(vec2 p){ivec2 c=ivec2(floor(p));vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(c),hash(c+ivec2(1,0)),f.x),mix(hash(c+ivec2(0,1)),hash(c+ivec2(1,1)),f.x),f.y)*2.-1.;}
float grain(vec2 p){return noise(p)*.62+noise(p*.5+vec2(83.7,19.2))*.28+noise(p*1.9+vec2(41.3,67.8))*.18;}

vec3 lookup(vec3 lin){
 vec3 s=lutDisplay>.5?(clamp(encode(lin),0.,1.)-domainMin)/(domainMax-domainMin):log2(1.+15.*max(lin,vec3(0.)))/log2(61.);
 s=clamp(s,0.,1.)*(lutSize-1.)/lutSize+.5/lutSize;
 return texture(lut,s).rgb;
}

void main(){
 if(op==1){ // highlight energy, measured on the exposed scene; coloured lights count as bright
  vec3 c=scene(sourceUV(uv));float l=max(lum(c),max(c.r,max(c.g,c.b))*.8);
  frag=vec4(c*smoothstep(threshold-.18,threshold+.25,l),1.);return;
 }
 if(op==2){vec3 sum=vec3(0.);float total=0.;for(int i=-6;i<=6;i++){float w=exp(-float(i*i)/18.);sum+=texture(src,uv+direction*float(i)/6.).rgb*w;total+=w;}frag=vec4(sum/total,1.);return;}

 vec2 t=sourceUV(uv);vec2 px=crop.zw/outSize;
 vec3 c=scene(t);
 // Luminance-only unsharp mask on a one-pixel cross; soft-limited so edges never ring or halo.
 vec3 n=(scene(t+vec2(px.x,0.))+scene(t-vec2(px.x,0.))+scene(t+vec2(0.,px.y))+scene(t-vec2(0.,px.y)))*.25;
 float L=sqrt(max(lum(c),0.)),N=sqrt(max(lum(n),0.)),d=L-N;d=d/(1.+abs(d)*6.);
 float sharpL=max(L+sharpen*1.6*d,0.);c*=sharpL*sharpL/max(L*L,1e-6);
 vec3 neutral=clamp(encode(c),0.,1.);
 vec3 glow=texture(nearTex,uv).rgb*halation*glowTint+texture(farTex,uv).rgb*bloom*mix(vec3(1.),glowTint,.4);
 vec3 color=mix(neutral,lookup(c+glow),strength);
 vec2 q=uv-.5;q.x*=outSize.x/outSize.y;float r=length(q)/length(vec2(.5*outSize.x/outSize.y,.5));
 color*=1.-vignette*smoothstep(.35,1.05,r);
 if(grainAmount>0.){
  vec2 g=vec2(uv.x,1.-uv.y)*outSize/min(outSize.x,outSize.y)*1000./grainSize+grainSeed;
  vec2 o=vec2(250./(min(outSize.x,outSize.y)*grainSize));
  float gn=(grain(g+o)+grain(g-o)+grain(g+vec2(o.x,-o.y))+grain(g+vec2(-o.x,o.y)))*.25;
  float y=lum(color);float w=(.35+.65*pow(max(0.,1.-abs(y-.45)*1.8),.7))*smoothstep(0.,.1,y)*(1.-.7*smoothstep(.8,1.,y));
  color+=gn*grainAmount*w;
 }
 color+=(hash(ivec2(gl_FragCoord.xy))-.5)/255.; // dither against banding in smooth skies
 frag=vec4(clamp(color,0.,1.),1.);
}`;
