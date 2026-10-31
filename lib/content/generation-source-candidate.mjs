// CONTENT product-layer candidate binding: claimed generation receipts + actual PNG bytes.
// Pure/offline only. A caller-supplied receipt is NOT provider-authenticated evidence.
// No generation API, credentials, approval, publisher, or shared BCI/Neon writes.
import {createHash} from 'node:crypto';
import {prepareContentIndependentImageIntents} from './generation-intent.mjs';
import {inspectPlannedContentPngBytes} from './plan-source-byte-gate.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length ||
      Reflect.ownKeys(value).some(key => {
        if (typeof key !== 'string' || !keys.includes(key)) return true;
        const d=Object.getOwnPropertyDescriptor(value,key);
        return !d?.enumerable || !Object.hasOwn(d,'value');
      })) throw Error('INVALID_CONTENT_' + label);
}
function exactArray(value,count) {
  if (!Array.isArray(value) || value.length!==count ||
      Reflect.ownKeys(value).length!==count+1 ||
      !Array.from({length:count},(_,i)=>i).every(i=>{
        const d=Object.getOwnPropertyDescriptor(value,String(i));
        return d?.enumerable && Object.hasOwn(d,'value');
      })) throw Error('INVALID_CONTENT_GENERATION_RECEIPTS');
}
function timestamp(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString()===value;
}

// Receipts are *claims*, even if their operation IDs and timestamps are distinct.
// Recompute both plan and actual PNG source-byte QA; never trust client QA booleans.
export function inspectContentGenerationSourceCandidates(config,brief,slotInstructions,receiptClaims,sourceBuffers,options={}) {
  const intent=prepareContentIndependentImageIntents(config,brief,slotInstructions);
  exactArray(receiptClaims,intent.jobs.length);
  const receipts=receiptClaims.map((claim,i)=>{
    exact(claim,['slot','generationIntentId','provider','operationId','receiptId','claimedGeneratedAt'],'GENERATION_RECEIPT');
    if(claim.slot!==i+1 || claim.generationIntentId!==intent.jobs[i].generationIntentId)
      throw Error('CONTENT_GENERATION_INTENT_RECEIPT_MISMATCH');
    if(typeof claim.provider!=='string' || !/^[a-z][a-z0-9_-]{1,39}$/.test(claim.provider) ||
       typeof claim.operationId!=='string' || !/^[A-Za-z0-9._:-]{6,160}$/.test(claim.operationId) ||
       typeof claim.receiptId!=='string' || !/^[A-Za-z0-9._:-]{6,160}$/.test(claim.receiptId) ||
       !timestamp(claim.claimedGeneratedAt))
      throw Error('INVALID_CONTENT_GENERATION_RECEIPT_CLAIM');
    return Object.freeze({
      slot:claim.slot,generationIntentId:claim.generationIntentId,
      provider:claim.provider,operationId:claim.operationId,
      receiptId:claim.receiptId,claimedGeneratedAt:claim.claimedGeneratedAt
    });
  });
  if(new Set(receipts.map(r=>r.provider+'\0'+r.operationId)).size!==receipts.length ||
     new Set(receipts.map(r=>r.provider+'\0'+r.receiptId)).size!==receipts.length)
    throw Error('CONTENT_REUSED_GENERATION_OPERATION_OR_RECEIPT');
  const qa=inspectPlannedContentPngBytes(config,brief,sourceBuffers,options);
  if(qa.planId!==intent.planId || qa.images.length!==receipts.length)
    throw Error('CONTENT_GENERATION_MEDIA_PLAN_MISMATCH');
  const images=Object.freeze(qa.images.map((im,i)=>Object.freeze({
    slot:im.slot,generationIntentId:receipts[i].generationIntentId,
    claimedProvider:receipts[i].provider,
    receiptClaimSha256:digest([1,receipts[i]]),
    sourceSha256:im.sha256,renderedRgbaSha256:im.renderedRgbaSha256,
    byteLength:im.byteLength
  })));
  return Object.freeze({
    schemaVersion:1,product:'content',tenantId:intent.tenantId,
    instanceId:intent.instanceId,planId:intent.planId,
    generationBatchId:intent.generationBatchId,mediaSetId:qa.mediaSetId,
    candidateId:'content-generation-source-candidate-'+digest([1,intent.generationBatchId,qa.mediaSetId,images]),
    images,status:'UNATTESTED_GENERATION_RECEIPTS_WITH_SOURCE_PNG_QA',
    sourceBytesStructurallyVerified:true,distinctRenderedPixelsVerified:true,
    receiptClaimsFormatChecked:true,providerReceiptAuthenticated:false,
    providerCapabilityVerified:false,independentGenerationVerified:false,
    visualEditorialQaVerified:false,approvalAuthenticated:false,approvalGranted:false,
    providerSentVerified:false,measurementVerified:false,learningVerified:false,
    sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false
  });
}
