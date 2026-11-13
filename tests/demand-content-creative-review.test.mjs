import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createDemandContentCreativeReader, demandContentReusePublicKey } from "../lib/demand/content-creative-reader.ts";
import { snapshotDemandCreativeRecord } from "../lib/demand/creative-intake.ts";
import { createDemandCreativeReview } from "../lib/demand/creative-review.ts";
import { createPausedCampaignHttpHandler } from "../lib/demand/meta-paused-campaign-http.ts";
import { preparePausedCampaignPlan } from "../lib/demand/meta-paused-campaign-plan.ts";

const scope = { tenantId: "11111111-1111-4111-8111-111111111111", principalId: "22222222-2222-4222-8222-222222222222" };
const now = Date.parse("2026-11-13T00:00:00Z");
const jwt = "synthetic.jwt.token";
const assetId = "asset:original:001", creativeVersion = "version:001";
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const mediaSha256 = createHash("sha256").update(bytes).digest("hex");
const creative = snapshotDemandCreativeRecord(scope.tenantId, {
  ...{ tenantId: scope.tenantId, assetId, creativeVersion },
  brandInstanceId: "brand:bros_sell", presetId: "preset:natural_my_ugc", presetVersion: "preset:v1",
  sha256: mediaSha256, bytes: bytes.length, mime: "image/png", mediaQa: "PASSED", editorialQa: "APPROVED",
  status: "APPROVED", logoEvidence: "OFFICIAL_APPROVED", claimsEvidence: "NO_CLAIMS",
  aiDisclosure: "REVIEWED", approvalEvidenceId: "approval:editorial:001",
});
const draft = { name: "Creative review", budgetMinor: 10000, durationDays: 7,
  startTime: "2026-11-13T02:00:00.000Z", landingUrl: "https://bros.bolehejas.com/",
  primaryText: "Review only", headline: "Exact original", description: "", imageHash: "a".repeat(32) };
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const wrongPrivateKey = generateKeyPairSync("ed25519").privateKey;
const key = demandContentReusePublicKey(publicKey.export({ type: "spki", format: "pem" }));

function fixture({ patchPayload, mutateBytes, signer = privateKey, revoke = false, enabled = true, configured = true } = {}) {
  const calls = [], challenges = [];
  let both = 0;
  const transport = async (request) => {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    calls.push(view);
    assert.equal(url.origin, "https://content-creative-reuse.internal");
    assert.equal(url.pathname, "/api/internal/neon-content-creative-reuse");
    assert.equal(url.searchParams.get("assetId"), assetId);
    assert.equal(url.searchParams.get("creativeVersion"), creativeVersion);
    assert.equal(request.method, "GET"); assert.equal(request.redirect, "error");
    assert.equal(request.cache, "no-store"); assert.equal(request.headers.get("authorization"), "Bearer " + jwt);
    if (view === "original") return new Response(mutateBytes?.(bytes) ?? bytes, { headers: { "Content-Type": "image/png" } });
    const challenge = url.searchParams.get("challenge");
    assert.match(challenge, /^[0-9a-f]{48}$/);
    challenges.push(challenge);
    const payload = {
      schemaVersion: 1, product: "demand", purpose: "CREATIVE_REVIEW", principalId: scope.principalId,
      challenge, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 45000).toISOString(),
      logoAssetVersionId: "logo:approved:001", creative,
      ...patchPayload?.(challenges.length, challenge),
    };
    const signature = sign(null, Buffer.from(JSON.stringify(["BROS_CONTENT_DEMAND_CREATIVE_REVIEW_V1", payload.schemaVersion,
      payload.product, payload.purpose, payload.principalId, payload.challenge, payload.issuedAt, payload.expiresAt,
      payload.logoAssetVersionId, payload.creative])), signer).toString("base64url");
    return Response.json({ payload, signature });
  };
  const review = createDemandCreativeReview({
    authorizeBoth: async token => {
      assert.equal(token, jwt);
      if (++both === 3 && revoke) throw Error("revoked");
      return scope;
    },
    readerFor: (authorized, token) => createDemandContentCreativeReader(authorized, token, key, transport, () => now),
    maximumBudgetMinor: () => 14000, now: () => now,
  });
  const handler = createPausedCampaignHttpHandler({
    enabled: () => enabled, authorize: async token => { assert.equal(token, jwt); return scope; },
    creativeReview: () => configured ? review : null,
    service: () => assert.fail("review must not instantiate the Meta execution service"),
  });
  return { handler, calls, challenges };
}

