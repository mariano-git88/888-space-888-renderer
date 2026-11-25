import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGrantedScopes,visibleActionMatrix,makeScopeObserver} from '../social-permissions.mjs';

test('unverified grants are never interpreted as allowed actions',()=>{
 const x=visibleActionMatrix(null);
 assert.equal(x.permissionCheck,'unverified');
 assert.equal(x.mentionedMediaReply.permissionsGranted,null);
 assert.equal(x.followOtherAccounts.status,'not_exposed_by_official_instagram_api');
 assert.equal(x.unsolicitedNewDM.status,'not_exposed_by_current_messaging_api');
});
test('mentions require both exact Meta permissions',()=>{
 const grants=normalizeGrantedScopes({data:[
  {permission:'instagram_manage_comments',status:'granted'},
  {permission:'pages_manage_metadata',status:'declined'},
  {permission:'instagram_basic',status:'granted'},
  {permission:'hacked_admin_override',status:'granted'}
 ]});
 assert.equal(grants.instagram_manage_comments,true);
 assert.equal(grants.pages_manage_metadata,false);
 assert.ok(!Object.hasOwn(grants,'hacked_admin_override'));
 let x=visibleActionMatrix({grants,check_status:'ok',checked_at:'2026-11-25T12:00:00Z'});
 assert.equal(x.mentionedMediaReply.permissionsGranted,false);
 assert.deepEqual(x.mentionedMediaReply.missingScopes,['pages_manage_metadata']);
 x=visibleActionMatrix({grants:{...grants,pages_manage_metadata:true},check_status:'ok'});
 assert.equal(x.mentionedMediaReply.permissionsGranted,true);
 assert.equal(x.mentionedMediaReply.webhookAndAppReviewVerified,false);
});
test('rejects malformed Meta permissions response',()=>{
 assert.throws(()=>normalizeGrantedScopes(null));
 assert.throws(()=>normalizeGrantedScopes({data:{}}));
});
test('stores only allowlisted grant booleans, never source token',async()=>{
 let captured=null;
 const pool={query:async(sql,params)=>{
  if(sql.startsWith('SELECT'))return {rows:[]};
  if(sql.startsWith('INSERT'))captured=params;
  return {rows:[]};
 }};
 const observer=makeScopeObserver({
  pool,installedToken:async()=>({token:'do-not-log'}),
  meta:async(path,t)=>{assert.equal(path,'me/permissions');assert.equal(t,'do-not-log');return {data:[{permission:'instagram_manage_comments',status:'granted'}]}},
  configured:()=>true
 });
 await observer.observe();
 assert.ok(captured);
 assert.ok(!JSON.stringify(captured).includes('do-not-log'));
 assert.ok(!JSON.stringify(captured).includes('app-scoped'));
});
