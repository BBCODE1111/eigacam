// Sharing must run directly in the tap handler, after the JPEG files already exist in memory.
export function canSharePhoto(files, api = navigator) {
 const list = [files].flat().filter(Boolean);
 try {return list.length > 0 && typeof api.share === 'function' && typeof api.canShare === 'function' && api.canShare({files: list});} catch {return false;}
}
export function sharePhoto(files, api = navigator) {
 const list = [files].flat().filter(Boolean);
 if (!canSharePhoto(list, api)) return Promise.resolve({status: 'unsupported'});
 // Files only: avoid Safari treating a mixed URL/text payload as a webpage share.
 try {return Promise.resolve(api.share({files: list})).then(() => ({status: 'shared'}), e => {if (e.name === 'AbortError') return {status: 'cancelled'}; throw e;});}
 catch (e) {return Promise.reject(e);}
}
