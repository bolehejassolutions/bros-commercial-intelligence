import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDemandCreativeAdmission } from "../lib/demand/creative-admission.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const assetId = "asset:immutable:001", creativeVersion = "version:001";
const request = { assetId, creativeVersion };
const media = Uint8Array.from([
  137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
  0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,
  0,0,0,13,73,68,65,84,120,156,99,248,207,192,240,31,
  0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130,
]);
const record = {
  tenantId, assetId, creativeVersion, brandInstanceId: "brand:bros_sell",
  presetId: "preset:natural_my_ugc", presetVersion: "preset:v1",
  mime: "image/png", bytes: media.length,
  sha256: createHash("sha256").update(media).digest("hex"),
  mediaQa: "PASSED", editorialQa: "APPROVED", status: "APPROVED",
  logoEvidence: "NO_LOGO", claimsEvidence: "NO_CLAIMS",
  aiDisclosure: "REVIEWED", approvalEvidenceId: "approval:editorial:001",
};
const grant = { principalId: userId, tenantId, product: "demand", active: true };
const approval = { tenantId, product: "demand", purpose: "CREATIVE_REVIEW", assetId, creativeVersion,
  brandInstanceId: record.brandInstanceId,
  mediaSha256: record.sha256, approvalEvidenceId: record.approvalEvidenceId, logoAssetVersionId: null };
const denied = /BROS_DEMAND_CREATIVE_ADMISSION_DENIED/;
const fixture = (patch = {}) => {
  const calls = { auth: 0, membership: 0, metadata: 0, bytes: 0, approval: 0 };
  const deps = {
    authenticate: async () => { calls.auth++; return { userId, authenticated: true }; },
    membershipsFor: async id => { calls.membership++; assert.equal(id, userId); return [grant]; },
    approvedRecordFor: async (tenant, asset, version) => {
      calls.metadata++; assert.equal(tenant, tenantId);
      assert.equal(asset, assetId); assert.equal(version, creativeVersion); return record;
    },
    mediaFor: async (tenant, asset, version) => {
      calls.bytes++; assert.equal(tenant, tenantId);
      assert.equal(asset, assetId); assert.equal(version, creativeVersion); return media;
    },
    verifyApproval: async input => {
      calls.approval++; assert.deepEqual(input, record); return approval;
    },
    ...patch,
  };
  return { deps, calls };
};
test("authorized immutable bytes require membership and metadata recheck, remain non-executable", async () => {
  const { deps, calls } = fixture();
  const result = await createDemandCreativeAdmission(deps)(request);
  assert.deepEqual(calls, { auth: 1, membership: 2, metadata: 2, bytes: 1, approval: 1 });
  assert.equal(result.mediaSha256, record.sha256);
  assert.equal(result.state, "INTAKE_VERIFIED_NOT_AD_APPROVED");
  assert.equal(result.membershipRecheckedAfterRead, true);
  assert.equal(result.approvalRecheckedAfterRead, true);
  assert.equal(result.approvalIndependentlyAttested, true);
  assert.equal(result.logoAssetVersionId, null);
  assert.equal(result.metaUploadAllowed, false);
  assert.equal(result.campaignExecutionAllowed, false);
  assert.equal(JSON.stringify(result).includes(tenantId), false);
  assert.equal(Object.isFrozen(result), true);
});
test("request cannot select tenant, principal, URL, approval or other asset", async () => {
  const { deps, calls } = fixture();
  const read = createDemandCreativeAdmission(deps);
  for (const bad of [null, {}, { ...request, tenantId }, { ...request, userId },
    { ...request, url: "https://example.test/foreign" },
    { ...request, approved: true }, { assetId: "../foreign", creativeVersion },
    { assetId, creativeVersion: "" }, { assetId: [assetId], creativeVersion },
    { assetId, creativeVersion: [creativeVersion] }]) await assert.rejects(read(bad), denied);
  assert.deepEqual(calls, { auth: 0, membership: 0, metadata: 0, bytes: 0, approval: 0 });
});
test("authentication and grants deny before any media read", async () => {
  for (const patch of [
    { authenticate: async () => null },
    { authenticate: async () => ({ userId, authenticated: false }) },
    { membershipsFor: async () => [] },
    { membershipsFor: async () => [grant, grant] },
    { membershipsFor: async () => [{ ...grant, active: false }] },
    { membershipsFor: async () => [{ ...grant, product: "content" }] },
    { membershipsFor: async () => [{ ...grant, tenantId: userId }] },
  ]) {
    const { deps, calls } = fixture(patch);
    await assert.rejects(createDemandCreativeAdmission(deps)(request), denied);
    assert.equal(calls.bytes, 0);
  }
});
test("cross-tenant metadata, wrong version, missing bytes and altered bytes deny", async () => {
  for (const patch of [
    { approvedRecordFor: async () => ({ ...record, tenantId: userId }) },
    { approvedRecordFor: async () => ({ ...record, creativeVersion: "version:002" }) },
    { approvedRecordFor: async () => null },
    { mediaFor: async () => null },
    { mediaFor: async () => Uint8Array.from(media, (v, i) => i === 45 ? v ^ 1 : v) },
  ]) {
    const { deps } = fixture(patch);
    await assert.rejects(createDemandCreativeAdmission(deps)(request), denied);
  }
});
test("membership revocation or editorial metadata replacement during byte fetch denies", async () => {
  let reads = 0;
  const revoked = fixture({ membershipsFor: async () => ++reads === 1 ? [grant] : [] });
  await assert.rejects(createDemandCreativeAdmission(revoked.deps)(request), denied);
  let metadataReads = 0;
  const changed = fixture({ approvedRecordFor: async () =>
    ++metadataReads === 1 ? record : { ...record, editorialQa: "PENDING" } });
  await assert.rejects(createDemandCreativeAdmission(changed.deps)(request), denied);
});
test("secret-bearing storage errors are sanitized and dependency validation is fail closed", async () => {
  assert.throws(() => createDemandCreativeAdmission({}), denied);
  const { deps } = fixture({ mediaFor: async () => { throw Error("private-storage-secret"); } });
  await assert.rejects(createDemandCreativeAdmission(deps)(request),
    error => error.message === "BROS_DEMAND_CREATIVE_ADMISSION_DENIED" &&
      !error.message.includes("private-storage-secret"));
});

