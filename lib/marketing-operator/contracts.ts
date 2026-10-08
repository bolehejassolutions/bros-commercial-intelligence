export type EvidenceSource = "manual-transcription" | "meta-readonly-export";

export interface CampaignSnapshot {
  market: "MY";
  currency: "MYR";
  campaignName: string;
  source: EvidenceSource;
  sourceReference: string;
  capturedAt: string;
  periodStart: string;
  periodEnd: string;
  spendMYR: number;
  impressions: number;
  linkClicks: number;
  landingPageViews: number | null;
  purchases: number | null;
  attributedRevenueMYR: number | null;
}

export interface Finding {
  id: string;
  classification: "snapshot_observation" | "inference";
  severity: "information" | "review";
  statement: string;
  evidence: string[];
}

export interface ProposedAction {
  id: string;
  priority: "normal" | "high";
  summary: string;
  rationale: string;
  evidence: string[];
  status: "PROPOSED_ONLY";
  approvalRequired: true;
}

export interface DryRunReport {
  mode: "DRY_RUN";
  market: "MY";
  generatedAt: string;
  snapshot: CampaignSnapshot;
  calculated: {
    ctr: number | null;
    clickToLandingViewRate: number | null;
    costPerLandingPageViewMYR: number | null;
    reportedRoas: number | null;
  };
  findings: Finding[];
  proposedActions: ProposedAction[];
  execution: {
    campaignChanges: 0;
    publishedAds: 0;
    authorizedSpendMYR: 0;
    note: string;
  };
}
