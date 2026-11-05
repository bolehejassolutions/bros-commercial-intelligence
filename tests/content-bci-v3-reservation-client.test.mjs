import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveContentV3Dispatch} from '../lib/content/bci-v3-reservation-client.mjs';
const origin='https://preview.example.test/';
const jwt='a.b.c';
const approval=Object.freeze({schemaVersion:3,status:'BCI_V3_APPROVAL_COMMITTED_AND_READ_BACK',
  dispatchIntentId:'intent-1',approvalId:'approval-1',bindingSha256:'a'.repeat(64),
  durableApprovalRecorded:true});
const result={status:'reserved',reservationId:'123e4567-e89b-42d3-a456-426614174000',
  postCommitReadback:true,providerSent:false,executionAllowed:false};
const response=(body=result,url=origin+'api/internal/neon-content-reservation')=>({
  status:200,ok:true,url,text:async()=>JSON.stringify(body)});
test('uses exact BCI reservation route and never authorizes dispatch',async()=>{
  let calls=0;
  const out=await reserveContentV3Dispatch({origin,jwt,approval,fetchImpl:async(url,opts)=>{
    calls++;assert.equal(url,origin+'api/internal/neon-content-reservation');
    assert.equal(opts.method,'POST');assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Origin,'https://preview.example.test');
    assert.deepEqual(JSON.parse(opts.body),{dispatchIntentId:'intent-1',
      approvalId:'approval-1',bindingSha256:'a'.repeat(64)});
    return response();
  }});
  assert.equal(calls,1);assert.equal(out.executionAllowed,false);
  assert.equal(out.status,'BCI_V3_RESERVATION_CONFIRMED_NO_DISPATCH');
});
test('ambiguous reservation requires reconciliation, not publish',async()=>{
  const out=await reserveContentV3Dispatch({origin,jwt,approval,fetchImpl:async()=>response({
    ...result,status:'reconciliation_required',reservationId:null})});
  assert.equal(out.reservationId,null);assert.equal(out.executionAllowed,false);
});
test('rejects unsigned/uncommitted approval without contacting provider',async()=>{
  let calls=0;
  await assert.rejects(reserveContentV3Dispatch({origin,jwt,approval:{
    ...approval,durableApprovalRecorded:false},fetchImpl:async()=>{calls++;return response();}}),
    /CONTENT_V3_RESERVATION_UNCONFIRMED/);
  assert.equal(calls,0);
});
test('accepts compact JWT separators and rejects malformed tokens before transport',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return response();};
  for(const jwt of ['aaa.bbb.ccc','a_-9.b_-0.c_-1']){
    const out=await reserveContentV3Dispatch({origin,jwt,approval,fetchImpl});
    assert.equal(out.status,'BCI_V3_RESERVATION_CONFIRMED_NO_DISPATCH');
  }
  assert.equal(calls,2);
  for(const jwt of ['', 'aaa', 'aaa.bbb', 'aaa..ccc','aaa.bbb.ccc.ddd',
    'aaa\\.bbb\\.ccc','aaa bbb ccc','Bearer aaa.bbb.ccc','a'.repeat(16000)+'.b.c']){
    await assert.rejects(reserveContentV3Dispatch({origin,jwt,approval,fetchImpl}),
      /CONTENT_V3_RESERVATION_UNCONFIRMED/);
  }
  assert.equal(calls,2);
});
test('rejects redirect, spoofed response, network ambiguity and unexpected fields',async()=>{
  for(const impl of [
    async()=>response(result,'https://attacker.test/api/internal/neon-content-reservation'),
    async()=>response({...result,executionAllowed:true}),
    async()=>response({...result,extra:'unexpected'}),
    async()=>{throw Error('timeout');}
  ])await assert.rejects(reserveContentV3Dispatch({origin,jwt,approval,fetchImpl:impl}),
    /CONTENT_V3_RESERVATION_UNCONFIRMED/);
});

