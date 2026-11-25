import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { makeResearchCollector } from './collector.mjs';
import { createAccountObserver } from './account-pulse.mjs';
import { ensurePageSubscription } from './page-subscription.mjs';
import { makeScopeObserver } from './social-permissions.mjs';
import { executeMentionReply, mentionTarget, verifyMentionSource } from './mention-reply.mjs';
import { matchMetaVerification,parseSignedMentions,storeVerifiedMentions,getMentionQueue } from './mention-events.mjs';
import { createHashtagReader } from './hashtag-research.mjs';
import { publicSourceManifest, publicResearchHealth } from './public.mjs';
import { publicReadingMap } from './artist-roster.mjs';
import { studioHTML } from './studio.mjs';
import { fieldHTML } from './field.mjs';
import { verifyCreativeRelease } from './release-check.mjs';
import { REQUIRED_PERMISSIONS, MENTION_PERMISSIONS, authorizeURL, secureEqual, sealToken, openToken, ownedInstagramMatches, isValidUsername, sanitizeDiscovery } from './security.mjs';

const e=process.env;
const version=e.META_GRAPH_VERSION||'v27.0';
const graphBase='https://graph.facebook.com/'+version;
const required=['META_APP_ID','META_APP_SECRET','META_REDIRECT_URI','META_PAGE_ID','META_IG_ID','OWNER_META_ASID','TOKEN_ENCRYPTION_KEY','RESEARCH_READ_KEY','DATABASE_URL'];
const configured=()=>required.every(k=>e[k]&&e[k].trim());
const pool=new Pool({connectionString:e.DATABASE_URL||'postgresql://unconfigured@127.0.0.1/no_database',max:2,connectionTimeoutMillis:5000});
const approved=new Set((e.RESEARCH_ALLOWLIST||'micahlexier').split(',').map(x=>x.trim().toLowerCase()).filter(isValidUsername));
let created=false,creating=null,times=[];
function send(res,n,data,type='application/json; charset=utf-8'){
  res.writeHead(n,{'Content-Type':type,'Cache-Control':'no-store','Pragma':'no-cache','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; form-action 'none'"});
  res.end(type.startsWith('text/html')?'<html><meta charset="utf-8"><body><h1>888 Space 888</h1><p>'+data+'</p></body></html>':JSON.stringify(data));
}
const page=(r,n,s)=>send(r,n,s,'text/html; charset=utf-8');
const error=s=>Object.assign(new Error(s),{code:s});
const cookieValue=(req,name)=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const stateCookie=(s,age=600)=>'fb_state='+s+'; Secure; HttpOnly; SameSite=Lax; Path=/auth/facebook; Max-Age='+age;
function authenticated(req){const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')&&secureEqual(h.slice(7),e.RESEARCH_READ_KEY)}
async function init(){
  if(created)return;
  if(!creating)creating=pool.query("CREATE TABLE IF NOT EXISTS gaetano_meta_tokens (name TEXT PRIMARY KEY CHECK(name='gaetano'), ciphertext TEXT NOT NULL, ig_id TEXT NOT NULL, authorized_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ)").then(()=>created=true).finally(()=>creating=null);
  await creating;
}
async function meta(path,token,params={}){
 const u=new URL(graphBase+'/'+path);
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
 const response=await fetch(u,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(16000)});
 const body=await response.json().catch(()=>({}));
 if(!response.ok||body.error)throw error('meta_request_failed');
 return body;
}
async function graphPost(path,token,params={}){
 const u=new URL(graphBase+'/'+path);
 const form=new URLSearchParams();
 for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined)form.set(k,String(v));
 const response=await fetch(u,{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'},
   body:form,redirect:'error',signal:AbortSignal.timeout(16000)
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.error)throw error('provider_write_unconfirmed');
 return data;
}
async function oauthExchange(code){
 const u=new URL(graphBase+'/oauth/access_token');
 for(const [k,v] of Object.entries({client_id:e.META_APP_ID,client_secret:e.META_APP_SECRET,redirect_uri:e.META_REDIRECT_URI,code}))u.searchParams.set(k,v);
 const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(16000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw error('authorization_exchange_failed');
 const v=new URL(graphBase+'/oauth/access_token');
 for(const [k,val] of Object.entries({grant_type:'fb_exchange_token',client_id:e.META_APP_ID,client_secret:e.META_APP_SECRET,fb_exchange_token:d.access_token}))v.searchParams.set(k,val);
 const rr=await fetch(v,{redirect:'error',signal:AbortSignal.timeout(16000)});
 const dd=await rr.json().catch(()=>({}));
 if(!rr.ok||!dd.access_token)throw error('long_lived_exchange_failed');
 return {token:dd.access_token,expiresIn:Number(dd.expires_in)||0};
}
async function installedToken(){
 await init();
 const r=await pool.query("SELECT ciphertext,ig_id,authorized_at,expires_at FROM gaetano_meta_tokens WHERE name='gaetano'");
 const x=r.rows[0];if(!x)throw error('authorization_required');
 if(x.ig_id!==e.META_IG_ID)throw error('account_mismatch');
 if(x.expires_at && new Date(x.expires_at).getTime()<=Date.now()+300000)throw error('authorization_expired');
 return {token:openToken(x.ciphertext,e.TOKEN_ENCRYPTION_KEY),expiresAt:x.expires_at,authorizedAt:x.authorized_at};
}
async function callback(req,res,u){
 res.setHeader('Set-Cookie',stateCookie('',0));
 if(!secureEqual(cookieValue(req,'fb_state'),u.searchParams.get('state')||''))return page(res,403,'Authorization state did not match.');
 if(u.searchParams.has('error'))return page(res,400,'Meta authorization was not approved.');
 const code=u.searchParams.get('code')||'';
 if(!code||code.length>2048)return page(res,400,'No valid authorization code received.');
 try{
  const auth=await oauthExchange(code);
  const [user,perms,account]=await Promise.all([
    meta('me',auth.token,{fields:'id'}),
    meta('me/permissions',auth.token),
    meta(e.META_PAGE_ID,auth.token,{fields:'id,instagram_business_account{id,username}'})
  ]);
  if(!secureEqual(String(user.id||''),e.OWNER_META_ASID))return page(res,403,'An unauthorized Facebook account was used.');
  const granted=new Set((perms.data||[]).filter(p=>p.status==='granted').map(p=>p.permission));
  if(!REQUIRED_PERMISSIONS.every(p=>granted.has(p)))return page(res,403,'Required permissions were not granted.');
  const extendedLogin=String(u.searchParams.get('state')||'').startsWith('mention_');
  if(extendedLogin&&!MENTION_PERMISSIONS.every(p=>granted.has(p)))return page(res,403,'Meta did not grant the required mention permissions. The existing connection is unchanged.');
  if(!ownedInstagramMatches(account,e.META_PAGE_ID,e.META_IG_ID,e.META_IG_USERNAME||'888.gaetano.888'))return page(res,403,'The selected Page does not match Gaetano.');
  await init();
  const expiry=auth.expiresIn>0?new Date(Date.now()+auth.expiresIn*1000):null;
  await pool.query("INSERT INTO gaetano_meta_tokens(name,ciphertext,ig_id,authorized_at,expires_at) VALUES('gaetano',$1,$2,NOW(),$3) ON CONFLICT (name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,ig_id=EXCLUDED.ig_id,authorized_at=NOW(),expires_at=EXCLUDED.expires_at",[sealToken(auth.token,e.TOKEN_ENCRYPTION_KEY),e.META_IG_ID,expiry]);
  await socialScopes.recordFromMeta(perms).catch(()=>console.log('gaetano_social_scope_cache_unavailable'));

  if(extendedLogin){
    const enrollment=await ensurePageSubscription({meta,subscribe:graphPost,userToken:auth.token,appId:e.META_APP_ID,
      pageId:e.META_PAGE_ID,igId:e.META_IG_ID,username:e.META_IG_USERNAME||'888.gaetano.888'}).catch(()=>'unverified');
    console.log('gaetano_mentions_page_subscription '+enrollment);
    return page(res,200,'Mention-capable login connected for Gaetano. Linked Page subscription: '+enrollment+'. Check the Instagram mentions field and Advanced Access in Meta App Dashboard.');
  }
  return page(res,200,'Research login connected for Gaetano. This tab may be closed.');
 }catch(err){console.error('gaetano_meta_authorization_failed');return page(res,503,'Could not complete authorization. Existing Instagram connections are unchanged.');}
}
const researchCollector=makeResearchCollector({pool,installedToken,meta,igId:e.META_IG_ID,approved,sanitizeDiscovery,configured});
const ownedObserver=createAccountObserver({pool,installedToken,meta,igId:e.META_IG_ID,configured});
const socialScopes=makeScopeObserver({pool,installedToken,meta,configured});
const hashtags=createHashtagReader({pool,installedToken,meta,igId:e.META_IG_ID,configured});
async function readBody(req){
 let s='';
 for await(const chunk of req){s+=chunk.toString('utf8');if(s.length>2048)throw error('request_too_large')}
 return JSON.parse(s);
}
async function discovery(req,res){
 if(!authenticated(req))return send(res,401,{status:'unauthorized'});
 if(!configured())return send(res,503,{status:'not_configured'});
 times=times.filter(t=>t>Date.now()-3600000);if(times.length>=30)return send(res,429,{status:'rate_limited'});
 let data;try{data=await readBody(req)}catch{return send(res,400,{status:'invalid_json'})}
 const username=String(data?.username||'').toLowerCase(),limit=Number(data?.limit??3);
 if(!isValidUsername(username)||!approved.has(username)||!Number.isInteger(limit)||limit<1||limit>5)return send(res,400,{status:'unapproved_target'});
 times.push(Date.now());
 try{
  const {token}=await installedToken();
  const fields='business_discovery.username('+username+'){username,media.limit('+limit+'){id,caption,media_type,permalink,timestamp,media_url,thumbnail_url,children{media_type,media_url}}}';
  let result,visual=true;
  try{result=await meta(e.META_IG_ID,token,{fields})}
  catch{visual=false;result=await meta(e.META_IG_ID,token,{fields:'business_discovery.username('+username+'){username,media.limit('+limit+'){id,caption,media_type,permalink,timestamp}}'})}
  return send(res,200,{status:'ok',...sanitizeDiscovery(result,username,limit),visualMetadataRequested:visual});
 }catch(err){console.error('gaetano_meta_research_failed');return send(res,503,{status:err.code==='authorization_required'||err.code==='authorization_expired'?err.code:'research_unavailable'})}
}
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'https://service.local');
  if(u.pathname==='/webhooks/instagram-mentions'&&req.method==='GET'){
    const challenge=matchMetaVerification(u.searchParams,e.META_MENTIONS_VERIFY_TOKEN);
    if(challenge===null)return send(res,403,{status:'verification_failed'});
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return res.end(challenge);
  }
  if(u.pathname==='/webhooks/instagram-mentions'&&req.method==='POST'){
    if(!e.META_APP_SECRET)return send(res,503,{status:'webhook_unconfigured'});
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(res,415,{status:'json_required'});
    let chunks=[],size=0,raw;
    try{
      for await(const chunk of req){
        size+=chunk.length;
        if(size>131072)throw Error('too_large');
        chunks.push(chunk);
      }
      raw=Buffer.concat(chunks);
    }catch{return send(res,413,{status:'payload_too_large'})}
    let events;
    try{events=parseSignedMentions(raw,req.headers['x-hub-signature-256'],e.META_APP_SECRET,e.META_IG_ID)}
    catch(err){return send(res,err?.message==='invalid_webhook_signature'?401:400,{status:'webhook_rejected'})}
    try{
      await storeVerifiedMentions(pool,events);
      // No unsolicited replies, no sender identities or message content stored.
      return send(res,200,{status:'acknowledged',mentionsAccepted:events.length});
    }catch{return send(res,503,{status:'webhook_storage_unavailable'})}
  }
  if(u.pathname==='/internal/mention-queue'&&req.method==='GET'){
    const header=String(req.headers.authorization||'');
    if(!e.MENTION_WRITE_KEY||!header.startsWith('Bearer ')||!secureEqual(header.slice(7),e.MENTION_WRITE_KEY))return send(res,401,{status:'unauthorized'});
    try{return send(res,200,await getMentionQueue(pool,Number(u.searchParams.get('limit')||10)))}
    catch{return send(res,503,{status:'mention_queue_unavailable'})}
  }
  if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{status:'ok',configured:Boolean(configured())});
  if(req.method==='GET'&&u.pathname==='/field/returns'){
    const phaseValue=u.searchParams.get('phase');
    if(phaseValue!==null && !/^[0-3]$/.test(phaseValue))return send(res,400,{status:'invalid_phase'});
    const phase=phaseValue===null?null:Number(phaseValue);
    const nonce=randomBytes(16).toString('base64');
    const html=fieldHTML(new Date().toISOString().slice(0,10),phase).replace('<style>','<style nonce="'+nonce+'">');
    res.writeHead(200,{
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
      'X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'none'; style-src 'nonce-"+nonce+"'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    return res.end(html);
  }
  if(req.method==='GET'&&u.pathname==='/lab/two-events'){
    const nonce=randomBytes(16).toString('base64');
    const html=studioHTML(new Date().toISOString().slice(0,10))
      .replace('<style>','<style nonce="'+nonce+'">')
      .replace('<script>','<script nonce="'+nonce+'">');
    res.writeHead(200,{
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
      'X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    return res.end(html);
  }

  if(req.method==='GET'&&u.pathname==='/public/interaction-capabilities'){
    try{return send(res,200,await socialScopes.read());}
    catch{return send(res,503,{status:'capabilities_unavailable'});}
  }
  if(req.method==='GET'&&u.pathname==='/public/instagram-pulse'){
    try{return send(res,200,await ownedObserver.read());}
    catch{return send(res,503,{status:'pulse_unavailable'});}
  }
  if(req.method==='GET'&&u.pathname==='/public/reading-map'){
    return send(res,200,publicReadingMap());
  }
  if(req.method==='GET'&&u.pathname==='/public/research-health'){
    try{
      const result=await researchCollector.readStatus();
      return send(res,200,publicResearchHealth(result.scans,approved));
    }catch{return send(res,503,{status:'research_health_unavailable'});}
  }
  if(req.method==='GET'&&u.pathname==='/public/hashtag-research'){
    try{return send(res,200,await hashtags.readPublic());}
    catch{return send(res,503,{status:'hashtag_unavailable'});}
  }
  if(req.method==='GET'&&u.pathname==='/public/research-sources'){
    try{
      const links=await researchCollector.readPublicSources(12);
      return send(res,200,publicSourceManifest(links,12));
    } catch {
      return send(res,503,{status:'sources_unavailable'});
    }
  }
  if(req.method==='GET'&&u.pathname==='/auth/facebook/mentions/start'){
    if(!configured())return page(res,503,'Setup is incomplete.');
    const state='mention_'+randomBytes(32).toString('base64url');
    res.writeHead(302,{
      'Set-Cookie':stateCookie(state),
      'Location':authorizeURL({appId:e.META_APP_ID,redirectURI:e.META_REDIRECT_URI,state,version,configId:e.META_LOGIN_CONFIG_ID,includeMentions:true}),
      'Cache-Control':'no-store'
    });
    return res.end();
  }
  if(req.method==='GET'&&u.pathname==='/auth/facebook/start'){
    if(!configured())return page(res,503,'Setup is incomplete.');
    const state=randomBytes(32).toString('base64url');
    res.writeHead(302,{'Set-Cookie':stateCookie(state),'Location':authorizeURL({appId:e.META_APP_ID,redirectURI:e.META_REDIRECT_URI,state,version,configId:e.META_LOGIN_CONFIG_ID}), 'Cache-Control':'no-store'});return res.end();
  }
  if(req.method==='GET'&&u.pathname==='/auth/facebook/callback')return callback(req,res,u);
  if(req.method==='POST'&&(u.pathname==='/internal/mention-reply'||u.pathname==='/internal/mention-source')){
    const bearer=String(req.headers.authorization||'');
    const key=bearer.startsWith('Bearer ')?bearer.slice(7):'';
    const fromSite=secureEqual(key,e.SITE_MENTION_BRIDGE_KEY);
    if(!fromSite&&!secureEqual(key,e.MENTION_WRITE_KEY))return send(res,401,{status:'unauthorized'});
    if(!configured())return send(res,503,{status:'not_configured'});
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(res,415,{status:'json_required'});
    let args;
    try{args=await readBody(req)}catch{return send(res,400,{status:'invalid_request'})}
    try{
      if(u.pathname==='/internal/mention-source'){
        const {token}=await installedToken();
        const source=await verifyMentionSource({meta,token,igId:e.META_IG_ID,...mentionTarget(args),includeText:true});
        return send(res,200,source);
      }
      if(fromSite && !/^[0-9a-f]{64}$/.test(args?.expectedSourceHash||''))return send(res,400,{status:'source_review_required'});
      return send(res,200,await executeMentionReply({pool,meta,post:(id,token,params)=>graphPost(id+'/mentions',token,params),installedToken,igId:e.META_IG_ID,args}));
    }catch(err){
      // Invalid, unverifiable or unsupported inputs must never trigger a Meta write.
      return send(res,422,{status:err?.message==='mention_unverified'?'mention_not_verified':'mention_request_not_eligible'});
    }
  }
  if(req.method==='GET'&&u.pathname==='/internal/status'){
    if(!authenticated(req))return send(res,401,{status:'unauthorized'});
    if(!configured())return send(res,503,{status:'not_configured'});
    try{const r=await installedToken();return send(res,200,{status:'connected',expiresAt:r.expiresAt,authorizedAt:r.authorizedAt})}
    catch(err){return send(res,200,{status:err.code==='authorization_expired'?'authorization_expired':'authorization_required'})}
  }
  if(req.method==='POST'&&u.pathname==='/internal/discover')return discovery(req,res);
  if(req.method==='GET'&&u.pathname==='/internal/archive'){
    if(!authenticated(req))return send(res,401,{status:'unauthorized'});
    if(!configured())return send(res,503,{status:'not_configured'});
    try { return send(res,200,await researchCollector.readArchive(Number(u.searchParams.get('limit')||20))); }
    catch { return send(res,503,{status:'archive_unavailable'}); }
  }
  if(req.method==='GET'&&u.pathname==='/internal/research-status'){
    if(!authenticated(req))return send(res,401,{status:'unauthorized'});
    if(!configured())return send(res,503,{status:'not_configured'});
    try { return send(res,200,await researchCollector.readStatus()); }
    catch { return send(res,503,{status:'archive_unavailable'}); }
  }
  return send(res,404,{status:'not_found'});
 }catch(err){console.error('gaetano_meta_service_error');if(!res.headersSent)send(res,500,{status:'internal_error'});}
});
const release=verifyCreativeRelease();
console.log('gaetano_field_release_checked count='+release.checks+' events='+release.fieldEvents);
server.listen(Number(e.PORT)||10000,'0.0.0.0',()=>{console.log('gaetano_meta_research_ready');setTimeout(()=>{void researchCollector.scan();},8000).unref();setTimeout(()=>{void ownedObserver.observe();},12000).unref();setTimeout(()=>{void socialScopes.observe();},16000).unref();setTimeout(()=>{void hashtags.scan();},20000).unref();});
setInterval(()=>{void researchCollector.scan();},6*60*60*1000).unref();
setInterval(()=>{void ownedObserver.observe();},6*60*60*1000).unref();
setInterval(()=>{void socialScopes.observe();},8*60*60*1000).unref();
setInterval(()=>{void hashtags.scan();},24*60*60*1000).unref();
process.on('SIGTERM',()=>server.close(()=>pool.end()));
