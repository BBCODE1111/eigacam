import {validateRecipe} from './model.js';
export async function decodePhoto(file,options={}){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('請選擇 JPEG、PNG 或 WebP。RAW／HEIC 請先轉為 sRGB JPEG。');
  if(file.size>60*1024*1024)throw Error('照片超過 60 MB，請先縮小檔案。');
  // Browser performs ICC conversion and EXIF orientation exactly once.
  let image;
  try{image=await createImageBitmap(file,{imageOrientation:'from-image',colorSpaceConversion:'default'});}catch{
    image=await new Promise((resolve,reject)=>{const im=new Image(),url=URL.createObjectURL(file);im.onload=()=>{URL.revokeObjectURL(url);resolve(im);};im.onerror=()=>{URL.revokeObjectURL(url);reject(Error('無法解碼照片'));};im.src=url;});
  }
  if(image.width*image.height>100_000_000){image.close?.();throw Error('照片超過 1 億像素，請先縮小。');}
  // Normalize once through an explicit sRGB canvas. Both preview and full-size
  // output then resample the same decoded pixels, avoiding browser JPEG decode
  // scaling paths that can differ at small preview sizes.
  const originalWidth=image.width,originalHeight=image.height;
  const coarse=matchMedia('(pointer: coarse)').matches;
  const safeEdge=options.maxEdge??(coarse?4096:16384),safePixels=options.maxPixels??(coarse?12_000_000:36_000_000);
  const target=options.target;
  if(target&&(target.width>originalWidth||target.height>originalHeight||target.width>safeEdge||target.height>safeEdge||target.width*target.height>safePixels)){
    image.close?.();throw Error('目標尺寸超出裝置範圍，請改選較小尺寸。');
  }
  const scale=Math.min(1,safeEdge/Math.max(originalWidth,originalHeight),Math.sqrt(safePixels/(originalWidth*originalHeight)));
  const normalized=document.createElement('canvas');normalized.width=Math.max(1,Math.floor(originalWidth*scale));normalized.height=Math.max(1,Math.floor(originalHeight*scale));
  normalized.originalWidth=originalWidth;normalized.originalHeight=originalHeight;
  const context=normalized.getContext('2d',{colorSpace:'srgb'});context.fillStyle='#fff';context.fillRect(0,0,normalized.width,normalized.height);context.imageSmoothingQuality='high';context.drawImage(image,0,0,normalized.width,normalized.height);
  try{context.getImageData(0,0,1,1);}catch{image.close?.();throw Error('瀏覽器無法配置影像畫布，請先縮小照片。');}
  image.close?.();
  if(target&&(target.width!==normalized.width||target.height!==normalized.height)){
    const output=document.createElement('canvas');output.width=target.width;output.height=target.height;output.originalWidth=originalWidth;output.originalHeight=originalHeight;
    const targetContext=output.getContext('2d',{colorSpace:'srgb'});targetContext.imageSmoothingQuality='high';targetContext.drawImage(normalized,0,0,target.width,target.height);
    normalized.width=normalized.height=1;return output;
  }
  return normalized;
}
export function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);}
export const jsonBlob=value=>new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
export function readDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('讀取原圖失敗'));r.readAsDataURL(blob);});}
export async function encodeProject(file,state){return {format:'filmroom-project',version:1,source:{name:file.name,type:file.type,data:await readDataURL(file)},recipe:state};}
export async function readJSON(file,maxMB=2){if(file.size>maxMB*1024*1024)throw Error('檔案過大');try{return JSON.parse(await file.text());}catch{throw Error('JSON 檔案無法讀取');}}
export function decodeProject(raw){
  if(raw?.format!=='filmroom-project'||raw.version!==1)throw Error('這不是可支援的映室專案');
  const state=validateRecipe(raw.recipe);const src=raw.source;
  if(!src||!['image/jpeg','image/png','image/webp'].includes(src.type)||typeof src.data!=='string'||!src.data.startsWith(`data:${src.type};base64,`))throw Error('專案原圖格式無效');
  const data=atob(src.data.split(',')[1]);if(data.length>60*1024*1024)throw Error('專案原圖過大');const bytes=Uint8Array.from(data,c=>c.charCodeAt(0));
  return {state,file:new File([bytes],String(src.name||'photo.jpg').slice(0,160),{type:src.type})};
}
