import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAccountPulse,validateOwnedProfile,createAccountObserver} from '../account-pulse.mjs';

test('a profile must be Gaetano and counts validated',()=>{
 assert.equal(validateOwnedProfile({username:'888.gaetano.888',followers_count:0,media_count:0,follows_count:1},'888.gaetano.888'),true);
 assert.equal(validateOwnedProfile({username:'other',media_count:0},'888.gaetano.888'),false);
 assert.equal(validateOwnedProfile({username:'888.gaetano.888',media_count:-2},'888.gaetano.888'),false);
});
test('readiness distinguishes missing data and verified empty feed',()=>{
 assert.equal(publicAccountPulse(undefined).status,'unobserved');
 const row={account_username:'888.gaetano.888',media_count:0,followers_count:0,follows_count:0,recent_media:[],checked_at:new Date('2026-11-25T13:00:00Z'),read_status:'ok'};
 const seen=publicAccountPulse(row);
 assert.equal(seen.status,'observed');
 assert.equal(seen.mediaCount,0);
 assert.equal(seen.mediaReadVerified,true);
 assert.deepEqual(publicAccountPulse({...row,profile_flags:{biographyConfigured:true,websiteConfigured:false,profilePictureConfigured:null}}).profileSetup,{biographyConfigured:true,websiteConfigured:false,profilePictureConfigured:null});
 assert.equal(publicAccountPulse({...row,followers_count:null,follows_count:null}).followersCount,null);
 assert.equal(publicAccountPulse({...row,followers_count:null,follows_count:null}).followingCount,null);
 assert.ok(!JSON.stringify(seen).includes('TOKEN_ENCRYPTION_KEY'));
 assert.equal(publicAccountPulse({...row,read_status:'media_unavailable'}).mediaReadVerified,false);
});
test('unsafe URLs cannot enter public recent media output',()=>{
 const base={account_username:'888.gaetano.888',media_count:4,checked_at:'2026-11-25T12:00:00Z',read_status:'ok'};
 const x=publicAccountPulse({...base,recent_media:[
  {permalink:'https://www.instagram.com/p/Good_A1/'},
  {permalink:'https://evil.example/private'},
  {permalink:'https://www.instagram.com/p/BAD#rawtoken'}
 ]});
 assert.deepEqual(x.recentPublications.map(p=>p.permalink),['https://www.instagram.com/p/Good_A1/']);
});
test('read errors do not claim an empty feed',async()=>{
 const q=[];
 const pool={query:async (sql,params)=>{
   q.push([sql,params]);return /SELECT checked_at/.test(sql)?{rows:[]}:{rows:[]};
 }};
 const observer=createAccountObserver({
  pool,installedToken:async()=>({token:'fixture'}),igId:'ig',
  configured:()=>true,meta:async(path,token,arg)=>{
   if(path==='ig')return {username:'888.gaetano.888',media_count:1,followers_count:4,follows_count:2};
   throw Error('offline');
  }
 });
 await observer.observe();
 const insertion=q.find(([sql])=>sql.includes('INSERT INTO gaetano_ig_pulse'));
 assert.equal(insertion[1].at(-2),'media_unavailable');
});
