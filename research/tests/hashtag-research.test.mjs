import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTag,publicHashtagSources,createHashtagReader} from '../hashtag-research.mjs';

test('only deliberately selected research tags may be searched',()=>{
 assert.equal(validateTag('mailart'),true);
 assert.equal(validateTag('artistbooks'),true);
 assert.equal(validateTag('random-tag'),false);
 assert.equal(validateTag('#mailart'),false);
});
test('public sources cannot leak caption, raw username or token',()=>{
 const d=publicHashtagSources([{
  tag:'mailart',media_id:'17918195224117851',
  permalink:'https://www.instagram.com/p/AbC123/',
  caption:'Private note from provider',access_token:'secret',username:'private-account',
  media_type:'IMAGE',published_at:'2026-11-25T12:00:00Z'
 },{
  tag:'evil',permalink:'https://evil.example/steal',caption:'should ignore'
 }]);
 assert.equal(d.media.length,1);
 assert.equal(d.media[0].tag,'mailart');
 for(const x of ['Private note','secret','private-account','evil.example'])assert.ok(!JSON.stringify(d).includes(x));
 assert.equal(d.caveat.includes('not a followed account'),true);
});
test('Meta feature failure records provider unavailable, never fake discoveries',async()=>{
 const queries=[];
 const pool={query:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.startsWith('SELECT read_at'))return {rows:[]};
  return {rows:[]};
 }};
 const reader=createHashtagReader({pool,installedToken:async()=>({token:'no-send'}),
  meta:async()=>{throw Error('provider denied')},igId:'17841457029407897',configured:()=>true});
 await reader.scan();
 assert.equal(queries.filter(x=>x.sql.startsWith('INSERT INTO gaetano_hashtag_reads')).length,3);
 assert.ok(queries.filter(x=>x.sql.startsWith('INSERT INTO gaetano_hashtag_reads')).every(q=>q.params[1]==='provider_unavailable'));
 assert.equal(queries.filter(x=>x.sql.startsWith('INSERT INTO gaetano_hashtag_sources')).length,0);
});
