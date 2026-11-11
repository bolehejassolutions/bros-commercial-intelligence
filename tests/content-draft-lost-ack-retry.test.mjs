/** Deterministic HTTP retry evidence: the writer commits before the client receives an acknowledgement. No live DB. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const workspace='11111111-1111-4111-8111-111111111111';
const alice='22222222-2222-4222-8222-222222222222';
const bob='55555555-5555-4555-8555-555555555555';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',platforms:['facebook']};
const key='retry_after_lost_ack_123';
function request(body=draft){
 return new Request('https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
  method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test',
   'sec-fetch-site':'same-origin','idempotency-key':key},body:JSON.stringify(body)
 });
}
test('committed write with lost HTTP acknowledgement is safely replayed, not duplicated',async()=>{
 const saved=new Map();let inserts=0;let attempts=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:alice,authenticated:true}),async(principal,w,payload,k)=>{
  attempts++;
  const scope=[principal.userId,w,k].join('|');
  const serialized=JSON.stringify(payload);
  const existing=saved.get(scope);
  if(existing){
   if(existing.payload!==serialized)throw Error('conflicting replay');
   return {...existing.receipt,replayed:true};
  }
  inserts++;
  const receipt={id:'33333333-3333-4333-8333-333333333333',status:'draft'};
  saved.set(scope,{payload:serialized,receipt});
  // Simulate a transport failure AFTER the durable commit, before the HTTP acknowledgement.
  throw Error('acknowledgement lost');
 });
 const lost=await handler(request(),workspace);
 assert.equal(lost.status,503);
 assert.deepEqual(await lost.json(),{error:'draft_unavailable'});
 const retry=await handler(request(),workspace);
 assert.equal(retry.status,201);
 assert.deepEqual(await retry.json(),{data:{id:'33333333-3333-4333-8333-333333333333',status:'draft',replayed:true}});
 assert.equal(inserts,1);assert.equal(attempts,2);assert.equal(saved.size,1);
});
test('same idempotency key cannot reuse another authenticated user receipt',async()=>{
 const rows=new Map();let inserts=0;let current=alice;
 const handler=createContentCampaignDraftPost(async()=>({userId:current,authenticated:true}),async(p,w,payload,k)=>{
  const scope=[p.userId,w,k].join('|');
  if(!rows.has(scope)){inserts++;rows.set(scope,{id:inserts===1?'33333333-3333-4333-8333-333333333333':'66666666-6666-4666-8666-666666666666',status:'draft'});}
  return rows.get(scope);
 });
 const first=await handler(request(),workspace);current=bob;
 const second=await handler(request(),workspace);
 assert.equal(first.status,201);assert.equal(second.status,201);
 assert.notEqual((await first.json()).data.id,(await second.json()).data.id);
 assert.equal(inserts,2);
});
