// Shape-preserving cubic interpolation for five equally-spaced tone-curve knots.
export const CHANNELS=['m','r','g','b'];
export const identity=()=>Object.fromEntries(CHANNELS.flatMap(c=>[0,25,50,75,100].map((v,i)=>[c+i,v])));
export function sampleCurve(points,x){
  const y=points.map(v=>v/100),d=y.slice(1).map((v,i)=>(v-y[i])*4),s=[d[0]];
  for(let i=1;i<4;i++)s.push(d[i-1]*d[i]<=0?0:2*d[i-1]*d[i]/(d[i-1]+d[i]));
  s.push(d[3]); const t=Math.max(0,Math.min(1,x))*4,i=Math.min(3,Math.floor(t)),u=t-i;
  return Math.max(0,Math.min(1,(2*u**3-3*u*u+1)*y[i]+(u**3-2*u*u+u)*s[i]/4+(-2*u**3+3*u*u)*y[i+1]+(u**3-u*u)*s[i+1]/4));
}
export function curveLUT(params){
  const curves=CHANNELS.map(c=>Array.from({length:5},(_,i)=>params[c+i]));
  const data=new Uint8Array(256*4);
  for(let i=0;i<256;i++){for(let c=0;c<3;c++)data[i*4+c]=Math.round(sampleCurve(curves[c+1],i/255)*255);data[i*4+3]=Math.round(sampleCurve(curves[0],i/255)*255);}
  return data;
}
