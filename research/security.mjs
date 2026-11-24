import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export const REQUIRED_PERMISSIONS = Object.freeze([
  'pages_show_list', 'pages_read_engagement', 'instagram_basic',
  'instagram_manage_insights', 'business_management'
]);
export function secureEqual(a,b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
export function encryptionKey(v) {
  if (!v) throw Error('encryption_key_missing');
  const b=Buffer.from(v,'base64');
  if (b.length!==32) throw Error('encryption_key_invalid');
  return b;
}
export function sealToken(v,k) {
  if (typeof v!=='string' || !v || v.length>4096) throw Error('token_invalid');
  const n=randomBytes(12),c=createCipheriv('aes-256-gcm',encryptionKey(k),n);
  c.setAAD(Buffer.from('gaetano-meta-user-token-v1'));
  const b=Buffer.concat([c.update(v,'utf8'),c.final()]);
  return [n,c.getAuthTag(),b].map(x=>x.toString('base64url')).join('.');
}
export function openToken(v,k) {
  const a=String(v??'').split('.');
  if(a.length!==3)throw Error('token_format_invalid');
  const [n,t,b]=a.map(x=>Buffer.from(x,'base64url'));
  if(n.length!==12||t.length!==16)throw Error('token_format_invalid');
  const d=createDecipheriv('aes-256-gcm',encryptionKey(k),n);
  d.setAAD(Buffer.from('gaetano-meta-user-token-v1'));d.setAuthTag(t);
  return Buffer.concat([d.update(b),d.final()]).toString('utf8');
}
export function isValidUsername(v){return typeof v==='string'&&/^[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?$/.test(v);}
export function ownedInstagramMatches(page,pageId,igId,name){
  return String(page?.id??'')===String(pageId)&&String(page?.instagram_business_account?.id??'')===String(igId)&&String(page?.instagram_business_account?.username??'').toLowerCase()===String(name).toLowerCase();
}
export function authorizeURL({appId,redirectURI,state,version='v27.0',configId}){
  if(!redirectURI?.startsWith('https://')||!appId||!state)throw Error('oauth_config_invalid');
  const u=new URL('https://www.facebook.com/'+version+'/dialog/oauth');
  for(const [k,v] of Object.entries({client_id:appId,redirect_uri:redirectURI,response_type:'code',state,scope:REQUIRED_PERMISSIONS.join(',')}))u.searchParams.set(k,v);
  if(configId)u.searchParams.set('config_id',configId);
  return u.toString();
}
export function sanitizeDiscovery(data,name,limit){
  const d=data?.business_discovery;
  if(!d||String(d.username||'').toLowerCase()!==name.toLowerCase())throw Error('discovery_unavailable');
  return {username:d.username,retrievedAt:new Date().toISOString(),source:'meta-business-discovery',visualInspectionPerformed:false,followingRelationshipVerified:false,
    media:(Array.isArray(d.media?.data)?d.media.data:[]).slice(0,limit).map(m=>({
      id:String(m.id),caption:typeof m.caption==='string'?m.caption.slice(0,10000):'',
      mediaType:m.media_type||null,permalink:typeof m.permalink==='string'&&m.permalink.startsWith('https://www.instagram.com/')?m.permalink:null,
      timestamp:m.timestamp||null,
      imageURL:typeof m.media_url==='string'&&m.media_url.startsWith('https://')?m.media_url:null,
      thumbnailURL:typeof m.thumbnail_url==='string'&&m.thumbnail_url.startsWith('https://')?m.thumbnail_url:null,
      children:(m.children?.data||[]).slice(0,10).map(c=>({mediaType:c.media_type||null,imageURL:typeof c.media_url==='string'&&c.media_url.startsWith('https://')?c.media_url:null}))
    }))
  };
}
