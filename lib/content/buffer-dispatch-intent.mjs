// CONTENT-only candidate for one exact Buffer publishing operation.
// Rechecks the original PNG media bytes and copy; does not authenticate a human,
// reserve an operation, upload media, enqueue, publish, or attest provider SENT.
// A server-owned durable unique reservation on dispatchIntentId is mandatory
// before any future approved publisher attempts a provider write.
import {createHash} from 'node:crypto';
import {prepareContentApprovalRequest} from './approval-request.mjs';
import {planContentJobCandidate} from './instance-plan.mjs';
import {inspectContentBufferDisclosureCapability} from './buffer-disclosure-capability.mjs';
import {inspectContentEditorialCopyFlags} from './editorial-review-preflight.mjs';

const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) ||
        !Object.getOwnPropertyDescriptor(value,key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))
    throw Error('INVALID_CONTENT_BUFFER_DISPATCH_OPTIONS');
}

export function prepareContentBufferDispatchIntent(instanceConfig, brief, sourceBuffers,
  proposedCopy, dispatchOptions, mediaOptions={}) {
  // All authority-like fields supplied by a caller are rejected, not trusted.
  exact(dispatchOptions, ['providerOrganizationId']);
  if (typeof dispatchOptions.providerOrganizationId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(dispatchOptions.providerOrganizationId))
    throw Error('INVALID_CONTENT_BUFFER_ORGANIZATION_ID');
  const plan = planContentJobCandidate(instanceConfig,brief);
  const request = prepareContentApprovalRequest(instanceConfig,brief,sourceBuffers,
    proposedCopy,mediaOptions);
  if (plan.planId !== request.planId || plan.tenantId !== request.tenantId ||
      plan.instanceId !== request.instanceId ||
      plan.brief.assetCount !== request.imageDigests.length)
    throw Error('CONTENT_DISPATCH_PLAN_MEDIA_SCOPE_MISMATCH');
  const capability = inspectContentBufferDisclosureCapability({
    schemaVersion:1,product:'content',tenantId:plan.tenantId,
    instanceId:plan.instanceId,planId:plan.planId,
    approvalRequestId:request.approvalRequestId,
    channelService:plan.brief.channelService,
    assetTypes:request.imageDigests.map(()=>'image'),
    aiDisclosure:request.copy.aiDisclosure,caption:request.copy.caption
  });
  // This is a deterministic candidate key, not a provider idempotency key.
  // Concurrent workers must acquire an atomic unique reservation in the
  // shared authorized server-side store before a future publisher can send.
  const dispatchIntentId = 'content-buffer-dispatch-' + hash([1,
    dispatchOptions.providerOrganizationId,plan.tenantId,plan.instanceId,
    plan.planId,plan.brief.channelService,plan.brief.channelId,
    request.approvalRequestId,request.mediaSetId,request.copySha256]);
  // Editorial holds apply to the exact bytes/copy-bound request even when
  // the Buffer API schema alone reports no capability limitation.
  const editorial = inspectContentEditorialCopyFlags(instanceConfig, brief, request);
  const reviewFlags = Object.freeze([...new Set([...capability.flags,
    ...editorial.automatedReviewFlags.filter(flag =>
      flag !== 'AI_DISCLOSURE_UNRESOLVED')])].sort());
  // UNKNOWN already maps to AI_PROVENANCE_UNRESOLVED in capability preflight.
  const reviewRequired = reviewFlags.length > 0;
  return Object.freeze({
    schemaVersion:1,product:'content',tenantId:plan.tenantId,
    instanceId:plan.instanceId,planId:plan.planId,
    provider:'buffer',providerOrganizationId:dispatchOptions.providerOrganizationId,
    channelService:plan.brief.channelService,channelId:plan.brief.channelId,
    approvalRequestId:request.approvalRequestId,mediaSetId:request.mediaSetId,
    copySha256:request.copySha256,assetCount:request.imageDigests.length,
    dispatchIntentId,capabilityPreflightId:capability.capabilityPreflightId,
    status:reviewRequired?'CAPABILITY_REVIEW_REQUIRED':'ATOMIC_RESERVATION_AND_APPROVAL_REQUIRED',
    reviewFlags,
    independentGenerationVerified:false,visualEditorialQaVerified:false,
    providerAccountCapabilityVerified:false,authenticatedApprovalVerified:false,
    atomicReservationVerified:false,providerUploadVerified:false,
    providerSentVerified:false,measurementVerified:false,
    sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false
  });
}
