// CONTENT-only binding of a deterministic plan to ACTUAL PNG source bytes.
// This pure offline gate never generates images, approves content, authenticates
// a provider, authorizes publication, or writes the shared BCI/Neon core.
import {createHash} from "node:crypto";
import {planContentJobCandidate} from "./instance-plan.mjs";
import {verifyDistinctPngSources} from "./png-source-qa.mjs";

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length ||
      Reflect.ownKeys(value).some(k => typeof k !== "string" || !keys.includes(k) ||
        !Object.getOwnPropertyDescriptor(value, k)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), "value")))
    throw Error("INVALID_CONTENT_MEDIA_QA_OPTIONS");
}

export function inspectPlannedContentPngBytes(instanceConfig, brief, sourceBuffers, options = {}) {
  // Derive identity from the full config+brief, never from a caller-supplied
  // planId or claimed media-QA summary.
  const plan = planContentJobCandidate(instanceConfig, brief);
  exactObject(options, Reflect.ownKeys(options).length === 0 ? [] :
    ["expectedWidth", "expectedHeight"]);
  const expectedWidth = options.expectedWidth ?? 1080;
  const expectedHeight = options.expectedHeight ?? 1350;
  if (!Number.isSafeInteger(expectedWidth) || !Number.isSafeInteger(expectedHeight) ||
      expectedWidth < 1 || expectedHeight < 1 ||
      expectedWidth * expectedHeight > 12_000_000)
    throw Error("INVALID_CONTENT_MEDIA_DIMENSIONS");
  if (!Array.isArray(sourceBuffers) ||
      sourceBuffers.length !== plan.brief.assetCount ||
      Reflect.ownKeys(sourceBuffers).length !== sourceBuffers.length + 1 ||
      !Array.from({length:sourceBuffers.length}, (_,i) => i).every(i =>
        Object.hasOwn(sourceBuffers, i) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(sourceBuffers, String(i)), "value") &&
        Buffer.isBuffer(sourceBuffers[i])))
    throw Error("CONTENT_MEDIA_COUNT_OR_BYTES_MISMATCH");

  // Actual byte decoding, CRC/deflate, dimensions and RGB(A) rendered-pixel
  // uniqueness happen here, not via a client-provided attestation.
  const qa = verifyDistinctPngSources(sourceBuffers, {expectedWidth, expectedHeight});
  const images = Object.freeze(qa.images.map((x,i) => Object.freeze({
    slot:i+1,format:x.format,width:x.width,height:x.height,
    byteLength:x.bytes,sha256:x.sha256,pixelSha256:x.pixelSha256,
    decodedRgbSha256:x.decodedRgbSha256,
    renderedRgbaSha256:x.renderedRgbaSha256
  })));
  const digest = createHash("sha256").update(JSON.stringify([
    1,plan.planId,images.map(x => [x.slot,x.sha256,x.renderedRgbaSha256])
  ])).digest("hex");
  return Object.freeze({
    schemaVersion:1,product:"content",tenantId:plan.tenantId,
    instanceId:plan.instanceId,planId:plan.planId,
    mediaSetId:"content-source-"+digest,status:"SOURCE_BYTE_QA_ONLY",
    images,sourceBytesStructurallyVerified:true,
    distinctSourceBytesVerified:true,distinctRenderedPixelsVerified:true,
    independentGenerationVerified:false,visualEditorialQaVerified:false,
    claimEvidenceVerified:false,approvalAuthenticated:false,
    providerMediaBytesVerified:false,providerCapabilityVerified:false,
    providerSentVerified:false,measurementVerified:false,
    sharedBciAuditVerified:false,executionAllowed:false,
    customerSaasReady:false
  });
}
