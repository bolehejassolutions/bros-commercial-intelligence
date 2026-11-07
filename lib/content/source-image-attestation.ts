/**
 * INTERNAL BROS CONTENT source-byte inspection. Not a full decoder, published-media
 * attestation, or provider upload proof. Never infer MIME from filename alone.
 */
import { createHash } from "node:crypto";

export type SupportedImageMime = "image/png" | "image/jpeg";
export type ImageMetadata = Readonly<{
  declaredSourceMime?: string | null;
  providerReportedMime?: string | null;
}>;
export type SourceImageAttestation = Readonly<{
  sha256: string;
  byteLength: number;
  detectedMime: SupportedImageMime;
  width: number;
  height: number;
  sourceMimeMatches: boolean | null;
  providerMimeMatchesSource: boolean | null;
  warnings: readonly ("source_mime_mismatch" | "provider_mime_differs_from_source")[];
  verification: "source_container_only";
  publishedBytesVerified: false;
}>;

const MAX_BYTES = 20 * 1024 * 1024;
const fail = (): never => { throw new Error("Invalid or unsupported CONTENT source image"); };
const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
const equals = (bytes: Uint8Array, at: number, signature: readonly number[]) =>
  at + signature.length <= bytes.length && signature.every((b, i) => bytes[at + i] === b);
const read32 = (b: Uint8Array, i: number) =>
  ((b[i]! * 0x1000000) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!) >>> 0;
const read16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const validDimension = (n: number) => Number.isSafeInteger(n) && n >= 1 && n <= 16384;

function pngDimensions(b: Uint8Array): [number, number] {
  // CRC and compressed IDAT are NOT checked: perform full decoding separately.
  if (b.length < 45 || !equals(b, 0, pngMagic) || read32(b, 8) !== 13 ||
      !equals(b, 12, [73, 72, 68, 82]) ||
      !equals(b, b.length - 12, [0, 0, 0, 0, 73, 69, 78, 68])) fail();
  const width = read32(b, 16), height = read32(b, 20);
  if (!validDimension(width) || !validDimension(height) ||
      ![1, 2, 4, 8, 16].includes(b[24]!) || ![0, 2, 3, 4, 6].includes(b[25]!)) fail();
  return [width, height];
}

function jpegDimensions(b: Uint8Array): [number, number] {
  if (b.length < 16 || !equals(b, 0, [255, 216, 255]) ||
      !equals(b, b.length - 2, [255, 217])) fail();
  let offset = 2;
  let dimensions: [number, number] | null = null;
  while (offset + 4 <= b.length - 2) {
    if (b[offset] !== 255) fail();
    while (offset < b.length && b[offset] === 255) offset++;
    const marker = b[offset++];
    if (marker === undefined || marker === 0 || marker === 255) fail();
    if (marker === 0xD9 || marker === 0xDA) break; // no entropy-stream decode
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) continue;
    if (offset + 2 > b.length - 2) fail();
    const length = read16(b, offset);
    if (length < 2 || offset + length > b.length - 2) fail();
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      if (length < 8 || dimensions !== null) fail();
      const height = read16(b, offset + 3), width = read16(b, offset + 5);
      if (!validDimension(width) || !validDimension(height)) fail();
      dimensions = [width, height];
    }
    offset += length;
  }
  if (dimensions === null) return fail();
  return dimensions;
}

export function inspectContentSourceImage(
  input: Uint8Array,
  metadata: ImageMetadata = {},
): SourceImageAttestation {
  if (!(input instanceof Uint8Array) || input.length > MAX_BYTES || input.length < 16 ||
      metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) fail();
  for (const key of ["declaredSourceMime", "providerReportedMime"] as const) {
    const value = metadata[key];
    if (value !== undefined && value !== null &&
        (typeof value !== "string" || value.length > 128)) fail();
  }
  const png = equals(input, 0, pngMagic);
  const detectedMime: SupportedImageMime = png ? "image/png" : "image/jpeg";
  const [width, height] = png ? pngDimensions(input) : jpegDimensions(input);
  const sourceMimeMatches = metadata.declaredSourceMime == null ? null :
    metadata.declaredSourceMime.toLowerCase() === detectedMime;
  const providerMimeMatchesSource = metadata.providerReportedMime == null ? null :
    metadata.providerReportedMime.toLowerCase() === detectedMime;
  const warnings: SourceImageAttestation["warnings"][number][] = [];
  if (sourceMimeMatches === false) warnings.push("source_mime_mismatch");
  if (providerMimeMatchesSource === false) warnings.push("provider_mime_differs_from_source");
  return Object.freeze({
    sha256: createHash("sha256").update(input).digest("hex"),
    byteLength: input.length, detectedMime, width, height,
    sourceMimeMatches, providerMimeMatchesSource,
    warnings: Object.freeze(warnings),
    verification: "source_container_only" as const,
    publishedBytesVerified: false as const,
  });
}
