import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {secureEqual,sealToken,openToken,authorizeURL,isValidUsername,ownedInstagramMatches,sanitizeDiscovery} from '../security.mjs';

const key=randomBytes(32).toString('base64');
test('token encryption is authenticated, never plaintext',()=>{
  const cipher=sealToken('test-token',key);
  assert.ok(!cipher.includes('test-token'));
  assert.equal(openToken(cipher,key),'test-token');
  assert.throws(()=>openToken(cipher,randomBytes(32).toString('base64')));
});
test('compare and username validation',()=>{
  assert.equal(secureEqual('abc','abc'),true);
  assert.equal(secureEqual('abc','abd'),false);
  assert.equal(isValidUsername('micahlexier'),true);
  assert.equal(isValidUsername('../secret'),false);
});
test('account identity must match page and Instagram ID',()=>{
  const p={id:'PAGE',instagram_business_account:{id:'IG',username:'888.gaetano.888'}};
  assert.equal(ownedInstagramMatches(p,'PAGE','IG','888.gaetano.888'),true);
  assert.equal(ownedInstagramMatches(p,'PAGE','OTHER','888.gaetano.888'),false);
  assert.equal(ownedInstagramMatches(p,'OTHER','IG','888.gaetano.888'),false);
});
test('OAuth uses fixed Facebook host and actual state',()=>{
  const u=new URL(authorizeURL({appId:'123',redirectURI:'https://example.com/auth/facebook/callback',state:'abc'}));
  assert.equal(u.origin,'https://www.facebook.com');
  assert.equal(u.searchParams.get('state'),'abc');
});
test('research result is bounded and drops unapproved raw fields',()=>{
  const data={business_discovery:{username:'micahlexier',media:{data:[{id:'1',caption:'test',access_token:'secret'},{id:'2'}]}}};
  const out=sanitizeDiscovery(data,'micahlexier',1);
  assert.equal(out.media.length,1);
  assert.ok(!JSON.stringify(out).includes('secret'));
  assert.throws(()=>sanitizeDiscovery(data,'wrong',1));
});