test("approval must bind the exact original, tenant, version and official logo proof", async () => {
  const official = { ...record, logoEvidence: "OFFICIAL_APPROVED" };
  const proof = { ...approval, logoAssetVersionId: "logo:approved:001" };
  for (const badProof of [
    null, { ...proof, tenantId: userId }, { ...proof, product: "content" },
    { ...proof, purpose: "PUBLISH" }, { ...proof, creativeVersion: "version:other" },
    { ...proof, brandInstanceId: "brand:other" }, { ...proof, mediaSha256: "a".repeat(64) },
    { ...proof, approvalEvidenceId: "approval:other" }, { ...proof, logoAssetVersionId: null },
    { ...proof, logoAssetVersionId: ["logo:approved:001"] },
  ]) {
    const { deps } = fixture({ approvedRecordFor: async () => official, verifyApproval: async () => badProof });
    await assert.rejects(createDemandCreativeAdmission(deps)(request), denied);
  }
  const wrongLogo = fixture({ verifyApproval: async () => proof });
  await assert.rejects(createDemandCreativeAdmission(wrongLogo.deps)(request), denied);
  const { deps } = fixture({ approvedRecordFor: async () => official, verifyApproval: async () => proof });
  const result = await createDemandCreativeAdmission(deps)(request);
  assert.equal(result.logoAssetVersionId, proof.logoAssetVersionId);
  assert.equal(result.metaUploadAllowed, false);
});

test("mutable callback records cannot swap evidence during a media read", async () => {
  const mutable = { ...record };
  const { deps } = fixture({
    approvedRecordFor: async () => mutable,
    mediaFor: async () => {
      mutable.approvalEvidenceId = "approval:editorial:other";
      return media;
    },
  });
  await assert.rejects(createDemandCreativeAdmission(deps)(request), denied);
});
