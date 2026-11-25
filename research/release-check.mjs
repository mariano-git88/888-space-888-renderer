import { fieldSnapshot } from './field-sources.mjs';
import { validFieldSnapshot,fieldScore,fieldHTML,visibleFieldMarks } from './field.mjs';
import { fieldRules } from './field-rules.mjs';
import { sourcePair,validateSourcePair,layoutForDay } from './studio.mjs';
import { publicSourceManifest } from './public.mjs';

// Bounded release smoke checks; safe to execute without Meta, a token, or database.
export function verifyCreativeRelease() {
  if(!validFieldSnapshot(fieldSnapshot))throw Error('field_source_invalid');
  if(!validateSourcePair(sourcePair))throw Error('studio_source_invalid');
  const date='2026-11-25',ids=fieldSnapshot.events.map(x=>x.id).join(',');
  const s=fieldScore(date),phases=[0,1,2,3].map(n=>fieldScore(date,n));
  if(phases.some(p=>p.marks.map(x=>x.id).join(',')!==ids))throw Error('field_identity_unstable');
  if(new Set(phases.map(p=>p.marks[0].y)).size!==4)throw Error('field_layout_not_distinct');
  if(layoutForDay(date).fields.length!==2)throw Error('two_event_layout_missing');
  const selected=visibleFieldMarks(fieldScore(date,2));
  if(selected.length!==Math.min(fieldSnapshot.events.length,fieldRules.markBudgets[2]))throw Error('field_omission_rule_invalid');
  const html=fieldHTML(date,2);
  if(!html.includes('withheld mark'))throw Error('field_omission_undisclosed');
  if(!html.startsWith('<!doctype html>')||!html.includes(fieldSnapshot.lastEventId)||!html.includes('not where it happened in space'))throw Error('field_html_broken');
  const pub=publicSourceManifest([{username:'artist',permalink:'https://www.instagram.com/p/ABCdef9/',caption:'not exported',media_type:'IMAGE'}]);
  if(pub.sources.length!==1||JSON.stringify(pub).includes('not exported'))throw Error('research_manifest_leak');
  const needles=['access_token','META_APP_SECRET','OWNER_META_ASID','private mailbox'];
  if(needles.some(s=>html.includes(s)))throw Error('field_privacy_guard');
  return {checks:9,fieldEvents:fieldSnapshot.events.length,latestSource:fieldSnapshot.lastEventId};
}
