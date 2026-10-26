/**
 * Read-only, provider-list-row reconciliation for INTERNAL BCI.
 *
 * Both rows must come from trusted, independently fetched HitPay list_charges
 * and list_orders results. Their amounts are in MINOR units (MYR sen).
 * HitPay get_charge_details instead returns MAJOR units: never pass its amount
 * here without an explicit and tested conversion boundary.
 *
 * This function proves only that HitPay reported matching PAID order/charge
 * records. It does NOT verify live-vs-test environment, BROS SELL product,
 * refunds, payout settlement, digital entitlement or marketing attribution.
 * In particular, its output MUST NOT be promoted to a verified live
 * GrowthEvidence paid_order or settled_order without independent checks.
 */

export type HitPayListCharge = Readonly<{
  id: string;
  remark: string | null;
  amount: number; // minor units
  currency: string;
  status: string;
  closed_at?: string | null;
}>;

export type HitPayListOrder = Readonly<{
  id: string;
  amount: number; // minor units
  currency: string;
  status: string;
  payment_status: string;
  fulfilment_status: string;
}>;

export type HitPayPaidPair = Readonly<{
  sourceKey: string;
  chargeId: string;
  orderId: string;
  currency: "MYR";
  grossChargeMinor: number;
  providerPaymentState: "paid";
  providerFulfilmentState: "completed" | "pending";
  environment: "unverified";
  productAttribution: "unverified";
  refundState: "unverified";
  payoutSettlement: "unverified";
  digitalEntitlement: "unverified";
  acquisitionAttribution: "unverified";
  closedAt: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$/;
/** Validate the actual UTC-offset calendar instant, not Date.parse's rollover. */
function validClosedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO.exec(value);
  if (!match) return false;
  const [, y, mo, d, h, mi, s, zone] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month] ||
      hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    const [offsetHours, offsetMinutes] = zone.slice(1).split(":").map(Number);
    if (offsetHours > 14 || offsetMinutes > 59 ||
        (offsetHours === 14 && offsetMinutes !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}
const fail = (): never => { throw new Error("HitPay read-only reconciliation mismatch"); };
const minor = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const uuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

export function reconcileHitPayPaidPair(
  charge: HitPayListCharge,
  order: HitPayListOrder,
): HitPayPaidPair {
  if (!charge || !order || !uuid(charge.id) || !uuid(order.id) ||
      charge.remark !== `Order #${order.id}` ||
      charge.status !== "succeeded" || order.status !== "completed" ||
      order.payment_status !== "paid" ||
      (order.fulfilment_status !== "completed" && order.fulfilment_status !== "pending") ||
      typeof charge.currency !== "string" || typeof order.currency !== "string" ||
      charge.currency.toUpperCase() !== "MYR" || order.currency.toUpperCase() !== "MYR" ||
      !minor(charge.amount) || !minor(order.amount) || charge.amount !== order.amount ||
      (charge.closed_at !== undefined && charge.closed_at !== null &&
        !validClosedAt(charge.closed_at))) fail();

  const fulfilmentState = order.fulfilment_status === "completed" ? "completed" : "pending";
  return Object.freeze({
    sourceKey: `hitpay:charge:${charge.id.toLowerCase()}`,
    chargeId: charge.id.toLowerCase(),
    orderId: order.id.toLowerCase(),
    currency: "MYR",
    grossChargeMinor: charge.amount,
    providerPaymentState: "paid",
    providerFulfilmentState: fulfilmentState,
    environment: "unverified",
    productAttribution: "unverified",
    refundState: "unverified",
    payoutSettlement: "unverified",
    digitalEntitlement: "unverified",
    acquisitionAttribution: "unverified",
    closedAt: charge.closed_at ?? null,
  });
}
