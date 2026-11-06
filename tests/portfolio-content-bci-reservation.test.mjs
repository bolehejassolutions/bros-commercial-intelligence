import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

// Both modules are supplied by their existing owner branches in the five-head
// merge. A standalone coordinator checkout cannot certify their compatibility.
const clientUrl=new URL('../lib/content/bci-v3-reservation-client.mjs',import.meta.url);
const httpUrl=new URL('../lib/bci/neon-content-reservation-http.ts',import.meta.url);
const available=existsSync(clientUrl)&&existsSync(httpUrl);
const opts={skip:available?false:'requires actual CONTENT and BCI worker modules'};
const origin='https://bci.example.test';
const jwt='aaa.bbb.ccc';
const approval={schemaVersion:3,status:'BCI_V3_APPROVAL_COMMITTED_AND_READ_BACK',
 dispatchIntentId:'content-intent-1',approvalId:'content-approval-1',
 bindingSha256:'a'.repeat(64),durableApprovalRecorded:true};
const reservationId='33333333-3333-4333-8333-333333333333';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/neon-bci-dev-ledger-20261025',
 BCI_NEON_DEV_PRIVATE_READS:'enabled',BCI_NEON_DEV_CONTENT_RESERVATIONS:'enabled'};

async function harness(delta={}){
 const {reserveContentV3Dispatch}=await import(clientUrl);
 const {createContentReservationHttpHandler}=await import(httpUrl);
 const writes=[];
 const handler=createContentReservationHttpHandler({env:()=>({...env,...delta}),
  execute:async(token,input)=>{
   assert.equal(token,jwt);
   assert.deepEqual(input,{dispatchIntentId:approval.dispatchIntentId,
    approvalId:approval.approvalId,bindingSha256:approval.bindingSha256});
   writes.push(input);
   return writes.length===1?{status:'acquired',reservationId}:
    {status:'already_reserved',reservationId:null};
  }});
 const fetchImpl=async(url,init)=>{
  const r=await handler(new Request(url,init));
  return {status:r.status,ok:r.ok,url,text:()=>r.text()};
 };
 return {writes,reserve:()=>reserveContentV3Dispatch({origin,jwt,approval,fetchImpl})};
}

test('actual CONTENT client and BCI HTTP handler agree on reservation and replay',opts,async()=>{
 // Synthetic auth/storage dependencies only: this proves code compatibility,
 // not human approval, restricted LOGIN or a live provider transaction.
 const h=await harness();
 const first=await h.reserve();
 assert.equal(first.status,'BCI_V3_RESERVATION_CONFIRMED_NO_DISPATCH');
 assert.equal(first.reservationId,reservationId);
 assert.equal(first.executionAllowed,false);
 const replay=await h.reserve();
 assert.equal(replay.status,'BCI_V3_RESERVATION_RECONCILIATION_REQUIRED');
 assert.equal(replay.executionAllowed,false);
 assert.equal(h.writes.length,2);
});

test('actual BCI route rejects disabled/production reservation before storage',opts,async()=>{
 for(const delta of [{BCI_NEON_DEV_CONTENT_RESERVATIONS:undefined},{VERCEL_ENV:'production'}]){
  const h=await harness(delta);
  await assert.rejects(h.reserve(),/CONTENT_V3_RESERVATION_UNCONFIRMED/);
  assert.equal(h.writes.length,0);
 }
});
