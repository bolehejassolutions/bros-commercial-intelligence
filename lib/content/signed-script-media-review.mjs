// CONTENT product-only supplementary Ed25519 proof binding script+original PNG
// to a separate human review. Image-only V1 approval never approves a script.
// This verifies signatures, NOT reviewer login, BCI approval, SENT or publishing.
import {createHash, verify, KeyObject} from 'node:crypto';
import {proposeContentBriefFromTrend,prepareContentTrendScriptMediaReview} from './trend-evidence.mjs';
import {prepareLocalContentEditorialHandoff} from './local-render-editorial-handoff.mjs';
import {verifyContentSignedEditorialDecision} from './signed-editorial-decision.mjs';
import {prepareContentAuthenticatedReviewPreflight} from './authenticated-review-preflight.mjs';
import {prepareContentReviewDispatchPreflight} from './review-dispatch-binding.mjs';

const fields=['schemaVersion','product','tenantId','instanceId','scriptMediaReviewId',
  'scriptIntentId','sourcePacketId','sourceCandidateId','planId','mediaSetId',
  'reviewPacketId','handoffId','signedReviewEvidenceId','reviewerSubject',
  'reviewerProvider','reviewedAt','scriptReviewedAt','expiresAt','nonce','decision','scriptCheckResults'];
const checks=['VERIFY_SCRIPT_STORYBOARD_AND_EACH_RENDERED_IMAGE_SEMANTICALLY',
  'VERIFY_SCRIPT_SOURCE_RIGHTS_CLAIMS_AND_BRAND_SAFETY'];
