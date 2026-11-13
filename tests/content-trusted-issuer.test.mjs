import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createBciContentTrustedIssuer} from '../lib/bci/content-trusted-issuer.mjs';
const h=x=>createHash('sha256').update(x).digest('hex');
const V1=['schemaVersion','product','tenantId','instanceId','planId','mediaSetId',
 'approvalRequestId','reviewPacketId','handoffId','reviewerSubject','reviewerProvider',
 'reviewedAt','expiresAt','nonce','decision','checkResults'];
const V2=['schemaVersion','product','tenantId','instanceId','handoffId',
 'reviewPacketId','mediaSetId','signedReviewEvidenceId','originalMediaSha256',
 'mediaCount','dispatchIntentId','signedDispatchIntentSha256','reviewerSubject',
 'reviewerProvider','reviewedAt','expiresAt','nonce'];
const tenantId='22222222-2222-4222-8222-222222222222';
const reviewer='11111111-1111-4111-8111-111111111111';
const time='2026-11-03T03:00:00.000Z';
const approved='2026-11-03T02:59:00.000Z';
const expires='2026-11-03T04:00:00.000Z';
const mediaBytes=Buffer.alloc(64,42); // MOCK source, NOT an actual PNG acceptance.
const digest=h(mediaBytes);
const media={handoffId:'content-handoff',reviewPacketId:'content-review',
 mediaSetId:'content-media',originalMediaSha256:digest,mediaCount:1};
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
function receipt(version,payload,fields,domain){
 const bytes=Buffer.from(domain+'\n'+JSON.stringify(fields.map(k=>payload[k])));
 return {schemaVersion:version,keyId:'content-human-key',payload,
  signature:sign(null,bytes,privateKey).toString('base64url')};
}
function fixture(){
 const p1={schemaVersion:1,product:'content',tenantId,instanceId:'instance-1',
  planId:'content-plan',mediaSetId:media.mediaSetId,
  approvalRequestId:'content-request',reviewPacketId:media.reviewPacketId,
  handoffId:media.handoffId,reviewerSubject:reviewer,reviewerProvider:'neon-auth',
  reviewedAt:approved,expiresAt:expires,nonce:'a'.repeat(32),decision:'APPROVE',
  checkResults:[{check:'HUMAN_MEDIA_QA',passed:true}]};
 const editorial=receipt(1,p1,V1,'BROS_CONTENT_SIGNED_REVIEW_V1');
 const reviewBytes=Buffer.from('BROS_CONTENT_SIGNED_REVIEW_V1\n'+JSON.stringify(V1.map(k=>p1[k])));
 const signedReviewEvidenceId='content-signed-review-'+h(Buffer.concat([
  reviewBytes,Buffer.from(editorial.signature,'base64url')]));
 const binding={reviewPacketId:media.reviewPacketId,handoffId:media.handoffId,
  signedReviewEvidenceId,planId:p1.planId,mediaSetId:media.mediaSetId,
  copySha256:'c'.repeat(64),providerOrganizationId:'org-1',channelId:'channel-1'};
 const keys=['reviewPacketId','handoffId','signedReviewEvidenceId','planId',
  'mediaSetId','copySha256','providerOrganizationId','channelId'];
 const bindingHash=h(JSON.stringify(keys.map(k=>binding[k])));
 const dispatchIntentId='content-intent';
 const signedDispatchIntentSha256=h('BCI_CONTENT_DISPATCH_INTENT_V1\n'+
  JSON.stringify([dispatchIntentId,bindingHash]));
 const p2={schemaVersion:2,product:'content',tenantId,instanceId:p1.instanceId,
  handoffId:media.handoffId,reviewPacketId:media.reviewPacketId,
  mediaSetId:media.mediaSetId,signedReviewEvidenceId,
  originalMediaSha256:digest,mediaCount:1,dispatchIntentId,
  signedDispatchIntentSha256,reviewerSubject:reviewer,reviewerProvider:'neon-auth',
  reviewedAt:approved,expiresAt:expires,nonce:'b'.repeat(32)};
 const admission=receipt(2,p2,V2,'BROS_CONTENT_SIGNED_ADMISSION_V2');
 return {dispatchIntentId,binding,mediaBytes,
  receipt:{editorial,admission}};
}
const role={role:'bci_dev_content_approval_issuer',sessionRole:'bci_dev_content_approval_issuer',
 canLogin:true,bypass:false,inherits:false,superuser:false,createRole:false,
 createDb:false,parents:0,db:'bros_intelligence_dev'};
