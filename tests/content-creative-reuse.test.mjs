import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContentReviewerKey, DEMAND_REUSE_CHECKS, signContentDemandReuse } from "../lib/portfolio/content-review-signing.ts";
import { createContentCreativeReuseHandler, readCreativeReuseConfiguration } from "../lib/portfolio/content-creative-reuse.ts";
import { contentReviewSources, readContentCreativeOriginal } from "../lib/portfolio/content-review-source.mjs";
import { usesNeonPreviewAuthentication } from "../lib/bci/neon-preview-route-policy.ts";
import { createDemandPreviewCreativeReview } from "../lib/demand/content-creative-preview.ts";
import { createPausedCampaignHttpHandler } from "../lib/demand/meta-paused-campaign-http.ts";
import { preparePausedCampaignPlan } from "../lib/demand/meta-paused-campaign-plan.ts";

const path = "/api/internal/neon-content-creative-reuse";
const root = new URL("../content-review-sources/", import.meta.url);
const registry = JSON.parse(readFileSync(new URL("index.json", root)));
const entry = registry.sources[0];
const scope = { principalId: "11111111-1111-4111-8111-111111111111", tenantId: entry.tenantId };
const original = readFileSync(new URL(entry.directory + "/content_card_01.png", root));
const assetId = "test-asset-001", version = "test-version-001", challenge = "b".repeat(48);
const now = Date.parse("2026-11-13T08:00:00.000Z");
const stamp = ms => new Date(ms).toISOString();
const owner = generateKeyPairSync("ed25519"), issuer = generateKeyPairSync("ed25519");
const keyId = "test-owner-key";
const creative = {
  aiDisclosure: "REVIEWED", approvalEvidenceId: "test-approval-001", assetId,
  brandInstanceId: "bros-sell-internal", bytes: original.length, claimsEvidence: "NO_CLAIMS",
  creativeVersion: version, editorialQa: "APPROVED", logoEvidence: "NO_LOGO", mediaQa: "PASSED",
  mime: "image/png", presetId: "test-preset", presetVersion: "test-preset-v1",
  sha256: createHash("sha256").update(original).digest("hex"), status: "APPROVED", tenantId: scope.tenantId,
};

function grant(change = {}, signingKey = owner.privateKey) {
  const payload = { schemaVersion: 1, product: "demand", purpose: "CREATIVE_REVIEW",
    proofEnvelopeId: entry.proofEnvelopeId, slot: 1, approvedAt: stamp(now - 1000), expiresAt: stamp(now + 300000),
    logoAssetVersionId: null, creative, ...change };
  const bytes = Buffer.from(JSON.stringify(["BROS_CONTENT_OWNER_DEMAND_REUSE_V1", keyId, payload.schemaVersion,
    payload.product, payload.purpose, payload.proofEnvelopeId, payload.slot, payload.approvedAt, payload.expiresAt,
    payload.logoAssetVersionId, payload.creative]));
  return { keyId, payload, signature: sign(null, bytes, signingKey).toString("base64url") };
}
function credentials(receipt = grant(), privateKey = issuer.privateKey) {
  return {
    BCI_CONTENT_DEMAND_REUSE_GRANT: JSON.stringify(receipt),
    BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS: JSON.stringify({
      [keyId]: owner.publicKey.export({ type: "spki", format: "pem" }),
    }),
    BCI_CONTENT_DEMAND_REUSE_ISSUER_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
function configuration(receipt, privateKey) {
  return readCreativeReuseConfiguration(credentials(receipt, privateKey));
}
function request(view = "approval", extra = "", options = {}) {
  const headers = { Authorization: "Bearer synthetic.jwt.token", ...options.headers };
  return new Request("https://example.test" + path + "?view=" + view +
    "&assetId=" + assetId + "&creativeVersion=" + version + (view === "approval" ? "&challenge=" + challenge : "") + extra,
  { ...options, headers });
}
function fixture(overrides = {}) {
  let reads = 0, authorizations = 0;
  const handler = createContentCreativeReuseHandler({
    enabled: () => true, now: () => now,
    authorize: async token => { assert.equal(token, "synthetic.jwt.token"); authorizations++; return scope; },
    configuration,
    readOriginal: (current, proof, slot) => {
      reads++;
      return readContentCreativeOriginal(current, proof, slot);
    },
    ...overrides,
  });
  return { handler, counts: () => ({ reads, authorizations }) };
}

test("fixture owner grant serves the exact BROS SELL original and the DEMAND-compatible challenge response", async () => {
  const f = fixture({ configuration: () => configuration(grant({ expiresAt: stamp(now + 30000) })) });
  const image = await f.handler(request("original"));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), original);
  const reply = await f.handler(request());
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get("cache-control"), /no-store/);
  const { payload: p, signature } = await reply.json();
  assert.equal(p.challenge, challenge);
  assert.equal(p.expiresAt, stamp(now + 30000));
  assert.deepEqual(p.creative, creative);
  assert.equal(verify(null, Buffer.from(JSON.stringify(["BROS_CONTENT_DEMAND_CREATIVE_REVIEW_V1", p.schemaVersion,
    p.product, p.purpose, p.principalId, p.challenge, p.issuedAt, p.expiresAt, p.logoAssetVersionId, p.creative])),
  issuer.publicKey, Buffer.from(signature, "base64url")), true);
  assert.deepEqual(f.counts(), { reads: 2, authorizations: 4 });
});

