import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMentionReply,containsGaetanoMention,verifyMentionSource,executeMentionReply} from '../mention-reply.mjs';

test('rejects invalid or unbounded mention replies',()=>{
 assert.throws(()=>validateMentionReply({mediaId:'other',message:'A thoughtful line.'}));
 assert.throws(()=>validateMentionReply({mediaId:'17918195224117851',message:'bad\nsecond line'}));
 assert.throws(()=>validateMentionReply({mediaId:'17918195224117851',message:'abc'}));
 assert.equal(validateMentionReply({mediaId:'17918195224117851',message:'Thank you for including this.'}).commentId,null);
});
test('a name, substring or other handle is not proof of mention',()=>{
 assert.equal(containsGaetanoMention('What do you think, @888.gaetano.888?'),true);
 assert.equal(containsGaetanoMention('hi @888.gaetano.888x'),false);
 assert.equal(containsGaetanoMention('ping@888.gaetano.888'),false);
 assert.equal(containsGaetanoMention('Gaetano knows about that.'),false);
});
test('mention source must be independently confirmed by Meta',async()=>{
 const meta=async (_id,_token,{fields})=>({mentioned_media:{id:'17918195224117851',caption:'@888.gaetano.888 would like this.'}});
 const verified=await verifyMentionSource({meta,token:'fixture',igId:'account',mediaId:'17918195224117851',commentId:null});
 assert.equal(verified.kind,'caption');
 assert.match(verified.textHash,/^[a-f0-9]{64}$/);
 await assert.rejects(()=>verifyMentionSource({
   meta:async()=>({mentioned_media:{id:'17918195224117851',caption:'An unrelated comment.'}}),
   token:'fixture',igId:'account',mediaId:'17918195224117851',commentId:null
 }),/mention_unverified/);
});
test('only authorized, verified @mentions may trigger one write per target',async()=>{
 let posted=0;
 const attempted=new Set();
 const queries=[];
 const pool={query:async (sql,params=[])=>{
   queries.push([sql,params]);
   if(sql.startsWith('SELECT status'))return {rows:attempted.has(params[0])?[{status:'attempt_reserved'}]:[]};
   if(sql.startsWith('SELECT COUNT'))return {rows:[{total:0}]};
   if(sql.startsWith('INSERT INTO gaetano_mention_replies')){
     if(attempted.has(params[0]))return {rows:[]};
     attempted.add(params[0]);
     return {rows:[{target_key:params[0]}]};
   }
   return {rows:[]};
 }};
 const meta=async(path,_token,{fields}={})=>{
   if(path==='me/permissions')return {data:[
     {permission:'instagram_manage_comments',status:'granted'},
     {permission:'pages_manage_metadata',status:'granted'}
   ]};
   assert.equal(path,'17841457029407897');
   assert.match(fields,/mentioned_media/);
   return {mentioned_media:{id:'17918195224117851',caption:'Hi @888.gaetano.888, the work is here.'}};
 };
 const post=async(_id,_token,params)=>{posted++;assert.equal(params.media_id,'17918195224117851');return {id:'17911496353086895'};};
 const args={mediaId:'17918195224117851',message:'Thank you. What drew you to this work?'};
 pool.connect=async()=>({query:pool.query,release(){}});
 const options={pool,meta,post,installedToken:async()=>({token:'private'}),igId:'17841457029407897',args};
 const sent=await executeMentionReply(options);
 assert.equal(sent.status,'sent');
 assert.equal(posted,1);
 const repeated=await executeMentionReply(options);
 assert.equal(repeated.status,'already_attempted');
 assert.equal(posted,1);
 assert.ok(!JSON.stringify(queries).includes('Thank you. What drew you'));
 assert.ok(!JSON.stringify(queries).includes('private'));
});
test('missing grant never posts',async()=>{
 let calls=0;
 const result=await executeMentionReply({
  pool:{query:async()=>{throw Error('DB should not be touched')}},
  meta:async()=>({data:[{permission:'instagram_manage_comments',status:'granted'}]}),
  post:async()=>{calls++},
  installedToken:async()=>({token:'private'}),
  igId:'17841457029407897',
  args:{mediaId:'17918195224117851',message:'A thoughtful response.'}
 });
 assert.equal(result.status,'permission_missing');
 assert.equal(calls,0);
});
test('provider uncertainty is never retried automatically',async()=>{
 const pool={query:async(sql)=>sql.startsWith('SELECT COUNT')?{rows:[{total:0}]}:
   sql.startsWith('INSERT INTO gaetano_mention_replies')?{rows:[{target_key:'held'}]}:{rows:[]}};
 pool.connect=async()=>({query:pool.query,release(){}});
 let calls=0;
 const result=await executeMentionReply({
   pool,
   meta:async(path)=>path==='me/permissions'?{data:[
     {permission:'instagram_manage_comments',status:'granted'},
     {permission:'pages_manage_metadata',status:'granted'}
   ]}:{mentioned_media:{id:'17918195224117851',caption:'@888.gaetano.888 please see this'}},
   post:async()=>{calls++;throw Error('network_timeout')},
   installedToken:async()=>({token:'private'}),
   igId:'17841457029407897',
   args:{mediaId:'17918195224117851',message:'Thank you for inviting me into this.'}
 });
 assert.equal(result.status,'send_unresolved');
 assert.equal(result.duplicatesPrevented,true);
 assert.equal(calls,1);
});

