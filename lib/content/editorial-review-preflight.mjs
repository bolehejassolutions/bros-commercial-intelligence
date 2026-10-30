// CONTENT product-layer editorial review preflight. Non-executing, advisory only.
// Rechecks supplied PNG bytes through prepareContentApprovalRequest; a textual
// heuristic cannot verify visual meaning, truth of claims or reviewer identity.
import {createHash} from 'node:crypto';
import {prepareContentApprovalRequest} from './approval-request.mjs';
import {normalizeContentInstanceConfig} from './instance-plan.mjs';
import {inspectContentBufferDisclosureCapability} from './buffer-disclosure-capability.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const norm = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const containsPhrase = (haystack, needle) => norm(haystack).includes(norm(needle));

export function prepareContentEditorialReviewPreflight(instanceConfig, brief, sourceBuffers, proposedCopy, options={}) {
  // Never trust a caller-supplied approvalRequestId or source QA summary.
  const request = prepareContentApprovalRequest(instanceConfig, brief, sourceBuffers, proposedCopy, options);
  const instance = normalizeContentInstanceConfig(instanceConfig);
  if (instance.tenantId !== request.tenantId || instance.instanceId !== request.instanceId)
    throw Error('CONTENT_REVIEW_SCOPE_MISMATCH');
  const text = [request.copy.caption, ...request.copy.altTexts].join('\n');
  const blockedMatches = instance.config.brand.blockedClaims
    .filter(phrase => containsPhrase(text, phrase));
  const candidateMatches = instance.config.brand.claimCandidates
    .filter(phrase => containsPhrase(text, phrase));
  const altTextKeys = request.copy.altTexts.map(norm);
  // Reuse the same AI-caption contradiction classifier as dispatch. A signed
  // editorial receipt must not silently clear contradictory provenance copy.
  const aiCaptionConflict = request.copy.aiDisclosure === 'DECLARED_NON_AI' &&
    inspectContentBufferDisclosureCapability({
      schemaVersion:1,product:'content',tenantId:request.tenantId,
      instanceId:request.instanceId,planId:request.planId,
      approvalRequestId:request.approvalRequestId,
      channelService:brief.channelService,
      assetTypes:request.imageDigests.map(()=>'image'),
      aiDisclosure:request.copy.aiDisclosure,caption:request.copy.caption
    }).flags.includes('AI_PROVENANCE_CAPTION_CONTRADICTION');
  const flags = [
    ...(request.copy.aiDisclosure === 'UNKNOWN' ? ['AI_DISCLOSURE_UNRESOLVED'] : []),
    ...(aiCaptionConflict ? ['AI_PROVENANCE_CAPTION_CONTRADICTION'] : []),
    ...(blockedMatches.length ? ['BLOCKED_CLAIM_TEXT_MATCH'] : []),
    ...(candidateMatches.length && !request.copy.claimEvidenceRefs.length ? ['CLAIM_EVIDENCE_REFERENCE_MISSING'] : []),
    ...(request.copy.claimEvidenceRefs.length ? ['CLAIM_EVIDENCE_REFERENCES_UNVERIFIED'] : []),
    ...(new Set(altTextKeys).size !== altTextKeys.length ? ['DUPLICATE_ALT_TEXT_REVIEW'] : []),
  ].sort();
  // A review packet is not an approval event. Even no automated flags never
  // proves editorial correctness or provider capability.
  const requiredHumanChecks = Object.freeze([
    'VERIFY_EACH_IMAGE_VISUALLY_AND_INDEPENDENTLY',
    'VERIFY_CAPTION_ALT_TEXT_AND_IMAGE_SEMANTIC_ALIGNMENT',
    'VERIFY_CLAIM_SOURCES_AND_BRAND_POLICY',
    'VERIFY_AI_DISCLOSURE_AND_PLATFORM_REQUIREMENTS',
    'VERIFY_CONTENT_SPECIFIC_AUTHENTICATED_APPROVAL',
    'VERIFY_PUBLISHER_CHANNEL_CAPABILITY_AND_PERMISSION',
  ]);
  const reviewPacketId = 'content-editorial-' + hash([1, request.approvalRequestId, flags, requiredHumanChecks]);
  return Object.freeze({
    schemaVersion:1, product:'content', tenantId:request.tenantId,
    instanceId:request.instanceId, planId:request.planId,
    mediaSetId:request.mediaSetId, approvalRequestId:request.approvalRequestId,
    reviewPacketId, status:'EDITORIAL_REVIEW_PENDING',
    automatedReviewFlags:Object.freeze(flags),
    blockedClaimTextMatches:Object.freeze(blockedMatches),
    claimCandidateTextMatches:Object.freeze(candidateMatches),
    requiredHumanChecks,
    sourceBytesStructurallyVerified:true, distinctRenderedPixelsVerified:true,
    textHeuristicIsApproval:false, visualEditorialQaVerified:false,
    claimEvidenceVerified:false, aiDisclosureVerified:false,
    reviewerAuthenticated:false, approvalGranted:false,
    providerCapabilityVerified:false, providerSentVerified:false,
    measurementVerified:false, learningVerified:false,
    sharedBciAuditVerified:false, executionAllowed:false, customerSaasReady:false,
  });
}
