import {createHash} from 'node:crypto';

/**
 * Narrow, official Instagram @mention reply. NOT a general foreign post
 * commenting, follow, or cold-DM endpoint.
 * It requires a verified @mention, separate server-only write authorization,
 * and a durable one-attempt send guard to prevent duplicate Meta comments.
 */
export function validateMentionReply(x){
 const media=String(x?.mediaId??''),comment=x?.commentId==null?null:String(x.commentId);
 const message=x?.message;
 if(!/^[0-9]{8,25}$/.test(media)||comment!==null&&!/^[0-9]{8,25}$/.test(comment))throw Error('invalid_mention_id');
 if(typeof message!=='string'||message.trim()!==message||message.length<8||message.length>500)throw Error('invalid_reply');
 if(/[\u0000-\u001F\u007F]/.test(message))throw Error('invalid_reply');
 return {mediaId:media,commentId:comment,message};
}
export function containsGaetanoMention(s){
 // Avoid accepting impersonating handles, suffixes, or arbitrary other tags.
 return typeof s==='string' && /(^|[^a-zA-Z0-9_.])@888\.gaetano\.888(?![a-zA-Z0-9_.])/i.test(s);
}
export async function verifyMentionSource({meta,token,igId,mediaId,commentId}){
 let x,text;
 if(commentId){
   const fields='mentioned_comment.comment_id('+commentId+')';
   const r=await meta(igId,token,{fields});
   x=r?.mentioned_comment;text=x?.text;
   if(String(x?.id||'')!==commentId||!containsGaetanoMention(text))throw Error('mention_unverified');
 }else{
   const fields='mentioned_media.media_id('+mediaId+'){caption,media_type}';
   const r=await meta(igId,token,{fields});
   x=r?.mentioned_media;text=x?.caption;
   if(String(x?.id||'')!==mediaId||!containsGaetanoMention(text))throw Error('mention_unverified');
 }
 return {kind:commentId?'comment':'caption',textHash:createHash('sha256').update(text).digest('hex')};
}
const required=['instagram_manage_comments','pages_manage_metadata'];
export async function executeMentionReply({pool,meta,post,installedToken,igId,args}){
 const data=validateMentionReply(args);
 const {token}=await installedToken();
 const permissionResponse=await meta('me/permissions',token);
 const granted=new Set((permissionResponse?.data||[]).filter(p=>p.status==='granted').map(p=>p.permission));
 if(!required.every(p=>granted.has(p)))return {status:'permission_missing',missing:required.filter(p=>!granted.has(p))};
 const source=await verifyMentionSource({meta,token,igId,...data});
 const key=createHash('sha256').update('verified-mention-v1:'+data.mediaId+':'+(data.commentId||'')).digest('hex');
 const textHash=createHash('sha256').update(data.message).digest('hex');
 await pool.query("CREATE TABLE IF NOT EXISTS gaetano_mention_replies (target_key TEXT PRIMARY KEY, media_id TEXT NOT NULL, comment_id TEXT, reply_hash TEXT NOT NULL, source_hash TEXT NOT NULL, status TEXT NOT NULL, provider_reply_id TEXT, first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ)");
 const count=await pool.query("SELECT COUNT(*)::int AS total FROM gaetano_mention_replies WHERE first_attempt_at > NOW()-INTERVAL '24 hours'");
 if(Number(count.rows[0]?.total||0)>=5)return {status:'rate_limited'};
 const reservation=await pool.query("INSERT INTO gaetano_mention_replies(target_key,media_id,comment_id,reply_hash,source_hash,status) VALUES($1,$2,$3,$4,$5,'attempt_reserved') ON CONFLICT(target_key) DO NOTHING RETURNING target_key",[key,data.mediaId,data.commentId,textHash,source.textHash]);
 if(!reservation.rows?.length)return {status:'already_attempted',duplicatesPrevented:true};
 // One external POST attempt. Any failure is preserved as uncertain: never retry
 // until provider evidence independently resolves whether a comment was sent.
 try{
   const result=await post(igId,token,{media_id:data.mediaId,comment_id:data.commentId,message:data.message});
   if(!/^[0-9]{8,25}$/.test(String(result?.id||'')))throw Error('provider_id_unconfirmed');
   await pool.query("UPDATE gaetano_mention_replies SET status='sent',provider_reply_id=$1,completed_at=NOW() WHERE target_key=$2",[String(result.id),key]);
   return {status:'sent',providerReplyId:String(result.id),mediaId:data.mediaId,sourceKind:source.kind};
 }catch{
   await pool.query("UPDATE gaetano_mention_replies SET status='send_unresolved' WHERE target_key=$1",[key]).catch(()=>{});
   return {status:'send_unresolved',duplicatesPrevented:true};
 }
}
