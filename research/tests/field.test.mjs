import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldSnapshot} from '../field-sources.mjs';
import {validFieldSnapshot,fieldScore,fieldHTML} from '../field.mjs';

test('only verified, ascending public simulation events are scored',()=>{
  assert.equal(validFieldSnapshot(fieldSnapshot),true);
  assert.equal(fieldSnapshot.lastEventId,'j_1289');
  assert.ok(fieldSnapshot.events.every(e=>/^j_\d+$/.test(e.id)&&e.minute>0));
  const broken={...fieldSnapshot,events:fieldSnapshot.events.slice().reverse()};
  assert.equal(validFieldSnapshot(broken),false);
  assert.equal(validFieldSnapshot({...fieldSnapshot,lastEventId:'j_9999999'}),false);
});
test('daily composition is reproducible and four clearly different arrangements are possible',()=>{
  const a=fieldScore('2026-11-25');
  assert.deepEqual(a,fieldScore('2026-11-25'));
  const variations=[0,1,2,3].map(i=>fieldScore('2026-11-25',i));
  assert.equal(new Set(variations.map(a=>a.marks[0].y)).size,4);
  assert.ok(variations.every(v=>v.marks.length===fieldSnapshot.events.length));
  assert.ok(variations.every(v=>v.marks.map(m=>m.id).join(',')===a.marks.map(m=>m.id).join(',')));
  assert.throws(()=>fieldScore('2026-02-30'));
  assert.throws(()=>fieldScore('2026-11-25',5));
});
test('public artwork contains source ledger but no private credentials',()=>{
  const html=fieldHTML('2026-11-25',1);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('A field made'));
  assert.ok(html.includes('j_1289'));
  assert.ok(html.includes('There')===false||html.includes('no')===true);
  assert.ok(html.includes('not where it happened in space'));
  assert.ok(html.includes('same place is mentioned twice'));
  assert.ok(!/access_token|token_encryption|META_APP_SECRET|OWNER_META_ASID|@crafters|private mailbox/i.test(html));
  assert.ok(!html.includes('<script'));
});
test('escapes all source text including hostile HTML and source titles',()=>{
  const fake={...fieldSnapshot,events:fieldSnapshot.events.map((e,i)=>i===0?{...e,text:'Rain. <script>alert(1)</script> & unstable text'}:e)};
  const html=fieldHTML('2026-11-25',0,fake);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});
