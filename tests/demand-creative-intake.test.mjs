import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareDemandCreativeIntake } from "../lib/demand/creative-intake.ts";

const tenantId = "11111111-1111-4111-8111-111111111111";
// Valid, independently encoded 1x1 RGBA PNG: IHDR + IDAT + IEND with CRCs.
const media = Uint8Array.from([
  137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
  0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,
  0,0,0,13,73,68,65,84,120,156,99,248,207,192,240,31,
  0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130,
]);
const sha256 = createHash("sha256").update(media).digest("hex");
const approved = {
  tenantId, assetId: "asset:immutable:001", creativeVersion: "version:001",
  brandInstanceId: "brand:bros_sell", presetId: "preset:natural_my_ugc",
  presetVersion: "preset:v1", mime: "image/png", bytes: media.length, sha256,
  mediaQa: "PASSED", editorialQa: "APPROVED", status: "APPROVED",
  logoEvidence: "NO_LOGO", claimsEvidence: "NO_CLAIMS",
  aiDisclosure: "REVIEWED", approvalEvidenceId: "approval:editorial:001",
};
const denied = /BROS_DEMAND_CREATIVE_INTAKE_DENIED/;
test("tenant-authorized approved immutable media is a NON-executable intake only", () => {
  const result = prepareDemandCreativeIntake(tenantId, approved, media);
  assert.equal(result.state, "INTAKE_VERIFIED_NOT_AD_APPROVED");
  assert.equal(result.metaUploadAllowed, false);
  assert.equal(result.campaignExecutionAllowed, false);
  assert.equal(result.mediaSha256, sha256);
  assert.equal(JSON.stringify(result).includes(tenantId), false);
  assert.equal(Object.isFrozen(result), true);
});
test("cross-tenant, missing bytes, altered bytes, false QA and absent approval fail closed", () => {
  const other = "22222222-2222-4222-8222-222222222222";
  for (const [tenant, record, bytes] of [
    [other, approved, media],
    [tenantId, { ...approved, tenantId: other }, media],
    [tenantId, approved, undefined],
    [tenantId, approved, new Uint8Array()],
    [tenantId, approved, Uint8Array.from(media, (v, i) => i === 27 ? v ^ 1 : v)],
    [tenantId, { ...approved, sha256: "0".repeat(64) }, media],
    [tenantId, { ...approved, bytes: media.length - 1 }, media],
    [tenantId, { ...approved, mediaQa: "NOT_RUN" }, media],
    [tenantId, { ...approved, editorialQa: "PENDING" }, media],
    [tenantId, { ...approved, status: "DRAFT_NOT_GENERATED" }, media],
    [tenantId, { ...approved, approvalEvidenceId: "" }, media],
    [tenantId, { ...approved, logoEvidence: "GENERATED_LOGO" }, media],
    [tenantId, { ...approved, claimsEvidence: "UNVERIFIED" }, media],
    [tenantId, { ...approved, aiDisclosure: "NOT_REVIEWED" }, media],
    [tenantId, { ...approved, mime: "image/jpeg" }, media],
    [tenantId, { ...approved, assetId: "../foreign" }, media],
  ]) assert.throws(() => prepareDemandCreativeIntake(tenant, record, bytes), denied);
});
test("prompt-only CONTENT preset registry cannot be treated as media or editorial approval", () => {
  const draft = {
    ...approved, mediaQa: "NOT_RUN", editorialQa: "NOT_REVIEWED",
    status: "DRAFT_NOT_GENERATED", bytes: 0,
  };
  assert.throws(() => prepareDemandCreativeIntake(tenantId, draft, media), denied);
});

