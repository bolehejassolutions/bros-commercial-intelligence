import { createHash } from "node:crypto";
/**
 * DEMAND product-only read-only HitPay order/charge reconciliation candidate.
 * Callers independently authenticate provider reads and tenant scope.
 * Not live/test attestation, purchased-product identity, payout allocation,
 * bank settlement, entitlement or acquisition attribution. No BCI writer.
 */
export type HitPayOrderObservation = Readonly<{
  id: string; order_display_number: number; amount: number; // orders: minor MYR
  currency: string; status: string; payment_status: string; fulfilment_status: string;
}>;
export type HitPayChargeObservation = Readonly<{
  id: string; amount: number; currency: string; status: string; remark: string;
}>; // charges list: minor MYR
export type HitPayChargeDetailObservation = Readonly<{
  id: string; amount: number; amount_without_fees: number; refunded_amount: number;
  currency: string; status: string; remark: string; order_reference_number: string;
  payout?: unknown; // details: major MYR; payout alone never proves allocation
}>;
export type DemandHitPayReconciliation = Readonly<{
  candidateKey: string;
  /** Stable pseudonymous order identity across fee/refund/status snapshots; not attestation. */
  orderIdentityDigest: string;
  status: "PROVIDER_REPORTED_PAID" | "REFUND_OBSERVED" | "NOT_PAID";
  orderId: string; chargeId: string;
  grossMinor: number; feeMinor: number; netMinor: number; refundedMinor: number;
  orderPaymentStatus: string; orderFulfilmentStatus: string;
  providerOrderChargeLinkMatched: true;
  providerAuthenticationVerified: false; tenantMembershipVerified: false;
  paymentEnvironmentVerified: false; productVerified: false;
  payoutAllocationVerified: false; bankSettlementVerified: false;
  entitlementVerified: false; acquisitionAttributionVerified: false;
  verifiedBrosSellOrders: null; settledOrders: null;
  verifiedCacMinor: null; causalLift: null;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw new Error("Invalid BROS DEMAND HitPay order-charge evidence"); };
function majorToMinor(value: unknown): number {
  if (typeof value !== "number") return fail();
  if (!Number.isFinite(value) || value < 0 ||
      !Number.isSafeInteger(Math.round(value * 100)) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) return fail();
  return Math.round(value * 100);
}
function minor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** Fail closed: explicit order ID and display number, not amount/date coincidence. */
export function reconcileDemandHitPayOrderCharge(
  order: HitPayOrderObservation,
  charge: HitPayChargeObservation,
  detail: HitPayChargeDetailObservation,
): DemandHitPayReconciliation {
  if (!order || !charge || !detail ||
      // RegExp.test coerces arrays and custom objects to strings. A forged
      // order/charge ID could otherwise pass linkage checks before causing an
      // unmasked TypeError during canonical digest construction. Never call
      // user-defined toString while validating provider identity.
      typeof order.id !== "string" || typeof charge.id !== "string" ||
      typeof detail.id !== "string" ||
      !UUID.test(order.id) || !UUID.test(charge.id) ||
      !Number.isSafeInteger(order.order_display_number) || order.order_display_number <= 0 ||
      !minor(order.amount) || !minor(charge.amount) ||
      typeof order.currency !== "string" || typeof charge.currency !== "string" ||
      typeof detail.currency !== "string" ||
      order.currency.toLowerCase() !== "myr" || charge.currency.toLowerCase() !== "myr" ||
      detail.currency.toLowerCase() !== "myr" ||
      !["completed", "canceled", "draft"].includes(order.status) ||
      !["paid", "awaiting_payment", "refunded", "partially_refunded", "canceled"].includes(order.payment_status) ||
      !["pending", "completed", "canceled", "payment_in_progress"].includes(order.fulfilment_status) ||
      !["succeeded", "refunded", "failed"].includes(charge.status) ||
      detail.status !== charge.status || detail.id !== charge.id ||
      charge.remark !== "Order #" + order.id || detail.remark !== charge.remark ||
      detail.order_reference_number !== String(order.order_display_number) ||
      order.amount !== charge.amount) fail();
  const grossMinor = majorToMinor(detail.amount);
  const netMinor = majorToMinor(detail.amount_without_fees);
  const refundedMinor = majorToMinor(detail.refunded_amount);
  if (grossMinor !== order.amount || netMinor > grossMinor || refundedMinor > grossMinor) fail();
  const feeMinor = grossMinor - netMinor;
  const refunded = refundedMinor > 0 || charge.status === "refunded" ||
    order.payment_status === "refunded" || order.payment_status === "partially_refunded";
  const paid = order.status === "completed" && order.payment_status === "paid" &&
    charge.status === "succeeded" && !refunded;
  const status = refunded ? "REFUND_OBSERVED" as const :
    paid ? "PROVIDER_REPORTED_PAID" as const : "NOT_PAID" as const;
  // Retrieval time/PII excluded. This candidate is NOT a BCI evidence ID.
  const orderIdentityDigest = createHash("sha256")
    .update("bros-demand:hitpay-order-identity:v1:" + order.id.toLowerCase())
    .digest("hex");
  const candidateKey = "demand:hitpay-candidate:sha256:" + createHash("sha256")
    .update(JSON.stringify([order.id.toLowerCase(), charge.id.toLowerCase(),
      order.order_display_number, order.status, order.payment_status,
      order.fulfilment_status, charge.status, grossMinor, feeMinor,
      netMinor, refundedMinor]))
    .digest("hex");
  return Object.freeze({
    candidateKey, orderIdentityDigest, status, orderId: order.id, chargeId: charge.id,
    grossMinor, feeMinor, netMinor, refundedMinor,
    orderPaymentStatus: order.payment_status,
    orderFulfilmentStatus: order.fulfilment_status,
    providerOrderChargeLinkMatched: true as const,
    providerAuthenticationVerified: false as const,
    tenantMembershipVerified: false as const,
    paymentEnvironmentVerified: false as const,
    productVerified: false as const,
    payoutAllocationVerified: false as const,
    bankSettlementVerified: false as const,
    entitlementVerified: false as const,
    acquisitionAttributionVerified: false as const,
    verifiedBrosSellOrders: null,
    settledOrders: null,
    verifiedCacMinor: null,
    causalLift: null,
  });
}
