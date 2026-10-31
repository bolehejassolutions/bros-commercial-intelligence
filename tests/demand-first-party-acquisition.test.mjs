import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { issueDemandAcquisitionTransfer as issue,
  prepareDemandHitPayAcquisitionReference as prepare,
  bindDemandHitPayAcquisitionRequest as bind } from "../lib/demand/first-party-acquisition.ts";

const scope = { tenantId: "11111111-1111-4111-8111-111111111111", product: "demand",
  pilotProduct: "bros_sell", environment: "preview", branch: "feat/demand-direct-meta-readonly-20261031" };
const now = "2026-11-01T00:00:00.000Z";
const source = { source: "facebook", medium: "paid_social", campaign: "brossell_test_v1", metaAdId: "120250864977640697" };
const config = { scope, consent: "granted", now, ttlSeconds: 300, source };
const key = new Uint8Array(32).fill(0x6a); // synthetic fixture, never a runtime credential
const requestId = "22222222-2222-4222-8222-222222222222";
const rejected = /^BROS_DEMAND_ACQUISITION_TRANSFER_REJECTED$/;
const fail = fn => assert.throws(fn, e => e instanceof Error && rejected.test(e.message));
const input = issued => ({ ...issued, scope, now, existingReferenceNumber: null });

test("server issues random opaque IDs and keeps source labels out of ticket/reference", () => {
  const a = issue(config, key), b = issue(config, key);
  assert.match(a.landingRecord.acquisitionId, /^da1_[a-f0-9]{32}$/);
  assert.notEqual(a.landingRecord.acquisitionId, b.landingRecord.acquisitionId);
  assert.deepEqual(a.landingRecord.source, source);
  assert.equal(a.ticket.acquisitionId, a.landingRecord.acquisitionId);
  assert.equal(a.ticket.expiresAt, "2026-11-01T00:05:00.000Z");
  const reference = prepare(input(a), key);
  assert.deepEqual(reference, { reference_number: a.landingRecord.acquisitionId });
  assert.equal(JSON.stringify(a.ticket).includes(source.campaign), false);
  assert.equal(JSON.stringify(a.ticket).includes(source.metaAdId), false);
  assert.equal(JSON.stringify(reference).includes(a.ticket.signature), false);
  assert.equal(Object.isFrozen(a), true);
  for (const x of [a.landingRecord, a.landingRecord.scope, a.landingRecord.source, a.ticket, a.ticket.scope, reference]) assert.ok(Object.isFrozen(x));
});

test("unknown source remains null and optional labels are never inferred", () => {
  const a = issue({ ...config, source: null }, key);
  assert.equal(a.landingRecord.source, null);
  assert.deepEqual(prepare(input(a), key), { reference_number: a.ticket.acquisitionId });
  const b = issue({ ...config, source: { campaign: source.campaign } }, key);
  assert.deepEqual(b.landingRecord.source, { campaign: source.campaign });
  assert.equal(Object.hasOwn(b.landingRecord.source, "source"), false);
});

test("denied/unknown consent, malformed input, raw click IDs, PII and extra fields fail closed", () => {
  for (const change of [
    { consent: "denied" }, { consent: "unknown" }, { consent: true },
    { now: "2026-02-30T00:00:00.000Z" }, { now: "2026-11-01T00:00:00Z" },
    { ttlSeconds: 0 }, { ttlSeconds: 901 }, { ttlSeconds: "300" }, { ttlSeconds: NaN }, { ttlSeconds: 1.5 },
    { source: {} }, { source: { source: ["facebook"] } }, { source: { medium: null } },
    { source: { campaign: "person@example.com" } }, { source: { campaign: "https://example.com" } },
    { source: { campaign: "x".repeat(65) } }, { source: { metaAdId: 123456 } },
    { source: { metaAdId: "0" } }, { source: { fbclid: "raw-click" } },
    { source: { ...source, email: "person@example.com" } }, { source: { ...source, url: "https://example.com" } },
    { source: Object.assign(Object.create({ secret: "hidden" }), source) },
    { rawFbclid: "raw" }, { authenticated: true },
  ]) fail(() => issue({ ...config, ...change }, key));
  for (const bad of [null, [], "x", Object.create(config)]) fail(() => issue(bad, key));
});

test("preview tenant/product/pilot/branch scope is strict and canonical", () => {
  for (const change of [
    { tenantId: [scope.tenantId] }, { tenantId: scope.tenantId.toUpperCase() + "x" },
    { tenantId: "00000000-0000-0000-0000-000000000000" },
    { product: "content" }, { pilotProduct: "other" }, { environment: "production" },
    { branch: "main" }, { ownerApproved: true },
  ]) fail(() => issue({ ...config, scope: { ...scope, ...change } }, key));
  for (const badKey of ["secret", new Uint8Array(31), new Uint8Array(129), [], null]) fail(() => issue(config, badKey));
});

