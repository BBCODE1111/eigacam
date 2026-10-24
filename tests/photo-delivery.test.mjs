import test from 'node:test';
import assert from 'node:assert/strict';
import {canSharePhoto,sharePhoto} from '../dist/src/photo-delivery.js';
const photo=new File(['jpeg-data'],'EIGACAM.jpg',{type:'image/jpeg'});
test('missing or unsupported file sharing stays on page without invoking share',async()=>{
 for(const api of [{},{share(){throw Error('must not call');}},{share(){throw Error('must not call');},canShare:()=>false},{canShare(){throw Error('blocked');},share(){throw Error('must not call');}}]){
  assert.equal(canSharePhoto(photo,api),false);assert.deepEqual(await sharePhoto(photo,api),{status:'unsupported'});
 }
});
test('share receives the JPEG file synchronously with no URL or text',async()=>{
 let called=false;const api={canShare:data=>data.files[0]===photo,share:data=>{called=true;assert.deepEqual(data,{files:[photo]});return Promise.resolve();}};
 const pending=sharePhoto(photo,api);assert.equal(called,true);assert.deepEqual(await pending,{status:'shared'});
});
test('cancelling the share sheet is not reported as saved or an error',async()=>{
 assert.deepEqual(await sharePhoto(photo,{canShare:()=>true,share:()=>Promise.reject({name:'AbortError'})}),{status:'cancelled'});
});
test('share failures propagate for visible fallback instead of silent download',async()=>{
 for(const share of [()=>Promise.reject(new Error('blocked')),()=>{throw new Error('blocked');}])await assert.rejects(sharePhoto(photo,{canShare:()=>true,share}),/blocked/);
});
