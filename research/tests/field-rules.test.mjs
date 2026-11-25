import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldSnapshot} from '../field-sources.mjs';
import {fieldRules} from '../field-rules.mjs';
import {fieldScore,fieldHTML,visibleFieldMarks} from '../field.mjs';

test('Practice-linked aesthetic policy has bounded, honest mark budgets',()=>{
  assert.equal(fieldRules.revision,1);
  assert.match(fieldRules.sourceReviewId,/^artreview_[a-f0-9]{24}$/);
  assert.match(fieldRules.sourceProjectId,/^artwork_[a-f0-9]{24}$/);
  const score=fieldScore('2026-11-25',0);
  for(let phase=0;phase<4;phase++){
    const s=fieldScore('2026-11-25',phase),v=visibleFieldMarks(s);
    assert.equal(v.length,Math.min(fieldSnapshot.events.length,fieldRules.markBudgets[phase]));
    assert.equal(new Set(v.map(x=>x.id)).size,v.length);
    assert.ok(v.every(x=>s.marks.includes(x)));
    assert.ok(v.find(x=>x.id===s.marks[0].id));
    assert.ok(v.find(x=>x.id===s.marks[s.marks.length-1].id));
    for(const kind of new Set(s.marks.map(x=>x.kind)))assert.ok(v.some(x=>x.kind===kind));
  }
  assert.equal(visibleFieldMarks(score).length,17);
  assert.equal(visibleFieldMarks(fieldScore('2026-11-25',2)).length,9);
});
test('omission is disclosed, never a silent deletion from the source ledger',()=>{
  const html=fieldHTML('2026-11-25',2);
  assert.match(html,/withheld mark/);
  assert.match(html,/17 real archived event records \/ 9 drawn/);
  assert.equal((html.match(/<li>/g)||[]).length,fieldSnapshot.events.length);
  assert.equal((html.match(/data-event=/g)||[]).length,9);
});
test('different phases preserve same evidenced event IDs and times',()=>{
  const scores=[0,1,2,3].map(p=>fieldScore('2026-11-25',p));
  assert.ok(scores.every(s=>s.marks.map(m=>m.id+':'+m.minute).join('|')===scores[0].marks.map(m=>m.id+':'+m.minute).join('|')));
});