test("flag, method, request shape, JWT and missing setup deny before accessing media", async () => {
  const f = fixture();
  for (const [req, status] of [[request("original", "", { method: "POST" }), 405],
    [request("approval", "&challenge=" + challenge), 400],
    [request("original", "&challenge=" + challenge), 400],
    [request("approval", "", { headers: { "x-tenant-id": scope.tenantId } }), 400],
    [request("approval", "", { headers: { Authorization: "" } }), 401]]) {
    assert.equal((await f.handler(req)).status, status);
  }
  assert.deepEqual(f.counts(), { reads: 0, authorizations: 0 });
  assert.equal((await fixture({ enabled: () => false }).handler(request())).status, 404);
  assert.equal((await fixture({ configuration: () => null }).handler(request())).status, 404);
  assert.equal(configuration(grant(), owner.privateKey), null);
  assert.equal(usesNeonPreviewAuthentication(path), true);
  assert.equal(usesNeonPreviewAuthentication(path + "/admin"), false);
});

test("dispatch-only, foreign, expired, wrong-version and forged grants are denied", async () => {
  for (const receipt of [grant({ product: "content", purpose: "DISPATCH" }),
    grant({ expiresAt: stamp(now) }), grant({ creative: { ...creative, tenantId: scope.principalId } }),
    grant({ creative: { ...creative, creativeVersion: "test-version-002" } }),
    grant({ logoAssetVersionId: "test-logo-001" }), grant({}, issuer.privateKey)]) {
    const f = fixture({ configuration: () => configuration(receipt) });
    assert.equal((await f.handler(request("original"))).status, 403);
    assert.equal(f.counts().reads, 0);
  }
});

test("rechecks asset bytes, grant and operator membership before returning either view", async () => {
  for (const view of ["approval", "original"]) {
    let reads = 0, checks = 0;
    for (const overrides of [
      { readOriginal: async () => ({ bytes: Buffer.alloc(original.length), brandInstanceId: creative.brandInstanceId }) },
      { configuration: () => ++reads === 1 ? configuration() : null },
      { authorize: async () => ++checks === 1 ? scope : { ...scope, tenantId: scope.principalId } },
    ]) {
      const response = await fixture(overrides).handler(request(view));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "CONTENT creative reuse unavailable." });
    }
  }
});

test("DEMAND reviews the actual CONTENT original through its existing endpoint in one Preview", async () => {
  const env = {
    ...credentials(),
    BROS_DEMAND_CONTENT_CREATIVE_REVIEW: "enabled",
    BCI_CONTENT_DEMAND_REUSE: "enabled",
    BROS_DEMAND_CONTENT_REUSE_PUBLIC_KEY: issuer.publicKey.export({ type: "spki", format: "pem" }),
  };
  let preview = true, membership = true, reads = 0;
  const creativeReview = createDemandPreviewCreativeReview({
    demandPreviewEnabled: () => preview, env, now: () => now,
    authorizeBoth: async token => {
      assert.equal(token, "synthetic.jwt.token");
      if (!membership) throw Error();
      return scope;
    },
    readOriginal: (current, proof, slot) => {
      reads++;
      return readContentCreativeOriginal(current, proof, slot);
    },
    maximumBudgetMinor: () => 14000,
  });
  const handler = createPausedCampaignHttpHandler({
    enabled: () => preview,
    authorize: async token => { assert.equal(token, "synthetic.jwt.token"); return scope; },
    creativeReview,
    service: () => assert.fail("CONTENT review must never initialize campaign execution"),
  });
  const draft = { name: "CONTENT review fixture", budgetMinor: 10000, durationDays: 7,
    startTime: stamp(now + 7200000), landingUrl: "https://bros.bolehejas.com/",
    primaryText: "Review only", headline: "Exact original", description: "", imageHash: "a".repeat(32) };
  const review = () => handler(new Request("https://demand.example/api/internal/demand-meta-campaigns", {
    method: "POST", headers: { Authorization: "Bearer synthetic.jwt.token", Origin: "https://demand.example",
      "Content-Type": "application/json" },
    body: JSON.stringify({ action: "review_creative", assetId, creativeVersion: version, draft }),
  }));

  const response = await review();
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.mediaSha256, creative.sha256);
  assert.equal(receipt.approvalEvidenceId, creative.approvalEvidenceId);
  assert.equal(receipt.planSha256, preparePausedCampaignPlan(scope, draft, 14000, now).planSha256);
  assert.equal(receipt.metaUploadAllowed, false);
  assert.equal(receipt.campaignExecutionAllowed, false);
  assert.equal(reads, 3);

  membership = false;
  assert.equal((await review()).status, 403);
  membership = true;
  for (const flag of ["BCI_CONTENT_DEMAND_REUSE", "BROS_DEMAND_CONTENT_CREATIVE_REVIEW",
    "BROS_DEMAND_CONTENT_REUSE_PUBLIC_KEY", "BCI_CONTENT_DEMAND_REUSE_GRANT"]) {
    const setting = env[flag];
    delete env[flag];
    assert.equal((await review()).status, 503);
    env[flag] = setting;
  }
  env.BROS_DEMAND_CONTENT_REUSE_PUBLIC_KEY = owner.publicKey.export({ type: "spki", format: "pem" });
  assert.equal((await review()).status, 503);
  preview = false;
  assert.equal((await review()).status, 404);
  assert.equal(reads, 3);
});

