/** Deterministic HTTP boundary acceptance; no Neon, credits, or provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const workspace='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const key='draft_retry_key_12345';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',description:'',problem:'',objective:'',duration_days:7,platforms:['facebook']};
function request(body=draft,headers={}){
 return new Request('https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
  method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test','sec-fetch-site':'same-origin','idempotency-key':key,...headers},body:JSON.stringify(body)
 });
}
test('authenticated draft reaches injected restricted writer once with normalized fields',async()=>{
 const calls=[];
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async(...args)=>{
  calls.push(args);return {id:'33333333-3333-4333-8333-333333333333',status:'draft'};
 });
 const response=await handler(request({...draft,product_service:'  BROS SELL  ',platforms:['FACEBOOK']}),workspace);
 assert.equal(response.status,201);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(calls.length,1);
 assert.equal(calls[0][0].userId,user);
 assert.equal(calls[0][1],workspace);
 assert.equal(calls[0][2].product_service,'BROS SELL');
 assert.deepEqual(calls[0][2].platforms,['facebook']);
 assert.equal(calls[0][3],key);
});
test('unauthenticated requests never invoke the writer',async()=>{
 let writes=0;
 const handler=createContentCampaignDraftPost(async()=>null,async()=>{writes++;});
 assert.equal((await handler(request(),workspace)).status,401);
 assert.equal(writes,0);
});
test('cross-origin browser requests fail before authentication or writer',async()=>{
 let auth=0,writes=0;
 const handler=createContentCampaignDraftPost(async()=>{auth++;return {userId:user,authenticated:true};},async()=>{writes++;});
 assert.equal((await handler(request(draft,{'origin':'https://evil.example'}),workspace)).status,403);
 assert.equal((await handler(request(draft,{'sec-fetch-site':'cross-site'}),workspace)).status,403);
 assert.equal(auth,0);assert.equal(writes,0);
});
test('malformed brief and duplicate platform fail before restricted writer',async()=>{
 let writes=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async()=>{writes++;});
 assert.equal((await handler(request({...draft,platforms:['facebook','FACEBOOK']}),workspace)).status,400);
 assert.equal((await handler(request({...draft,untrusted:'secret'}),workspace)).status,400);
 assert.equal(writes,0);
});
test('uncertain restricted writer failure returns no-store 503 without leaking exception',async()=>{
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async()=>{throw new Error('sensitive connection detail');});
 const response=await handler(request(),workspace);
 assert.equal(response.status,503);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{error:'draft_unavailable'});
});
