import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePair,validateSourcePair,layoutForDay,studioHTML} from '../studio.mjs';

test('the two edited events have exactly 26 characters',()=>{
 assert.ok(validateSourcePair());
 assert.deepEqual(sourcePair.map(r=>r.id),['j_1135','j_1136']);
 assert.equal(sourcePair[0].count,26);assert.equal(sourcePair[1].count,26);
});
test('a date reproduces the same layout; four states are reachable',()=>{
 const first=layoutForDay('2026-11-25');
 assert.deepEqual(first,layoutForDay('2026-11-25'));
 const phases=new Set([0,1,2,3].map(n=>layoutForDay('2026-11-25',n).phase));
 assert.equal(phases.size,4);
 assert.throws(()=>layoutForDay('2026-02-30'));
});
test('rendered studio contains source, is public-safe and uses no remote assets',()=>{
 const html=studioHTML('2026-11-25');
 assert.ok(html.startsWith('<!doctype html>'));
 assert.match(html,/Two events, one minute/);
 assert.match(html,/j_1135|1135/);
 assert.match(html,/World minute 77149/);
 assert.doesNotMatch(html,/access_token|facebook\.com|graphql|App Secret|ownerAddress|mailbox/i);
});
