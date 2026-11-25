import test from 'node:test';
import assert from 'node:assert/strict';
import {publicSourceManifest,publicResearchHealth} from '../public.mjs';

test('manifest exports only source link metadata',()=>{
 const input=[{
   username:'micahlexier',
   permalink:'https://www.instagram.com/p/DgIFW11HFXG/',
   media_type:'CAROUSEL_ALBUM',posted_at:'2026-11-24T13:40:02+0000',
   caption:'Private source copy not to redistribute',
   access_token:'NEVER-RETURN',
   media_url:'https://signed.internal/private',
   user_id:'private-user-id'
 }];
 const out=publicSourceManifest(input,12);
 assert.equal(out.sources.length,1);
 assert.equal(out.sources[0].username,'micahlexier');
 const text=JSON.stringify(out);
 for (const v of ['NEVER-RETURN','Private source copy','private-user-id','signed.internal'])assert.ok(!text.includes(v));
});

test('manifest rejects arbitrary links and clamps source count',()=>{
 const good={username:'artist.name',permalink:'https://www.instagram.com/p/AbC123/',media_type:'IMAGE',posted_at:'2026-11-24T12:00:00Z'};
 const x=publicSourceManifest([{username:'foo',permalink:'https://evil.example/'},...Array(30).fill(good)],20);
 assert.equal(x.sources.length,12);
 assert.equal(x.sources[0].permalink,good.permalink);
});


test('research-health only lists approved public artist accounts and bounded states',()=>{
 const out=publicResearchHealth([
   {username:'micahlexier',last_status:'ok',last_scan_at:'2026-11-25T12:00:00Z',access_token:'DO-NOT-SHOW'},
   {username:'unapproved',last_status:'ok',last_scan_at:'2026-11-25T12:00:00Z',personalData:'secret'}
 ],new Set(['micahlexier','bookworksuk']));
 assert.deepEqual(out.accounts.map(x=>x.username),['bookworksuk','micahlexier']);
 assert.equal(out.accounts[0].status,'not_checked');
 assert.equal(out.accounts[1].status,'observed');
 assert.doesNotMatch(JSON.stringify(out),/secret|DO-NOT-SHOW|unapproved/);
});
