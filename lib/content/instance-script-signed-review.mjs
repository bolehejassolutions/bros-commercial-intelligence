// CONTENT-only supplementary human script review proof for ordinary (non-trend)
// instance editorial envelopes. A signature is NOT BCI authorization or SENT.
// The server must recompute this envelope from ORIGINAL media bytes.
import {createHash,verify,KeyObject} from 'node:crypto';
import {prepareContentInstanceScriptProofEnvelope} from './instance-editorial-script-proof.mjs';
import {prepareLocalContentEditorialHandoff} from './local-render-editorial-handoff.mjs';
import {verifyContentSignedEditorialDecision} from './signed-editorial-decision.mjs';
import {prepareContentAuthenticatedReviewPreflight} from './authenticated-review-preflight.mjs';
const deny=()=>{throw Error('CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_DENIED');};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const F=['schemaVersion','product','proofEnvelopeId','tenantId','instanceId',
  'planId','reviewPacketId','scriptIntentId','copySha256','channelService',
  'channelId','reviewerSubject','reviewerProvider','reviewedAt','expiresAt',
  'nonce','decision','scriptCheckResults'];
const R=['schemaVersion','keyId','payload','signature'];
export const CONTENT_INSTANCE_SCRIPT_REVIEW_CHECKS=Object.freeze([
  'VERIFY_SCRIPT_SHOTS_MATCH_RENDERED_MEDIA_SEMANTICALLY',
  'VERIFY_RESOURCE_MAPPING_INPUT_ACTION_OUTPUT_AND_PAYOFF',
  'VERIFY_SCRIPT_COPY_CLAIMS_RIGHTS_AND_DISCLOSURE'
]);
function exact(x,fields){
  return !!x&&typeof x==='object'&&!Array.isArray(x)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
    Reflect.ownKeys(x).length===fields.length&&fields.every(k=>{
      const d=Object.getOwnPropertyDescriptor(x,k);
      return d?.enumerable===true&&Object.hasOwn(d,'value');
    });
}
function validTime(s){return typeof s==='string'&&TIME.test(s)&&
  Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;}
