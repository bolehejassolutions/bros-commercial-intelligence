import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {contentSignedReviewSigningBytes,verifyContentSignedEditorialDecision as check} from '../lib/content/signed-editorial-decision.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const keys=new Map([['pilot-key-v1',publicKey]]);
const H=x=>'content-'+x+'-'+'a'.repeat(64);
const checks=['VERIFY_EACH_IMAGE_VISUALLY_AND_INDEPENDENTLY',
 'VERIFY_CAPTION_ALT_TEXT_AND_IMAGE_SEMANTIC_ALIGNMENT',
 'VERIFY_CLAIM_SOURCES_AND_BRAND_POLICY',
 'VERIFY_AI_DISCLOSURE_AND_PLATFORM_REQUIREMENTS',
 'VERIFY_CONTENT_SPECIFIC_AUTHENTICATED_APPROVAL',
 'VERIFY_PUBLISHER_CHANNEL_CAPABILITY_AND_PERMISSION'];
const handoff=()=>({product:'content',status:'LOCAL_MEDIA_EDITORIAL_REVIEW_PENDING',
 tenantId:'tenant-internal',instanceId:'content-pilot',planId:H('plan'),mediaSetId:H('media'),
 approvalRequestId:H('review'),reviewPacketId:H('editorial'),handoffId:H('local-editorial'),
 requiredHumanChecks:checks,approvalGranted:false,executionAllowed:false});
const now=Date.parse('2026-10-29T07:00:00.000Z');
const payload=(h=handoff())=>({schemaVersion:1,product:'content',tenantId:h.tenantId,
 instanceId:h.instanceId,planId:h.planId,mediaSetId:h.mediaSetId,
 approvalRequestId:h.approvalRequestId,reviewPacketId:h.reviewPacketId,handoffId:h.handoffId,
 reviewerSubject:'reviewer-123',reviewerProvider:'supabase',
 reviewedAt:'2026-10-29T06:59:00.000Z',expiresAt:'2026-10-29T08:00:00.000Z',
 nonce:'b'.repeat(32),decision:'APPROVE',checkResults:checks.map(check=>({check,passed:true}))});
const receipt=p=>({schemaVersion:1,keyId:'pilot-key-v1',payload:p,
 signature:sign(null,contentSignedReviewSigningBytes(p),privateKey).toString('base64url')});
test('valid Ed25519 review evidence binds exact handoff but NEVER grants approval/publishing',()=>{
 const h=handoff(),r=receipt(payload(h)),a=check(h,r,keys,now);
 assert.equal(a.signatureVerified,true);
 assert.equal(a.signedDecision,'APPROVE');
 assert.equal(a.status,'SIGNED_REVIEW_EVIDENCE_ONLY');
 assert.equal(check(h,r,keys,now).signedReviewEvidenceId,a.signedReviewEvidenceId);
 for(const k of ['reviewerAuthenticated','reviewerRoleVerified','tenantMembershipVerified',
 'visualEditorialQaVerified','approvalGranted','durableApprovalRecorded',
 'atomicReservationVerified','providerSentVerified','measurementVerified',
 'sharedBciAuditVerified','executionAllowed','customerSaasReady'])assert.equal(a[k],false,k);
});
test('tampered reviewer, copy-bound identity, scope, key, signature and authority flags fail closed',()=>{
 const h=handoff(),r=receipt(payload(h));
 for(const patch of [{reviewerSubject:'impostor'},{approvalRequestId:H('other')},
   {tenantId:'other-tenant'},{decision:'REJECT'}])
   assert.throws(()=>check(h,{...r,payload:{...r.payload,...patch}},keys,now),
     /SIGNATURE_INVALID|SCOPE_MISMATCH/);
 assert.throws(()=>check({...h,approvalGranted:true},r,keys,now),/INVALID_HANDOFF_STATE/);
 assert.throws(()=>check(h,{...r,keyId:'unknown-key'},keys,now),/TRUST_ANCHOR_MISSING/);
 assert.throws(()=>check(h,r,new Map([['pilot-key-v1',generateKeyPairSync('ed25519').publicKey]]),now),/SIGNATURE_INVALID/);
 assert.throws(()=>check(h,{...r,approvalGranted:true},keys,now),/INVALID_CONTENT_SIGNED_RECEIPT/);
});
test('expired, future, unresolved human checks and invalid dates are rejected',()=>{
 const h=handoff();
 assert.throws(()=>check(h,receipt(payload(h)),keys,Date.parse('2026-10-29T08:00:00.000Z')), /EXPIRED/);
 const future=payload(h);future.reviewedAt='2026-10-29T08:00:00.000Z';
 assert.throws(()=>check(h,receipt(future),keys,now),/EXPIRED/);
 const fail=payload(h);fail.checkResults[0].passed=false;
 assert.throws(()=>check(h,receipt(fail),keys,now),/CHECKS_UNRESOLVED/);
 const invalid=payload(h);invalid.expiresAt='2026-02-30T00:00:00.000Z';
 assert.throws(()=>check(h,receipt(invalid),keys,now),/INVALID_CONTENT_SIGNED_REVIEW_FIELDS/);
});
test('signed REJECT can record failed checks but cannot authorize publishing',()=>{
 const h=handoff(),p=payload(h);p.decision='REJECT';p.checkResults[1].passed=false;
 const a=check(h,receipt(p),keys,now);
 assert.equal(a.signedDecision,'REJECT');assert.equal(a.executionAllowed,false);
});
test('accessor, duplicate check, untrusted key type and forged signature fail closed',()=>{
 const h=handoff(),p=payload(h),r=receipt(p);
 const getter={...p};Object.defineProperty(getter,'decision',{get(){throw Error('EXECUTED');}});
 assert.throws(()=>check(h,{...r,payload:getter},keys,now),/INVALID_CONTENT_SIGNED_REVIEW_PAYLOAD/);
 const duplicate=payload(h);duplicate.checkResults[1]={...duplicate.checkResults[0]};
 assert.throws(()=>check(h,receipt(duplicate),keys,now),/CHECKS_UNRESOLVED/);
 const badSig={...r,signature:'A'.repeat(86)};
 assert.throws(()=>check(h,badSig,keys,now),/SIGNATURE_INVALID/);
 assert.throws(()=>check(h,r,new Map([['pilot-key-v1',privateKey]]),now),/TRUST_ANCHOR_MISSING/);
});
