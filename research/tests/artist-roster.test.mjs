import test from 'node:test';
import assert from 'node:assert/strict';
import {publicReadingMap} from '../artist-roster.mjs';
test('source map is public-only, independent and non-interactive',()=>{
 const map=publicReadingMap();
 assert.equal(map.targets.length,6);
 assert.equal(new Set(map.targets.map(x=>x.instagramUsername)).size,6);
 for(const target of map.targets){
   assert.match(target.officialSource,/^https:\/\//);
   assert.ok(target.openQuestions.length>=1);
 }
 assert.doesNotMatch(JSON.stringify(map),/access_token|creator|wallet|mailbox|private|API_SECRET|OWNER_META_ASID/i);
 assert.ok(map.purpose.includes('not evidence of following'));
});
