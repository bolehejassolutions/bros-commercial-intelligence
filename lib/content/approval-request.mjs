// CONTENT-only, nonexecuting human-review request for one exact plan, media set and copy.
// Source bytes are rechecked here; a caller-provided media QA/approval summary is never trusted.
// Does NOT authenticate an approver, approve content, publish, or write shared BCI/Neon.
import {createHash} from "node:crypto";
import {inspectPlannedContentPngBytes} from "./plan-source-byte-gate.mjs";

const digest = x => createHash("sha256").update(JSON.stringify(x)).digest("hex");
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length ||
      Reflect.ownKeys(value).some(k => typeof k !== "string" || !keys.includes(k) ||
        !Object.getOwnPropertyDescriptor(value, k)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), "value")))
    throw Error("INVALID_" + label);
}
function copy(value, label, min, max, allowNewlines=false) {
  // Real Buffer captions may contain LF-separated paragraphs; alt text and IDs may not.
  // Preserve exact caption bytes for approval identity; reject CR, TAB, NUL and other controls.
  if (typeof value !== "string" || value !== value.trim() ||
      value.length < min || value.length > max ||
      (allowNewlines ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value))
    throw Error("INVALID_" + label);
  return value;
}
function strictArray(value, label, max) {
  if (!Array.isArray(value) || value.length > max ||
      Reflect.ownKeys(value).length !== value.length + 1 ||
      !Array.from({length:value.length}, (_,i) => i).every(i => {
        const d=Object.getOwnPropertyDescriptor(value,String(i));
        return d?.enumerable && Object.hasOwn(d,"value");
      }))throw Error("INVALID_" + label);
  return value;
}
function reviewCopy(input, expectedAssets) {
  exact(input,["schemaVersion","caption","altTexts","aiDisclosure","claimEvidenceRefs"],"CONTENT_REVIEW_COPY_FIELDS");
  if (input.schemaVersion !== 1)throw Error("INVALID_CONTENT_REVIEW_VERSION");
  const caption=copy(input.caption,"CONTENT_CAPTION",2,5000,true);
  const altTexts=strictArray(input.altTexts,"CONTENT_ALT_TEXTS",20)
    .map(x=>copy(x,"CONTENT_ALT_TEXT",2,500));
  if (altTexts.length !== expectedAssets)throw Error("CONTENT_ALT_TEXT_COUNT_MISMATCH");
  if (!["DECLARED_AI","DECLARED_NON_AI","UNKNOWN"].includes(input.aiDisclosure))
    throw Error("INVALID_CONTENT_AI_DISCLOSURE");
  const refs=strictArray(input.claimEvidenceRefs,"CONTENT_CLAIM_REFS",20)
    .map(x=>copy(x,"CONTENT_CLAIM_REF",2,128));
  if (refs.some(x=>!/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/.test(x)) ||
      new Set(refs).size !== refs.length)throw Error("INVALID_CONTENT_CLAIM_REFS");
  return Object.freeze({caption,altTexts:Object.freeze(altTexts),
    aiDisclosure:input.aiDisclosure,claimEvidenceRefs:Object.freeze(refs)});
}
export function prepareContentApprovalRequest(instanceConfig, brief, sourceBuffers, proposedCopy, options={}) {
  const media=inspectPlannedContentPngBytes(instanceConfig,brief,sourceBuffers,options);
  const creative=reviewCopy(proposedCopy,media.images.length);
  // Copy, disclosure and declared evidence references are all version-bound.
  // Media slot order and rendered pixels are already bound by mediaSetId.
  const copySha256=digest([1,creative.caption,creative.altTexts,
    creative.aiDisclosure,creative.claimEvidenceRefs]);
  const approvalRequestId="content-review-"+digest([1,media.tenantId,media.instanceId,
    media.planId,media.mediaSetId,copySha256]);
  return Object.freeze({
    schemaVersion:1,product:"content",tenantId:media.tenantId,
    instanceId:media.instanceId,planId:media.planId,mediaSetId:media.mediaSetId,
    approvalRequestId,copySha256,copy:creative,
    imageDigests:Object.freeze(media.images.map(x=>Object.freeze({
      slot:x.slot,sha256:x.sha256,renderedRgbaSha256:x.renderedRgbaSha256
    }))),
    status:"REVIEW_REQUEST_ONLY",sourceBytesStructurallyVerified:true,
    distinctRenderedPixelsVerified:true,
    independentGenerationVerified:false,editorialQaVerified:false,
    aiDisclosureVerified:false,claimEvidenceVerified:false,
    approvalAuthenticated:false,approvalGranted:false,
    providerCapabilityVerified:false,providerSentVerified:false,
    measurementVerified:false,learningVerified:false,sharedBciAuditVerified:false,
    executionAllowed:false,customerSaasReady:false
  });
}
