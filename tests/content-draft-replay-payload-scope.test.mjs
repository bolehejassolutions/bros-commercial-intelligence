/** Deterministic HTTP-boundary replay integrity: no live Neon or paid providers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';

const workspaceA='11111111-1111-4111-8111-111111111111';
const workspaceB='44444444-4444-4444-8444-444444444444';
const user='22222222-2222-4222-8222-222222222222';
const key='replay_payload_scope_123';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',platforms:['facebook']};
const makeRequest=(body)=>new Request('https://content.example.test/api/content/dev/workspaces/'+workspaceA+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test',
 'sec-fetch-site':'same-origin','idempotency-key':key},body:JSON.stringify(body)
});

test('changed payload after acknowledged commit cannot reuse idempotency receipt',async()=>{
 const saved=new Map();let inserts=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async(p,w,payload,k)=>{
  const scope=[p.userId,w,k].join('|');const fingerprint=JSON.stringify(payload);
  const existing=saved.get(scope);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('payload mismatch');return {...existing.receipt,replayed:true};}
  inserts++;
  const receipt={id:'33333333-3333-4333-8333-333333333333',status:'draft'};
  saved.set(scope,{fingerprint,receipt});return receipt;
 });
 const first=await handler(makeRequest(draft),workspaceA);
 assert.equal(first.status,201);
 const changed=await handler(makeRequest({...draft,audience:'Another audience'}),workspaceA);
 assert.equal(changed.status,503);
 assert.deepEqual(await changed.json(),{error:'draft_unavailable'});
 const replay=await handler(makeRequest(draft),workspaceA);
 assert.equal(replay.status,201);
 assert.equal((await replay.json()).data.replayed,true);
 assert.equal(inserts,1);
 assert.equal(saved.size,1);
});

test('same authenticated principal and key remain scoped to workspace',async()=>{
 const saved=new Map();let inserts=0;
 const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),async(p,w,payload,k)=>{
  const scope=[p.userId,w,k].join('|');
  if(!saved.has(scope)){
   inserts++;
   saved.set(scope,{id:inserts===1?'33333333-3333-4333-8333-333333333333':'66666666-6666-4666-8666-666666666666',status:'draft'});
  }
  return saved.get(scope);
 });
 const a=await handler(makeRequest(draft),workspaceA);
 const b=await handler(makeRequest(draft),workspaceB);
 assert.equal(a.status,201);assert.equal(b.status,201);
 assert.notEqual((await a.json()).data.id,(await b.json()).data.id);
 assert.equal(inserts,2);
});
