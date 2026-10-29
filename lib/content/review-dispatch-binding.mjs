// CONTENT-only nonexecuting binding of fresh original media bytes, signed
// editorial review, BCI-scoped reviewer preflight and exact Buffer dispatch intent.
// Never substitute this for real human approval, durable BCI reservation or SENT.
// Trusted server must supply auth/membership dependencies, keys and provider org.
import {prepareLocalContentEditorialHandoff} from './local-render-editorial-handoff.mjs';
import {prepareContentAuthenticatedReviewPreflight} from './authenticated-review-preflight.mjs';
import {prepareContentBufferDispatchIntent} from './buffer-dispatch-intent.mjs';

const deny=()=>{throw Error('CONTENT_REVIEW_DISPATCH_BINDING_DENIED');};

export async function prepareContentReviewDispatchPreflight(instanceConfig,brief,
  rendererManifest,sourceBuffers,proposedCopy,dispatchOptions,receipt,
  trustedPublicKeys,serverAuthDependencies,now=Date.now(),mediaOptions={}){
  try{
    // Recompute both branches from original image bytes, never caller QA summaries.
    const handoff=prepareLocalContentEditorialHandoff(instanceConfig,brief,
      rendererManifest,sourceBuffers,proposedCopy,mediaOptions);
    const review=await prepareContentAuthenticatedReviewPreflight(handoff,receipt,
      trustedPublicKeys,serverAuthDependencies,now);
    const dispatch=prepareContentBufferDispatchIntent(instanceConfig,brief,
      sourceBuffers,proposedCopy,dispatchOptions,mediaOptions);
    for(const key of ['tenantId','instanceId','planId','mediaSetId','approvalRequestId']){
      if(handoff[key]!==review[key]||handoff[key]!==dispatch[key])deny();
    }
    if(review.handoffId!==handoff.handoffId||
        review.reviewPacketId!==handoff.reviewPacketId||
        review.status!=='AUTHORITY_MATCHED_REVIEW_PREFLIGHT_ONLY'||
        review.executionAllowed!==false||
        dispatch.status!=='ATOMIC_RESERVATION_AND_APPROVAL_REQUIRED'||
        dispatch.executionAllowed!==false||
        dispatch.reviewFlags.length!==0)deny();
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:handoff.tenantId,
      instanceId:handoff.instanceId,planId:handoff.planId,
      mediaSetId:handoff.mediaSetId,approvalRequestId:handoff.approvalRequestId,
      reviewPacketId:handoff.reviewPacketId,handoffId:handoff.handoffId,
      signedReviewEvidenceId:review.signedReviewEvidenceId,
      dispatchIntentId:dispatch.dispatchIntentId,
      provider:'buffer',channelService:dispatch.channelService,
      channelId:dispatch.channelId,
      status:'SIGNED_REVIEW_DISPATCH_SCOPE_BOUND_PREFLIGHT_ONLY',
      originalMediaBytesRechecked:true,
      signedReviewScopeMatched:true,serverAuthDependenciesMatched:true,
      providerOrganizationAuthenticated:false,reviewerAuthenticatedByThisModule:false,
      visualEditorialQaVerified:false,approvalGranted:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      providerAccountCapabilityVerified:false,providerUploadVerified:false,
      providerSentVerified:false,measurementVerified:false,
      learningVerified:false,sharedBciAuditVerified:false,
      executionAllowed:false,customerSaasReady:false
    });
  }catch{return deny();}
}