test("an aborted request releases no approval or original", async () => {
  const abort = new AbortController();
  const f = fixture({ readOriginal: async () => {
    abort.abort();
    return { bytes: original, brandInstanceId: creative.brandInstanceId };
  } });
  assert.equal((await f.handler(request("original", "", { signal: abort.signal }))).status, 403);
  assert.equal(f.counts().authorizations, 1);
});

test("browser reviewer signs exactly one checked original and the producer accepts that grant", async () => {
  const reviewer = await createContentReviewerKey();
  assert.equal(reviewer.privateKey.extractable, false);
  const { envelope } = await contentReviewSources.load({ ...scope, product: "content" }, entry.proofEnvelopeId);
  const evidence = {
    presetId: "test-preset", presetVersion: "test-preset-v1", logoEvidence: "NO_LOGO",
    logoAssetVersionId: null, confirmedChecks: DEMAND_REUSE_CHECKS,
  };
  for (const [source, slot, bytes, input] of [
    [envelope, 1, original, { ...evidence, confirmedChecks: DEMAND_REUSE_CHECKS.slice(1) }],
    [envelope, 1, original, { ...evidence, logoEvidence: "OFFICIAL_APPROVED" }],
    [{ ...envelope, copy: { claimEvidenceRefs: ["unverified-reference"] } }, 1, original, evidence],
    [envelope, 2, original, evidence],
    [envelope, 1, Buffer.concat([original, Buffer.of(0)]), evidence],
    [{ ...envelope, automatedReviewFlags: ["HOLD"] }, 1, original, evidence],
  ]) {
    await assert.rejects(() => signContentDemandReuse(reviewer, source, slot, bytes, input), /REVIEW_INCOMPLETE/);
  }
  const signed = await signContentDemandReuse(reviewer, envelope, 1, original, evidence);
  const reissued = await signContentDemandReuse(reviewer, envelope, 1, original, evidence);
  assert.equal(signed.payload.creative.assetId, reissued.payload.creative.assetId);
  assert.equal(signed.payload.creative.creativeVersion, reissued.payload.creative.creativeVersion);
  assert.notEqual(signed.payload.creative.approvalEvidenceId, reissued.payload.creative.approvalEvidenceId);
  assert.equal(signed.payload.creative.sha256, creative.sha256);
  assert.equal(Date.parse(signed.payload.expiresAt) - Date.parse(signed.payload.approvedAt), 86400000);
  const env = {
    ...credentials(signed),
    BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS: JSON.stringify({ [reviewer.keyId]: reviewer.publicKeyPem }),
  };
  const f = fixture({ now: Date.now, configuration: () => readCreativeReuseConfiguration(env) });
  const url = new URL("https://example.test" + path);
  url.search = new URLSearchParams({
    view: "original", assetId: signed.payload.creative.assetId, creativeVersion: signed.payload.creative.creativeVersion,
  });
  const read = () => f.handler(new Request(url, { headers: { Authorization: "Bearer synthetic.jwt.token" } }));
  const response = await read();
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  env.BCI_CONTENT_DEMAND_REUSE_GRANT = JSON.stringify({
    ...signed, payload: { ...signed.payload, creative: { ...signed.payload.creative, presetId: "other-preset" } },
  });
  assert.equal((await read()).status, 403);
  assert.equal(f.counts().reads, 1);
});
