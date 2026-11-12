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

test('a draft receipt selector requires a single UUID and excludes pagination',async()=>{
 const draft='55555555-5555-4555-8555-555555555555';
 const calls=[];
 const handler=createContentWorkspaceGet(async()=>({userId:A,authenticated:true}),async(...args)=>{
  calls.push(args);return {campaigns:[]};
 });
 for(const query of ['?draft=', '?draft=other', `?draft=${draft}&draft=${draft}`, `?draft=${draft}&before=${draft}`]){
  const response=await handler(new Request(req().url+query),W);
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:'invalid_draft'});
 }
 assert.deepEqual(calls,[]);
 assert.equal((await handler(new Request(req().url+`?draft=${draft}`),W)).status,200);
 assert.deepEqual(calls,[[{userId:A,authenticated:true},W,undefined,draft]]);
});
