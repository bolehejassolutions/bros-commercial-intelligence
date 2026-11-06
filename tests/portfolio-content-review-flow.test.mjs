import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey,createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createContentReviewSourceStore} from '../lib/portfolio/content-review-source.mjs';
import {createContentReviewerKey,signContentReviewDecision,SCRIPT_REVIEW_CHECKS} from '../lib/portfolio/content-review-signing.ts';
import {createNeonContentIssuanceService} from '../lib/bci/neon-content-issuance-service.ts';
import {createBciContentTrustedIssuer} from '../lib/bci/content-trusted-issuer.mjs';
import {createContentReservationHttpHandler} from '../lib/bci/neon-content-reservation-http.ts';
import {reserveContentV3Dispatch} from '../lib/content/bci-v3-reservation-client.mjs';
const root=resolve('content-review-sources'),entry=JSON.parse(readFileSync(join(root,'index.json'))).sources[0];
const reviewer='11111111-1111-4111-8111-111111111111'; // MOCK reviewer, never a real human approval.
const scope={principalId:reviewer,tenantId:entry.tenantId,product:'content'};
const hash=x=>createHash('sha256').update(x).digest('hex');
async function harness(){
  const source=await createContentReviewSourceStore(root).load(scope,entry.proofEnvelopeId);
  const key=await createContentReviewerKey(),keys=new Map([[key.keyId,createPublicKey(key.publicKeyPem)]]);
  let writes=0,row;
  const tx=async fn=>fn(async(sql,p)=>{
    if(sql.includes('AS "sessionRole"'))return {rows:[{role:'bci_dev_content_approval_issuer',sessionRole:'bci_dev_content_approval_issuer',
      canLogin:true,bypass:false,inherits:false,superuser:false,createRole:false,createDb:false,parents:0,db:'bros_intelligence_dev'}]};
    if(sql.includes('AS "members"'))return {rows:[{members:1,reviewers:1}]};
    if(sql.includes('clock_timestamp()'))return {rows:[{now:new Date()}]};
    if(sql.startsWith('INSERT')){writes++;row={approvalId:p[0],tenantId:p[1],product:'content',dispatchIntentId:p[2],approvedBy:p[3],
      bindingSha256:p[4],approvedAt:new Date(p[5]),expiresAt:new Date(p[6]),signedProofVersion:p[7],signedReviewEvidenceId:p[8],
      originalMediaSha256:p[9],originalMediaCount:p[10],signedDispatchIntentSha256:p[11],reviewDigest:hash(p[12]),
      admissionDigest:hash(p[13]),signedAdmissionNonce:p[16],scriptProofEnvelopeId:p[17],signedScriptMediaEvidenceId:p[18],
      orderedMediaManifestSha256:p[19],scriptReviewDigest:hash(p[20]),scriptDispatchBindingSha256:p[22]};return {rows:[{approval_id:p[0]}]};}
    if(sql.startsWith('SELECT approval_id'))return {rows:row?[row]:[]};return {rows:[{}]};
  });
  const issuer=createBciContentTrustedIssuer({trustedPublicKeys:keys,
    authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
    readReviewerAuthority:async()=>({principalId:reviewer,tenantId:scope.tenantId,product:'content',memberActive:true,reviewerAuthorized:true,revokedAt:null}),
    recomputeOriginalMedia:async()=>{throw Error('no image-only downgrade');},verifyContentSourceContext:async()=>false,
    verifyCompleteScriptSourceContext:source.verifyCompleteScriptSourceContext,writeTransaction:tx,readTransaction:tx,now:Date.now});
  const service=createNeonContentIssuanceService({authenticate:async()=>({userId:reviewer}),
    membershipsFor:async()=>[{...scope,active:true}],loadSource:async()=>source,createIssuer:()=>issuer});
  return {source,key,service,get writes(){return writes;}};
}
test('actual original PNGs + browser WebCrypto signatures -> real V3 issuer -> reservation contract (MOCK auth/DB/provider)',async()=>{
  const h=await harness();
  await assert.rejects(crypto.subtle.exportKey('pkcs8',h.key.privateKey));
  const receipt=await signContentReviewDecision(h.key,h.source.envelope,h.source.handoff,reviewer,
    [...h.source.handoff.requiredHumanChecks,...SCRIPT_REVIEW_CHECKS]);
  const issued=await h.service('mock.jwt.token',{proofEnvelopeId:entry.proofEnvelopeId,receipt});
  assert.equal(issued.status,'BCI_CONTENT_V3_APPROVAL_COMMITTED');assert.equal(h.writes,1);
  const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/neon-bci-dev-ledger-20261025',
    BCI_NEON_DEV_PRIVATE_READS:'enabled',BCI_NEON_DEV_CONTENT_RESERVATIONS:'enabled'};
  const reservationId='33333333-3333-4333-8333-333333333333';
  const handler=createContentReservationHttpHandler({env:()=>env,execute:async()=>({status:'acquired',reservationId})});
  const origin='https://bci.example.test';
  const reserved=await reserveContentV3Dispatch({origin,jwt:'mock.jwt.token',approval:{schemaVersion:3,
    status:'BCI_V3_APPROVAL_COMMITTED_AND_READ_BACK',dispatchIntentId:receipt.dispatch.payload.dispatchIntentId,
    approvalId:issued.approvalId,bindingSha256:receipt.dispatch.payload.bindingSha256,durableApprovalRecorded:true},
    fetchImpl:async(url,init)=>{const r=await handler(new Request(url,init));return {ok:r.ok,status:r.status,url,text:()=>r.text()};}});
  assert.equal(reserved.reservationId,reservationId);assert.equal(reserved.executionAllowed,false);
});
test('operator cannot sign without all checks; a modified script receipt cannot be persisted',async()=>{
  const h=await harness();
  await assert.rejects(signContentReviewDecision(h.key,h.source.envelope,h.source.handoff,reviewer,[]),/REVIEW_INCOMPLETE/);
  const receipt=await signContentReviewDecision(h.key,h.source.envelope,h.source.handoff,reviewer,
    [...h.source.handoff.requiredHumanChecks,...SCRIPT_REVIEW_CHECKS]);
  receipt.script.payload.copySha256='f'.repeat(64);
  await assert.rejects(h.service('mock.jwt.token',{proofEnvelopeId:entry.proofEnvelopeId,receipt}));assert.equal(h.writes,0);
});
test('build-owned source store refuses foreign scope, path selection and changed original bytes',async()=>{
  const store=createContentReviewSourceStore(root);
  await assert.rejects(store.load({...scope,tenantId:reviewer},entry.proofEnvelopeId));
  await assert.rejects(store.load(scope,'../../source.json'));
  const temporary=mkdtempSync(join(tmpdir(),'bros-content-source-'));
  try{cpSync(root,temporary,{recursive:true});
    const path=join(temporary,entry.directory,'content_card_01.png'),bytes=readFileSync(path);bytes[50]^=1;writeFileSync(path,bytes);
    await assert.rejects(createContentReviewSourceStore(temporary).load(scope,entry.proofEnvelopeId));
  }finally{rmSync(temporary,{recursive:true,force:true});}
});
