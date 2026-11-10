/** HTTP-level deterministic retry contract; injected in-memory writer, no Neon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCampaignDraftPost} from '../lib/content/neon-content-campaign-draft-http.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';

const workspace='11111111-1111-4111-8111-111111111111';
const otherWorkspace='44444444-4444-4444-8444-444444444444';
const user='22222222-2222-4222-8222-222222222222';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',platforms:['facebook']};
const make=(body=draft,key='retry_key_123456789',urlWorkspace=workspace)=>new Request('https://content.example.test/api/content/dev/workspaces/'+urlWorkspace+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test','sec-fetch-site':'same-origin','idempotency-key':key},body:JSON.stringify(body)
});
const principal=async()=>({userId:user,authenticated:true});

test('same authenticated request and retry key yield one persisted campaign via injected idempotent writer',async()=>{
 const rows=new Map();let inserts=0;
 const handler=createContentCampaignDraftPost(principal,async(p,w,d,key)=>{
  const scope=p.userId+'|'+w+'|'+key;
  const payload=JSON.stringify(d);
  if(rows.has(scope)){const old=rows.get(scope);if(old.payload!==payload)throw Error('conflict');return old.data;}
  inserts++;const data={id:'33333333-3333-4333-8333-333333333333',status:'draft'};
  rows.set(scope,{payload,data});return data;
 });
 const first=await handler(make(),workspace);
 const second=await handler(make(),workspace);
 assert.equal(first.status,201);assert.equal(second.status,201);
 assert.deepEqual(await first.json(),await second.json());
 assert.equal(inserts,1);
});

test('same retry key with changed normalized payload fails closed without leaking writer details',async()=>{
 let attempts=0;let original;
 const handler=createContentCampaignDraftPost(principal,async(_p,_w,d)=>{
  attempts++;const current=JSON.stringify(d);
  if(original&&original!==current)throw Error('database secret or conflicting payload');
  original=current;return {id:'33333333-3333-4333-8333-333333333333',status:'draft'};
 });
 assert.equal((await handler(make(),workspace)).status,201);
 const response=await handler(make({...draft,audience:'Different audience'}),workspace);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'draft_unavailable'});
 assert.equal(attempts,2);
});

test('retry keys are scoped to workspace and cannot create a cross-workspace cache hit',async()=>{
 const scopes=[];const handler=createContentCampaignDraftPost(principal,async(p,w,_d,key)=>{
  scopes.push([p.userId,w,key]);return {id:w,status:'draft'};
 });
 assert.equal((await handler(make(),workspace)).status,201);
 assert.equal((await handler(make(draft,'retry_key_123456789',otherWorkspace),otherWorkspace)).status,201);
 assert.equal(scopes.length,2);
 assert.notEqual(scopes[0][1],scopes[1][1]);
});

test('membership-denied writer response is indistinguishable from missing workspace',async()=>{
 let calls=0;
 const handler=createContentCampaignDraftPost(principal,async()=>{calls++;throw new ContentReadDenied();});
 const response=await handler(make(),workspace);
 assert.equal(response.status,404);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{error:'not_found'});
 assert.equal(calls,1);
});
