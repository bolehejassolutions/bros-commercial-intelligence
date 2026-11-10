/** HTTP draft success responses expose only the documented public identity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const workspace='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const campaign='33333333-3333-4333-8333-333333333333';
const request=()=>new Request('https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test','idempotency-key':'retry_key_123456789'},
 body:JSON.stringify({product_service:'BROS SELL',audience:'Peniaga Malaysia',platforms:['facebook']})
});
const verify=async()=>({userId:user,authenticated:true});

test('successful draft response strips arbitrary writer metadata',async()=>{
 const handler=createContentCampaignDraftPost(verify,async()=>({
  id:campaign,status:'draft',replayed:false,
  connectionString:'do-not-expose',tenantSecret:'do-not-expose',internalMetadata:{private:true}
 }));
 const response=await handler(request(),workspace);
 assert.equal(response.status,201);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{data:{id:campaign,status:'draft',replayed:false}});
});
test('replayed acknowledgement retains public replay flag without private metadata',async()=>{
 const handler=createContentCampaignDraftPost(verify,async()=>({
  id:campaign,status:'draft',replayed:true,internalError:'private'
 }));
 const response=await handler(request(),workspace);
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{data:{id:campaign,status:'draft',replayed:true}});
});
test('nonboolean replay metadata cannot be reflected to the client',async()=>{
 const handler=createContentCampaignDraftPost(verify,async()=>({
  id:campaign,status:'draft',replayed:{internal:'private'}
 }));
 const response=await handler(request(),workspace);
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{data:{id:campaign,status:'draft',replayed:false}});
});
