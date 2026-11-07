import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';
const user='11111111-1111-4111-8111-111111111111';
const workspace='22222222-2222-4222-8222-222222222222';
const key='safe_retry_key_123';
const request=(body,headers={})=>new Request('https://example.invalid/content',{method:'POST',headers:{'idempotency-key':key,'content-type':'application/json',...headers},body:JSON.stringify(body)});
const valid={product_service:'Test service',audience:'Owners',platforms:['facebook']};
test('rejects unauthenticated requests without invoking writer',async()=>{
 let calls=0;
 const handler=createContentCampaignDraftPost(async()=>null,async()=>{calls++;});
 assert.equal((await handler(request(valid),workspace)).status,401);
 assert.equal(calls,0);
});
test('binds verified principal and rejects body identity injection',async()=>{
 let calls=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async(p,w,d,k)=>{calls++;assert.equal(p.userId,user);assert.equal(w,workspace);assert.equal(k,key);return {id:'draft'};});
 assert.equal((await handler(request({...valid,tenant_id:workspace}),workspace)).status,400);
 assert.equal((await handler(request(valid),workspace)).status,201);
 assert.equal(calls,1);
});
test('rejects invalid idempotency keys, malformed drafts and oversized payload',async()=>{
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async()=>{throw Error('must not write');});
 assert.equal((await handler(request(valid,{'idempotency-key':'short'}),workspace)).status,400);
 assert.equal((await handler(request({...valid,duration_days:91}),workspace)).status,400);
 assert.equal((await handler(request({...valid,platforms:['']}),workspace)).status,400);
 assert.equal((await handler(request({...valid,description:'x'.repeat(17000)}),workspace)).status,413);
});
test('foreign tenant denial and database failure reveal no details',async()=>{
 const auth=async()=>({userId:user,authenticated:true});
 const denied=createContentCampaignDraftPost(auth,async()=>{throw new ContentReadDenied();});
 const unavailable=createContentCampaignDraftPost(auth,async()=>{throw new Error('sensitive SQL details');});
 const r=await denied(request(valid),workspace);
 assert.equal(r.status,404);
 assert.equal((await r.text()).includes('tenant'),false);
 const q=await unavailable(request(valid),workspace);
 assert.equal(q.status,503);
 assert.equal((await q.text()).includes('sensitive'),false);
});

test('rejects unsupported media types and multibyte oversized JSON before writer',async()=>{
 let calls=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async()=>{calls++;return {id:'draft'};});
 assert.equal((await handler(request(valid,{'content-type':'text/plain'}),workspace)).status,415);
 const oversized={...valid,description:'界'.repeat(5500)};
 assert.equal((await handler(request(oversized),workspace)).status,413);
 assert.equal(calls,0);
});
