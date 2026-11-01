// CONTENT product-only supplementary Ed25519 proof binding script+original PNG
// to a separate human review. Image-only V1 approval never approves a script.
// This verifies signatures, NOT reviewer login, BCI approval, SENT or publishing.
import {createHash, verify, KeyObject} from 'node:crypto';
import {proposeContentBriefFromTrend,prepareContentTrendScriptMediaReview} from './trend-evidence.mjs';
import {prepareLocalContentEditorialHandoff} from './local-render-editorial-handoff.mjs';
import {verifyContentSignedEditorialDecision} from './signed-editorial-decision.mjs';

const fields=['schemaVersion','product','tenantId','instanceId','scriptMediaReviewId',
  'scriptIntentId','sourcePacketId','sourceCandidateId','planId','mediaSetId',
  'reviewPacketId','handoffId','signedReviewEvidenceId','reviewerSubject',
  'reviewerProvider','reviewedAt','expiresAt','nonce','decision','scriptCheckResults'];
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
  return Buffer.from('BROS_CONTENT_SCRIPT_MEDIA_SIGNED_REVIEW_V1\n'+
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
export function prepareContentScriptMediaReviewPayload(args,editorialReceipt,
  trustedKeys,scriptCheckResults,nonce,now=Date.now()){
  try{
    const {review,editorial,original}=context(args,editorialReceipt,trustedKeys,now);
    validateChecks(scriptCheckResults);
    if(typeof nonce!=='string'||!/^[a-f0-9]{32,64}$/.test(nonce)||
       nonce===original.nonce)fail();
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:review.tenantId,
      instanceId:review.instanceId,scriptMediaReviewId:review.scriptMediaReviewId,
      scriptIntentId:review.scriptIntentId,sourcePacketId:review.sourcePacketId,
      sourceCandidateId:review.sourceCandidateId,planId:review.planId,
      mediaSetId:review.mediaSetId,reviewPacketId:review.reviewPacketId,
      handoffId:review.handoffId,signedReviewEvidenceId:editorial.signedReviewEvidenceId,
      reviewerSubject:original.reviewerSubject,reviewerProvider:original.reviewerProvider,
      reviewedAt:original.reviewedAt,expiresAt:original.expiresAt,
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
       scriptReceipt.schemaVersion!==1||
       scriptReceipt.keyId!==editorialReceipt?.keyId||
       !exact(scriptReceipt.payload,fields)||
       typeof scriptReceipt.signature!=='string'||
       !/^[A-Za-z0-9_-]{86}$/.test(scriptReceipt.signature))fail();
    const p=scriptReceipt.payload;
    if(p.schemaVersion!==1||p.product!=='content'||p.decision!=='APPROVE')fail();
    const expected=prepareContentScriptMediaReviewPayload(args,editorialReceipt,
      trustedKeys,p.scriptCheckResults,p.nonce,now);
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
      schemaVersion:1,product:'content',tenantId:p.tenantId,
      instanceId:p.instanceId,scriptMediaReviewId:p.scriptMediaReviewId,
      scriptIntentId:p.scriptIntentId,sourcePacketId:p.sourcePacketId,
      mediaSetId:p.mediaSetId,handoffId:p.handoffId,
      signedReviewEvidenceId:p.signedReviewEvidenceId,signedScriptMediaEvidenceId,
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
