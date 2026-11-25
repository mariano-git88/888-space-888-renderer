import {createHmac,createHash,timingSafeEqual} from 'node:crypto';

/**
 * Passive, signature-verified storage of real Meta Instagram @mention webhook
 * identifiers. This does NOT update provider subscriptions, send comments,
 * create chat messages, infer identities or call Meta itself.
 */
export function verifyMetaSignature(raw,signature,secret){
 if(!secret||typeof secret!=='string'||!Buffer.isBuffer(raw)||raw.length===0||raw.length>131072)return false;
 if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/i.test(signature))return false;
 const expected=createHmac('sha256',secret).update(raw).digest('hex');
 const incoming=signature.slice(7).toLowerCase();
 const x=Buffer.from(expected,'hex'),y=Buffer.from(incoming,'hex');
 return x.length===y.length && timingSafeEqual(x,y);
}
export function matchMetaVerification(q,expected){
 const token=q?.get?.('hub.verify_token'),challenge=q?.get?.('hub.challenge'),mode=q?.get?.('hub.mode');
 if(!expected||typeof token!=='string'||typeof challenge!=='string'||mode!=='subscribe'||!/^\d{1,24}$/.test(challenge))return null;
 const a=Buffer.from(token),b=Buffer.from(expected);
 return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)?challenge:null;
}
export function parseSignedMentions(raw,signature,secret,expectedAccountId){
 if(!verifyMetaSignature(raw,signature,secret))throw Error('invalid_webhook_signature');
 let obj;try{obj=JSON.parse(raw.toString('utf8'))}catch{throw Error('invalid_webhook_json')}
 const envelopes=Array.isArray(obj)?obj:[obj];
 if(!envelopes.length||envelopes.length>1000)throw Error('unexpected_meta_payload');
 const entries=[];
 for(const envelope of envelopes){
   if(envelope?.object!=='instagram'||!Array.isArray(envelope.entry)||entries.length+envelope.entry.length>1000)throw Error('unexpected_meta_payload');
   entries.push(...envelope.entry);
 }
 const out=new Map();
 for(const entry of entries){
   // Never import events from another Instagram account, even if Meta sends a
   // batched payload. The configured account is the only admissible origin.
   if(String(entry?.id||'')!==String(expectedAccountId))continue;
   if(!Array.isArray(entry?.changes)||entry.changes.length>1000)continue;
   for(const change of entry.changes){
     if(change?.field!=='mentions')continue;
     const value=change?.value||{};
     const mediaId=String(value.media_id||''),commentId=value.comment_id==null?null:String(value.comment_id);
     if(!/^\d{8,25}$/.test(mediaId)||commentId!==null&&!/^\d{8,25}$/.test(commentId))continue;
     const key=createHash('sha256').update('gaetano-mention:'+expectedAccountId+':'+mediaId+':'+(commentId||'')).digest('hex');
     const eventSecond=entry.time;
     out.set(key,{key,mediaId,commentId,eventTime:Number.isSafeInteger(eventSecond)&&eventSecond>0?new Date(eventSecond*1000).toISOString():null});
     if(out.size>200)throw Error('webhook_too_many_mentions');
   }
 }
 return [...out.values()];
}
export async function storeVerifiedMentions(pool,events){
 await pool.query("CREATE TABLE IF NOT EXISTS gaetano_mention_events (event_key TEXT PRIMARY KEY,media_id TEXT NOT NULL,comment_id TEXT,event_time TIMESTAMPTZ,first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),status TEXT NOT NULL DEFAULT 'received')");
 let accepted=0;
 for(const e of events){
   const r=await pool.query("INSERT INTO gaetano_mention_events(event_key,media_id,comment_id,event_time,status) VALUES($1,$2,$3,$4,'received') ON CONFLICT(event_key) DO UPDATE SET last_received_at=NOW() RETURNING event_key",[e.key,e.mediaId,e.commentId,e.eventTime]);
   if(r.rows?.length)accepted++;
 }
 return accepted;
}
export async function getMentionQueue(pool,limit=10){
 await pool.query("CREATE TABLE IF NOT EXISTS gaetano_mention_events (event_key TEXT PRIMARY KEY,media_id TEXT NOT NULL,comment_id TEXT,event_time TIMESTAMPTZ,first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),status TEXT NOT NULL DEFAULT 'received')");
 const n=Number.isSafeInteger(limit)&&limit>0?Math.min(limit,20):10;
 const r=await pool.query("SELECT event_key,media_id,comment_id,status,event_time,first_received_at FROM gaetano_mention_events ORDER BY first_received_at DESC LIMIT $1",[n]);
 return {source:'Meta signed Instagram webhook',status:'stored_identifiers_only',requiresSourceVerification:true,events:r.rows};
}
