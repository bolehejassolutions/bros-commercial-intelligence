import test from "node:test";
import assert from "node:assert/strict";
import { projectUnattestedContentHandoff } from "../lib/bci/unattested-content-handoff.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const scope = { tenantId: tenant, product: "content" };
const observedAt = "2026-10-26T15:34:46Z";
const metrics = { impressions: null, reach: 4, views: 6, reactions: 0,
  comments: 0, shares: 0, clicks: null, saves: null, follows: null };
const provenance = { provider: "buffer", providerObjectId: "post_123",
  collectedAt: "2026-10-26T16:00:00Z", observedAt,
  windowStart: "2026-10-26T01:02:51Z", windowEnd: observedAt,
  sourceReference: "https://www.instagram.com/p/De8Djl1oNGa/",
  completeness: "unverified" };
const unknowns = ["PROVIDER_AUTHENTICATION_UNVERIFIED",
  "PUBLICATION_APPROVAL_UNVERIFIED", "NATIVE_MEDIA_BYTES_UNVERIFIED",
  "SHARED_BCI_AUDIT_NOT_WRITTEN"];
const handoff = { schemaVersion: 1, tenantId: tenant, product: "content",
  evidenceId: "content-buffer-" + "a".repeat(64),
  category: "content_post_observation", provenance, metrics,
  observedFacts: ["Buffer-shaped projection reports SENT; not attested.",
    "Metric snapshot present, not provider-attested."], unknowns };

test("maps CONTENT observation conservatively, preserving null vs zero and stable key", () => {
  const a = projectUnattestedContentHandoff(handoff, scope);
  const b = projectUnattestedContentHandoff({ ...handoff,
    provenance: { ...provenance, collectedAt: "2026-10-26T16:30:00Z" } }, scope);
  assert.deepEqual(a.envelope, b.envelope);
  assert.equal(a.envelope.providerRecordKey, handoff.evidenceId);
  assert.equal(a.envelope.metrics.views, 6);
  assert.equal(a.envelope.metrics.clicks, null);
  assert.equal(a.envelope.metrics.reactions, 0);
  assert.equal(a.envelope.environment, "unknown");
  assert.equal(a.envelope.provenance, "synthetic");
  for (const flag of ["authenticated", "providerAttested", "approvalVerified", "persisted"])
    assert.equal(a[flag], false);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.envelope), true);
});

test("rejects caller-controlled tenant/product and admin scope claims", () => {
  for (const input of [
    { ...handoff, tenantId: "22222222-2222-4222-8222-222222222222" },
    { ...handoff, product: "demand" },
    { ...handoff, verified: true },
    { ...handoff, provenance: { ...provenance, completeness: "verified" } },
    { ...handoff, provenance: { ...provenance, provider: "meta_ads" } },
  ]) assert.throws(() => projectUnattestedContentHandoff(input, scope),
    /Invalid unattested CONTENT handoff/);
  assert.throws(() => projectUnattestedContentHandoff(handoff,
    { ...scope, admin: true }), /Invalid unattested CONTENT handoff/);
});

test("rejects forged provider status, malformed snapshot identity and unknown flags", () => {
  for (const input of [
    { ...handoff, evidenceId: "content-buffer-not-a-hash" },
    { ...handoff, provenance: { ...provenance, windowEnd: null } },
    { ...handoff, provenance: { ...provenance,
      sourceReference: "https://evil.example/post" } },
    { ...handoff, unknowns: unknowns.filter(x => x !== "PUBLICATION_APPROVAL_UNVERIFIED") },
    { ...handoff, unknowns: [...unknowns, "PROVIDER_VERIFIED"] },
    { ...handoff, metrics: { ...metrics, views: -1 } },
    { ...handoff, metrics: { ...metrics, views: 1.5 } },
  ]) assert.throws(() => projectUnattestedContentHandoff(input, scope),
    /Invalid unattested CONTENT handoff/);
});

test("rejects provider future timestamps and hidden data fields", () => {
  for (const input of [
    { ...handoff, provenance: { ...provenance,
      collectedAt: "2026-10-26T14:00:00Z" } },
    { ...handoff, provenance: { ...provenance, accessToken: "secret" } },
    { ...handoff, metrics: { ...metrics, customerEmail: 0 } },
  ]) assert.throws(() => projectUnattestedContentHandoff(input, scope),
    /Invalid unattested CONTENT handoff/);
});