function request(patch = {}, headers = {}) {
  return new Request("https://demand.example/api/internal/demand-meta-campaigns", {
    method: "POST", headers: { Authorization: "Bearer " + jwt, Origin: "https://demand.example",
      "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ action: "review_creative", assetId, creativeVersion, draft, ...patch }),
  });
}

test("signed CONTENT readback admits exact bytes and binds the actual plan without any Meta call", async () => {
  assert.equal(key?.asymmetricKeyType, "ed25519");
  assert.equal(demandContentReusePublicKey("invalid"), null);
  const h = fixture();
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const receipt = await response.json();
  assert.equal(receipt.planSha256, preparePausedCampaignPlan(scope, draft, 14000, now).planSha256);
  assert.equal(receipt.mediaSha256, mediaSha256);
  assert.equal(receipt.approvalEvidenceId, creative.approvalEvidenceId);
  assert.equal(receipt.logoAssetVersionId, "logo:approved:001");
  assert.equal(receipt.metaUploadAllowed, false);
  assert.equal(receipt.campaignExecutionAllowed, false);
  assert.equal(receipt.state, "REVIEW_ONLY_NOT_AUTHORIZED");
  assert.deepEqual(h.calls, ["approval", "original", "approval"]);
  assert.equal(new Set(h.challenges).size, 2);
  const changed = await fixture().handler(request({ draft: { ...draft, headline: "Different plan" } }));
  const changedReceipt = await changed.json();
  assert.notEqual(changedReceipt.planSha256, receipt.planSha256);
  assert.notEqual(changedReceipt.reviewDigest, receipt.reviewDigest);
});

test("invalid, replayed, expired or revoked proofs release neither a receipt nor source details", async () => {
  for (const options of [
    { signer: wrongPrivateKey },
    { patchPayload: () => ({ product: "content", purpose: "DISPATCH" }) },
    { patchPayload: () => ({ expiresAt: new Date(now).toISOString() }) },
    { patchPayload: () => ({ principalId: scope.tenantId }) },
    { patchPayload: () => ({ creative: { ...creative, tenantId: scope.principalId } }) },
    { patchPayload: () => ({ creative: { ...creative, creativeVersion: "version:002" } }) },
    { patchPayload: () => ({ creative: { ...creative, editorialQa: "PENDING" } }) },
    { patchPayload: () => ({ logoAssetVersionId: null }) },
    { patchPayload: i => i === 2 ? { logoAssetVersionId: "logo:changed:001" } : {} },
    { patchPayload: () => ({ challenge: "f".repeat(48) }) },
    { mutateBytes: input => Buffer.concat([input, Buffer.from([1])]) },
    { mutateBytes: input => Buffer.from(input).map((value, i) => i === 20 ? value ^ 1 : value) },
    { revoke: true },
  ]) {
    const h = fixture(options);
    const response = await h.handler(request());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Creative review could not be verified.", code: "CONTENT_CREATIVE_REVIEW_UNVERIFIED" });
  }
});

test("review route rejects caller scope and unavailable configuration before accessing CONTENT", async () => {
  const h = fixture();
  assert.equal((await h.handler(request({ tenantId: scope.tenantId }))).status, 400);
  assert.equal((await h.handler(request({}, { "X-Principal-Id": scope.principalId }))).status, 400);
  assert.equal((await h.handler(request({}, { Authorization: "" }))).status, 401);
  assert.equal((await h.handler(request({ draft: { ...draft, imageHash: [draft.imageHash] } }))).status, 403);
  assert.deepEqual(h.calls, []);
  for (const [options, status] of [[{ enabled: false }, 404], [{ configured: false }, 503]]) {
    const unconfigured = fixture(options);
    assert.equal((await unconfigured.handler(request())).status, status);
    assert.deepEqual(unconfigured.calls, []);
  }
});
