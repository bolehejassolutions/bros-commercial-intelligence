import test from "node:test";
import assert from "node:assert/strict";
import { simulateCampaign, validateSnapshot } from "../lib/marketing-operator/engine.ts";
import { MARKETING_OPERATOR_POLICY, rejectExternalMutation, ExternalMutationBlocked } from "../lib/marketing-operator/safety.ts";

const snapshot = (overrides = {}) => ({
  market: "MY",
  currency: "MYR",
  campaignName: "Synthetic BROS SELL Malaysia test",
  source: "manual-transcription",
  sourceReference: "SYNTHETIC TEST DATA — NOT LIVE",
  capturedAt: "2026-10-09T00:00:00.000Z",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-08",
  spendMYR: 15,
  impressions: 500,
  linkClicks: 12,
  landingPageViews: 8,
  purchases: null,
  attributedRevenueMYR: null,
  ...overrides,
});

test("policy is permanently dry-run with zero spending authority", () => {
  assert.equal(MARKETING_OPERATOR_POLICY.mode, "DRY_RUN");
  assert.equal(MARKETING_OPERATOR_POLICY.maxAuthorizedSpendMYR, 0);
  assert.equal(MARKETING_OPERATOR_POLICY.externalWritesEnabled, false);
  assert.equal(MARKETING_OPERATOR_POLICY.publishingEnabled, false);
  assert.equal(MARKETING_OPERATOR_POLICY.automaticBudgetChangesEnabled, false);
  assert.equal(Object.isFrozen(MARKETING_OPERATOR_POLICY), true);
});

test("every enumerated external mutation is rejected", () => {
  for (const op of ["create_campaign", "edit_campaign", "publish_ad", "change_budget", "pause_or_resume_ad", "modify_audience"]) {
    assert.throws(() => rejectExternalMutation(op), ExternalMutationBlocked);
  }
});

test("unknown conversions do not become zero sales, no fabricated ROAS", () => {
  const report = simulateCampaign(snapshot(), "2026-10-09T01:00:00Z");
  assert.equal(report.calculated.reportedRoas, null);
  assert.equal(report.snapshot.purchases, null);
  assert.equal(report.execution.authorizedSpendMYR, 0);
  assert.equal(report.execution.campaignChanges, 0);
  assert.equal(report.execution.publishedAds, 0);
  assert.ok(report.findings.some((f) => f.id === "conversion-attribution-unknown"));
  assert.ok(report.proposedActions.some((p) => p.id === "verify-conversion-evidence"));
});

test("missing landing-page views cannot be treated as zero", () => {
  const report = simulateCampaign(snapshot({ landingPageViews: null, linkClicks: 40, impressions: 2000 }));
  assert.equal(report.calculated.clickToLandingViewRate, null);
  assert.equal(report.calculated.costPerLandingPageViewMYR, null);
  assert.ok(report.proposedActions.some((p) => p.id === "enable-landing-page-measurement"));
});

test("sufficient measured click loss becomes investigation, not automatic spend", () => {
  const report = simulateCampaign(snapshot({ impressions: 2500, linkClicks: 100, landingPageViews: 20 }));
  assert.equal(report.calculated.ctr, 0.04);
  assert.equal(report.calculated.clickToLandingViewRate, 0.2);
  assert.ok(report.proposedActions.some((p) => p.id === "diagnose-landing-page"));
  assert.equal(report.execution.authorizedSpendMYR, 0);
});

test("verified zero purchases is distinct from missing attribution", () => {
  const report = simulateCampaign(snapshot({ impressions: 3000, linkClicks: 200, landingPageViews: 120, purchases: 0, attributedRevenueMYR: 0 }));
  assert.equal(report.snapshot.purchases, 0);
  assert.equal(report.calculated.reportedRoas, 0);
  assert.ok(report.proposedActions.some((p) => p.id === "audit-checkout"));
});

test("all proposals require explicit human review", () => {
  const report = simulateCampaign(snapshot());
  assert.ok(report.proposedActions.length > 0);
  for (const proposal of report.proposedActions) {
    assert.equal(proposal.approvalRequired, true);
    assert.equal(proposal.status, "PROPOSED_ONLY");
    assert.ok(proposal.evidence.includes("SYNTHETIC TEST DATA — NOT LIVE"));
  }
});

test("invalid and unsupported inputs fail closed", () => {
  assert.throws(() => validateSnapshot(snapshot({ currency: "USD" })));
  assert.throws(() => validateSnapshot(snapshot({ spendMYR: -1 })));
  assert.throws(() => validateSnapshot(snapshot({ impressions: Infinity })));
  assert.throws(() => validateSnapshot(snapshot({ linkClicks: 1.3 })));
  assert.throws(() => validateSnapshot(snapshot({ periodEnd: "2026-09-01" })));
  assert.throws(() => validateSnapshot(snapshot({ periodStart: "2026-02-30" })));
  assert.throws(() => validateSnapshot(snapshot({ sourceReference: "" })));
  assert.throws(() => validateSnapshot(snapshot({ purchases: null, attributedRevenueMYR: 50 })));
});