test('a changed caption requires a new review before reservation or sending',async()=>{
 const api={
   installedToken:async()=>({token:'fixture'}),igId:'123456789',
   meta:async path=>path==='me/permissions'?{data:['instagram_manage_comments','pages_manage_metadata'].map(permission=>({permission,status:'granted'}))}:{mentioned_media:{id:'17918195224117851',caption:'@888.gaetano.888 a revised question'}},
   pool:{query:()=>assert.fail('unexpected reservation')},post:()=>assert.fail('unexpected send')
 };
 const result=await executeMentionReply({...api,args:{mediaId:'17918195224117851',message:'Can you expand on this?',expectedSourceHash:'0'.repeat(64)}});
 assert.equal(result.status,'source_changed');
 const source=await verifyMentionSource({meta:api.meta,token:'fixture',igId:api.igId,mediaId:'17918195224117851',includeText:true});
 assert.equal(source.text,'@888.gaetano.888 a revised question');
});

test('a confirmed identical reply reuses its receipt; unresolved or rate-limited attempts never send',async()=>{
 const {createHash}=await import('node:crypto');
 const message='This minute still matters.', mediaId='17918195224117851';
 for(const [prior,count,expected] of [[{status:'sent',reply_hash:createHash('sha256').update(message).digest('hex'),provider_reply_id:'17911496353086895'},2,'sent'],[null,5,'rate_limited'],[{status:'send_unresolved'},1,'already_attempted']]){
   const operations=[];
   const query=async sql=>{operations.push(sql);if(sql.startsWith('SELECT status'))return {rows:prior?[prior]:[]};if(sql.startsWith('SELECT COUNT'))return {rows:[{total:count}]};return {rows:[]}};
   const result=await executeMentionReply({pool:{query,connect:async()=>({query,release(){}})},installedToken:async()=>({token:'fixture'}),
     meta:async path=>path==='me/permissions'?{data:['instagram_manage_comments','pages_manage_metadata'].map(permission=>({permission,status:'granted'}))}:{mentioned_media:{id:mediaId,caption:'Hello @888.gaetano.888'}},
     post:()=>assert.fail('no new send'),igId:'fixture',args:{mediaId,message}});
   assert.equal(result.status,expected);
   assert.ok(operations.indexOf('BEGIN')<operations.findIndex(sql=>sql.includes('pg_advisory_xact_lock')));
   assert.equal(operations.at(-1),'COMMIT');
 }
});
