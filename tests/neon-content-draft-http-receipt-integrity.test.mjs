import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const user='11111111-1111-4111-8111-111111111111';
const workspace='22222222-2222-4222-8222-222222222222';
const draft={product_service:'Fixture product',audience:'Fixture audience',platforms:['facebook']};
const makeRequest=()=>new Request('https://example.invalid/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json','idempotency-key':'receipt_integrity_123'},body:JSON.stringify(draft)
});
const auth=async()=>({userId:user,authenticated:true});

test('HTTP never acknowledges an unpersisted or malformed draft receipt',async()=>{
 const invalid=[null,undefined,{},[],{id:'not-a-uuid',status:'draft'},
  {id:'33333333-3333-4333-8333-333333333333',status:'pending'},
  {id:'33333333-3333-4333-8333-333333333333'}];
 for(const receipt of invalid){
  const handler=createContentCampaignDraftPost(auth,async()=>receipt);
  const response=await handler(makeRequest(),workspace);
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'draft_unavailable'});
  assert.equal(response.headers.get('cache-control'),'no-store');
 }
});

test('HTTP returns only allowlisted draft receipt fields and no writer metadata',async()=>{
 const secret='internal-db-trace-do-not-expose';
 const handler=createContentCampaignDraftPost(auth,async()=>({
  id:'33333333-3333-4333-8333-333333333333',status:'draft',replayed:true,
  connectionString:secret,internalTenantId:workspace,sqlTrace:secret,customerData:{email:secret}
 }));
 const response=await handler(makeRequest(),workspace);
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{data:{
  id:'33333333-3333-4333-8333-333333333333',status:'draft',replayed:true
 }});
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});

test('HTTP does not disclose writer exceptions or acknowledge a failed commit',async()=>{
 const secret='sensitive-postgres-error-detail';
 const handler=createContentCampaignDraftPost(auth,async()=>{throw new Error(secret);});
 const response=await handler(makeRequest(),workspace);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'draft_unavailable'});
 assert.equal((await response.clone().text()).includes(secret),false);
});
