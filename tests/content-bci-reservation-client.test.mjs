import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createContentBciReservationClient} from '../lib/content/bci-reservation-client.mjs';
const binding={reviewPacketId:'review-1',handoffId:'handoff-1',signedReviewEvidenceId:'signed-1',
  planId:'plan-1',mediaSetId:'media-1',copySha256:'a'.repeat(64),providerOrganizationId:'org-1',channelId:'channel-1'};
const candidate={dispatchIntentId:'intent-1',binding};
const receipt={status:'reserved',reservationId:'33333333-3333-4333-8333-333333333333',
  postCommitReadback:true,providerSent:false,executionAllowed:false};
const response=p=>Response.json(p,{headers:{'Cache-Control':'private, no-store',Vary:'Authorization'}});
test('CONTENT sends one fixed-path exact intent/binding request, then retains nonexecuting receipt',async()=>{
  const calls=[];const reserve=createContentBciReservationClient({requestToken:async()=>'aaa.bbb.ccc',
    fetchSameOrigin:async(path,options)=>{calls.push({path,options});return response(receipt);}});
  const result=await reserve(candidate,'approval-1');
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/internal/neon-content-reservation');
  const body=JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(body),['dispatchIntentId','approvalId','bindingSha256']);
  assert.equal(body.bindingSha256,createHash('sha256').update(JSON.stringify(Object.values(binding))).digest('hex'));
  assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'same-origin');
  assert.equal(result.status,'BCI_RESERVATION_RECEIPT_ONLY');assert.equal(result.approvalGranted,false);
  assert.equal(result.providerSentVerified,false);assert.equal(result.executionAllowed,false);
});
test('replay stays reconciliation required and never reauthorizes a publish',async()=>{
  const reserve=createContentBciReservationClient({requestToken:async()=>'aaa.bbb.ccc',
    fetchSameOrigin:async()=>response({...receipt,status:'reconciliation_required',reservationId:null})});
  const r=await reserve(candidate,'approval-1');assert.equal(r.reservationStatus,'reconciliation_required');
  assert.equal(r.reservationId,null);assert.equal(r.executionAllowed,false);
});
test('source binding is immutable across the fresh token await',async()=>{
  const input=structuredClone(candidate);let body;
  const reserve=createContentBciReservationClient({requestToken:async()=>{input.binding.channelId='other-channel';return 'aaa.bbb.ccc';},
    fetchSameOrigin:async(_,opts)=>{body=JSON.parse(opts.body);return response(receipt);}});
  await reserve(input,'approval-1');
  assert.equal(body.bindingSha256,createHash('sha256').update(JSON.stringify(Object.values(binding))).digest('hex'));
});
test('foreign fields, incomplete/script binding, bad token and token errors reject before network',async()=>{
  let calls=0;const deps={requestToken:async()=>'aaa.bbb.ccc',fetchSameOrigin:async()=>{calls++;return response(receipt);}};
  for(const input of [{...candidate,tenantId:'foreign'},
    {...candidate,dispatchIntentId:123},
    {...candidate,binding:{...binding,signedScriptMediaEvidenceId:'script-1'}},
    {...candidate,binding:{...binding,copySha256:'not-a-hash'}}])
    await assert.rejects(createContentBciReservationClient(deps)(input,'approval-1'),/NOT_SUBMITTED/);
  for(const requestToken of [async()=>'opaque',async()=>{throw Error('secret provider detail');}])
    await assert.rejects(createContentBciReservationClient({...deps,requestToken})(candidate,'approval-1'),/NOT_SUBMITTED/);
  assert.equal(calls,0);
});
test('ambiguous network/HTML/errors/privileged receipts do not retry or certify approval/SENT',async()=>{
  for(const fetch of [async()=>{throw Error('provider secret');},async()=>new Response('<html>login</html>'),
    async()=>response({...receipt,postCommitReadback:false}),async()=>response({...receipt,executionAllowed:true}),
    async()=>response({...receipt,extra:'bad'})]){
    let calls=0;const reserve=createContentBciReservationClient({requestToken:async()=>'aaa.bbb.ccc',
      fetchSameOrigin:async(...args)=>{calls++;return fetch(...args);}});
    await assert.rejects(reserve(candidate,'approval-1'),/UNCONFIRMED_RECONCILE_INTENT/);assert.equal(calls,1);
  }
});
