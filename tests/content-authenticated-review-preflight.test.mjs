import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {contentSignedReviewSigningBytes} from '../lib/content/signed-editorial-decision.mjs';
import {prepareContentAuthenticatedReviewPreflight as prepare} from '../lib/content/authenticated-review-preflight.mjs';
const reviewer='11111111-1111-4111-8111-111111111111';
const tenant='22222222-2222-4222-8222-222222222222';
const H=x=>'content-'+x+'-'+'a'.repeat(64);
const checks=['VERIFY_EACH_IMAGE_VISUALLY_AND_INDEPENDENTLY',
 'VERIFY_CAPTION_ALT_TEXT_AND_IMAGE_SEMANTIC_ALIGNMENT',
 'VERIFY_CLAIM_SOURCES_AND_BRAND_POLICY',
 'VERIFY_AI_DISCLOSURE_AND_PLATFORM_REQUIREMENTS',
 'VERIFY_CONTENT_SPECIFIC_AUTHENTICATED_APPROVAL',
 'VERIFY_PUBLISHER_CHANNEL_CAPABILITY_AND_PERMISSION'];
const handoff=()=>({product:'content',status:'LOCAL_MEDIA_EDITORIAL_REVIEW_PENDING',
 tenantId:tenant,instanceId:'content-pilot',planId:H('plan'),mediaSetId:H('media'),
 approvalRequestId:H('review'),reviewPacketId:H('editorial'),handoffId:H('local-editorial'),
 requiredHumanChecks:checks,approvalGranted:false,executionAllowed:false});
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const trusted=new Map([['review-key',publicKey]]);
const now=Date.parse('2026-10-29T07:00:00.000Z');
const payload=(h=handoff())=>({schemaVersion:1,product:'content',tenantId:h.tenantId,
 instanceId:h.instanceId,planId:h.planId,mediaSetId:h.mediaSetId,
 approvalRequestId:h.approvalRequestId,reviewPacketId:h.reviewPacketId,handoffId:h.handoffId,
 reviewerSubject:reviewer,reviewerProvider:'neon-auth',
 reviewedAt:'2026-10-29T06:59:00.000Z',expiresAt:'2026-10-29T08:00:00.000Z',
 nonce:'c'.repeat(32),decision:'APPROVE',
 checkResults:checks.map(check=>({check,passed:true}))});
const receipt=p=>({schemaVersion:1,keyId:'review-key',payload:p,
 signature:sign(null,contentSignedReviewSigningBytes(p),privateKey).toString('base64url')});
const deps=()=>({authenticateReviewer:async()=>({userId:reviewer,authenticated:true}),
 membershipsFor:async(id,product)=>[{principalId:id,tenantId:tenant,product,active:true}]});
test('signed review + server-scoped membership match remains NONEXECUTING preflight',async()=>{
 const h=handoff(),r=receipt(payload(h)),a=await prepare(h,r,trusted,deps(),now);
 assert.equal(a.serverPrincipalAndMembershipMatched,true);
 assert.equal(a.status,'AUTHORITY_MATCHED_REVIEW_PREFLIGHT_ONLY');
 for(const k of ['reviewerAuthenticatedByThisModule','visualEditorialQaVerified','approvalGranted',
 'durableApprovalRecorded','atomicReservationVerified','providerSentVerified',
 'measurementVerified','sharedBciAuditVerified','executionAllowed','customerSaasReady'])
   assert.equal(a[k],false,k);
 assert.equal((await prepare(h,r,trusted,deps(),now)).signedReviewEvidenceId,a.signedReviewEvidenceId);
});
test('rejects impostor, cross-tenant, cross-product, revoked, duplicate or absent membership',async()=>{
 const h=handoff(),r=receipt(payload(h));
 const mutations=[
  {...deps(),authenticateReviewer:async()=>({userId:'33333333-3333-4333-8333-333333333333',authenticated:true})},
  {...deps(),membershipsFor:async()=>[{principalId:reviewer,tenantId:'33333333-3333-4333-8333-333333333333',product:'content',active:true}]},
  {...deps(),membershipsFor:async()=>[{principalId:reviewer,tenantId:tenant,product:'demand',active:true}]},
  {...deps(),membershipsFor:async()=>[{principalId:reviewer,tenantId:tenant,product:'content',active:false}]},
  {...deps(),membershipsFor:async()=>[]},
  {...deps(),membershipsFor:async()=>[...await deps().membershipsFor(reviewer,'content'),...await deps().membershipsFor(reviewer,'content')]},
  {...deps(),authenticateReviewer:async()=>({userId:reviewer,authenticated:true,role:'admin'})},
 ];
 for(const d of mutations)await assert.rejects(prepare(h,r,trusted,d,now),/CONTENT_REVIEW_AUTHORITY_PREFLIGHT_DENIED/);
});
test('rejects REJECT decision, forged receipt, expired signature and untrusted reviewer provider',async()=>{
 const h=handoff(),p=payload(h),r=receipt(p);
 const reject=payload(h);reject.decision='REJECT';
 await assert.rejects(prepare(h,receipt(reject),trusted,deps(),now),/PREFLIGHT_DENIED/);
 await assert.rejects(prepare(h,{...r,payload:{...p,reviewerSubject:'44444444-4444-4444-8444-444444444444'}},trusted,deps(),now),/PREFLIGHT_DENIED/);
 await assert.rejects(prepare(h,r,trusted,deps(),Date.parse('2026-10-29T08:00:00.000Z')),/PREFLIGHT_DENIED/);
 const other=payload(h);other.reviewerProvider='other-provider';
 await assert.rejects(prepare(h,receipt(other),trusted,deps(),now),/PREFLIGHT_DENIED/);
});
test('missing auth, failed membership read and caller-supplied authority fields fail closed',async()=>{
 const h=handoff(),r=receipt(payload(h));
 await assert.rejects(prepare(h,r,trusted,{},now),/PREFLIGHT_DENIED/);
 await assert.rejects(prepare(h,r,trusted,{...deps(),tenantId:tenant},now),/PREFLIGHT_DENIED/);
 await assert.rejects(prepare(h,r,trusted,{...deps(),authenticateReviewer:async()=>null},now),/PREFLIGHT_DENIED/);
 await assert.rejects(prepare(h,r,trusted,{...deps(),membershipsFor:async()=>{throw Error('database secrets')}} ,now),/PREFLIGHT_DENIED/);
});
