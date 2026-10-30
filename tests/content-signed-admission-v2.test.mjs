import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {contentSignedReviewSigningBytes} from '../lib/content/signed-editorial-decision.mjs';
import {prepareContentAdmissionV2Payload as prepare,
  contentAdmissionV2SigningBytes as signingBytes,
  verifyContentAdmissionV2 as verify} from '../lib/content/signed-admission-v2.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const keys=new Map([['pilot-key-v1',publicKey]]);
const H=x=>'content-'+x+'-'+'a'.repeat(64);
const checks=['VERIFY_EACH_IMAGE_VISUALLY_AND_INDEPENDENTLY',
 'VERIFY_CAPTION_ALT_TEXT_AND_IMAGE_SEMANTIC_ALIGNMENT',
 'VERIFY_CLAIM_SOURCES_AND_BRAND_POLICY',
 'VERIFY_AI_DISCLOSURE_AND_PLATFORM_REQUIREMENTS',
 'VERIFY_CONTENT_SPECIFIC_AUTHENTICATED_APPROVAL',
 'VERIFY_PUBLISHER_CHANNEL_CAPABILITY_AND_PERMISSION'];
const now=Date.parse('2026-10-31T07:30:00.000Z');
const sha=x=>createHash('sha256').update(x).digest('hex');
const handoff=()=>({product:'content',status:'LOCAL_MEDIA_EDITORIAL_REVIEW_PENDING',
 tenantId:'22222222-2222-4222-8222-222222222222',instanceId:'content-pilot',
 planId:H('plan'),mediaSetId:H('media'),approvalRequestId:H('review'),
 reviewPacketId:H('editorial'),handoffId:H('local-editorial'),
 requiredHumanChecks:checks,automatedReviewFlags:[],approvalGranted:false,executionAllowed:false});