function setup(opts={}){
 const calls=[];const inserts=[];let row;
 const tx=async fn=>fn(async(sql,params)=>{
  calls.push(sql);
  if(sql.includes('AS "sessionRole"'))return {rows:[opts.role??role]};
  if(sql.includes('AS "members"'))return {rows:[{members:opts.members??1,reviewers:opts.reviewers??1}]};
  if(sql.includes('clock_timestamp()'))return {rows:[{now:new Date(time)}]};
  if(sql.startsWith('INSERT')){
   inserts.push(params);
   row={approvalId:params[0],tenantId:params[1],product:'content',
    dispatchIntentId:params[2],approvedBy:params[3],bindingSha256:params[4],
    approvedAt:new Date(params[5]),expiresAt:new Date(params[6]),
    signedProofVersion:params[7],signedReviewEvidenceId:params[8],
    originalMediaSha256:params[9],originalMediaCount:params[10],
    signedDispatchIntentSha256:params[11],reviewDigest:h(params[12]),
    admissionDigest:h(params[13]),signedAdmissionNonce:params[16]};
   return {rows:[{approval_id:params[0]}]};
  }
  if(sql.startsWith('SELECT approval_id'))return {rows:row?[row]:[]};
  return {rows:[{}]};
 });
 const issuer=createBciContentTrustedIssuer({
  trustedPublicKeys:new Map([['content-human-key',publicKey]]),
  authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
  readReviewerAuthority:async()=>({principalId:reviewer,tenantId,
   product:'content',memberActive:true,reviewerAuthorized:true,revokedAt:null}),
  recomputeOriginalMedia:async()=>media,
  verifyContentSourceContext:async(pinned,mediaBytes)=>
    typeof opts.sourceValid==='function'?opts.sourceValid(pinned,mediaBytes):opts.sourceValid??true,
  writeTransaction:tx,readTransaction:tx,now:()=>Date.parse(time)});
 return {issuer,calls,inserts};
}
test('real Ed25519 V1+V2 signed proof checked before restricted append and readback (offline mocks)',async()=>{
 const x=setup();const result=await x.issuer.issue(fixture());
 assert.equal(result.status,'BCI_CONTENT_APPROVAL_COMMITTED');
 assert.equal(result.committedReadback,true);assert.equal(result.providerSent,false);
 assert.equal(x.calls.filter(s=>s.startsWith('INSERT')).length,1);
 assert.equal(x.calls.filter(s=>s.startsWith('SELECT approval_id')).length,2);
});
test('tampered editorial/V2 signature, reviewer, media and destination deny before INSERT',async()=>{
 const changes=[
  f=>{f.receipt.editorial.payload.decision='REJECT';},
  f=>{f.receipt.admission.payload.originalMediaSha256='f'.repeat(64);},
  f=>{f.receipt.admission.payload.reviewerSubject='33333333-3333-4333-8333-333333333333';},
  f=>{f.binding.channelId='different';},
  f=>{f.receipt.admission.signature=f.receipt.editorial.signature;},
  f=>{f.receipt.admission.payload.mediaCount=2;},
  f=>{f.receipt.admission.payload.nonce='a'.repeat(32);}
 ];
 for(const mutate of changes){const f=fixture(),x=setup();mutate(f);
  await assert.rejects(x.issuer.issue(f),/BCI_CONTENT_TRUSTED_ISSUER_DENIED/);
  assert.equal(x.calls.some(s=>s.startsWith('INSERT')),false);
 }
});
test('revoked reviewer and admin role cannot insert even with cryptographic signatures',async()=>{
 for(const options of [{reviewers:0},{members:0},{role:{...role,sessionRole:'BROS'}}]){
  const x=setup(options);
  await assert.rejects(x.issuer.issue(fixture()),/BCI_CONTENT_TRUSTED_ISSUER_DENIED/);
  assert.equal(x.calls.some(s=>s.startsWith('INSERT')),false);
 }
});
test('script or carousel cannot borrow single-image signed proof',async()=>{
 for(const patch of [{format:'script'},{mediaCount:2}]){
  const f=fixture();f.receipt.admission.payload={...f.receipt.admission.payload,...patch};
  const x=setup();await assert.rejects(x.issuer.issue(f),/BCI_CONTENT_TRUSTED_ISSUER_DENIED/);
  assert.equal(x.calls.some(s=>s.startsWith('INSERT')),false);
 }
});
test('missing genuine source/PNG/editorial context holds issuance even with valid signatures',async()=>{
 const x=setup({sourceValid:false});
 await assert.rejects(x.issuer.issue(fixture()),/BCI_CONTENT_TRUSTED_ISSUER_DENIED/);
 assert.equal(x.calls.some(s=>s.startsWith('INSERT')),false);
});

test('even a genuinely signed V2 receipt cannot name a different dispatch intent',async()=>{
 const f=fixture();
 f.receipt.admission=receipt(2,{...f.receipt.admission.payload,
  dispatchIntentId:'different-intent'},V2,'BROS_CONTENT_SIGNED_ADMISSION_V2');
 const x=setup();
 await assert.rejects(x.issuer.issue(f),/BCI_CONTENT_TRUSTED_ISSUER_DENIED/);
 assert.equal(x.calls.some(s=>s.startsWith('INSERT')),false);
});

// A CONTENT-owned callback must not be able to rewrite BCI's already-signed
// immutable ledger payload after Ed25519 admission. Offline isolation test.
test('async source verifier receives isolated proof and original-media copies',async()=>{
 const f=fixture();
 const originalEditorial=JSON.stringify(f.receipt.editorial);
 const originalAdmission=JSON.stringify(f.receipt.admission);
 const originalMediaDigest=h(f.mediaBytes);
 const x=setup({sourceValid:async(pinned,bytes)=>{
  pinned.receipt.editorial.payload.reviewedAt='2026-11-03T02:58:00.000Z';
  pinned.receipt.admission.payload.expiresAt='2026-11-03T05:00:00.000Z';
  pinned.receipt.admission.payload.nonce='c'.repeat(32);
  pinned.binding.channelId='changed-after-signature';
  bytes.fill(1);
  return true;
 }});
 const result=await x.issuer.issue(f);
 assert.equal(result.status,'BCI_CONTENT_APPROVAL_COMMITTED');
 assert.equal(x.inserts.length,1);
 const params=x.inserts[0];
 assert.equal(params[5],approved);
 assert.equal(params[6],expires);
 assert.equal(params[12],originalEditorial);
 assert.equal(params[13],originalAdmission);
 assert.equal(params[16],'b'.repeat(32));
 assert.equal(h(f.mediaBytes),originalMediaDigest);
});
