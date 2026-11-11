import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const workspace='22222222-2222-4222-8222-222222222222';
const user='11111111-1111-4111-8111-111111111111';
const request=()=>new Request('https://example.invalid/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json','idempotency-key':'immutable_platforms_123'},
 body:JSON.stringify({product_service:'Fixture service',audience:'Fixture audience',platforms:['FACEBOOK','TikTok']})
});

test('authenticated draft writer receives an immutable canonical platform snapshot',async()=>{
 let calls=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async(_principal,_workspace,draft)=>{
  calls++;
  assert.deepEqual(draft.platforms,['facebook','tiktok']);
  assert.equal(Object.isFrozen(draft),true);
  assert.equal(Object.isFrozen(draft.platforms),true);
  assert.throws(()=>draft.platforms.push('instagram'),TypeError);
  assert.throws(()=>{draft.platforms[0]='instagram';},TypeError);
  assert.deepEqual(draft.platforms,['facebook','tiktok']);
  return {id:'33333333-3333-4333-8333-333333333333',status:'draft'};
 });
 const response=await handler(request(),workspace);
 assert.equal(response.status,201);
 assert.equal(calls,1);
 assert.deepEqual(await response.json(),{data:{id:'33333333-3333-4333-8333-333333333333',status:'draft',replayed:false}});
});
