import { fieldSnapshot } from './field-sources.mjs';
import { validFieldSnapshot,fieldScore,fieldHTML,visibleFieldMarks } from './field.mjs';
import { fieldRules } from './field-rules.mjs';
import { sourcePair,validateSourcePair,layoutForDay } from './studio.mjs';
import { publicSourceManifest,captionCues,publicResearchHealth } from './public.mjs';
import { publicAccountPulse } from './account-pulse.mjs';
import { validateMentionReply, containsGaetanoMention } from './mention-reply.mjs';
import { visibleActionMatrix } from './social-permissions.mjs';
import { authorizeURL } from './security.mjs';
import { publicReadingMap } from './artist-roster.mjs';

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
  const cues=captionCues('A collaborative edition of old stock envelopes and strict letter-count texts.');
  if(!cues.includes('counted-language')||!cues.includes('printed-matter')||cues.length>4)throw Error('research_cue_classifier_failed');
  const needles=['access_token','META_APP_SECRET','OWNER_META_ASID','private mailbox'];
  if(needles.some(s=>html.includes(s)))throw Error('field_privacy_guard');
  const roster=publicReadingMap();
  if(roster.targets.length!==6||roster.targets.some(x=>!x.officialSource.startsWith('https://')))throw Error('reading_map_invalid');
  const health=publicResearchHealth([{username:'not_authorized',last_status:'ok'}],new Set(['micahlexier']));
  if(health.accounts.length!==1||health.accounts[0].status!=='not_checked')throw Error('research_health_leak');
  if(publicAccountPulse(null).status!=='unobserved')throw Error('missing_profile_not_preserved');
  const empty=publicAccountPulse({account_username:'888.gaetano.888',read_status:'ok',media_count:null,followers_count:null,follows_count:null,checked_at:new Date(date),recent_media:[]});
  if(empty.mediaCount!==null||empty.followersCount!==null||empty.recentPublications.length!==0)throw Error('unknown_metrics_incorrectly_zero');
  const mention=validateMentionReply({mediaId:'17918195224117851',message:'Thank you for the invitation.'});
  if(mention.mediaId!=='17918195224117851'||mention.commentId!==null)throw Error('mention_payload_guard_invalid');
  if(!containsGaetanoMention('Please see @888.gaetano.888')||containsGaetanoMention('@888.gaetano.888not'))throw Error('mention_source_guard_invalid');
  if(visibleActionMatrix(null).mentionedMediaReply.permissionsGranted!==null)throw Error('mention_permissions_unverified_not_preserved');
  const granted=visibleActionMatrix({check_status:'ok',grants:{instagram_manage_comments:true,pages_manage_metadata:false}});
  if(granted.mentionedMediaReply.permissionsGranted!==false)throw Error('missing_mentions_scope_not_blocked');
  const url=new URL(authorizeURL({appId:'123',redirectURI:'https://example.org/auth/facebook/callback',state:'mention_trial',includeMentions:true}));
  if(!url.searchParams.get('scope')?.includes('pages_manage_metadata')||!url.searchParams.get('scope')?.includes('instagram_manage_comments'))throw Error('mentions_oauth_missing_grants');
  return {checks:19,fieldEvents:fieldSnapshot.events.length,latestSource:fieldSnapshot.lastEventId};
}
