import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceGet} from '../lib/content/neon-content-workspace-http.ts';
import {ContentReadDenied, ContentReadIncomplete} from '../lib/content/neon-content-workspace-reader.ts';

// Receipt-specific GETs must preserve the same authentication, RLS-denial
// indistinguishability, and error redaction as ordinary workspace reads.
const principalId='11111111-1111-4111-8111-111111111111';
const workspaceId='33333333-3333-4333-8333-333333333333';
const draftId='55555555-5555-4555-8555-555555555555';
const request=()=>new Request('https://example.invalid/api/content/dev/workspaces/'+workspaceId+'?draft='+draftId);

test('draft selector never reaches the reader without a verified session',async()=>{
 let calls=0;
 for(const verify of [async()=>null,async()=>{throw Error('expired session');},async()=>({userId:'invalid',authenticated:true})]){
  const get=createContentWorkspaceGet(verify,async()=>{calls++;return {campaigns:[]};});
  const result=await get(request(),workspaceId);
  assert.equal(result.status,401);
  assert.deepEqual(await result.json(),{error:'unauthorized'});
  assert.equal(result.headers.get('cache-control'),'no-store');
 }
 assert.equal(calls,0);
});

test('draft selector hides foreign and absent receipts behind identical 404 responses',async()=>{
 const get=createContentWorkspaceGet(
  async()=>({userId:principalId,authenticated:true}),
  async(_principal,_workspace,_before,selected)=>{
   assert.equal(selected,draftId);
   throw new ContentReadDenied();
  }
 );
 const result=await get(request(),workspaceId);
 assert.equal(result.status,404);
 assert.deepEqual(await result.json(),{error:'not_found'});
 assert.equal(result.headers.get('cache-control'),'no-store');
});

test('draft selector never exposes restricted-reader failure details',async()=>{
 for(const [failure,expected] of [
  [new ContentReadIncomplete(), 'workspace_incomplete'],
  [new Error('SQL password=secret tenant=private'), 'workspace_unavailable']
 ]){
  const get=createContentWorkspaceGet(
   async()=>({userId:principalId,authenticated:true}),
   async()=>{throw failure;}
  );
  const result=await get(request(),workspaceId);
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{error:expected});
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal(result.headers.get('x-content-type-options'),'nosniff');
 }
});