const fail=()=>{throw Error('CONTENT_SCRIPT_MEDIA_SIGNED_REVIEW_DENIED');};
function exact(obj,keys){
  return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(obj))&&
    Reflect.ownKeys(obj).length===keys.length&&Reflect.ownKeys(obj).every(k=>{
      const d=Object.getOwnPropertyDescriptor(obj,k);
      return typeof k==='string'&&keys.includes(k)&&d?.enumerable===true&&
        Object.hasOwn(d,'value');
    });
}
function canonical(payload){
  if(!exact(payload,fields))fail();
  return Buffer.from('BROS_CONTENT_SCRIPT_MEDIA_SIGNED_REVIEW_V2\n'+
    JSON.stringify(fields.map(k=>payload[k])),'utf8');
}
export function contentScriptMediaSigningBytes(payload){return canonical(payload);}
function context(args,editorialReceipt,keys,now){
  if(!Array.isArray(args)||args.length!==9||!Number.isSafeInteger(now))fail();
  const [config,packet,candidateId,channel,proposal,script,manifest,buffers,copy]=args;
  const plan=proposeContentBriefFromTrend(config,packet,candidateId,channel,proposal);
  const review=prepareContentTrendScriptMediaReview(...args);
  const handoff=prepareLocalContentEditorialHandoff(config,plan.brief,manifest,buffers,copy);
  const editorial=verifyContentSignedEditorialDecision(handoff,editorialReceipt,keys,now);
  if(editorial.signedDecision!=='APPROVE'||review.handoffId!==handoff.handoffId||
     review.mediaSetId!==handoff.mediaSetId||
     review.scriptMediaReviewId.length<40||
     review.status!=='TREND_SCRIPT_MEDIA_EDITORIAL_REVIEW_PENDING'||
     !Array.isArray(review.requiredHumanChecks)||
     !checks.every(c=>review.requiredHumanChecks.includes(c))||
     !Array.isArray(review.automatedReviewFlags)||
     review.automatedReviewFlags.length!==0||
     review.executionAllowed!==false||editorial.executionAllowed!==false)fail();
  return {review,editorial,original:editorialReceipt.payload};
}
function validateChecks(results){
  if(!Array.isArray(results)||results.length!==checks.length||
     Reflect.ownKeys(results).length!==results.length+1)fail();
  for(let i=0;i<checks.length;i++){
    const d=Object.getOwnPropertyDescriptor(results,String(i));
    if(!d?.enumerable||!Object.hasOwn(d,'value')||
       !exact(d.value,['check','passed'])||
       d.value.check!==checks[i]||d.value.passed!==true)fail();
  }
}
// The second review is a distinct event, not a copy of image review time.
function validateScriptReviewTime(value,original,now){
  if(typeof value!=='string'||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))fail();
  const scriptTime=Date.parse(value);
  const imageTime=Date.parse(original.reviewedAt);
  const expiry=Date.parse(original.expiresAt);
  if(!Number.isFinite(scriptTime)||new Date(scriptTime).toISOString()!==value||
     !Number.isFinite(imageTime)||!Number.isFinite(expiry)||
     scriptTime<imageTime||scriptTime>now||scriptTime>=expiry)fail();
}
export function prepareContentScriptMediaReviewPayload(args,editorialReceipt,
  trustedKeys,scriptCheckResults,nonce,scriptReviewedAt,now=Date.now()){
  try{
    const {review,editorial,original}=context(args,editorialReceipt,trustedKeys,now);
    validateChecks(scriptCheckResults);
    validateScriptReviewTime(scriptReviewedAt,original,now);
    if(typeof nonce!=='string'||!/^[a-f0-9]{32,64}$/.test(nonce)||
       nonce===original.nonce)fail();
    return Object.freeze({
      schemaVersion:2,product:'content',tenantId:review.tenantId,
      instanceId:review.instanceId,scriptMediaReviewId:review.scriptMediaReviewId,
      scriptIntentId:review.scriptIntentId,sourcePacketId:review.sourcePacketId,
      sourceCandidateId:review.sourceCandidateId,planId:review.planId,
      mediaSetId:review.mediaSetId,reviewPacketId:review.reviewPacketId,
      handoffId:review.handoffId,signedReviewEvidenceId:editorial.signedReviewEvidenceId,
      reviewerSubject:original.reviewerSubject,reviewerProvider:original.reviewerProvider,
      reviewedAt:original.reviewedAt,scriptReviewedAt,
      expiresAt:original.expiresAt,
      nonce,decision:'APPROVE',
      scriptCheckResults:Object.freeze(scriptCheckResults.map(x=>Object.freeze({
        check:x.check,passed:true})))
    });
  }catch{return fail();}
}
export function verifyContentScriptMediaReviewReceipt(args,editorialReceipt,
  scriptReceipt,trustedKeys,now=Date.now()){
  try{
    if(!exact(scriptReceipt,['schemaVersion','keyId','payload','signature'])||
       scriptReceipt.schemaVersion!==2||
       scriptReceipt.keyId!==editorialReceipt?.keyId||
       !exact(scriptReceipt.payload,fields)||
       typeof scriptReceipt.signature!=='string'||
       !/^[A-Za-z0-9_-]{86}$/.test(scriptReceipt.signature))fail();
    const p=scriptReceipt.payload;
    if(p.schemaVersion!==2||p.product!=='content'||p.decision!=='APPROVE')fail();
    const expected=prepareContentScriptMediaReviewPayload(args,editorialReceipt,
      trustedKeys,p.scriptCheckResults,p.nonce,p.scriptReviewedAt,now);
    if(!fields.every(k=>k==='scriptCheckResults'
      ?JSON.stringify(p[k])===JSON.stringify(expected[k])
      :p[k]===expected[k]))fail();
    if(!(trustedKeys instanceof Map))fail();
    const key=trustedKeys.get(scriptReceipt.keyId);
    if(!(key instanceof KeyObject)||key.type!=='public'||
       key.asymmetricKeyType!=='ed25519')fail();
    const signature=Buffer.from(scriptReceipt.signature,'base64url');
    if(signature.length!==64||
       signature.toString('base64url')!==scriptReceipt.signature||
       !verify(null,canonical(p),key,signature))fail();
    const signedScriptMediaEvidenceId='content-script-media-signed-'+
      createHash('sha256').update(canonical(p)).update(signature).digest('hex');
    return Object.freeze({
      schemaVersion:2,product:'content',tenantId:p.tenantId,
      instanceId:p.instanceId,scriptMediaReviewId:p.scriptMediaReviewId,
      scriptIntentId:p.scriptIntentId,sourcePacketId:p.sourcePacketId,
      mediaSetId:p.mediaSetId,handoffId:p.handoffId,
      signedReviewEvidenceId:p.signedReviewEvidenceId,signedScriptMediaEvidenceId,
      imageReviewedAt:p.reviewedAt,scriptReviewedAt:p.scriptReviewedAt,
      status:'SCRIPT_MEDIA_SIGNED_REVIEW_EVIDENCE_ONLY',signatureVerified:true,
      reviewerAuthenticated:false,reviewerRoleVerified:false,
      tenantMembershipVerified:false,scriptSemanticsIndependentlyVerified:false,
      approvalGranted:false,durableApprovalRecorded:false,
      atomicReservationVerified:false,providerSentVerified:false,
      measurementVerified:false,learningVerified:false,
      sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false
    });
  }catch{return fail();}
}

