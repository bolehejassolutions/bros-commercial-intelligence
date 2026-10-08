import type { CampaignSnapshot, DryRunReport, Finding, ProposedAction } from "./contracts";

function nonNegative(name: string, value: number, integer = false) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(name + " must be a finite non-negative" + (integer ? " integer." : " number."));
  }
}

function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day + "T00:00:00Z")) &&
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
}

export function validateSnapshot(input: CampaignSnapshot): CampaignSnapshot {
  if (input.market !== "MY" || input.currency !== "MYR") {
    throw new Error("This operator accepts Malaysia/MYR snapshots only.");
  }
  if (!input.campaignName.trim() || input.campaignName.length > 140) {
    throw new Error("A campaign name (maximum 140 characters) is required.");
  }
  if (input.source !== "manual-transcription" && input.source !== "meta-readonly-export") {
    throw new Error("Unknown evidence source.");
  }
  if (!input.sourceReference.trim() || input.sourceReference.length > 500) {
    throw new Error("A source reference (maximum 500 characters) is required for provenance.");
  }
  if (!validDay(input.periodStart) || !validDay(input.periodEnd) || input.periodStart > input.periodEnd) {
    throw new Error("Provide a valid chronological reporting date range.");
  }
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new Error("Invalid evidence capture timestamp.");
  }
  nonNegative("Spend", input.spendMYR);
  nonNegative("Impressions", input.impressions, true);
  nonNegative("Link clicks", input.linkClicks, true);
  if (input.landingPageViews !== null) nonNegative("Landing-page views", input.landingPageViews, true);
  if (input.purchases !== null) nonNegative("Purchases", input.purchases, true);
  if (input.attributedRevenueMYR !== null) nonNegative("Revenue", input.attributedRevenueMYR);
  if (input.attributedRevenueMYR !== null && input.purchases === null) {
    throw new Error("Revenue requires a reported purchases value. Leave both blank if attribution is unverified.");
  }
  return {
    ...input,
    campaignName: input.campaignName.trim(),
    sourceReference: input.sourceReference.trim(),
  };
}

export function simulateCampaign(input: CampaignSnapshot, generatedAt = new Date().toISOString()): DryRunReport {
  const snapshot = validateSnapshot(input);
  const findings: Finding[] = [];
  const proposedActions: ProposedAction[] = [];
  const basis = [snapshot.sourceReference, snapshot.periodStart + " to " + snapshot.periodEnd];

  findings.push({
    id: "observed-metrics",
    classification: "snapshot_observation",
    severity: "information",
    statement: "Supplied snapshot reports RM" + snapshot.spendMYR.toFixed(2) +
      " spent, " + snapshot.impressions + " impressions and " + snapshot.linkClicks + " link clicks.",
    evidence: basis,
  });

  const ctr = snapshot.impressions > 0 ? snapshot.linkClicks / snapshot.impressions : null;
  const clickToLandingViewRate = snapshot.landingPageViews !== null && snapshot.linkClicks > 0
    ? snapshot.landingPageViews / snapshot.linkClicks : null;
  const costPerLandingPageViewMYR = snapshot.landingPageViews !== null && snapshot.landingPageViews > 0
    ? snapshot.spendMYR / snapshot.landingPageViews : null;
  const reportedRoas = snapshot.attributedRevenueMYR !== null && snapshot.spendMYR > 0
    ? snapshot.attributedRevenueMYR / snapshot.spendMYR : null;

  if (snapshot.purchases === null || snapshot.attributedRevenueMYR === null) {
    findings.push({
      id: "conversion-attribution-unknown",
      classification: "inference",
      severity: "review",
      statement: "Purchase attribution or revenue is unverified in this snapshot; sales performance and ROAS cannot be established.",
      evidence: basis,
    });
    proposedActions.push({
      id: "verify-conversion-evidence",
      priority: "high",
      summary: "Verify Meta purchase events against checkout/payment records.",
      rationale: "Do not infer zero sales from missing attribution. Confirm event mapping and reconcile actual paid orders before changing budgets.",
      evidence: basis,
      status: "PROPOSED_ONLY",
      approvalRequired: true,
    });
  }

  // These minimum samples are investigative heuristics, NOT benchmark targets.
  if (snapshot.impressions < 1000 || snapshot.linkClicks < 20) {
    findings.push({
      id: "limited-sample",
      classification: "inference",
      severity: "information",
      statement: "The supplied sample is too small for a reliable creative or targeting verdict under the pilot's conservative review thresholds.",
      evidence: basis,
    });
    proposedActions.push({
      id: "collect-more-evidence",
      priority: "normal",
      summary: "Gather more read-only results before making targeting or creative changes.",
      rationale: "Avoid overreacting to early volatility. Additional paid spend is NOT authorized by this proposal.",
      evidence: basis,
      status: "PROPOSED_ONLY",
      approvalRequired: true,
    });
  }

  if (snapshot.linkClicks >= 20 && snapshot.landingPageViews === null) {
    proposedActions.push({
      id: "enable-landing-page-measurement",
      priority: "high",
      summary: "Verify availability of landing-page view reporting.",
      rationale: "Without landing-page views, the click-to-landing diagnostic cannot be run.",
      evidence: basis,
      status: "PROPOSED_ONLY",
      approvalRequired: true,
    });
  }

  if (clickToLandingViewRate !== null && snapshot.linkClicks >= 20 && clickToLandingViewRate < 0.5) {
    findings.push({
      id: "low-click-to-view-ratio",
      classification: "inference",
      severity: "review",
      statement: "Fewer than half of reported link clicks appear as landing-page views. Possible causes include page load, redirects, consent or tracking.",
      evidence: basis,
    });
    proposedActions.push({
      id: "diagnose-landing-page",
      priority: "high",
      summary: "Inspect mobile landing performance, redirects and event measurement.",
      rationale: "Investigate measurement and user experience before revising ad targeting or spending.",
      evidence: basis,
      status: "PROPOSED_ONLY",
      approvalRequired: true,
    });
  }

  if (snapshot.purchases === 0 && snapshot.landingPageViews !== null && snapshot.landingPageViews >= 100) {
    proposedActions.push({
      id: "audit-checkout",
      priority: "normal",
      summary: "Audit purchase tracking, offer clarity and checkout steps.",
      rationale: "The supplied snapshot reports zero purchases despite substantial page views; this is a diagnostic question, not proof of a funnel failure.",
      evidence: basis,
      status: "PROPOSED_ONLY",
      approvalRequired: true,
    });
  }

  return {
    mode: "DRY_RUN",
    market: "MY",
    generatedAt,
    snapshot,
    calculated: { ctr, clickToLandingViewRate, costPerLandingPageViewMYR, reportedRoas },
    findings,
    proposedActions,
    execution: {
      campaignChanges: 0,
      publishedAds: 0,
      authorizedSpendMYR: 0,
      note: "Simulation only. No Meta Ads write adapter or publishing endpoint is present in this release.",
    },
  };
}
