// CONTENT-only supplemental Ed25519 attestation for the single-image BCI pilot.
// V1 editorial receipt is immutable; V2 signs its evidence ID, ORIGINAL bytes,
// and complete dispatch intent separately to avoid signing its own signature hash.
// This is NONAUTHORIZING. BCI owns authenticated issuer, reviewer role and DB.
import {createHash,verify,KeyObject} from 'node:crypto';
import {verifyContentSignedEditorialDecision} from './signed-editorial-decision.mjs';

const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const keys=['schemaVersion','product','tenantId','instanceId','handoffId',
  'reviewPacketId','mediaSetId','signedReviewEvidenceId','originalMediaSha256',
  'mediaCount','dispatchIntentId','signedDispatchIntentSha256','reviewerSubject',
  'reviewerProvider','reviewedAt','expiresAt','nonce'];
const receiptKeys=['schemaVersion','keyId','payload','signature'];
const mediaKeys=['handoffId','reviewPacketId','mediaSetId','originalMediaSha256','mediaCount'];
const bindingKeys=['reviewPacketId','handoffId','signedReviewEvidenceId','planId',
  'mediaSetId','copySha256','providerOrganizationId','channelId'];
const deny=()=>{throw Error('CONTENT_SIGNED_ADMISSION_V2_DENIED');};
function exact(x,fields){
  return !!x&&typeof x==='object'&&!Array.isArray(x)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
    Reflect.ownKeys(x).length===fields.length&&Reflect.ownKeys(x).every(k=>{
      const d=Object.getOwnPropertyDescriptor(x,k);
      return typeof k==='string'&&fields.includes(k)&&d?.enumerable===true&&
        Object.hasOwn(d,'value');
    });
}
const sha=b=>createHash('sha256').update(b).digest('hex');
function signingBytes(p){
  if(!exact(p,keys))deny();
  return Buffer.from('BROS_CONTENT_SIGNED_ADMISSION_V2\n'+
    JSON.stringify(keys.map(k=>p[k])),'utf8');
}
export function contentAdmissionV2SigningBytes(payload){
  return signingBytes(payload);
}
function context(handoff,editorialReceipt,media,dispatch,trustedKeys,now){
  const review=verifyContentSignedEditorialDecision(
    handoff,editorialReceipt,trustedKeys,now);
  if(review.signedDecision!=='APPROVE'||
      !exact(media?.originalMedia,mediaKeys)||
      !Buffer.isBuffer(media.mediaBytes)||media.mediaBytes.length<32||
      media.mediaBytes.length>20*1024*1024||
      media.originalMedia.mediaCount!==1||
      !SHA.test(media.originalMedia.originalMediaSha256)||
      sha(media.mediaBytes)!==media.originalMedia.originalMediaSha256||
      !['handoffId','reviewPacketId','mediaSetId'].every(k=>
        media.originalMedia[k]===handoff[k])||
      !Array.isArray(handoff.automatedReviewFlags)||
      handoff.automatedReviewFlags.length!==0||
      dispatch?.status!=='ATOMIC_RESERVATION_AND_APPROVAL_REQUIRED'||
      dispatch.executionAllowed!==false||
      !Array.isArray(dispatch.reviewFlags)||dispatch.reviewFlags.length!==0||
      !['tenantId','instanceId','planId','mediaSetId','approvalRequestId'].every(k=>
        dispatch[k]===handoff[k])||
      !ID.test(dispatch.dispatchIntentId)||!ID.test(dispatch.providerOrganizationId)||
      !ID.test(dispatch.channelId)||!SHA.test(dispatch.copySha256)||
      !ID.test(review.signedReviewEvidenceId))deny();
  const binding=Object.freeze({
    reviewPacketId:handoff.reviewPacketId,handoffId:handoff.handoffId,
    signedReviewEvidenceId:review.signedReviewEvidenceId,planId:handoff.planId,
    mediaSetId:handoff.mediaSetId,copySha256:dispatch.copySha256,
    providerOrganizationId:dispatch.providerOrganizationId,
    channelId:dispatch.channelId
  });
  if(!bindingKeys.every(k=>ID.test(binding[k])||
      (k==='copySha256'&&SHA.test(binding[k]))))deny();
  const bindingSha256=sha(JSON.stringify(bindingKeys.map(k=>binding[k])));
  const intentSha256=sha('BCI_CONTENT_DISPATCH_INTENT_V1\n'+
    JSON.stringify([dispatch.dispatchIntentId,bindingSha256]));
  const p=editorialReceipt.payload;
  return {review,binding,bindingSha256,intentSha256,mediaSha:sha(media.mediaBytes),
    editorial:p,dispatchIntentId:dispatch.dispatchIntentId};
}
// The signer must be an external, authenticated HUMAN review action.
// This helper merely prepares the exact bytes that action would sign.
export function prepareContentAdmissionV2Payload(handoff,editorialReceipt,media,
  dispatch,trustedKeys,nonce,now=Date.now()){
  try{
    const c=context(handoff,editorialReceipt,media,dispatch,trustedKeys,now);
    if(typeof nonce!=='string'||!/^[a-f0-9]{32,64}$/.test(nonce))deny();
    return Object.freeze({
      schemaVersion:2,product:'content',tenantId:handoff.tenantId,
      instanceId:handoff.instanceId,handoffId:handoff.handoffId,
      reviewPacketId:handoff.reviewPacketId,mediaSetId:handoff.mediaSetId,
      signedReviewEvidenceId:c.review.signedReviewEvidenceId,
      originalMediaSha256:c.mediaSha,mediaCount:1,
      dispatchIntentId:c.dispatchIntentId,
      signedDispatchIntentSha256:c.intentSha256,
      reviewerSubject:c.editorial.reviewerSubject,
      reviewerProvider:c.editorial.reviewerProvider,
      reviewedAt:c.editorial.reviewedAt,expiresAt:c.editorial.expiresAt,nonce
    });
  }catch{return deny();}
}
// The trusted BCI server MUST independently recompute handoff, original bytes,
// reviewer JWT/role and receipt verification. This does NOT issue approval.
export function verifyContentAdmissionV2(handoff,editorialReceipt,media,dispatch,
  admissionReceipt,trustedKeys,now=Date.now()){
  try{
    const c=context(handoff,editorialReceipt,media,dispatch,trustedKeys,now);
    if(!exact(admissionReceipt,receiptKeys)||admissionReceipt.schemaVersion!==2||
        admissionReceipt.keyId!==editorialReceipt.keyId||
        !exact(admissionReceipt.payload,keys)||
        typeof admissionReceipt.signature!=='string'||
        !/^[A-Za-z0-9_-]{86}$/.test(admissionReceipt.signature))deny();
    const p=admissionReceipt.payload;
    const expected=prepareContentAdmissionV2Payload(handoff,editorialReceipt,
      media,dispatch,trustedKeys,p.nonce,now);
    if(!keys.every(k=>p[k]===expected[k]))deny();
    if(!(trustedKeys instanceof Map))deny();
    const key=trustedKeys.get(admissionReceipt.keyId);
    if(!(key instanceof KeyObject)||key.type!=='public'||
        key.asymmetricKeyType!=='ed25519')deny();
    const sig=Buffer.from(admissionReceipt.signature,'base64url');
    if(sig.length!==64||sig.toString('base64url')!==admissionReceipt.signature||
        !verify(null,signingBytes(p),key,sig))deny();
    // Exact keys expected by BCI's admission verifier; NOT reviewer authority.
    const verified=Object.freeze({
      product:'content',tenantId:p.tenantId,
      reviewerSubject:p.reviewerSubject,reviewerProvider:p.reviewerProvider,
      signedDecision:'APPROVE',signatureVerified:true,
      signedReviewEvidenceId:p.signedReviewEvidenceId,expiresAt:p.expiresAt,
      handoffId:p.handoffId,reviewPacketId:p.reviewPacketId,
      mediaSetId:p.mediaSetId,originalMediaSha256:p.originalMediaSha256,
      mediaCount:1,signedDispatchIntentSha256:p.signedDispatchIntentSha256
    });
    return Object.freeze({
      status:'SIGNED_ADMISSION_V2_VERIFIED_NONAUTHORIZING',
      verified,binding:c.binding,bindingSha256:c.bindingSha256,
      dispatchIntentId:c.dispatchIntentId,
      mediaBytes:Buffer.from(media.mediaBytes),
      approvalGranted:false,durableApprovalRecorded:false,
      providerSent:false,executionAllowed:false,customerSaasReady:false
    });
  }catch{return deny();}
}
