/** Route/workspace binding must fail closed before authentication and persistence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const a='11111111-1111-4111-8111-111111111111';
const b='44444444-4444-4444-8444-444444444444';
const user='22222222-2222-4222-8222-222222222222';
const payload={product_service:'BROS SELL',audience:'Peniaga Malaysia',platforms:['facebook']};
function request(workspaceId,pathnameSuffix='campaign-drafts'){
 return new Request('https://content.example.test/api/content/dev/workspaces/'+workspaceId+'/'+pathnameSuffix,{
  method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test',
   'sec-fetch-site':'same-origin','idempotency-key':'workspace_route_bind_123'},
  body:JSON.stringify(payload)
 });
}
test('mismatched HTTP route cannot persist into a different workspace',async()=>{
 let verified=0,written=0;
 const handler=createContentCampaignDraftPost(async()=>{verified++;return {userId:user,authenticated:true};},
  async()=>{written++;return {id:'33333333-3333-4333-8333-333333333333',status:'draft'};});
 const response=await handler(request(a),b);
 assert.equal(response.status,404);
 assert.deepEqual(await response.json(),{error:'not_found'});
 assert.equal(verified,0);assert.equal(written,0);
});
test('wrong draft route fails closed; matching route preserves authenticated write',async()=>{
 let written=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),
  async(_principal,workspace)=>{assert.equal(workspace,a);written++;return {id:'33333333-3333-4333-8333-333333333333',status:'draft'};});
 const wrong=await handler(request(a,'campaigns'),a);
 assert.equal(wrong.status,404);assert.equal(written,0);
 const ok=await handler(request(a),a);
 assert.equal(ok.status,201);assert.equal(written,1);
 assert.equal((await ok.json()).data.status,'draft');
});