// Bridge the SECOND signed script+media review to the SAME trusted BCI reviewer
// principal/membership preflight used for the image-only editorial receipt.
// Neither a test stub nor a valid signature issues a durable BCI approval.
export async function prepareContentScriptMediaAuthBindingPreflight(args,
  editorialReceipt,scriptReceipt,trustedKeys,serverAuthDependencies,now=Date.now()){
  try{
    if(!Array.isArray(args)||args.length!==9)fail();
    const proof=verifyContentScriptMediaReviewReceipt(args,editorialReceipt,
      scriptReceipt,trustedKeys,now);
    const [config,packet,candidateId,channel,proposal,,manifest,buffers,copy]=args;
    const plan=proposeContentBriefFromTrend(config,packet,candidateId,channel,proposal);
    const handoff=prepareLocalContentEditorialHandoff(config,plan.brief,
      manifest,buffers,copy);
    const principal=await prepareContentAuthenticatedReviewPreflight(handoff,
      editorialReceipt,trustedKeys,serverAuthDependencies,now);
    if(principal.status!=='AUTHORITY_MATCHED_REVIEW_PREFLIGHT_ONLY'||
       proof.status!=='SCRIPT_MEDIA_SIGNED_REVIEW_EVIDENCE_ONLY'||
       editorialReceipt.payload.reviewerProvider!=='neon-auth'||
       scriptReceipt.payload.reviewerProvider!=='neon-auth'||
       scriptReceipt.payload.reviewerSubject!==editorialReceipt.payload.reviewerSubject||
       !['tenantId','instanceId','mediaSetId','handoffId','signedReviewEvidenceId']
         .every(k=>proof[k]===principal[k])||
       proof.sourcePacketId!==plan.sourcePacketId||
       proof.scriptMediaReviewId!==scriptReceipt.payload.scriptMediaReviewId||
       principal.serverPrincipalAndMembershipMatched!==true||
       principal.executionAllowed!==false||proof.executionAllowed!==false)fail();
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:principal.tenantId,
      instanceId:principal.instanceId,planId:principal.planId,
      mediaSetId:principal.mediaSetId,handoffId:principal.handoffId,
      reviewPacketId:principal.reviewPacketId,
      signedReviewEvidenceId:principal.signedReviewEvidenceId,
      signedScriptMediaEvidenceId:proof.signedScriptMediaEvidenceId,
      scriptMediaReviewId:proof.scriptMediaReviewId,
      sourcePacketId:proof.sourcePacketId,
      status:'SCRIPT_MEDIA_AUTH_DEPENDENCY_MATCHED_PREFLIGHT_ONLY',
      imageAndScriptSignaturesVerified:true,
      serverAuthDependenciesMatched:true,
      reviewerAuthenticatedByThisModule:false,
      independentSemanticQaVerified:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      providerSentVerified:false,measurementVerified:false,
      learningVerified:false,sharedBciAuditVerified:false,
      executionAllowed:false,customerSaasReady:false
    });
  }catch{return fail();}
}


// Script-based dispatch MUST NOT reuse the existing image-only BCI reservation
// contract. Its eight binding fields do not cover signedScriptMediaEvidenceId.
// This produces a stable diagnostic scope only; no executable reservation
// candidate is exposed until the BCI-owned issuer binds BOTH receipts.
export async function prepareContentScriptDispatchBlockedPreflight(args,
  editorialReceipt,scriptReceipt,trustedKeys,serverAuthDependencies,
  dispatchOptions,now=Date.now()){
  try{
    const script=await prepareContentScriptMediaAuthBindingPreflight(args,
      editorialReceipt,scriptReceipt,trustedKeys,serverAuthDependencies,now);
    const [config,packet,candidateId,channel,proposal,,manifest,buffers,copy]=args;
    const plan=proposeContentBriefFromTrend(config,packet,candidateId,channel,proposal);
    const image=await prepareContentReviewDispatchPreflight(config,plan.brief,
      manifest,buffers,copy,dispatchOptions,editorialReceipt,trustedKeys,
      serverAuthDependencies,now);
    if(script.status!=='SCRIPT_MEDIA_AUTH_DEPENDENCY_MATCHED_PREFLIGHT_ONLY'||
       image.status!=='SIGNED_REVIEW_DISPATCH_SCOPE_BOUND_PREFLIGHT_ONLY'||
       script.executionAllowed!==false||image.executionAllowed!==false||
       script.sourcePacketId!==plan.sourcePacketId||
       image.channelId!==channel.channelId||
       image.channelService!==channel.service||
       !['tenantId','instanceId','planId','mediaSetId','handoffId',
         'reviewPacketId','signedReviewEvidenceId'].every(k=>script[k]===image[k]))fail();
    const scriptDispatchScopeId='content-script-dispatch-scope-'+
      createHash('sha256').update('BROS_CONTENT_SCRIPT_DISPATCH_SCOPE_V1\\n'+
        JSON.stringify([script.tenantId,script.instanceId,
          script.sourcePacketId,script.scriptMediaReviewId,
          script.signedScriptMediaEvidenceId,image.dispatchIntentId]))
        .digest('hex');
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:script.tenantId,
      instanceId:script.instanceId,planId:script.planId,
      mediaSetId:script.mediaSetId,handoffId:script.handoffId,
      signedReviewEvidenceId:script.signedReviewEvidenceId,
      signedScriptMediaEvidenceId:script.signedScriptMediaEvidenceId,
      scriptMediaReviewId:script.scriptMediaReviewId,
      scriptDispatchScopeId,
      imageOnlyDispatchIntentId:image.dispatchIntentId,
      bciReservationRequestCandidate:null,
      status:'SCRIPT_DISPATCH_BCI_BINDING_UNSUPPORTED_BLOCKED',
      scriptAndImageScopeMatched:true,
      bciScriptDispatchBindingSupported:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      providerSentVerified:false,measurementVerified:false,
      learningVerified:false,executionAllowed:false,customerSaasReady:false
    });
  }catch{return fail();}
}
