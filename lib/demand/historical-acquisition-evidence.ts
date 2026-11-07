import { createHash } from "node:crypto";
import { normalizeMetaCampaignFunnel } from "./meta-insights-funnel.ts";
import { reconcileDemandHitPayOrderCharge } from "./hitpay-order-charge.ts";
import type { MetaCampaignInsight, MetaFunnelScope } from "./meta-insights-funnel.ts";
import type {
  HitPayOrderObservation, HitPayChargeObservation, HitPayChargeDetailObservation,
} from "./hitpay-order-charge.ts";

/**
 * DEMAND-only, read-only juxtaposition of independent Meta and HitPay observations.
 * Neither a shared BCI evidence writer nor a provider-authenticated transaction
 * join. Same date, amount or purchase count NEVER establishes event->order identity,
 * settlement, entitlement, attribution, incremental sales or a completed experiment.
 * Keep raw merchant transaction IDs and payer information out of the result.
 */
export function reviewDemandAcquisitionEvidencePair(
  scope: MetaFunnelScope,
  metaRow: MetaCampaignInsight,
  order: HitPayOrderObservation,
  charge: HitPayChargeObservation,
  chargeDetail: HitPayChargeDetailObservation,
) {
  // Recompute from raw observations. Never trust caller-supplied "verified" flags.
  const meta = normalizeMetaCampaignFunnel(scope, metaRow);
  const payment = reconcileDemandHitPayOrderCharge(order, charge, chargeDetail);
  const omniPositive = (metaRow.actions ?? []).some(action =>
    action.action_type === "omni_purchase" && Number(action.value) > 0);
  const metaPurchaseSignal = (meta.metaAttributedPurchases ?? 0) > 0 ||
    (meta.pixelPurchaseEvents ?? 0) > 0 || omniPositive;
  const paymentCandidate = payment.status === "PROVIDER_REPORTED_PAID";

  const nextAction = meta.actionAliasMismatch ? "AUDIT_META_ACTION_ALIASES" :
    metaPurchaseSignal && paymentCandidate ? "OBTAIN_META_EVENT_TO_HITPAY_ORDER_LINK" :
    metaPurchaseSignal ? "VERIFY_HITPAY_PAYMENT_AND_REFUND_STATE" :
    paymentCandidate ? "VERIFY_META_PURCHASE_EVENT_COVERAGE" :
    "VERIFY_BOTH_PROVIDER_BASELINES";

  const pairKey = "demand:acquisition-evidence-pair:sha256:" + createHash("sha256")
    .update(JSON.stringify([
      "v1", meta.snapshotKey, payment.candidateKey, nextAction,
    ])).digest("hex");

  return Object.freeze({
    pairKey,
    status: "UNATTESTED_PARALLEL_EVIDENCE" as const,
    metaSourceKey: meta.sourceKey,
    metaSnapshotKey: meta.snapshotKey,
    hitpayCandidateKey: payment.candidateKey,
    hitpayOrderIdentityDigest: payment.orderIdentityDigest,
    metaPurchaseAliasConflict: meta.actionAliasMismatch,
    // Campaign spend and funnel observations are independently provider-reported.
    // Never divide by the unrelated HitPay order to imply CPA, ROAS or attribution.
    metaObservedSpendMinor: meta.spendMinor,
    metaObservedInlineLinkClicks: meta.inlineLinkClicks,
    metaObservedLandingPageViews: meta.landingPageViews,
    metaAttributedPurchaseEvents: meta.metaAttributedPurchases,
    pixelPurchaseEvents: meta.pixelPurchaseEvents,
    hitpayPaymentObservation: payment.status,
    hitpayGrossMinor: payment.grossMinor,
    hitpayFeeMinor: payment.feeMinor,
    hitpayNetMinor: payment.netMinor,
    hitpayRefundedMinor: payment.refundedMinor,
    nextAction,
    requiredIndependentEvidence: Object.freeze([
      "authenticated_and_tenant_scoped_meta_and_hitpay_source_receipts",
      "hitpay_live_environment_and_bros_sell_product_identity",
      "provider_event_or_click_to_merchant_order_identifier_join",
      "independent_payout_allocation_refund_and_entitlement_readback",
      "authorized_experiment_action_and_durable_bci_outcome_learning",
    ]),
    providerAuthenticationVerified: false as const,
    tenantMembershipVerified: false as const,
    paymentEnvironmentVerified: false as const,
    productVerified: false as const,
    metaEventToOrderJoinVerified: false as const,
    acquisitionAttributionVerified: false as const,
    payoutAllocationVerified: false as const,
    bankSettlementVerified: false as const,
    entitlementVerified: false as const,
    actionExecutedVerified: false as const,
    outcomeVerified: false as const,
    learningVerified: false as const,
    executionAllowed: false as const,
    verifiedBrosSellOrders: null,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
  });
}