function setup(){
 const h=handoff(),bytes=Buffer.alloc(64,42);
 const p={schemaVersion:1,product:'content',tenantId:h.tenantId,
   instanceId:h.instanceId,planId:h.planId,mediaSetId:h.mediaSetId,
   approvalRequestId:h.approvalRequestId,reviewPacketId:h.reviewPacketId,
   handoffId:h.handoffId,reviewerSubject:'11111111-1111-4111-8111-111111111111',
   reviewerProvider:'neon-auth',reviewedAt:'2026-10-31T07:29:00.000Z',
   expiresAt:'2026-10-31T08:30:00.000Z',nonce:'b'.repeat(32),
   decision:'APPROVE',checkResults:checks.map(check=>({check,passed:true}))};
 const editorial={schemaVersion:1,keyId:'pilot-key-v1',payload:p,
   signature:sign(null,contentSignedReviewSigningBytes(p),privateKey).toString('base64url')};
 const media={originalMedia:{handoffId:h.handoffId,reviewPacketId:h.reviewPacketId,
   mediaSetId:h.mediaSetId,originalMediaSha256:sha(bytes),mediaCount:1},mediaBytes:bytes};
 const dispatch={tenantId:h.tenantId,instanceId:h.instanceId,planId:h.planId,
   mediaSetId:h.mediaSetId,approvalRequestId:h.approvalRequestId,
   providerOrganizationId:'a'.repeat(24),channelId:'channel-1',
   copySha256:'c'.repeat(64),dispatchIntentId:H('buffer-dispatch'),
   status:'ATOMIC_RESERVATION_AND_APPROVAL_REQUIRED',reviewFlags:[],
   executionAllowed:false};
 const payload=prepare(h,editorial,media,dispatch,keys,'d'.repeat(32),now);
 const attestation={schemaVersion:2,keyId:'pilot-key-v1',payload,
   signature:sign(null,signingBytes(payload),privateKey).toString('base64url')};
 return {h,editorial,media,dispatch,attestation};
}
const denied=/CONTENT_SIGNED_ADMISSION_V2_DENIED/;
test('V1 review + separately signed V2 media/intent produces exact NONAUTHORIZING BCI verified shape',()=>{
 const x=setup(),out=verify(x.h,x.editorial,x.media,x.dispatch,x.attestation,keys,now);
 assert.equal(out.status,'SIGNED_ADMISSION_V2_VERIFIED_NONAUTHORIZING');
 assert.equal(out.verified.signedDecision,'APPROVE');
 assert.equal(out.verified.mediaCount,1);
 assert.equal(out.verified.originalMediaSha256,sha(x.media.mediaBytes));
 assert.equal(out.verified.signedDispatchIntentSha256,x.attestation.payload.signedDispatchIntentSha256);
 assert.deepEqual(Object.keys(out.verified),['product','tenantId','reviewerSubject',
  'reviewerProvider','signedDecision','signatureVerified','signedReviewEvidenceId',
  'expiresAt','handoffId','reviewPacketId','mediaSetId','originalMediaSha256',
  'mediaCount','signedDispatchIntentSha256']);
 for(const k of ['approvalGranted','durableApprovalRecorded','providerSent',
   'executionAllowed','customerSaasReady'])assert.equal(out[k],false);
 assert.notEqual(out.mediaBytes,x.media.mediaBytes);
});
test('changed original bytes, count, copy, plan, provider, channel or intent deny',()=>{
 const x=setup();
 for(const [media,dispatch] of [
   [{...x.media,mediaBytes:Buffer.alloc(64,10)},x.dispatch],
   [{...x.media,originalMedia:{...x.media.originalMedia,mediaCount:2}},x.dispatch],
   [x.media,{...x.dispatch,copySha256:'e'.repeat(64)}],
   [x.media,{...x.dispatch,planId:H('other')}],
   [x.media,{...x.dispatch,providerOrganizationId:'b'.repeat(24)}],
   [x.media,{...x.dispatch,channelId:'channel-2'}],
   [x.media,{...x.dispatch,dispatchIntentId:H('replay')}]
 ])assert.throws(()=>verify(x.h,x.editorial,media,dispatch,x.attestation,keys,now),denied);
});
test('V2 cannot be forged by injecting digest or skipping signature, reviewer key, or expiry',()=>{
 const x=setup();
 for(const a of [
   {...x.attestation,payload:{...x.attestation.payload,originalMediaSha256:'e'.repeat(64)}},
   {...x.attestation,payload:{...x.attestation.payload,signedDispatchIntentSha256:'e'.repeat(64)}},
   {...x.attestation,payload:{...x.attestation.payload,mediaCount:2}},
   {...x.attestation,keyId:'unknown'},
   {...x.attestation,signature:'A'.repeat(86)},
   {...x.attestation,approvalGranted:true}
 ])assert.throws(()=>verify(x.h,x.editorial,x.media,x.dispatch,a,keys,now),denied);
 assert.throws(()=>verify(x.h,x.editorial,x.media,x.dispatch,x.attestation,keys,
   Date.parse('2026-10-31T08:30:00.000Z')),denied);
});
test('V1 review identity is fixed before V2 signing; rejected review never accepted',()=>{
 const x=setup();
 const p={...x.editorial.payload,decision:'REJECT'};
 const editorial={...x.editorial,payload:p,
   signature:sign(null,contentSignedReviewSigningBytes(p),privateKey).toString('base64url')};
 assert.throws(()=>prepare(x.h,editorial,x.media,x.dispatch,keys,'d'.repeat(32),now),denied);
 assert.throws(()=>verify(x.h,editorial,x.media,x.dispatch,x.attestation,keys,now),denied);
});
test('mutable or malformed input and unreviewed media cannot acquire authority',()=>{
 const x=setup();
 assert.throws(()=>prepare({...x.h,automatedReviewFlags:['CLAIM_UNVERIFIED']},
   x.editorial,x.media,x.dispatch,keys,'d'.repeat(32),now),denied);
 assert.throws(()=>verify(x.h,x.editorial,x.media,
   {...x.dispatch,reviewFlags:['CAPABILITY_UNVERIFIED']},x.attestation,keys,now),denied);
 assert.throws(()=>verify(x.h,x.editorial,x.media,x.dispatch,
   {...x.attestation,payload:{...x.attestation.payload,nonce:'bad'}},keys,now),denied);
 assert.throws(()=>verify(x.h,x.editorial,x.media,x.dispatch,x.attestation,
   new Map([['pilot-key-v1',generateKeyPairSync('ed25519').publicKey]]),now),denied);
});
