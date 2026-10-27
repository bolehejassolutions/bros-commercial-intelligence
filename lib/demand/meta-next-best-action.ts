import { createHash } from "node:crypto";
import { normalizeMetaCampaignFunnel } from "./meta-insights-funnel.ts";
import type { MetaCampaignInsight, MetaFunnelScope } from "./meta-insights-funnel.ts";

/**
 * DEMAND-specific, read-only next-best-action candidate from a Meta observation.
 * BCI owns trusted evidence intake, tenant authorization, durable decisions,
 * action/outcome/learning. This module neither authenticates provider data nor
 * writes to BCI, Meta, HitPay, analytics or a publisher.
 */
export type DemandMetaNextBestAction = Readonly<{
  candidateId: string;
  sourceKey: string;
  evidenceCandidateKey: string;
  status: "PROPOSED_UNATTESTED";
  diagnosis: "AMBIGUOUS_PURCHASE_ACTIONS" | "UNJOINED_PURCHASE_SIGNAL" |
    "CLICK_LANDING_MEASUREMENT_GAP" | "FUNNEL_BASELINE_INCOMPLETE";
  action: "AUDIT_META_ACTION_ALIASES" | "RECONCILE_PURCHASE_TO_HITPAY" |
    "AUDIT_CLICK_LANDING_MEASUREMENT" | "VERIFY_FUNNEL_BASELINE";
  priority: "P1" | "P2";
  rationale: string;
  requiredEvidence: readonly string[];
  providerAuthenticationVerified: false;
  tenantMembershipVerified: false;
  ownerApproved: false;
  actionExecuted: false;
  outcomeVerified: false;
  learningVerified: false;
  executionAllowed: false;
  noProviderWrites: true;
  maxIncrementalSpendMinor: 0;
  verifiedPaidOrders: null;
  verifiedSettledOrders: null;
  verifiedCacMinor: null;
  causalLift: null;
}>;

export function proposeDemandMetaNextBestAction(
  scope: MetaFunnelScope, row: MetaCampaignInsight,
): DemandMetaNextBestAction {
  // Recompute from raw scoped observation; do not accept caller-forged
  // projected verification flags, denominators or snapshot identities.
  const observation = normalizeMetaCampaignFunnel(scope, row);
  let diagnosis: DemandMetaNextBestAction["diagnosis"];
  let action: DemandMetaNextBestAction["action"];
  let priority: DemandMetaNextBestAction["priority"];
  let rationale: string;
  let evidence: readonly string[];
  if (observation.actionAliasMismatch) {
    diagnosis = "AMBIGUOUS_PURCHASE_ACTIONS";
    action = "AUDIT_META_ACTION_ALIASES";
    priority = "P1";
    rationale = "Meta purchase aliases disagree; do not count them as distinct orders.";
    evidence = ["authenticated_meta_action_breakdown", "provider_attribution_window"];
  } else if ((observation.metaAttributedPurchases ?? 0) > 0 ||
             (observation.pixelPurchaseEvents ?? 0) > 0) {
    diagnosis = "UNJOINED_PURCHASE_SIGNAL";
    action = "RECONCILE_PURCHASE_TO_HITPAY";
    priority = "P1";
    rationale = "A Meta purchase signal is not a verified HitPay order or settled sale.";
    evidence = ["authenticated_meta_event_identity", "hitpay_order_charge_link",
      "live_environment_and_product_attestation", "payout_allocation_and_entitlement"];
  } else if (observation.inlineLinkClicks !== null && observation.inlineLinkClicks > 0 &&
             observation.landingPageViews !== null &&
             observation.landingPageViews < observation.inlineLinkClicks) {
    diagnosis = "CLICK_LANDING_MEASUREMENT_GAP";
    action = "AUDIT_CLICK_LANDING_MEASUREMENT";
    priority = "P2";
    rationale = "Fewer reported landing views than inline link clicks; this does not prove drop-off.";
    evidence = ["authenticated_click_and_landing_definitions",
      "tracking_and_redirect_qa", "matching_reporting_windows"];
  } else {
    diagnosis = "FUNNEL_BASELINE_INCOMPLETE";
    action = "VERIFY_FUNNEL_BASELINE";
    priority = "P2";
    rationale = "Available observations do not establish a paid acquisition outcome.";
    evidence = ["authenticated_campaign_spend_and_clicks",
      "verified_landing_and_checkout_events", "hitpay_paid_settled_and_entitlement_evidence"];
  }
  const requiredEvidence = Object.freeze([...evidence]);
  const candidateId = "demand:next-action:sha256:" + createHash("sha256")
    .update(JSON.stringify([observation.snapshotKey, diagnosis, action, requiredEvidence]))
    .digest("hex");
  return Object.freeze({
    candidateId, sourceKey: observation.sourceKey,
    evidenceCandidateKey: observation.snapshotKey,
    status: "PROPOSED_UNATTESTED" as const,
    diagnosis, action, priority, rationale, requiredEvidence,
    providerAuthenticationVerified: false as const,
    tenantMembershipVerified: false as const,
    ownerApproved: false as const,
    actionExecuted: false as const,
    outcomeVerified: false as const,
    learningVerified: false as const,
    executionAllowed: false as const,
    noProviderWrites: true as const,
    maxIncrementalSpendMinor: 0 as const,
    verifiedPaidOrders: null, verifiedSettledOrders: null,
    verifiedCacMinor: null, causalLift: null,
  });
}
