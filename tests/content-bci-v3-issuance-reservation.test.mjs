import test from 'node:test';
import assert from 'node:assert/strict';
import {issueAndReserveContentV3} from '../lib/content/bci-v3-issuance-reservation.mjs';
const sha='a'.repeat(64),intent='content-intent-1',approvalId='content-approved-1';
const request=()=>({envelope:{proofEnvelopeId:'proof-1',scriptIntentId:'script-1',
 copySha256:sha,destination:{channelService:'facebook',channelId:'page-1'}},
 mediaBytes:[new Uint8Array(32),new Uint8Array(32)],
 receipt:{editorial:{},script:{},dispatch:{schemaVersion:3,keyId:'key-1',
 signature:'signed-by-human',payload:{schemaVersion:3,product:'content',
 dispatchIntentId:intent,bindingSha256:sha,signedDispatchIntentSha256:sha,
 proofEnvelopeId:'proof-1',scriptIntentId:'script-1',copySha256:sha,
 channelService:'facebook',channelId:'page-1'}}}});
const issued=()=>({status:'BCI_CONTENT_V3_APPROVAL_COMMITTED',approvalId,
 committedReadback:true,providerSent:false,executionAllowed:false});
const origin='https://content.example.test';
const jwt='aaa.bbb.ccc';
const fetchImpl=async (url,opts)=>{
 assert.equal(url,origin+'/api/internal/neon-content-reservation');
 assert.equal(opts.redirect,'error');
 assert.deepEqual(JSON.parse(opts.body),{dispatchIntentId:intent,approvalId,bindingSha256:sha});
 return {status:200,ok:true,url,text:async()=>JSON.stringify({
 status:'reserved',reservationId:'123e4567-e89b-42d3-a456-426614174000',
 postCommitReadback:true,providerSent:false,executionAllowed:false})};
};
test('committed BCI V3 readback flows to authenticated reservation without dispatch',async()=>{
 let called=0;
 const result=await issueAndReserveContentV3({request:request(),
 issueScript:async()=>{called++;return issued();},origin,jwt,fetchImpl});
 assert.equal(called,1);
 assert.equal(result.status,'BCI_V3_RESERVATION_CONFIRMED_NO_DISPATCH');
 assert.equal(result.executionAllowed,false);
});
test('preflight-only output never reaches reservation',async()=>{
 let reserved=false;
 await assert.rejects(issueAndReserveContentV3({request:request(),
 issueScript:async()=>({...issued(),status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY'}),
 origin,jwt,fetchImpl:async()=>{reserved=true;throw Error('unexpected');}}),
 /CONTENT_V3_ISSUANCE_RESERVATION_DENIED/);
 assert.equal(reserved,false);
});
test('altered destination fails before issuer invocation',async()=>{
 const r=request();r.receipt.dispatch.payload.channelId='another-page';
 let called=false;
 await assert.rejects(issueAndReserveContentV3({request:r,issueScript:async()=>{called=true;return issued();},
 origin,jwt,fetchImpl}),/CONTENT_V3_ISSUANCE_RESERVATION_DENIED/);
 assert.equal(called,false);
});
test('failed restricted readback never reaches reservation',async()=>{
 let reserved=false;
 await assert.rejects(issueAndReserveContentV3({request:request(),
 issueScript:async()=>({...issued(),committedReadback:false}),
 origin,jwt,fetchImpl:async()=>{reserved=true;throw Error('unexpected');}}),
 /CONTENT_V3_ISSUANCE_RESERVATION_DENIED/);
 assert.equal(reserved,false);
});
