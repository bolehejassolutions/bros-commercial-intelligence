/** Isolated HTTP negative-path acceptance. No Neon, paid providers, or customer data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const workspace='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const url='https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts';
const payload={product_service:'BROS SELL',audience:'Peniaga Malaysia',platforms:['facebook']};
const headers={'content-type':'application/json','origin':'https://content.example.test','sec-fetch-site':'same-origin','idempotency-key':'retry_key_123456789'};
const request=(body:unknown,overrides:Record<string,string>={})=>new Request(url,{method:'POST',headers:{...headers,...overrides},body:typeof body==='string'?body:JSON.stringify(body)});
const principal=async()=>({userId:user,authenticated:true});

test('oversized UTF-8 payload is rejected before writer invocation',async()=>{
 let calls=0;const handler=createContentCampaignDraftPost(principal,async()=>{calls++;return {};});
 const response=await handler(request({...payload,audience:'é'.repeat(9000)}),workspace);
 assert.equal(response.status,413);
 assert.deepEqual(await response.json(),{error:'payload_too_large'});
 assert.equal(calls,0);
});

test('malformed JSON is rejected before writer invocation without leaking input',async()=>{
 let calls=0;const handler=createContentCampaignDraftPost(principal,async()=>{calls++;return {};});
 const response=await handler(request('{"audience":"sensitive",'),workspace);
 assert.equal(response.status,400);
 assert.deepEqual(await response.json(),{error:'invalid_json'});
 assert.equal(calls,0);
});

test('cross-site fetch metadata cannot be overridden by matching Origin',async()=>{
 let authenticated=0,writes=0;
 const handler=createContentCampaignDraftPost(async()=>{authenticated++;return {userId:user,authenticated:true};},async()=>{writes++;return {};});
 const response=await handler(request(payload,{'sec-fetch-site':'cross-site'}),workspace);
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:'forbidden_origin'});
 assert.equal(authenticated,0);assert.equal(writes,0);
});

test('invalid retry key is rejected without persisting a draft',async()=>{
 let writes=0;const handler=createContentCampaignDraftPost(principal,async()=>{writes++;return {};});
 const response=await handler(request(payload,{'idempotency-key':'short'}),workspace);
 assert.equal(response.status,400);
 assert.deepEqual(await response.json(),{error:'invalid_idempotency_key'});
 assert.equal(writes,0);
});

test('writer failure is sanitized and non-cacheable',async()=>{
 const handler=createContentCampaignDraftPost(principal,async()=>{throw Error('database password SECRET');});
 const response=await handler(request(payload),workspace);
 assert.equal(response.status,503);
 assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.text();
 assert.deepEqual(JSON.parse(body),{error:'draft_unavailable'});
 assert.doesNotMatch(body,/SECRET/);
});
