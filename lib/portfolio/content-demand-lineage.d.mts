export type LineageInput = Readonly<{
  schemaVersion: 1;
  tenantId: string;
  contentPlanId: string;
  creativeSha256: string;
  channel: "facebook" | "instagram" | "tiktok";
  campaignKey: string;
  landingUrl: string;
}>;
export type LineageProposal = Readonly<{
  schemaVersion: 1;
  kind: "BROS_CONTENT_DEMAND_LINEAGE_V1";
  tenantId: string;
  contentPlanId: string;
  creativeSha256: string;
  channel: LineageInput["channel"];
  campaignKey: string;
  lineageKey: string;
  tracking: Readonly<{
    utm_source: string; utm_medium: "organic_social"; utm_campaign: string; utm_content: string;
  }>;
  trackedLandingUrl: string;
  status: "LINK_SPEC_NOT_PUBLISHED";
  approvalVerified: false;
  publicationVerified: false;
  landingReceiptVerified: false;
  checkoutCorrelationVerified: false;
  paidOrderVerified: false;
  attributedRevenueMYR: null;
  verifiedPurchases: null;
  attributionClaimAllowed: false;
  executionAllowed: false;
}>;
export function prepareContentDemandLink(input: LineageInput): LineageProposal;
export function reviewContentDemandLandingLabels(
  proposal: LineageProposal, landingUrl: string, serverTenantId: string
): Readonly<{
  lineageKey: string; status: "MATCHED_LABELS_UNATTESTED" | "LABEL_MISMATCH";
  labelsMatch: boolean; serverReceiptVerified: false; providerPublicationVerified: false;
  verifiedPaidOrder: null; revenueMYR: null; nextAction: string; executionAllowed: false;
}>;
