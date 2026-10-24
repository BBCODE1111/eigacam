// Sharing must run directly in the tap handler, after JPEG preparation completes.
export function canSharePhoto(file,api=navigator){
 try{return !!file&&typeof api.share==='function'&&typeof api.canShare==='function'&&api.canShare({files:[file]});}catch{return false;}
}
export function sharePhoto(file,api=navigator){
 if(!canSharePhoto(file,api))return Promise.resolve({status:'unsupported'});
 // File only: avoid Safari treating a mixed URL/text payload as a webpage share.
 try{return Promise.resolve(api.share({files:[file]})).then(()=>({status:'shared'}),e=>{if(e.name==='AbortError')return {status:'cancelled'};throw e;});}
 catch(e){return Promise.reject(e);}
}
