import { createHash } from "node:crypto";

/**
 * DEMAND-only immutable creative handoff boundary. CONTENT owns generation,
 * storage and visual/editorial QA; this never approves or uploads Meta ads.
 * The caller must independently authenticate tenant access and fetch actual
 * immutable media bytes from its trusted tenant-scoped storage service.
 */
type CreativeRecord = Readonly<{
  tenantId: string; assetId: string; creativeVersion: string;
  brandInstanceId: string; presetId: string; presetVersion: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  bytes: number; sha256: string;
  mediaQa: "PASSED"; editorialQa: "APPROVED";
  logoEvidence: "OFFICIAL_APPROVED" | "NO_LOGO";
  claimsEvidence: "VERIFIED" | "NO_CLAIMS";
  aiDisclosure: "REVIEWED";
  status: "APPROVED";
  approvalEvidenceId: string;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,127}$/;
const hash = /^[0-9a-f]{64}$/;
const deny = (): never => { throw new Error("BROS_DEMAND_CREATIVE_INTAKE_DENIED"); };
function signature(mime: CreativeRecord["mime"], data: Uint8Array): boolean {
  if (mime === "image/png") return data.length >= 24 &&
    [137,80,78,71,13,10,26,10].every((v,i) => data[i] === v) &&
    data[12] === 73 && data[13] === 72 && data[14] === 68 && data[15] === 82;
  if (mime === "image/jpeg") return data.length >= 4 &&
    data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 &&
    data[data.length - 1] === 217;
  return data.length >= 16 && String.fromCharCode(...data.subarray(0,4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8,12)) === "WEBP";
}
export function prepareDemandCreativeIntake(
  tenantId: string, record: CreativeRecord, media: Uint8Array,
) {
  if (!uuid.test(tenantId) || !record || !uuid.test(record.tenantId) ||
      record.tenantId.toLowerCase() !== tenantId.toLowerCase() ||
      ![record.assetId, record.creativeVersion, record.brandInstanceId,
        record.presetId, record.presetVersion, record.approvalEvidenceId].every(v =>
        typeof v === "string" && id.test(v)) ||
      record.status !== "APPROVED" || record.mediaQa !== "PASSED" ||
      record.editorialQa !== "APPROVED" ||
      !["OFFICIAL_APPROVED", "NO_LOGO"].includes(record.logoEvidence) ||
      !["VERIFIED", "NO_CLAIMS"].includes(record.claimsEvidence) ||
      record.aiDisclosure !== "REVIEWED" ||
      !["image/png", "image/jpeg", "image/webp"].includes(record.mime) ||
      !Number.isSafeInteger(record.bytes) || record.bytes < 32 ||
      record.bytes > 15_000_000 || !hash.test(record.sha256) ||
      !(media instanceof Uint8Array) || media.byteLength !== record.bytes ||
      !signature(record.mime, media) ||
      createHash("sha256").update(media).digest("hex") !== record.sha256) deny();
  return Object.freeze({
    assetId: record.assetId, creativeVersion: record.creativeVersion,
    brandInstanceId: record.brandInstanceId,
    mediaSha256: record.sha256, mime: record.mime, bytes: record.bytes,
    approvalEvidenceId: record.approvalEvidenceId,
    state: "INTAKE_VERIFIED_NOT_AD_APPROVED" as const,
    metaUploadAllowed: false as const, campaignExecutionAllowed: false as const,
  });
}
