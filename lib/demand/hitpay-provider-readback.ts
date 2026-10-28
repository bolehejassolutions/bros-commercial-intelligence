import { createHash } from "node:crypto";
import { reconcileDemandHitPayOrderCharge } from "./hitpay-order-charge.ts";
import type {
  HitPayOrderObservation, HitPayChargeObservation, HitPayChargeDetailObservation,
} from "./hitpay-order-charge.ts";

/**
 * DEMAND-only cross-endpoint consistency readback for an already identified
 * HitPay order. Accepts four independently retrieved provider responses.
 * The connector's authenticated session is NOT the DEMAND application's
 * independently verified tenant-scoped server credential.
 *
 * Never emit payer PII, raw merchant order/charge IDs, provider card metadata,
 * or a fabricated Meta event-to-order join. No DB or payment writes.
 */
type Page<T> = Readonly<{
  data: T[]; has_more: boolean; next_cursor: string | null;
}>;
type RefundReadback = Readonly<{
  transaction_id: string; charge_status: string; charge_amount: number;
  currency: string; total_refunded: number; refunds: unknown[];
}>;
const invalid = (): never => { throw new Error("Invalid BROS DEMAND HitPay provider readback"); };
const toMinor = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      !Number.isSafeInteger(Math.round(value * 100)) ||
      Math.round(value * 100) / 100 !== value) return invalid();
  return Math.round(value * 100);
};

export function reviewDemandHitPayProviderReadback(
  orders: Page<HitPayOrderObservation>,
  charges: Page<HitPayChargeObservation>,
  detail: HitPayChargeDetailObservation,
  refundReadback: RefundReadback,
) {
  // A bounded page is only usable as a complete one-order candidate when
  // pagination is explicitly exhausted. No claim about other time windows.
  if (!orders || !charges || !Array.isArray(orders.data) ||
      !Array.isArray(charges.data) || orders.data.length !== 1 ||
      charges.data.length !== 1 || orders.has_more !== false ||
      charges.has_more !== false || orders.next_cursor !== null ||
      charges.next_cursor !== null || !refundReadback ||
      !Array.isArray(refundReadback.refunds)) invalid();

  const order = orders.data[0];
  const charge = charges.data[0];
  const payment = reconcileDemandHitPayOrderCharge(order, charge, detail);
  if (refundReadback.transaction_id !== charge.id ||
      refundReadback.charge_status !== charge.status ||
      typeof refundReadback.currency !== "string" ||
      refundReadback.currency.toLowerCase() !== "myr" ||
      toMinor(refundReadback.charge_amount) !== payment.grossMinor ||
      toMinor(refundReadback.total_refunded) !== payment.refundedMinor ||
      (payment.refundedMinor === 0 && refundReadback.refunds.length !== 0) ||
      (payment.refundedMinor > 0 && refundReadback.refunds.length === 0)) invalid();

  const refundObservation = payment.refundedMinor === 0
    ? "NO_REFUNDS_REPORTED_AT_READBACK" as const
    : "REFUND_REVIEW_REQUIRED" as const;
  // A live HitPay charge detail may return payout:null even when an
  // independently listed payout has a coincident net amount. Distinguish
  // missing, explicit null and non-null provider fields without interpreting
  // a non-null value as an allocation or exposing its raw contents.
  const chargePayoutFieldState = !Object.hasOwn(detail, "payout") ||
    detail.payout === undefined ? "NOT_RETURNED" as const :
    detail.payout === null ? "NULL_UNLINKED" as const :
    "PRESENT_UNVERIFIED" as const;
  const snapshotKey = "demand:hitpay-provider-readback:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v2", payment.candidateKey, refundObservation,
      refundReadback.refunds.length, payment.refundedMinor, chargePayoutFieldState]))
    .digest("hex");

  return Object.freeze({
    snapshotKey,
    orderIdentityDigest: payment.orderIdentityDigest,
    observation: payment.status,
    refundObservation,
    chargePayoutFieldState,
    providerOrderChargeReferenceConsistent: true as const,
    orderDisplayNumber: order.order_display_number,
    currency: "MYR" as const,
    grossMinor: payment.grossMinor,
    feeMinor: payment.feeMinor,
    netAfterFeesMinor: payment.netMinor,
    refundedMinor: payment.refundedMinor,
    // A successful charge, completed fulfilment, and no refund at readback
    // do not attest a bank payout, the product, entitlement or ad attribution.
    payoutAllocationVerified: false as const,
    bankSettlementVerified: false as const,
    brosSellProductVerified: false as const,
    entitlementVerified: false as const,
    metaEventToOrderJoinVerified: false as const,
    providerAuthenticationVerifiedForDemandApp: false as const,
    tenantAuthorizationVerifiedForDemandApp: false as const,
    experimentActionVerified: false as const,
    verifiedAcquisitionOutcome: null,
    verifiedSettledOrders: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    durableBciLearningVerified: false as const,
    nextEvidenceAction: "VERIFY_META_EVENT_ORDER_LINK_AND_BANK_PAYOUT_ALLOCATION" as const,
  });
}
