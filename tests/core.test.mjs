import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {identity,curveLUT,sampleCurve} from '../dist/src/curves.js';
import {PRESETS,createState,findLayer,safeState} from '../dist/src/presets.js';
import {validateRecipe,clone,History,outputDimensions} from '../dist/src/model.js';
test('five presets have independent light and shadow layers with valid ranges',()=>{assert.equal(PRESETS.length,5);for(const p of PRESETS){const s=createState(p.id),v=validateRecipe(s);assert.equal(v.layers.length,9);assert.ok(findLayer(v,'bloom'));assert.ok(findLayer(v,'shadow'));assert.ok(findLayer(v,'curves'));assert.notDeepEqual(createState(p.id).layers.map(l=>l.id),s.layers.map(l=>l.id));}});
test('identity LUT is exact in all four channels',()=>{const data=curveLUT(identity());for(let i=0;i<256;i++)for(let j=0;j<4;j++)assert.equal(data[i*4+j],i);});
test('monotone curves never overshoot or reverse, including flat segments',()=>{for(const knots of [[0,0,50,100,100],[10,25,50,75,90],[0,10,20,30,100]]){let previous=0;for(let i=0;i<=1000;i++){const y=sampleCurve(knots,i/1000);assert.ok(y>=previous-1e-10);assert.ok(y>=knots[0]/100&&y<=knots[4]/100+1e-10);previous=y;}}});
test('recipe round-trip retains curve edits and independent layer strengths',()=>{const s=createState('coast');Object.assign(findLayer(s,'grain').params,{amount:.35,size:8,roughness:1});findLayer(s,'curves').params.r2=57;findLayer(s,'bloom').strength=.22;findLayer(s,'shadow').enabled=false;const v=validateRecipe(JSON.parse(JSON.stringify(s)));assert.equal(findLayer(v,'grain').params.amount,.35);assert.equal(findLayer(v,'grain').params.size,8);assert.equal(findLayer(v,'curves').params.r2,57);assert.equal(findLayer(v,'bloom').strength,.22);assert.equal(findLayer(v,'shadow').enabled,false);});
test('malformed controls cannot reach GPU',()=>{for(const mutate of [s=>s.mix=Infinity,s=>findLayer(s,'curves').params.m2=-1,s=>findLayer(s,'bloom').params.radius=50,s=>s.layers[0].type='script']){const s=createState();mutate(s);assert.throws(()=>validateRecipe(s));}});
test('undo/redo retains curve edits and layer switch',()=>{const s=createState(),h=new History(s);findLayer(s,'curves').params.m2=60;h.push(s);findLayer(s,'shadow').enabled=false;h.push(s);assert.equal(findLayer(h.undo(),'shadow').enabled,true);assert.equal(findLayer(h.undo(),'curves').params.m2,45);assert.equal(findLayer(h.redo(),'curves').params.m2,60);});
test('output respects original aspect ratio without upscaling',()=>{assert.deepEqual(outputDimensions(6000,4000,'2560'),{width:2560,height:1707});assert.deepEqual(outputDimensions(300,400,'2560'),{width:300,height:400});});

test('previously saved eight-layer recipes keep their controls and still import',()=>{
 const recipes=JSON.parse(readFileSync(new URL('./legacy-recipes.json',import.meta.url),'utf8'));
 for(const recipe of recipes){const restored=validateRecipe(safeState(recipe));assert.equal(restored.layers.length,8);assert.equal(restored.mix,recipe.state.mix);const controls=layers=>layers.map(({id,...layer})=>layer);assert.deepEqual(controls(restored.layers),controls(recipe.state.layers));}
});
test('five looks use monotonic channel curves and separate film shaping',()=>{for(const p of PRESETS){const s=createState(p.id),c=findLayer(s,'curves').params;assert.ok(findLayer(s,'film'));for(const ch of ['m','r','g','b'])for(let i=1;i<5;i++)assert.ok(c[ch+i]>=c[ch+(i-1)]);assert.equal(validateRecipe(s).revision,3);}});
test('new and legacy recipe envelopes both import',()=>{for(const format of ['eigacam-recipe','luma-recipe']){const s=createState('iwai');assert.equal(validateRecipe(safeState({format,version:1,state:s})).id,'iwai');}assert.throws(()=>safeState({format:'unrelated',version:1}));assert.throws(()=>safeState({format:'eigacam-recipe',version:2}));});
test('monochrome recipe starts at full strength without colour tints',()=>{const s=validateRecipe(createState('kurosawa'));assert.equal(s.mix,1);assert.equal(findLayer(s,'color').params.saturation,-100);assert.equal(findLayer(s,'bloom').params.amount,0);assert.equal(findLayer(s,'shadow').params.saturation,0);});
