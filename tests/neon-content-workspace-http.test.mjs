import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceGet} from '../lib/content/neon-content-workspace-http.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';
const A='11111111-1111-4111-8111-111111111111';
const W='33333333-3333-4333-8333-333333333333';
const req=(method='GET')=>new Request('https://example.invalid/api/content/workspaces/'+W,{method});
test('only server-verified principal reaches reader',async()=>{
 let called=0;
 const handler=createContentWorkspaceGet(async()=>({userId:A,authenticated:true}),async(p,id)=>{
  called++;assert.equal(p.userId,A);assert.equal(id,W);return {campaigns:[]};
 });
 const res=await handler(req(),W);
 assert.equal(res.status,200);assert.equal(called,1);
 assert.equal(res.headers.get('cache-control'),'no-store');
});
test('missing session and verifier failure deny before DB',async()=>{
 let called=0;
 for(const verify of [async()=>null,async()=>{throw Error('expired');},async()=>({userId:'bad',authenticated:true})]){
  const handler=createContentWorkspaceGet(verify,async()=>{called++;return {};});
  assert.equal((await handler(req(),W)).status,401);
 }
 assert.equal(called,0);
});
test('invalid workspace and unsafe method deny before verification',async()=>{
 let called=0;
 const handler=createContentWorkspaceGet(async()=>{called++;return {userId:A,authenticated:true};},async()=>({}));
 assert.equal((await handler(req(),'invalid')).status,404);
 assert.equal((await handler(req('POST'),W)).status,405);
 assert.equal(called,0);
});
test('foreign workspace denial is indistinguishable from missing workspace',async()=>{
 const handler=createContentWorkspaceGet(async()=>({userId:A,authenticated:true}),async()=>{throw new ContentReadDenied();});
 const res=await handler(req(),W);
 assert.equal(res.status,404);
 assert.deepEqual(await res.json(),{error:'not_found'});
});
test('database errors fail closed without leaking details',async()=>{
 const handler=createContentWorkspaceGet(async()=>({userId:A,authenticated:true}),async()=>{throw Error('SQL password=secret');});
 const res=await handler(req(),W);
 assert.equal(res.status,503);
 assert.equal((await res.text()).includes('secret'),false);
});


test('cursor is bounded and is sent only with a verified principal and workspace',async()=>{
 const cursor='44444444-4444-4444-8444-444444444444';
 let reads=0;
 const handler=createContentWorkspaceGet(async()=>({userId:A,authenticated:true}),async(p,id,before)=>{
  reads++;assert.equal(p.userId,A);assert.equal(id,W);assert.equal(before,cursor);return {campaigns:[]};
 });
 for(const query of ['?before=', '?before=other', `?before=${cursor}&before=${cursor}`])
  assert.equal((await handler(new Request(req().url+query),W)).status,400);
 assert.equal(reads,0);
 assert.equal((await handler(new Request(req().url+`?before=${cursor}`),W)).status,200);
 assert.equal(reads,1);
});
