// CONTENT-only handoff from real local renderer bytes to a reviewable editorial packet.
// This is a deterministic REVIEW request, never a human approval or provider dispatch.
// The renderer manifest is untrusted and is checked against independently decoded PNGs.
import {createHash} from 'node:crypto';
import {bindLocalContentRenderToPlan} from './local-render-manifest-gate.mjs';
import {prepareContentEditorialReviewPreflight} from './editorial-review-preflight.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function prepareLocalContentEditorialHandoff(instanceConfig, brief, rendererManifest,
  sourceBuffers, proposedCopy, mediaOptions={}) {
  // Both stages re-read original media bytes rather than accepting caller QA summaries.
  const rendered = bindLocalContentRenderToPlan(instanceConfig, brief, rendererManifest,
    sourceBuffers, mediaOptions);
  const editorial = prepareContentEditorialReviewPreflight(instanceConfig, brief,
    sourceBuffers, proposedCopy, mediaOptions);
  if (rendered.tenantId !== editorial.tenantId ||
      rendered.instanceId !== editorial.instanceId ||
      rendered.planId !== editorial.planId ||
      rendered.mediaSetId !== editorial.mediaSetId ||
      rendered.images.length !== proposedCopy.altTexts.length)
    throw Error('CONTENT_LOCAL_EDITORIAL_HANDOFF_SCOPE_MISMATCH');

  const handoffId = 'content-local-editorial-' + sha([1, rendered.tenantId,
    rendered.instanceId, rendered.planId, rendered.mediaSetId,
    editorial.approvalRequestId, editorial.reviewPacketId]);
  return Object.freeze({
    schemaVersion:1, product:'content', tenantId:rendered.tenantId,
    instanceId:rendered.instanceId, planId:rendered.planId,
    mediaSetId:rendered.mediaSetId, approvalRequestId:editorial.approvalRequestId,
    reviewPacketId:editorial.reviewPacketId, handoffId,
    status:'LOCAL_MEDIA_EDITORIAL_REVIEW_PENDING',
    automatedReviewFlags:editorial.automatedReviewFlags,
    requiredHumanChecks:editorial.requiredHumanChecks,
    sourceBytesStructurallyVerified:true, distinctRenderedPixelsVerified:true,
    rendererManifestAttested:false, planAuthenticated:false,
    localGenerationAuthenticated:false, independentAiGenerationVerified:false,
    visualEditorialQaVerified:false, claimEvidenceVerified:false,
    aiDisclosureVerified:false, reviewerAuthenticated:false,
    approvalGranted:false, atomicReservationVerified:false,
    providerCapabilityVerified:false, providerSentVerified:false,
    measurementVerified:false, learningVerified:false,
    sharedBciAuditVerified:false, executionAllowed:false, customerSaasReady:false
  });
}
