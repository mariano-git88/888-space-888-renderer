/**
 * Read-only authorization diagnostic for Gaetano's separate Facebook Login token.
 * It does not configure Meta webhooks, comment on another profile, send DMs,
 * access another authorized Page, or mutate Instagram state.
 */
const requiredMentionScopes=Object.freeze(['instagram_manage_comments','pages_manage_metadata']);
const recordScopes=Object.freeze([
 'instagram_basic','instagram_manage_insights','pages_read_engagement',
 'pages_show_list','business_management','instagram_manage_comments','pages_manage_metadata'
]);
export function normalizeGrantedScopes(payload){
 if(!Array.isArray(payload?.data))throw Error('scopes_not_verified');
 const m=new Map();
 for(const row of payload.data){
   if(!recordScopes.includes(row?.permission))continue;
   if(row?.status==='granted'||row?.status==='declined'||row?.status==='expired')
     m.set(row.permission,row.status);
 }
 return Object.fromEntries(recordScopes.map(scope=>[scope,m.get(scope)==='granted']));
}
export function visibleActionMatrix(row){
 const scopes=row?.grants && typeof row.grants==='object'?row.grants:null;
 const grantState=row?.check_status==='ok'&&scopes?'checked':'unverified';
 const canReadMention=grantState==='checked'&&requiredMentionScopes.every(s=>scopes[s]===true);
 const missing=grantState==='checked'?requiredMentionScopes.filter(s=>!scopes[s]):[];
 return {
  account:'888.gaetano.888',
  source:'Meta Facebook Login app grants (read-only diagnostic)',
  checkedAt:row?.checked_at instanceof Date?row.checked_at.toISOString():(row?.checked_at||null),
  permissionCheck:grantState,
  mentionedMediaReply:{
    permissionsGranted:grantState==='checked'?canReadMention:null,
    missingScopes:missing,
    webhookAndAppReviewVerified:false,
    evidenceRequired:'A real @mention of Gaetano on third-party public media and verified source content; no arbitrary target comments',
    status:canReadMention?'scopes_granted_other_setup_unverified':'needs_scope_verification'
  },
  ownPostComments:{status:'existing_unified_login_site_api'},
  inboundMessages:{status:'existing_unified_login_site_api'},
  followOtherAccounts:{status:'not_exposed_by_official_instagram_api'},
  unsolicitedOtherAccountComment:{status:'not_exposed_by_official_instagram_api'},
  unsolicitedNewDM:{status:'not_exposed_by_current_messaging_api'},
  outboundInteractiveFlow:{status:'requires_authorized_instagram_interface_and_individual_human_control'}
 };
}
export function makeScopeObserver({pool,installedToken,meta,configured}){
 let busy=false;
 async function init(){
   await pool.query("CREATE TABLE IF NOT EXISTS gaetano_social_scopes (id TEXT PRIMARY KEY CHECK(id='gaetano'), grants JSONB NOT NULL DEFAULT '{}'::jsonb, check_status TEXT NOT NULL, checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 }
 async function recordFromMeta(payload){
   const grants=normalizeGrantedScopes(payload);
   await init();
   await pool.query("INSERT INTO gaetano_social_scopes(id,grants,check_status,checked_at) VALUES('gaetano',$1::jsonb,'ok',NOW()) ON CONFLICT(id) DO UPDATE SET grants=EXCLUDED.grants,check_status=EXCLUDED.check_status,checked_at=NOW()",[JSON.stringify(grants)]);
   return visibleActionMatrix({grants,check_status:'ok',checked_at:new Date()});
 }
 async function observe(){
   if(busy||!configured())return;
   busy=true;
   try {
     await init();
     const prev=await pool.query("SELECT checked_at FROM gaetano_social_scopes WHERE id='gaetano'");
     if(prev.rows[0]?.checked_at && Date.now()-new Date(prev.rows[0].checked_at).getTime()<6*60*60*1000)return;
     const {token}=await installedToken();
     const grants=normalizeGrantedScopes(await meta('me/permissions',token));
     await pool.query("INSERT INTO gaetano_social_scopes(id,grants,check_status,checked_at) VALUES('gaetano',$1::jsonb,'ok',NOW()) ON CONFLICT(id) DO UPDATE SET grants=EXCLUDED.grants,check_status=EXCLUDED.check_status,checked_at=NOW()",[JSON.stringify(grants)]);
     // Only capability flags are logged; never usernames, app-scoped user, or tokens.
     console.log('gaetano_social_permissions_checked mentions='+String(requiredMentionScopes.every(s=>grants[s])));
   }catch{
     console.log('gaetano_social_permission_check_unavailable');
   }finally{busy=false;}
 }
 async function read(){
   await init();
   const r=await pool.query("SELECT grants,check_status,checked_at FROM gaetano_social_scopes WHERE id='gaetano'");
   return visibleActionMatrix(r.rows[0]);
 }
 return {observe,read,recordFromMeta};
}
