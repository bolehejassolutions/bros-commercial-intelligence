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
  if (mime === "image/png") {
    // PNG requires a complete, bounded IHDR and IEND, not merely an
    // eight-byte magic prefix. Decoding/visual QA remains CONTENT-owned.
    if (data.length < 44 ||
        ![137,80,78,71,13,10,26,10].every((v,i) => data[i] === v) ||
        !(data[8] === 0 && data[9] === 0 && data[10] === 0 && data[11] === 13) ||
        !(data[12] === 73 && data[13] === 72 && data[14] === 68 && data[15] === 82)) return false;
    const width = (data[16] * 0x1000000 + (data[17] << 16) + (data[18] << 8) + data[19]) >>> 0;
    const height = (data[20] * 0x1000000 + (data[21] << 16) + (data[22] << 8) + data[23]) >>> 0;
    return width > 0 && height > 0 && width <= 8192 && height <= 8192 &&
      data[data.length - 12] === 0 && data[data.length - 11] === 0 &&
      data[data.length - 10] === 0 && data[data.length - 9] === 0 &&
      data[data.length - 8] === 73 && data[data.length - 7] === 69 &&
      data[data.length - 6] === 78 && data[data.length - 5] === 68 &&
      data[data.length - 4] === 174 && data[data.length - 3] === 66 &&
      data[data.length - 2] === 96 && data[data.length - 1] === 130;
  }
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
