// CONTENT product layer: bind local renderer manifest to the canonical plan and actual PNG bytes.
// A manifest is untrusted input, not proof of generation, editorial approval or provider authority.
import {planContentJobCandidate} from './instance-plan.mjs';
import {inspectPlannedContentPngBytes} from './plan-source-byte-gate.mjs';

const hex = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length ||
      Reflect.ownKeys(value).some(k => {
        if (typeof k !== 'string' || !fields.includes(k)) return true;
        const d = Object.getOwnPropertyDescriptor(value, k);
        return !d?.enumerable || !Object.hasOwn(d, 'value');
      })) throw Error('INVALID_' + label);
}
const manifestFields = ['schemaVersion','renderer','planId','planIdAuthenticated',
  'status','localMediaBytesDecoded','externalAiProviderGenerationVerified',
  'providerReceiptAuthenticated','editorialApprovalVerified','bufferSentVerified',
  'sharedBciAuditVerified','executionAllowed','customerSaasReady','images'];
const imageFields = ['slot','filename','byteLength','sourceSha256','decodedRgbSha256'];

export function bindLocalContentRenderToPlan(instanceConfig, brief, rendererManifest,
  sourceBuffers, mediaOptions = {}) {
  const plan = planContentJobCandidate(instanceConfig, brief);
  exact(rendererManifest, manifestFields, 'CONTENT_LOCAL_RENDER_MANIFEST');
  if (rendererManifest.schemaVersion !== 1 ||
      rendererManifest.renderer !== 'content-local-card-pillow-v1' ||
      rendererManifest.status !== 'LOCAL_TEMPLATE_RENDERED_EDITORIAL_PENDING' ||
      rendererManifest.planId !== plan.planId ||
      rendererManifest.planIdAuthenticated !== false ||
      rendererManifest.localMediaBytesDecoded !== true ||
      ['externalAiProviderGenerationVerified','providerReceiptAuthenticated',
       'editorialApprovalVerified','bufferSentVerified','sharedBciAuditVerified',
       'executionAllowed','customerSaasReady'].some(k => rendererManifest[k] !== false))
    throw Error('CONTENT_LOCAL_RENDER_PLAN_OR_AUTHORITY_MISMATCH');
  const records = rendererManifest.images;
  if (!Array.isArray(records) || records.length !== plan.brief.assetCount ||
      Reflect.ownKeys(records).length !== records.length + 1 ||
      !Array.from({length:records.length}, (_,i) => {
        const d=Object.getOwnPropertyDescriptor(records,String(i));
        return d?.enumerable && Object.hasOwn(d,'value');
      })) throw Error('CONTENT_LOCAL_RENDER_ASSET_COUNT_MISMATCH');
  // Decode original PNG bytes again. The manifest's hashes and pixel claims
  // cannot substitute for independent source-byte validation.
  const media = inspectPlannedContentPngBytes(instanceConfig, brief, sourceBuffers, mediaOptions);
  for (let i=0;i<records.length;i++) {
    const record=records[i], observed=media.images[i];
    exact(record,imageFields,'CONTENT_LOCAL_RENDER_IMAGE');
    if (record.slot !== i+1 || record.filename !== 'content_card_' +
        String(i+1).padStart(2,'0') + '.png' ||
        !Number.isSafeInteger(record.byteLength) ||
        !hex(record.sourceSha256) || !hex(record.decodedRgbSha256) ||
        record.byteLength !== observed.byteLength ||
        record.sourceSha256 !== observed.sha256 ||
        // The manifest's decoded RGB digest must match independently decoded bytes.
        // A valid source hash alone cannot authenticate a forged pixel claim.
        record.decodedRgbSha256 !== observed.decodedRgbSha256)
      throw Error('CONTENT_LOCAL_RENDER_BYTES_OR_ORDER_MISMATCH');
  }
  return Object.freeze({
    schemaVersion:1, product:'content', tenantId:plan.tenantId,
    instanceId:plan.instanceId, planId:plan.planId, mediaSetId:media.mediaSetId,
    status:'LOCAL_RENDER_PLAN_BOUND_REVIEW_ONLY',
    sourceBytesStructurallyVerified:true, distinctRenderedPixelsVerified:true,
    rendererManifestAttested:false, localGenerationAuthenticated:false,
    independentAiGenerationVerified:false, editorialApprovalVerified:false,
    bufferSentVerified:false, measurementVerified:false, learningVerified:false,
    sharedBciAuditVerified:false, executionAllowed:false, customerSaasReady:false,
    images:media.images
  });
}