function validateChecks(a){
  if(!Array.isArray(a)||a.length!==CONTENT_INSTANCE_SCRIPT_REVIEW_CHECKS.length||
    Reflect.ownKeys(a).length!==a.length+1)deny();
  for(let i=0;i<a.length;i++){
    const d=Object.getOwnPropertyDescriptor(a,String(i));
    if(!d?.enumerable||!Object.hasOwn(d,'value')||
      !exact(d.value,['check','passed'])||
      d.value.check!==CONTENT_INSTANCE_SCRIPT_REVIEW_CHECKS[i]||
      d.value.passed!==true)deny();
  }
}
function canonical(p){
  if(!exact(p,F))deny();
  validateChecks(p.scriptCheckResults);
  return Buffer.from('BROS_CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_V1\n'+
    JSON.stringify(F.map(k=>p[k])),'utf8');
}
export function contentInstanceScriptReviewSigningBytes(payload){
  return canonical(payload);
}
function freshEnvelope(args){
  if(!Array.isArray(args)||args.length!==7)deny();
  const envelope=prepareContentInstanceScriptProofEnvelope(...args);
  if(![2,3].includes(envelope.schemaVersion)||envelope.product!=='content'||
    envelope.status!=='INSTANCE_SCRIPT_AND_ORIGINAL_MEDIA_REVIEW_REQUIRED'||
    envelope.executionAllowed!==false||
    envelope.humanImageReviewSigned!==false||
    envelope.humanScriptReviewSigned!==false||
    envelope.durableApprovalRecorded!==false||
    envelope.destination.providerOrganizationId!==null||
    !Array.isArray(envelope.automatedReviewFlags)||
    envelope.automatedReviewFlags.length!==0)deny();
  return envelope;
}
function timeWindow(reviewedAt,expiresAt,now){
  if(!Number.isSafeInteger(now)||!validTime(reviewedAt)||!validTime(expiresAt))deny();
  const start=Date.parse(reviewedAt),end=Date.parse(expiresAt);
  if(start>now+5*60_000||end<=now||end<=start||end-start>24*60*60_000)deny();
}
export function prepareContentInstanceScriptReviewPayload(args,reviewerSubject,
  scriptCheckResults,nonce,reviewedAt,expiresAt,now=Date.now()){
  try{
    const e=freshEnvelope(args);
    if(typeof reviewerSubject!=='string'||!UUID.test(reviewerSubject)||
      typeof nonce!=='string'||!/^[a-f0-9]{32,64}$/.test(nonce))deny();
    validateChecks(scriptCheckResults);
    timeWindow(reviewedAt,expiresAt,now);
    return Object.freeze({
      schemaVersion:1,product:'content',proofEnvelopeId:e.proofEnvelopeId,
      tenantId:e.tenantId,instanceId:e.instanceId,planId:e.planId,
      reviewPacketId:e.reviewPacketId,scriptIntentId:e.scriptIntentId,
      copySha256:e.copySha256,channelService:e.destination.channelService,
      channelId:e.destination.channelId,reviewerSubject,
      reviewerProvider:'neon-auth',reviewedAt,expiresAt,nonce,
      decision:'APPROVE',scriptCheckResults:Object.freeze(
        scriptCheckResults.map(x=>Object.freeze({check:x.check,passed:true})))
    });
  }catch{return deny();}
}
export function verifyContentInstanceScriptReviewReceipt(args,receipt,
  trustedPublicKeys,now=Date.now()){
  try{
    if(!exact(receipt,R)||receipt.schemaVersion!==1||
      typeof receipt.keyId!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,63}$/.test(receipt.keyId)||
      typeof receipt.signature!=='string'||
      !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)||
      !exact(receipt.payload,F))deny();
    const p=receipt.payload;
    if(p.schemaVersion!==1||p.product!=='content'||p.decision!=='APPROVE'||
      p.reviewerProvider!=='neon-auth')deny();
    const expected=prepareContentInstanceScriptReviewPayload(args,
      p.reviewerSubject,p.scriptCheckResults,p.nonce,p.reviewedAt,p.expiresAt,now);
    if(!F.every(k=>k==='scriptCheckResults'
      ?JSON.stringify(p[k])===JSON.stringify(expected[k])
      :p[k]===expected[k]))deny();
    if(!(trustedPublicKeys instanceof Map))deny();
    const key=trustedPublicKeys.get(receipt.keyId);
    if(!(key instanceof KeyObject)||key.type!=='public'||
      key.asymmetricKeyType!=='ed25519')deny();
    const signature=Buffer.from(receipt.signature,'base64url');
    const bytes=canonical(p);
    if(signature.length!==64||
      signature.toString('base64url')!==receipt.signature||
      !verify(null,bytes,key,signature))deny();
    const signedScriptMediaEvidenceId='content-instance-script-signed-'+
      createHash('sha256').update(bytes).update(signature).digest('hex');
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:p.tenantId,
      instanceId:p.instanceId,planId:p.planId,
      reviewPacketId:p.reviewPacketId,proofEnvelopeId:p.proofEnvelopeId,
      scriptIntentId:p.scriptIntentId,signedScriptMediaEvidenceId,
      reviewerSubject:p.reviewerSubject,reviewerProvider:p.reviewerProvider,
      status:'INSTANCE_SCRIPT_SIGNATURE_VERIFIED_EVIDENCE_ONLY',
      signatureVerified:true,originalMediaRecomputed:true,
      reviewerAuthenticated:false,reviewerRoleVerified:false,
      tenantMembershipVerified:false,independentHumanReviewVerified:false,
      imageReviewSigned:false,providerOrganizationAuthenticated:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      bciReservationRequestCandidate:null,providerSentVerified:false,
      measurementVerified:false,learningVerified:false,
      executionAllowed:false,customerSaasReady:false
    });
  }catch{return deny();}
}