test("PNG creative intake rejects truncated signature, malformed IHDR and invalid dimensions", () => {
  for (const bytes of [
    media.subarray(0, 24),
    Uint8Array.from(media, (v, i) => i === 11 ? 12 : v),
    Uint8Array.from(media, (v, i) => i === 19 ? 0 : v),
    Uint8Array.from(media, (v, i) => i === 23 ? 0 : v),
    Uint8Array.from(media, (v, i) => i === media.length - 8 ? 0 : v),
    Uint8Array.from(media, (v, i) => i === 17 ? 33 : v),
  ]) {
    const record = { ...approved, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") };
    assert.throws(() => prepareDemandCreativeIntake(tenantId, record, bytes), denied);
  }
});

test("WebP intake enforces RIFF declared length, exact chunk boundary and recognized codec", () => {
  const webp = Uint8Array.from([
    82,73,70,70,24,0,0,0,87,69,66,80,
    86,80,56,76,12,0,0,0,47,0,0,0,0,0,0,0,0,0,0,0,
  ]);
  const withMedia = bytes => ({
    ...approved, mime: "image/webp", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const result = prepareDemandCreativeIntake(tenantId, withMedia(webp), webp);
  assert.equal(result.metaUploadAllowed, false);
  assert.equal(result.campaignExecutionAllowed, false);
  for (const bad of [
    webp.subarray(0, 20),
    Uint8Array.from([...webp, 0]),
    Uint8Array.from(webp, (v, i) => i === 4 ? 23 : v),
    Uint8Array.from(webp, (v, i) => i === 12 ? 88 : v),
    Uint8Array.from(webp, (v, i) => i === 16 ? 13 : v),
    Uint8Array.from(webp, (v, i) => i === 16 ? 0 : v),
  ]) assert.throws(() => prepareDemandCreativeIntake(tenantId, withMedia(bad), bad), denied);
});

test("PNG CRC, IDAT presence, exact chunk boundaries and forged matching hashes fail closed", () => {
  const withMedia = bytes => ({
    ...approved, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const changed = (index, value) => Uint8Array.from(media, (v, i) => i === index ? value : v);
  const bad = [
    changed(29, media[29] ^ 1), // IHDR CRC corruption
    changed(45, media[45] ^ 1), // IDAT payload corruption
    changed(57, media[57] ^ 1), // IDAT CRC corruption
    changed(67, media[67] ^ 1), // IEND CRC corruption
    changed(37, 14), // IDAT declared length exceeds its actual chunk
    changed(36, 88), // missing IDAT (unrecognized replacement)
    Uint8Array.from([...media, 0]), // bytes after IEND
    Uint8Array.from([...media.slice(0, 33), ...media.slice(58)]), // missing IDAT
  ];
  for (const bytes of bad)
    assert.throws(() => prepareDemandCreativeIntake(tenantId, withMedia(bytes), bytes), denied);
});

test("PNG rejects illegal IHDR modes and unknown critical chunks even with valid CRC and SHA-256", () => {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const value of bytes) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const write32 = (bytes, at, value) => {
    bytes[at] = (value >>> 24) & 255;
    bytes[at + 1] = (value >>> 16) & 255;
    bytes[at + 2] = (value >>> 8) & 255;
    bytes[at + 3] = value & 255;
  };
  const ihdrChanged = (at, value) => {
    const bytes = Uint8Array.from(media);
    bytes[at] = value;
    write32(bytes, 29, crc32(bytes.subarray(12, 29)));
    return bytes;
  };
  const chunk = (name, payload) => {
    const out = new Uint8Array(12 + payload.length);
    write32(out, 0, payload.length);
    out.set([...name].map(c => c.charCodeAt(0)), 4);
    out.set(payload, 8);
    write32(out, out.length - 4, crc32(out.subarray(4, out.length - 4)));
    return out;
  };
  const insertBeforeIdat = (name, payload) => Uint8Array.from([
    ...media.subarray(0, 33), ...chunk(name, payload), ...media.subarray(33),
  ]);
  const withMedia = bytes => ({
    ...approved, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  for (const bytes of [
    ihdrChanged(24, 3), // RGBA cannot have 3-bit samples
    ihdrChanged(25, 1), // undefined color type
    ihdrChanged(26, 1), // unsupported compression
    ihdrChanged(27, 1), // unsupported filter method
    ihdrChanged(28, 2), // unsupported interlace method
    insertBeforeIdat("ABCD", Uint8Array.of(1)), // unknown critical chunk
    insertBeforeIdat("PLTE", Uint8Array.of(1, 2)), // malformed palette
  ]) {
    assert.throws(() => prepareDemandCreativeIntake(tenantId, withMedia(bytes), bytes), denied);
  }
  // Valid ancillary metadata does not confer ad approval.
  const ancillary = insertBeforeIdat("tEXt", Uint8Array.of(75, 0, 86));
  const result = prepareDemandCreativeIntake(tenantId, withMedia(ancillary), ancillary);
  assert.equal(result.metaUploadAllowed, false);
  assert.equal(result.campaignExecutionAllowed, false);
});

test("untrusted creative records reject accessors, inherited fields and extra grants", () => {
  assert.throws(() => prepareDemandCreativeIntake(tenantId, {...approved, metaUploadAllowed:true}, media), denied);
  assert.throws(() => prepareDemandCreativeIntake(tenantId, Object.assign(Object.create(null),approved), media), denied);
  const inherited=Object.create(approved);
  assert.throws(() => prepareDemandCreativeIntake(tenantId, inherited, media), denied);
  const accessor={...approved};
  Object.defineProperty(accessor,"editorialQa",{enumerable:true,get(){throw Error("MUST_NOT_EXECUTE");}});
  assert.throws(() => prepareDemandCreativeIntake(tenantId,accessor,media), denied);
  const hidden={...approved};
  Object.defineProperty(hidden,"ownerApproved",{value:true,enumerable:false});
  assert.throws(() => prepareDemandCreativeIntake(tenantId,hidden,media), denied);
  const symbol={...approved};
  symbol[Symbol("privilege")]=true;
  assert.throws(() => prepareDemandCreativeIntake(tenantId,symbol,media), denied);
});

test("PNG repeated palette chunks are rejected even with valid CRC and matching media hash", () => {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const value of bytes) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const palette = Uint8Array.of(0, 0, 0, 3, 80, 76, 84, 69, 1, 2, 3, 0, 0, 0, 0);
  const crc = crc32(palette.subarray(4, 11));
  palette.set([(crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], 11);
  const once = Uint8Array.from([...media.subarray(0, 33), ...palette, ...media.subarray(33)]);
  const twice = Uint8Array.from([...media.subarray(0, 33), ...palette, ...palette, ...media.subarray(33)]);
  const record = bytes => ({
    ...approved, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  assert.equal(prepareDemandCreativeIntake(tenantId, record(once), once).metaUploadAllowed, false);
  assert.throws(() => prepareDemandCreativeIntake(tenantId, record(twice), twice), denied);
});


test("PNG palette rules reject indexed images without PLTE, oversized indexed palettes and grayscale PLTE", () => {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const value of bytes) {
      crc ^= value;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const write32 = (out, offset, value) => {
    out[offset] = (value >>> 24) & 255;
    out[offset + 1] = (value >>> 16) & 255;
    out[offset + 2] = (value >>> 8) & 255;
    out[offset + 3] = value & 255;
  };
  const chunk = (type, payload) => {
    const out = new Uint8Array(12 + payload.length);
    write32(out, 0, payload.length);
    out.set([...type].map(c => c.charCodeAt(0)), 4);
    out.set(payload, 8);
    write32(out, out.length - 4, crc32(out.subarray(4, out.length - 4)));
    return out;
  };
  const changeHeader = (depth, type) => {
    const bytes = Uint8Array.from(media);
    bytes[24] = depth; bytes[25] = type;
    write32(bytes, 29, crc32(bytes.subarray(12, 29)));
    return bytes;
  };
  const withPalette = (bytes, entries) => Uint8Array.from([
    ...bytes.subarray(0, 33), ...chunk("PLTE", new Uint8Array(entries * 3)),
    ...bytes.subarray(33),
  ]);
  const record = bytes => ({
    ...approved, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const indexed = changeHeader(1, 3);
  const grayscale = changeHeader(8, 0);
  for (const bytes of [
    indexed,
    withPalette(indexed, 3),
    withPalette(grayscale, 1),
  ]) assert.throws(() => prepareDemandCreativeIntake(tenantId, record(bytes), bytes), denied);
  const validIndexedStructure = withPalette(indexed, 2);
  assert.equal(prepareDemandCreativeIntake(tenantId, record(validIndexedStructure), validIndexedStructure).metaUploadAllowed, false);
});
