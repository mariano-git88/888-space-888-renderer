import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyMetaSignature,matchMetaVerification,parseSignedMentions,storeVerifiedMentions} from '../mention-events.mjs';
const secret='fake-test-secret-not-a-production-key',id='17841457029407897';
const payload={object:'instagram',entry:[
 {id,time:1795610000,changes:[{field:'mentions',value:{media_id:'17918195224117851',comment_id:'17894227972186120'}}]},
 {id,time:1795610000,changes:[{field:'mentions',value:{media_id:'17918195224117851',comment_id:'17894227972186120'}}]},
 {id:'another-account',time:1795610000,changes:[{field:'mentions',value:{media_id:'17918195224117852'}}]},
 {id,time:1795610000,changes:[{field:'not_mentioned',value:{media_id:'17918195224117853'}}]}
]};
const raw=Buffer.from(JSON.stringify(payload),'utf8'),signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
test('Meta HMAC signature uses raw payload, never parsed JSON',()=>{
 assert.equal(verifyMetaSignature(raw,signature,secret),true);
 assert.equal(verifyMetaSignature(Buffer.from('{}'),signature,secret),false);
 assert.equal(verifyMetaSignature(raw,'sha256=00000000',secret),false);
 assert.equal(verifyMetaSignature(raw,signature,'other-secret'),false);
});
test('Meta verification challenge requires exact token and safe challenge',()=>{
 const u=new URLSearchParams('hub.mode=subscribe&hub.challenge=432134&hub.verify_token=key');
 assert.equal(matchMetaVerification(u,'key'),'432134');
 assert.equal(matchMetaVerification(u,'bad'),null);
 u.set('hub.challenge','<script>');
 assert.equal(matchMetaVerification(u,'key'),null);
});
test('genuine account only; duplicates collapsed and foreign accounts ignored',()=>{
 const result=parseSignedMentions(raw,signature,secret,id);
 assert.equal(result.length,1);
 assert.equal(result[0].mediaId,'17918195224117851');
 assert.equal(result[0].commentId,'17894227972186120');
 assert.match(result[0].key,/^[a-f0-9]{64}$/);
 assert.throws(()=>parseSignedMentions(raw,'sha256='+'0'.repeat(64),secret,id),/invalid_webhook_signature/);
});
test('does not accept unverifiable or unrelated account content',()=>{
 const r=Buffer.from(JSON.stringify({object:'instagram',entry:[{id:'private-other',changes:[{field:'mentions',value:{media_id:'17918195224117851'}}]}]}));
 const sig='sha256='+createHmac('sha256',secret).update(r).digest('hex');
 assert.equal(parseSignedMentions(r,sig,secret,id).length,0);
});
test('event store holds only event IDs, not third-party caption content',async()=>{
 let inserts=0,items=[];
 const pool={query:async (sql,params)=>{if(sql.startsWith('INSERT')){inserts++;items.push(params);return {rows:[{event_key:params[0]}]}}return {rows:[]}}};
 const result=await storeVerifiedMentions(pool,parseSignedMentions(raw,signature,secret,id));
 assert.equal(result,1);assert.equal(inserts,1);
 assert.ok(!JSON.stringify(items).includes('private'));
});