/** Bind an ordinary, NON-TREND script review to a separately signed image
 * editorial review, original ordered PNG bytes, and the existing BCI
 * principal/membership preflight. This is NOT the BCI issuer or an image-only
 * dispatch authorization. A future BCI script issuer must independently
 * authorize the complete ordered-media/script/copy/destination envelope.
 */
export async function prepareContentInstanceScriptImageAuthPreflight(args,
  rendererManifest,editorialReceipt,scriptReceipt,trustedPublicKeys,
  serverAuthDependencies,now=Date.now()){
  try{
    if(!Array.isArray(args)||args.length!==7||!Number.isSafeInteger(now))deny();
    const [config,brief,, ,originalPngBuffers,proposedCopy,mediaOptions]=args;
    if(!Array.isArray(originalPngBuffers)||originalPngBuffers.length<2)deny();
    const script=verifyContentInstanceScriptReviewReceipt(args,scriptReceipt,
      trustedPublicKeys,now);
    const envelope=freshEnvelope(args);
    const handoff=prepareLocalContentEditorialHandoff(config,brief,
      rendererManifest,originalPngBuffers,proposedCopy,mediaOptions);
    const image=verifyContentSignedEditorialDecision(handoff,editorialReceipt,
      trustedPublicKeys,now);
    if(image.signedDecision!=='APPROVE'||
       !Array.isArray(handoff.automatedReviewFlags)||
       handoff.automatedReviewFlags.length!==0||
       editorialReceipt.keyId!==scriptReceipt.keyId||
       editorialReceipt.payload.reviewerProvider!=='neon-auth'||
       editorialReceipt.payload.reviewerSubject!==scriptReceipt.payload.reviewerSubject||
       editorialReceipt.payload.nonce===scriptReceipt.payload.nonce||
       Date.parse(scriptReceipt.payload.reviewedAt)<=
         Date.parse(editorialReceipt.payload.reviewedAt)||
       Date.parse(scriptReceipt.payload.expiresAt)>
         Date.parse(editorialReceipt.payload.expiresAt)||
       script.status!=='INSTANCE_SCRIPT_SIGNATURE_VERIFIED_EVIDENCE_ONLY'||
       script.executionAllowed!==false||
       !['tenantId','instanceId','planId','reviewPacketId'].every(
         k=>script[k]===image[k]&&script[k]===envelope[k])||
       image.mediaSetId!==envelope.mediaSetId||
       script.proofEnvelopeId!==envelope.proofEnvelopeId)deny();
    const principal=await prepareContentAuthenticatedReviewPreflight(handoff,
      editorialReceipt,trustedPublicKeys,serverAuthDependencies,now);
    if(principal.status!=='AUTHORITY_MATCHED_REVIEW_PREFLIGHT_ONLY'||
       principal.serverPrincipalAndMembershipMatched!==true||
       principal.executionAllowed!==false||
       !['tenantId','instanceId','planId','reviewPacketId','mediaSetId'].every(
         k=>principal[k]===image[k]))deny();
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:script.tenantId,
      instanceId:script.instanceId,planId:script.planId,
      reviewPacketId:script.reviewPacketId,mediaSetId:image.mediaSetId,
      handoffId:image.handoffId,proofEnvelopeId:script.proofEnvelopeId,
      scriptIntentId:script.scriptIntentId,
      signedReviewEvidenceId:image.signedReviewEvidenceId,
      signedScriptMediaEvidenceId:script.signedScriptMediaEvidenceId,
      status:'INSTANCE_SCRIPT_IMAGE_AUTH_PREFLIGHT_ONLY',
      imageAndScriptSignaturesVerified:true,
      originalOrderedMediaRecomputed:true,
      serverPrincipalAndMembershipMatched:true,
      reviewerRoleVerified:false,independentSemanticQaVerified:false,
      providerOrganizationAuthenticated:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      bciReservationRequestCandidate:null,providerSentVerified:false,
      measurementVerified:false,learningVerified:false,
      executionAllowed:false,customerSaasReady:false
    });
  }catch{return deny();}
}
