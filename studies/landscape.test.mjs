import test from 'node:test';
import assert from 'node:assert/strict';
import { visualRecipe, renderStudy } from './landscape.mjs';

const fixture={seed:888,worldMinute:12*1440+720,season:'summer',weather:'clear',objects:[
  {type:'tree',x:-16,z:-5,stage:4},{type:'tree',x:-20,z:8,stage:2},
  {type:'landmark',x:12,z:5},{type:'shelter',x:-2,z:-10},
  {type:'garden',x:4,z:-12},{type:'rock',x:20,z:4}
]};
test('stable, pure result for identical world state',()=>{
  const original=JSON.stringify(fixture);
  assert.deepEqual(visualRecipe(fixture),visualRecipe(fixture));
  assert.equal(renderStudy(fixture),renderStudy(fixture));
  assert.equal(JSON.stringify(fixture),original);
});
test('evolves over days and responds to environmental changes',()=>{
  const recipe=visualRecipe(fixture);
  assert.notEqual(renderStudy({...fixture,worldMinute:fixture.worldMinute+6*1440}),renderStudy(fixture));
  assert.ok(visualRecipe({...fixture,weather:'fog'}).atmosphere>recipe.atmosphere);
  assert.notEqual(visualRecipe({...fixture,season:'winter'}).ground,recipe.ground);
});
test('smooth slow-drift transition at an epoch boundary',()=>{
  const a=visualRecipe({...fixture,worldMinute:4319}),b=visualRecipe({...fixture,worldMinute:4320});
  assert.ok(Math.abs(a.horizonFraction-b.horizonFraction)<0.00001);
  assert.ok(Math.abs(a.contourAmplitude-b.contourAmplitude)<0.00001);
});
test('does not serialize arbitrary object labels or private fields',()=>{
  const result=renderStudy({...fixture,privateNote:'PRIVATE_SENTINEL',objects:[
    {type:'<script>alert(1)</script>',x:1,z:2,label:'PRIVATE_SENTINEL'},
    {type:'tree',x:0,z:0,stage:2,label:'PRIVATE_SENTINEL'}
  ]});
  assert.doesNotMatch(result,/PRIVATE_SENTINEL|<script/);
});
test('bounded finite outputs and strict input limits',()=>{
  assert.match(renderStudy(fixture),/^<svg /);
  assert.doesNotMatch(renderStudy(fixture),/\b(NaN|Infinity|undefined)\b/);
  assert.throws(()=>visualRecipe({...fixture,worldMinute:-1}),TypeError);
  assert.throws(()=>renderStudy(fixture,9000,720),RangeError);
  assert.ok(renderStudy({...fixture,objects:Array.from({length:1000},()=>({type:'tree',x:0,z:0,stage:2}))}).length<100000);
});
