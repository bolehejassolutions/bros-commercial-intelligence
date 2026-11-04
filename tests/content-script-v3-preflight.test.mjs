import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createBciContentScriptV3Preflight} from '../lib/bci/content-script-v3-preflight.mjs';
const h=x=>createHash('sha256').update(x).digest('hex');
const tenantId='22222222-2222-4222-8222-222222222222';
const reviewer='11111111-1111-4111-8111-111111111111';
const img=[Buffer.alloc(64,11),Buffer.alloc(64,22)];
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const V1=['schemaVersion','product','tenantId','instanceId','planId','mediaSetId',
 'approvalRequestId','reviewPacketId','handoffId','reviewerSubject','reviewerProvider',
 'reviewedAt','expiresAt','nonce','decision','checkResults'];
const SCRIPT=['schemaVersion','product','proofEnvelopeId','tenantId','instanceId',
 'planId','reviewPacketId','scriptIntentId','copySha256','channelService',
 'channelId','reviewerSubject','reviewerProvider','reviewedAt','expiresAt',
 'nonce','decision','scriptCheckResults'];
const t1='2026-11-04T08:00:00.000Z',t2='2026-11-04T08:01:00.000Z',exp='2026-11-04T09:00:00.000Z';
const now=Date.parse('2026-11-04T08:02:00.000Z');
function signed(payload,fields,domain){
 const bytes=Buffer.from(domain+'\n'+JSON.stringify(fields.map(k=>payload[k])));
 return {schemaVersion:1,keyId:'human-key',payload,
  signature:sign(null,bytes,privateKey).toString('base64url')};
}
function fixture(){
 const a={schemaVersion:1,product:'content',tenantId,instanceId:'instance-1',
  planId:'plan-1',mediaSetId:'media-1',approvalRequestId:'request-1',
  reviewPacketId:'review-1',handoffId:'handoff-1',reviewerSubject:reviewer,
  reviewerProvider:'neon-auth',reviewedAt:t1,expiresAt:exp,
  nonce:'a'.repeat(32),decision:'APPROVE',
  checkResults:[{check:'HUMAN_MEDIA_QA',passed:true}]};
 const envelopeId='content-instance-script-proof-'+h('complete-source');
 const scriptIntentId='script-intent';
 const copySha256='a'.repeat(64);
 const b={schemaVersion:1,product:'content',proofEnvelopeId:envelopeId,
  tenantId,instanceId:'instance-1',planId:'plan-1',reviewPacketId:'review-1',
  scriptIntentId,copySha256,channelService:'instagram',channelId:'ig-1',
  reviewerSubject:reviewer,reviewerProvider:'neon-auth',reviewedAt:t2,
  expiresAt:exp,nonce:'b'.repeat(32),decision:'APPROVE',
  scriptCheckResults:[
   {check:'VERIFY_SCRIPT_SHOTS_MATCH_RENDERED_MEDIA_SEMANTICALLY',passed:true},
   {check:'VERIFY_RESOURCE_MAPPING_INPUT_ACTION_OUTPUT_AND_PAYOFF',passed:true},
   {check:'VERIFY_SCRIPT_COPY_CLAIMS_RIGHTS_AND_DISCLOSURE',passed:true}
  ]};
 const media=img.map((x,i)=>({slot:i+1,sourceSha256:h(x),
   decodedRgbaSha256:h('pixels'+i)}));
 const envelope={schemaVersion:3,product:'content',tenantId,
  instanceId:'instance-1',planId:'plan-1',reviewPacketId:'review-1',
  mediaSetId:'media-1',proofEnvelopeId:envelopeId,scriptIntentId,
  copySha256,script:{shots:['shot one','shot two']},
  orderedMediaDigests:media,shotMediaBindings:media.map((x,i)=>({
   shotIndex:i+1,shot:['shot one','shot two'][i],mediaSlot:x.slot,
   sourceSha256:x.sourceSha256,decodedRgbaSha256:x.decodedRgbaSha256
  })),automatedReviewFlags:[],
  destination:{channelService:'instagram',channelId:'ig-1',providerOrganizationId:null},
  executionAllowed:false,durableApprovalRecorded:false,
  humanImageReviewSigned:false,humanScriptReviewSigned:false};
 return {envelope,mediaBytes:img.map(x=>Buffer.from(x)),
  receipt:{editorial:signed(a,V1,'BROS_CONTENT_SIGNED_REVIEW_V1'),
   script:signed(b,SCRIPT,'BROS_CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_V1')}};
}
function setup(overrides={}){
 let sourceCalls=0;
 const preflight=createBciContentScriptV3Preflight({
  trustedPublicKeys:new Map([['human-key',publicKey]]),
  authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
  readReviewerAuthority:async()=>({principalId:reviewer,tenantId,
   product:'content',memberActive:true,
   reviewerAuthorized:overrides.authorized??true,revokedAt:null}),
  verifyServerSource:async(...args)=>{
   sourceCalls++;
   return overrides.source ? overrides.source(...args) : true;
  },
  now:overrides.now??(()=>now)
 });
 return {preflight,get sourceCalls(){return sourceCalls;}};
}
test('V3 original ordered media and two independent real Ed25519 reviews preflight only',async()=>{
 const s=setup(),r=await s.preflight(fixture());
 assert.equal(r.status,'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY');
 assert.equal(r.signatureVerified,true);
 assert.equal(r.reviewerAuthorized,true);
 assert.equal(r.mediaCount,2);
 assert.equal(r.durableApprovalRecorded,false);
 assert.equal(r.executionAllowed,false);
 assert.equal(s.sourceCalls,1);
});
test('tampered signed script, reviewer, copy, channel or image deny',async()=>{
 const mutations=[
  f=>{f.receipt.script.payload.copySha256='f'.repeat(64);},
  f=>{f.receipt.script.payload.reviewerSubject='33333333-3333-4333-8333-333333333333';},
  f=>{f.envelope.destination.channelId='another';},
  f=>{f.envelope.copySha256='0'.repeat(64);},
  f=>{f.mediaBytes[0][0]=99;},
  f=>{f.mediaBytes.reverse();},
  f=>{f.receipt.script.signature=f.receipt.editorial.signature;},
  f=>{f.receipt.script.payload.nonce='a'.repeat(32);}
 ];
 for(const mutate of mutations){const f=fixture(),s=setup();mutate(f);
  await assert.rejects(s.preflight(f),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 }
});
test('revoked reviewer, source refusal and image-only downgrade denied',async()=>{
 const revoked=setup({authorized:false});
 await assert.rejects(revoked.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 const source=setup({source:()=>false});
 await assert.rejects(source.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 const old=fixture();old.envelope.schemaVersion=2;
 await assert.rejects(setup().preflight(old),/BCI_CONTENT_SCRIPT_V3_DENIED/);
});
test('untrusted source callback cannot mutate original receipts/media',async()=>{
 const f=fixture(),orig=JSON.stringify(f.receipt),origHash=h(f.mediaBytes[0]);
 const s=setup({source:(snapshot,media)=>{
  snapshot.receipt.script.payload.channelId='changed';
  media[0].fill(99);
  return true;
 }});
 assert.equal((await s.preflight(f)).executionAllowed,false);
 assert.equal(JSON.stringify(f.receipt),orig);
 assert.equal(h(f.mediaBytes[0]),origHash);
});

test('V3 expires during source recomputation and never authenticates reviewer',async()=>{
 let ticks=0;
 const clock=()=>++ticks===1?now:Date.parse(exp);
 const s=setup({now:clock});
 await assert.rejects(s.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 assert.equal(s.sourceCalls,1);
});
test('V3 rejects clock rollback after source verification',async()=>{
 let ticks=0;
 const s=setup({now:()=>++ticks===1?now:now-1});
 await assert.rejects(s.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
});
test('V3 expires after reviewer authorization without issuing approval',async()=>{
 let ticks=0;
 const s=setup({now:()=>++ticks<3?now:Date.parse(exp)});
 await assert.rejects(s.preflight(fixture()),/BCI_CONTENT_SCRIPT_V3_DENIED/);
 assert.equal(s.sourceCalls,1);
});


import {createBciContentTrustedIssuer} from '../lib/bci/content-trusted-issuer.mjs';
const DISPATCH=['schemaVersion','product','tenantId','reviewerSubject','reviewerProvider',
 'proofEnvelopeId','scriptIntentId','signedScriptMediaEvidenceId','orderedMediaManifestSha256',
 'originalMediaCount','copySha256','channelService','channelId','dispatchIntentId',
 'bindingSha256','signedDispatchIntentSha256','reviewedAt','expiresAt','nonce'];
function issuerFixture(){
 const f=fixture(),manifest=h('BCI_CONTENT_ORDERED_MEDIA_V3\n'+
   JSON.stringify(f.mediaBytes.map((bytes,i)=>[i+1,h(bytes)])));
 const script=f.receipt.script.payload;
 const scriptBytes=Buffer.from('BROS_CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_V1\n'+
   JSON.stringify(SCRIPT.map(k=>script[k])));
 const evidence='content-instance-script-signed-'+h(Buffer.concat([
   scriptBytes,Buffer.from(f.receipt.script.signature,'base64url')]));
 const dispatchIntentId='content-v3-dispatch';
 const bindingHash=h('BCI_CONTENT_SCRIPT_DISPATCH_BINDING_V3\\n'+JSON.stringify([
   script.proofEnvelopeId,script.scriptIntentId,evidence,manifest,2,
   script.copySha256,script.channelService,script.channelId,tenantId,reviewer]));
 const intentHash=h('BCI_CONTENT_SCRIPT_DISPATCH_INTENT_V3\\n'+
   JSON.stringify([dispatchIntentId,bindingHash]));
 const d={schemaVersion:3,product:'content',tenantId,reviewerSubject:reviewer,
   reviewerProvider:'neon-auth',proofEnvelopeId:script.proofEnvelopeId,
   scriptIntentId:script.scriptIntentId,signedScriptMediaEvidenceId:evidence,
   orderedMediaManifestSha256:manifest,originalMediaCount:2,
   copySha256:script.copySha256,channelService:script.channelService,
   channelId:script.channelId,dispatchIntentId,bindingSha256:bindingHash,
   signedDispatchIntentSha256:intentHash,reviewedAt:t2,expiresAt:exp,
   nonce:'c'.repeat(32)};
 const bytes=Buffer.from('BROS_CONTENT_COMPLETE_DISPATCH_ADMISSION_V3\n'+
   JSON.stringify(DISPATCH.map(k=>d[k])));
 f.receipt.dispatch={schemaVersion:3,keyId:'human-key',payload:d,
   signature:sign(null,bytes,privateKey).toString('base64url')};
 return f;
}
function issuerSetup({authorized=true,sourceValid=true,roleValid=true}={}){
 let writes=0,reads=0,row;
 const tx=async fn=>fn(async(sql,p)=>{
   if(sql.includes('AS "sessionRole"'))return {rows:[{role:'bci_dev_content_approval_issuer',
     sessionRole:roleValid?'bci_dev_content_approval_issuer':'admin',
     canLogin:true,bypass:false,inherits:false,superuser:false,createRole:false,
     createDb:false,parents:0,db:'bros_intelligence_dev'}]};
   if(sql.includes('AS "members"'))return {rows:[{members:1,reviewers:authorized?1:0}]};
   if(sql.includes('clock_timestamp()'))return {rows:[{now:new Date(now)}]};
   if(sql.startsWith('INSERT')){
     writes++;
     row={approvalId:p[0],tenantId:p[1],product:'content',dispatchIntentId:p[2],
       approvedBy:p[3],bindingSha256:p[4],approvedAt:new Date(p[5]),
       expiresAt:new Date(p[6]),signedProofVersion:p[7],signedReviewEvidenceId:p[8],
       originalMediaSha256:p[9],originalMediaCount:p[10],
       signedDispatchIntentSha256:p[11],reviewDigest:h(p[12]),
       admissionDigest:h(p[13]),signedAdmissionNonce:p[16],
       scriptProofEnvelopeId:p[17],signedScriptMediaEvidenceId:p[18],
       orderedMediaManifestSha256:p[19],scriptReviewDigest:h(p[20]),
       scriptDispatchBindingSha256:p[22]};
     return {rows:[{approval_id:p[0]}]};
   }
   if(sql.startsWith('SELECT approval_id')){reads++;return {rows:row?[row]:[]};}
   return {rows:[{}]};
 });
 const issuer=createBciContentTrustedIssuer({
   trustedPublicKeys:new Map([['human-key',publicKey]]),
   authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
   readReviewerAuthority:async()=>({principalId:reviewer,tenantId,product:'content',
     memberActive:true,reviewerAuthorized:authorized,revokedAt:null}),
   recomputeOriginalMedia:async()=>{throw Error('V2 downgrade forbidden');},
   verifyContentSourceContext:async()=>false,
   verifyCompleteScriptSourceContext:async()=>sourceValid,
   writeTransaction:tx,readTransaction:tx,now:()=>now
 });
 return {issuer,get writes(){return writes;},get reads(){return reads;}};
}
test('V3 real Ed25519 complete-dispatch issuance reaches restricted append and separate readback (offline mocks)',async()=>{
 const s=issuerSetup(),r=await s.issuer.issueScript(issuerFixture());
 assert.equal(r.status,'BCI_CONTENT_V3_APPROVAL_COMMITTED');
 assert.equal(r.committedReadback,true);
 assert.equal(r.executionAllowed,false);
 assert.equal(s.writes,1);assert.equal(s.reads,2);
});
test('V3 altered signed dispatch, source, reviewer and physical role fail closed before durable approval',async()=>{
 for(const variant of ['signature','channel','source','reviewer','role']){
   const f=issuerFixture();
   if(variant==='signature')f.receipt.dispatch.signature=f.receipt.script.signature;
   if(variant==='channel')f.receipt.dispatch.payload.channelId='different';
   const s=issuerSetup({sourceValid:variant!=='source',
     authorized:variant!=='reviewer',roleValid:variant!=='role'});
   await assert.rejects(s.issuer.issueScript(f),/BCI_CONTENT_TRUSTED_ISSUER_DENIED/);
   assert.equal(s.writes,variant==='role'?0:0);
 }
});
