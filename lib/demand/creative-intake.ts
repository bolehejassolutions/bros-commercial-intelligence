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
/** Validate PNG chunk framing and CRC32; a matching hash is not decoding proof. */
function validPngChunks(data: Uint8Array): boolean {
  const read32 = (i: number) =>
    (data[i] * 0x1000000 + data[i + 1] * 65536 + data[i + 2] * 256 + data[i + 3]) >>> 0;
  let offset = 8, count = 0, seenIdat = false, seenEnd = false;
  let idatClosed = false;
  while (offset + 12 <= data.length && count++ < 512) {
    const length = read32(offset);
    if (length > data.length - offset - 12) return false;
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (count === 1 && (type !== "IHDR" || length !== 13)) return false;
    if (type === "IHDR" && count !== 1) return false;
    // Reject unknown critical chunks, repeated IHDR, and noncontiguous IDAT.
    // Ancillary chunks may be present, but cannot interrupt an IDAT sequence
    // that later resumes. These are PNG structural rules, not decode proof.
    if (type[0] === type[0].toUpperCase() &&
        !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) return false;
    if (type === "IDAT") {
      if (idatClosed || length === 0) return false;
      seenIdat = true;
    } else if (seenIdat) idatClosed = true;
    if (type === "PLTE" && (seenIdat || length === 0 || length % 3 !== 0 ||
        length > 768)) return false;
    if (type === "IEND" && (length !== 0 || !seenIdat)) return false;
    let crc = 0xffffffff;
    for (let i = offset + 4; i < offset + 8 + length; i++) {
      crc ^= data[i];
      for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== read32(offset + 8 + length)) return false;
    offset += 12 + length;
    if (type === "IEND") { seenEnd = true; break; }
  }
  return seenEnd && offset === data.length;
}
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
    // IHDR: legal bit-depth/color-type pairs, compression/filter method 0,
    // and interlace method 0 (none) or 1 (Adam7).
    const bitDepth = data[24], colorType = data[25];
    const legalDepths: Record<number, readonly number[]> = {
      0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8],
      4: [8, 16], 6: [8, 16],
    };
    return width > 0 && height > 0 && width <= 8192 && height <= 8192 &&
      Array.isArray(legalDepths[colorType]) &&
      legalDepths[colorType].includes(bitDepth) &&
      data[26] === 0 && data[27] === 0 &&
      (data[28] === 0 || data[28] === 1) &&
      validPngChunks(data) &&
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
  // A WebP RIFF header must declare the exact container size. Otherwise a
  // matching hash can still describe a truncated or trailing-data container.
  if (data.length < 20 ||
      String.fromCharCode(...data.subarray(0,4)) !== "RIFF" ||
      String.fromCharCode(...data.subarray(8,12)) !== "WEBP") return false;
  const declared = (data[4] + data[5] * 256 + data[6] * 65536 +
    data[7] * 16777216) >>> 0;
  const chunk = String.fromCharCode(...data.subarray(12,16));
  const chunkLength = (data[16] + data[17] * 256 + data[18] * 65536 +
    data[19] * 16777216) >>> 0;
  return declared === data.length - 8 && ["VP8 ", "VP8L", "VP8X"].includes(chunk) &&
    chunkLength > 0 && chunkLength <= data.length - 20 &&
    20 + chunkLength + (chunkLength % 2) === data.length;
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
