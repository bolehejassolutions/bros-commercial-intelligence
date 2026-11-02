// CONTENT instance editorial hook -> script + original image bytes review proof.
// Not trend evidence, human approval, BCI authorization, reservation or SENT.
import {createHash} from 'node:crypto';
import {planContentJobCandidate} from './instance-plan.mjs';
import {prepareContentApprovalRequest} from './approval-request.mjs';
const deny=()=>{throw Error('CONTENT_INSTANCE_SCRIPT_PROOF_DENIED');};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/;
const SF=['scriptId','revisionId','openingHook','sellerSituation','diagnosticQuestion','valueExplanation','sellerAction','closingLine','shots'];
const RF=['resourceId','hookPromise','demonstratedInput','demonstratedAction','demonstratedOutput','answerLocation'];
function exact(x,keys){return !!x&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
  Reflect.ownKeys(x).length===keys.length&&keys.every(k=>{
    const d=Object.getOwnPropertyDescriptor(x,k);
    return d?.enumerable===true&&Object.hasOwn(d,'value');});}
function clean(x,max=800){return typeof x==='string'&&x===x.trim()&&
  x.length>=3&&x.length<=max&&!/[\u0000-\u001f\u007f]/u.test(x);}
function dense(a){return Array.isArray(a)&&a.length>=2&&a.length<=6&&
  Reflect.ownKeys(a).length===a.length+1&&
  Array.from({length:a.length},(_,i)=>{
    const d=Object.getOwnPropertyDescriptor(a,String(i));
    return d?.enumerable===true&&Object.hasOwn(d,'value');}).every(Boolean);}
function freeze(x){if(x&&typeof x==='object'){
  for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
/** Instance-owned editorial input; BCI must separately verify source, reviewer,
 * complete signed script+image proof and approval before any future dispatch.
 */
export function prepareContentInstanceScriptProofEnvelope(config,brief,script,
  resource,originalPngBuffers,proposedCopy,mediaOptions={}){
  try{
    if(!exact(script,SF)||!exact(resource,RF)||
      typeof script.scriptId!=='string'||!ID.test(script.scriptId)||
      typeof script.revisionId!=='string'||!ID.test(script.revisionId)||
      typeof resource.resourceId!=='string'||!ID.test(resource.resourceId)||
      !dense(script.shots)||!script.shots.every(x=>clean(x,320))||
      !SF.filter(x=>!['scriptId','revisionId','shots'].includes(x))
        .every(x=>clean(script[x]))||
      !RF.filter(x=>x!=='resourceId').every(x=>clean(resource[x]))||
      script.openingHook!==resource.hookPromise||
      script.openingHook!==brief?.hook)deny();
    const plan=planContentJobCandidate(config,brief);
    const approval=prepareContentApprovalRequest(config,brief,originalPngBuffers,
      proposedCopy,mediaOptions);
    if(plan.planId!==approval.planId||plan.tenantId!==approval.tenantId||
      plan.instanceId!==approval.instanceId||
      plan.brief.assetCount!==approval.imageDigests.length)deny();
    const s=Object.fromEntries(SF.map(k=>[k,k==='shots'?[...script.shots]:script[k]]));
    const r=Object.fromEntries(RF.map(k=>[k,resource[k]]));
    const images=approval.imageDigests.map(x=>({
      slot:x.slot,sourceSha256:x.sha256,decodedRgbaSha256:x.renderedRgbaSha256}));
    const destination={channelService:plan.brief.channelService,
      channelId:plan.brief.channelId,providerOrganizationId:null};
    const scriptIntentId='content-instance-script-'+hash([1,plan.tenantId,
      plan.instanceId,plan.planId,s,r]);
    const proofEnvelopeId='content-instance-script-proof-'+hash([1,
      plan.tenantId,plan.instanceId,plan.planId,approval.approvalRequestId,
      scriptIntentId,images,approval.copySha256,destination]);
    return freeze({schemaVersion:1,product:'content',
      tenantId:plan.tenantId,instanceId:plan.instanceId,planId:plan.planId,
      approvalRequestId:approval.approvalRequestId,mediaSetId:approval.mediaSetId,
      scriptIntentId,proofEnvelopeId,script:s,resourceMapping:r,
      orderedMediaDigests:images,copySha256:approval.copySha256,
      copy:structuredClone(approval.copy),destination,
      status:'INSTANCE_SCRIPT_AND_ORIGINAL_MEDIA_REVIEW_REQUIRED',
      resourceMappingAuthenticated:false,trendEvidenceClaimed:false,
      originalMediaBytesStructurallyVerified:true,renderedPixelsDistinct:true,
      scriptSemanticsReviewed:false,humanImageReviewSigned:false,
      humanScriptReviewSigned:false,reviewerAuthenticated:false,
      durableApprovalRecorded:false,bciReservationRequestCandidate:null,
      providerSentVerified:false,measurementVerified:false,
      learningVerified:false,executionAllowed:false,customerSaasReady:false});
  }catch{return deny();}
}