test("modified ticket fields, record labels and different keys cannot prepare reference", () => {
  const a = issue(config, key), original = input(a);
  for (const change of [
    { signature: "0".repeat(64) }, { signature: "short" }, { landingDigest: "f".repeat(64) },
    { acquisitionId: "da1_" + "f".repeat(32) }, { issuedAt: "2026-10-31T23:59:00.000Z" },
    { expiresAt: "2026-11-01T00:06:00.000Z" }, { version: "other" }, { token: "leak" },
    { scope: { ...scope, tenantId: "33333333-3333-4333-8333-333333333333" } },
  ]) fail(() => prepare({ ...original, ticket: { ...a.ticket, ...change } }, key));
  for (const change of [
    { source: { ...source, campaign: "different_campaign" } }, { consent: "denied" },
    { acquisitionId: "da1_" + "a".repeat(32) }, { email: "person@example.com" },
  ]) fail(() => prepare({ ...original, landingRecord: { ...a.landingRecord, ...change } }, key));
  fail(() => prepare(original, new Uint8Array(32).fill(0x6b)));
  // An attacker replacing BOTH record and its public digest still lacks the MAC.
  const altered = { ...a.landingRecord, source: { ...source, campaign: "different_campaign" } };
  const fakeDigest = createHash("sha256").update(JSON.stringify(["bros-demand:landing-record:v1", altered])).digest("hex");
  fail(() => prepare({ ...original, landingRecord: altered, ticket: { ...a.ticket, landingDigest: fakeDigest } }, key));
});

test("wrong scope, future issue, expiry and occupied merchant reference reject", () => {
  const original = input(issue(config, key));
  for (const change of [
    { scope: { ...scope, tenantId: "33333333-3333-4333-8333-333333333333" } },
    { scope: { ...scope, product: "content" } }, { scope: { ...scope, environment: "production" } },
    { now: "2026-10-31T23:59:59.999Z" }, { now: "2026-11-01T00:05:00.000Z" },
    { now: "2026-11-01T00:05:00.001Z" }, { now: "invalid" },
    { existingReferenceNumber: "order_1007" }, { existingReferenceNumber: "" },
    { existingReferenceNumber: undefined }, { providerAuthenticated: true },
  ]) fail(() => prepare({ ...original, ...change }, key));
  assert.ok(prepare({ ...original, now: "2026-11-01T00:04:59.999Z" }, key));
});

test("matching provider reference produces stable candidate only, replay prevention remains false", () => {
  const original = input(issue(config, key));
  const response = { id: requestId, reference_number: original.ticket.acquisitionId };
  const a = bind(original, response, key);
  assert.equal(a.status, "REFERENCE_ECHO_MATCHED_UNATTESTED");
  assert.match(a.candidateKey, /^demand:acquisition-request-candidate:sha256:[a-f0-9]{64}$/);
  assert.deepEqual(a, bind(original, response, key));
  assert.equal(a.acquisitionId, original.ticket.acquisitionId);
  assert.equal(a.paymentRequestId, requestId);
  for (const k of ["providerAuthenticationVerified", "tenantAuthorizationVerified", "consentVerified", "replayPrevented", "bciPersistenceVerified", "hitpayPaymentVerified", "acquisitionAttributionVerified"]) assert.equal(a[k], false);
  for (const k of ["verifiedPaidOrders", "verifiedCpaMinor", "verifiedCacMinor", "verifiedRoas", "causalLift"]) assert.equal(a[k], null);
  assert.equal(JSON.stringify(a).includes(original.ticket.signature), false);
  assert.equal(JSON.stringify(a).includes(source.campaign), false);
  assert.ok(Object.isFrozen(a));
  const other = bind(original, { ...response, id: "33333333-3333-4333-8333-333333333333" }, key);
  assert.notEqual(a.candidateKey, other.candidateKey); // BCI must deny this second mapping.
});

test("untrusted redirects, mismatched echoes, malformed IDs and authority fields never bind", () => {
  const original = input(issue(config, key));
  for (const response of [
    { id: requestId, reference_number: "da1_" + "0".repeat(32) },
    { id: [requestId], reference_number: original.ticket.acquisitionId },
    { id: "not-a-uuid", reference_number: original.ticket.acquisitionId },
    { id: requestId, reference_number: original.ticket.acquisitionId, status: "completed" },
    { reference: requestId, status: "completed" }, null,
  ]) fail(() => bind(original, response, key));
});

test("malicious accessor errors are sanitized and never leak secrets", () => {
  const poison = { ...config, get source() { throw new Error("buyer-email-or-token"); } };
  fail(() => issue(poison, key));
  const original = input(issue(config, key));
  fail(() => prepare({ ...original, get ticket() { throw new Error("buyer-email-or-token"); } }, key));
  fail(() => bind(original, { get id() { throw new Error("buyer-email-or-token"); }, reference_number: original.ticket.acquisitionId }, key));
  const hidden = { ...config };
  Object.defineProperty(hidden, "source", { value: source, enumerable: false });
  fail(() => issue(hidden, key));
  let reads = 0;
  fail(() => issue({ ...config, source: { get campaign() { reads++; return source.campaign; } } }, key));
  assert.equal(reads, 0);
});
