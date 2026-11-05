// CONTENT product-layer original-byte producer for BCI's single-image DEV admission.
// Never treat this object, a signed editorial receipt, or a Buffer as approval.
// BCI must independently recompute these fields on a trusted server and verify
// the signed originalMediaSha256 + mediaCount=1 before durable issuance.
import {createHash} from 'node:crypto';
import {prepareLocalContentEditorialHandoff} from './local-render-editorial-handoff.mjs';
import {inspectPlannedContentPngBytes} from './plan-source-byte-gate.mjs';

const deny=()=>{throw Error('CONTENT_SINGLE_IMAGE_ADMISSION_MEDIA_DENIED');};

export function prepareContentSingleImageAdmissionMedia(instanceConfig,brief,
  rendererManifest,sourceBuffers,proposedCopy,mediaOptions={}) {
  try {
    // No first-slide fallback: reject every carousel before considering its bytes.
    if(brief?.format!=='single_image'||brief?.assetCount!==1||
        !Array.isArray(sourceBuffers)||sourceBuffers.length!==1||
        !Buffer.isBuffer(sourceBuffers[0])||
        sourceBuffers[0].byteLength<32||
        sourceBuffers[0].byteLength>20*1024*1024)deny();
    const handoff=prepareLocalContentEditorialHandoff(instanceConfig,brief,
      rendererManifest,sourceBuffers,proposedCopy,mediaOptions);
    const inspected=inspectPlannedContentPngBytes(instanceConfig,brief,
      sourceBuffers,mediaOptions);
    if(inspected.images.length!==1||
        handoff.status!=='LOCAL_MEDIA_EDITORIAL_REVIEW_PENDING'||
        handoff.planId!==inspected.planId||
        handoff.mediaSetId!==inspected.mediaSetId||
        handoff.tenantId!==inspected.tenantId||
        handoff.instanceId!==inspected.instanceId||
        !Array.isArray(handoff.automatedReviewFlags)||
        handoff.automatedReviewFlags.length!==0)deny();
    const mediaBytes=Buffer.from(sourceBuffers[0]);
    const originalMediaSha256=createHash('sha256').update(mediaBytes).digest('hex');
    if(originalMediaSha256!==inspected.images[0].sha256||
        inspected.images[0].byteLength!==mediaBytes.length)deny();
    // EXACT shape required by BCI recomputeOriginalMedia; BCI must derive it
    // independently from server-owned plan/context + bytes, not trust this claim.
    const originalMedia=Object.freeze({
      handoffId:handoff.handoffId,
      reviewPacketId:handoff.reviewPacketId,
      mediaSetId:handoff.mediaSetId,
      originalMediaSha256,
      mediaCount:1
    });
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:handoff.tenantId,
      instanceId:handoff.instanceId,planId:handoff.planId,
      originalMedia,mediaBytes,
      status:'SINGLE_IMAGE_ORIGINAL_BYTES_RECHECKED_NONAUTHORIZING',
      signedOriginalDigestVerified:false,
      reviewerAuthenticated:false,approvalGranted:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      providerSentVerified:false,measurementVerified:false,
      sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false
    });
  }catch{return deny();}
}
