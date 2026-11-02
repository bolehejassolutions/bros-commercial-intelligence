import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { planUnattestedDemandMetaEvidenceIntake } from "../lib/bci/demand-meta-intake-preflight.ts";

const tenantId = "22222222-2222-4222-8222-222222222222";
const scope = Object.freeze({
  tenantId, product: "demand", accountId: "act_1997776120879476",
  campaignId: "120251158023300697", since: "2026-10-01", until: "2026-10-30",
});
const hash = input => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const candidateFor = (s = scope, status = "NO_ROWS_NOT_ZERO", report = null, collectedAt = "2026-10-31T15:21:00Z") => ({
  candidateKey: "demand:meta-read:sha256:" + hash(["v1",s.tenantId.toLowerCase(),
    s.accountId,s.campaignId,s.since,s.until,status,report?.snapshotKey ?? null]),
  stage: "UNATTESTED_READ_CANDIDATE_ONLY", reportStatus: status,
  windowStart: s.since, windowEndInclusive: s.until, collectedAt,
  metricsPresent: report !== null,
  independentProviderReceiptRecorded: false, durableBciEvidenceRecorded: false,
  executionAllowed: false,
});
const report = Object.freeze({
  campaignId: scope.campaignId, windowStart: scope.since,
  windowEndInclusive: scope.until,
  snapshotKey: "meta_ads:sha256:" + "a".repeat(64),
  currency: "MYR", spendMinor: 12493, inlineLinkClicks: 63,
  landingPageViews: 33, metaAttributedPurchases: 1, pixelPurchaseEvents: 1,
  actionAliasMismatch: false,
});
const denied = /BCI DEMAND Meta intake preflight denied/;

test("empty Meta response maps to private unverified BCI row with null spend and purchases", () => {
  const candidate = candidateFor();
  const plan = planUnattestedDemandMetaEvidenceIntake(scope, candidate, null);
  assert.equal(plan.intakeStage, "UNTRUSTED_BCI_PREFLIGHT_ONLY");
  assert.equal(plan.permissionToWrite, false);
  assert.equal(plan.authenticatedProviderReceiptRecorded, false);
  assert.equal(plan.durableBciEvidenceRecorded, false);
  assert.equal(plan.proposedRow.completeness, "unverified");
  assert.equal(plan.proposedRow.provider, "meta_ads");
  assert.equal(plan.proposedRow.provider_record_key, candidate.candidateKey);
  assert.match(plan.proposedRow.period_start, /T00:00:00\+08:00$/);
  assert.match(plan.proposedRow.period_end, /T23:59:59\+08:00$/);
  assert.deepEqual(plan.proposedRow.metrics, {
    spend_minor: null, inline_link_clicks: null,
    landing_page_views: null, meta_attributed_purchases: null,
    pixel_purchase_events: null,
  });
  assert.ok(plan.proposedRow.unknowns.includes("no_rows_spend_and_conversion_metrics_unknown"));
  assert.equal(plan.verifiedPaidOrders, null);
  assert.equal(plan.verifiedCpaMinor, null);
  assert.equal(plan.verifiedCacMinor, null);
  const raw = JSON.stringify(plan);
  for (const credential of ["Bearer ", "EAA", "postgresql://", "secret"]) {
    assert.equal(raw.includes(credential), false);
  }
});

test("replay stable under collection timestamps, changed scope window yields different key", () => {
  const first = planUnattestedDemandMetaEvidenceIntake(scope, candidateFor(), null);
  const second = planUnattestedDemandMetaEvidenceIntake(scope,
    candidateFor(scope, "NO_ROWS_NOT_ZERO", null, "2026-10-31T15:25:00Z"),null);
  assert.equal(first.candidateKey, second.candidateKey);
  assert.notEqual(first.proposedRow.collected_at, second.proposedRow.collected_at);
  const changed = { ...scope, since: "2026-10-02" };
  assert.notEqual(first.candidateKey,
    planUnattestedDemandMetaEvidenceIntake(changed, candidateFor(changed), null).candidateKey);
});

test("single Meta row is still unverified, never equals independently confirmed paid sale", () => {
  const c = candidateFor(scope, "CAMPAIGN_ROW_OBSERVED_UNATTESTED", report);
  const p = planUnattestedDemandMetaEvidenceIntake(scope, c, report);
  assert.equal(p.proposedRow.metrics.spend_minor, 12493);
  assert.equal(p.proposedRow.metrics.meta_attributed_purchases, 1);
  assert.equal(p.verifiedPaidOrders, null);
  assert.equal(p.durableBciEvidenceRecorded, false);
  assert.equal(p.permissionToWrite, false);
  assert.ok(!p.proposedRow.unknowns.includes("no_rows_spend_and_conversion_metrics_unknown"));
});

test("provider zero is not interchangeable with missing report metric", () => {
  const zero = { ...report, spendMinor: 0 };
  const missing = { ...report, spendMinor: null };
  const a = planUnattestedDemandMetaEvidenceIntake(scope,
    candidateFor(scope, "CAMPAIGN_ROW_OBSERVED_UNATTESTED", zero), zero);
  const b = planUnattestedDemandMetaEvidenceIntake(scope,
    candidateFor(scope, "CAMPAIGN_ROW_OBSERVED_UNATTESTED", missing), missing);
  assert.equal(a.proposedRow.metrics.spend_minor, 0);
  assert.equal(b.proposedRow.metrics.spend_minor, null);
});

test("rejects forged candidate key, foreign tenant or campaign, extra keys and false attestation", () => {
  const valid = candidateFor();
  const cases = [
    [scope, { ...valid, candidateKey: "demand:meta-read:sha256:" + "f".repeat(64) }, null],
    [{ ...scope, tenantId:"33333333-3333-4333-8333-333333333333" },valid,null],
    [{ ...scope, campaignId:"9999999" },valid,null],
    [scope,{ ...valid, accountId:"act_1" },null],
    [scope,{ ...valid, providerVerified:true },null],
    [scope,{ ...valid, independentProviderReceiptRecorded:true },null],
    [scope,{ ...valid, durableBciEvidenceRecorded:true },null],
    [scope,{ ...valid, executionAllowed:true },null],
    [scope,{ ...valid, metricsPresent:true },null],
    [scope,{ ...valid, windowStart:"2026-10-02" },null],
    [scope,{ ...valid, collectedAt:"tomorrow" },null],
    [scope,{ ...valid, reportStatus:"CAMPAIGN_ROW_OBSERVED_UNATTESTED" },null],
    [scope,valid,report],
  ];
  for (const [s,c,r] of cases) {
    assert.throws(() => planUnattestedDemandMetaEvidenceIntake(s,c,r), denied);
  }
});

test("rejects forged report status, wrong fields, conflicting campaign and unsafe numbers", () => {
  const c=candidateFor(scope,"CAMPAIGN_ROW_OBSERVED_UNATTESTED",report);
  for (const r of [
    { ...report, campaignId:"99999" },
    { ...report, windowEndInclusive:"2026-10-29" },
    { ...report, currency:"USD" },
    { ...report, snapshotKey:"untrusted" },
    { ...report, spendMinor:-1 },
    { ...report, spendMinor:1.25 },
    { ...report, pixelPurchaseEvents:Number.NaN },
    { ...report, metaAttributedPurchases:"1" },
    { ...report, someSecret:"token" },
  ]) assert.throws(() => planUnattestedDemandMetaEvidenceIntake(scope,c,r),denied);
});
