import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDemandCreativeAdmission } from "../lib/demand/creative-admission.ts";
import { bindDemandCreativeForReview } from "../lib/demand/creative-plan-binding.ts";

const tenantId = "11111111-1111-4111-8111-111111111111";
const principalId = "22222222-2222-4222-8222-222222222222";
const plan = { tenantId, accountId: "act_1997776120879476", campaignPlanDigest: "b".repeat(64) };
const media = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const record = {
  tenantId, assetId: "asset:immutable:001", creativeVersion: "version:001",
  brandInstanceId: "brand:bros_sell", presetId: "preset:natural_my_ugc", presetVersion: "preset:v1",
  sha256: createHash("sha256").update(media).digest("hex"), mime: "image/png", bytes: media.length,
  status: "APPROVED", mediaQa: "PASSED", editorialQa: "APPROVED", logoEvidence: "OFFICIAL_APPROVED",
  claimsEvidence: "NO_CLAIMS", aiDisclosure: "REVIEWED", approvalEvidenceId: "approval:editorial:001",
};
const denied = /BROS_DEMAND_CREATIVE_BINDING_DENIED/;

async function admit(asset = record, logoAssetVersionId = "logo:approved:001") {
  return createDemandCreativeAdmission({
    authenticate: async () => ({ userId: principalId, authenticated: true }),
    membershipsFor: async () => [{ principalId, tenantId, product: "demand", active: true }],
    approvedRecordFor: async () => asset,
    mediaFor: async () => media,
    verifyApproval: async ({ assetId, creativeVersion, brandInstanceId, sha256, approvalEvidenceId }) =>
      ({ tenantId, product: "demand", purpose: "CREATIVE_REVIEW", assetId, creativeVersion, brandInstanceId,
        mediaSha256: sha256, approvalEvidenceId, logoAssetVersionId }),
  })({ assetId: asset.assetId, creativeVersion: asset.creativeVersion });
}

test("authorized real-byte intake through the approval adapter binds deterministically for review", async () => {
  const first = bindDemandCreativeForReview(await admit(), plan);
  const second = bindDemandCreativeForReview(await admit(), { ...plan });
  assert.deepEqual(first, second);
  assert.equal(first.state, "REVIEW_ONLY_NOT_AUTHORIZED");
  assert.equal(first.metaUploadAllowed, false);
  assert.equal(first.campaignExecutionAllowed, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(JSON.stringify(first).includes(tenantId), false);
});

test("changes to admitted asset, approval, logo, account or plan change the review digest", async () => {
  const intake = await admit();
  const original = bindDemandCreativeForReview(intake, plan).digest;
  for (const asset of [
    { ...record, assetId: "asset:immutable:002" },
    { ...record, creativeVersion: "version:002" },
    { ...record, approvalEvidenceId: "approval:editorial:002" },
  ]) assert.notEqual(bindDemandCreativeForReview(await admit(asset), plan).digest, original);
  assert.notEqual(bindDemandCreativeForReview(await admit(record, "logo:approved:002"), plan).digest, original);
  assert.notEqual(bindDemandCreativeForReview(intake, { ...plan, accountId: "act_1997776120879477" }).digest, original);
  assert.notEqual(bindDemandCreativeForReview(intake, { ...plan, campaignPlanDigest: "c".repeat(64) }).digest, original);
});

test("serialized or forged admission and cross-tenant or malformed plan scopes fail closed", async () => {
  const intake = await admit();
  for (const untrusted of [
    { ...intake }, JSON.parse(JSON.stringify(intake)),
    { ...intake, mediaSha256: "c".repeat(64) },
    { ...intake, campaignExecutionAllowed: true },
    Object.assign(Object.create(null), intake),
  ]) assert.throws(() => bindDemandCreativeForReview(untrusted, plan), denied);
  for (const scope of [
    { ...plan, tenantId: principalId }, { ...plan, accountId: [plan.accountId] },
    { ...plan, accountId: "123" }, { ...plan, campaignPlanDigest: "bad" },
    { ...plan, ownerApproved: true }, Object.assign(Object.create(null), plan),
  ]) assert.throws(() => bindDemandCreativeForReview(intake, scope), denied);
  const accessor = { ...plan };
  Object.defineProperty(accessor, "accountId", { enumerable: true, get() { throw Error("getter executed"); } });
  assert.throws(() => bindDemandCreativeForReview(intake, accessor), denied);
});
