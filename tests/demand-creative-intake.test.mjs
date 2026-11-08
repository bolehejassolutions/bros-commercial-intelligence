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
