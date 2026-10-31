// CONTENT-only provider-neutral independent image generation *intent*.
// This is a nonexecuting request contract, NOT an image-generation receipt.
// No provider calls, paid credits, approval, publishing, or BCI/Neon writes.
import {createHash} from 'node:crypto';
import {planContentJobCandidate} from './instance-plan.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length ||
      Reflect.ownKeys(value).some(key => {
        if (typeof key !== 'string' || !keys.includes(key)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
      })) throw Error('INVALID_CONTENT_' + label);
}
function boundedText(value, label, max) {
  if (typeof value !== 'string' || value !== value.trim() ||
      value.length < 8 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value))
    throw Error('INVALID_CONTENT_' + label);
  return value;
}
function strictSlots(slots, count) {
  if (!Array.isArray(slots) || slots.length !== count ||
      Reflect.ownKeys(slots).length !== count + 1 ||
      !Array.from({length:count}, (_,i) => i).every(i => {
        const d = Object.getOwnPropertyDescriptor(slots, String(i));
        return d?.enumerable && Object.hasOwn(d, 'value');
      })) throw Error('INVALID_CONTENT_GENERATION_SLOTS');
}

export function prepareContentIndependentImageIntents(instanceConfig, brief, slotInstructions) {
  const plan = planContentJobCandidate(instanceConfig, brief);
  strictSlots(slotInstructions, plan.brief.assetCount);
  const normalized = slotInstructions.map((entry, i) => {
    exact(entry, ['slot','visualBrief','visualDistinction','avoid'], 'GENERATION_SLOT');
    if (entry.slot !== i + 1) throw Error('CONTENT_GENERATION_SLOT_ORDER_MISMATCH');
    const visualBrief = boundedText(entry.visualBrief, 'VISUAL_BRIEF', 1800);
    const visualDistinction = boundedText(entry.visualDistinction, 'VISUAL_DISTINCTION', 600);
    const avoid = boundedText(entry.avoid, 'VISUAL_AVOID', 600);
    return Object.freeze({slot:i+1,visualBrief,visualDistinction,avoid});
  });
  // A distinct slot ID or different generation seed is not independent content.
  // Require a distinct declared visual objective for each slot, but DO NOT
  // claim that a model produced independent images until real receipts exist.
  const normalizedObjectives = normalized.map(x =>
    x.visualDistinction.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu,' ').trim());
  if (new Set(normalizedObjectives).size !== normalizedObjectives.length)
    throw Error('CONTENT_DUPLICATE_VISUAL_OBJECTIVES');
  // Distinct slot labels alone cannot mask a copied image-generation brief.
  // This is a syntactic duplicate guard, not semantic visual QA or provenance.
  const normalizedBriefs = normalized.map(x =>
    x.visualBrief.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu,' ').trim());
  if (new Set(normalizedBriefs).size !== normalizedBriefs.length)
    throw Error('CONTENT_DUPLICATE_VISUAL_BRIEFS');
  const jobs = normalized.map(x => Object.freeze({
    slot:x.slot,
    generationIntentId:'content-image-intent-' + hash([1,plan.planId,x]),
    promptSha256:hash([1,x.visualBrief,x.visualDistinction,x.avoid]),
    instruction:x,
    requiredEvidence:Object.freeze([
      'INDEPENDENT_PROVIDER_GENERATION_OPERATION_ID',
      'PROVIDER_GENERATION_RECEIPT_AND_TIMESTAMP',
      'ACTUAL_SOURCE_IMAGE_BYTES_AND_DECODED_PIXEL_QA',
      'HUMAN_VISUAL_AND_EDITORIAL_REVIEW',
    ]),
    status:'GENERATION_REQUEST_ONLY',providerCapabilityVerified:false,
    providerGenerationVerified:false,sourceBytesVerified:false,
    independentlyGeneratedVerified:false,executionAllowed:false,
  }));
  return Object.freeze({
    schemaVersion:1,product:'content',tenantId:plan.tenantId,
    instanceId:plan.instanceId,planId:plan.planId,
    generationBatchId:'content-image-batch-' + hash([1,plan.planId,jobs.map(x=>x.generationIntentId)]),
    jobs:Object.freeze(jobs),status:'GENERATION_REQUEST_ONLY',
    providerCapabilityVerified:false,providerGenerationVerified:false,
    independentImagesVerified:false,sourceBytesVerified:false,
    editorialQaVerified:false,approvalAuthenticated:false,approvalGranted:false,
    providerSentVerified:false,measurementVerified:false,learningVerified:false,
    sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false,
  });
}
