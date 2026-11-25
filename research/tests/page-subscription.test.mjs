import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePageSubscription } from '../page-subscription.mjs';

const options = {userToken:'fixture-user',appId:'222',pageId:'333',igId:'444',username:'gaetano'};
const page = {id:'333',access_token:'fixture-page',instagram_business_account:{id:'444',username:'gaetano'}};
test('preserves an existing subscription, including across paginated results', async () => {
  const status=await ensurePageSubscription({...options, meta:async (path, token, query)=>{
    if(path==='333') return page;
    assert.equal(path,'333/subscribed_apps');
    assert.equal(token,'fixture-page');
    return query.after ? {data:[{id:'222',subscribed_fields:['messages']}]} : {data:[],paging:{next:'never-follow-this-url',cursors:{after:'cursor'}}};
  }, subscribe:()=>assert.fail('existing subscription must remain intact')});
  assert.equal(status,'confirmed');
});
test('new enrollment is confirmed by a second read even after a lost response', async () => {
  let writes=0;
  const status=await ensurePageSubscription({...options, meta:async path=>path==='333'?page:{data:writes?[{id:'222',subscribed_fields:['name']}]:[]},
    subscribe:async(path,token,params)=>{
      writes++; assert.equal(path,'333/subscribed_apps'); assert.deepEqual(params,{subscribed_fields:'name'});
      throw Error('response lost');
    }});
  assert.equal(status,'confirmed'); assert.equal(writes,1);
});
test('incomplete lists, unexpected accounts and ambiguous records never trigger a write', async () => {
  for(const [binding,result] of [[page,{data:[],paging:{next:'opaque'}}],[{...page,id:'different'},{}],[page,{data:[{id:'222'}]}],[page,{}]]) {
    const status=await ensurePageSubscription({...options,meta:async path=>path==='333'?binding:result,subscribe:()=>assert.fail('unexpected write')});
    assert.equal(status,'unverified');
  }
});
