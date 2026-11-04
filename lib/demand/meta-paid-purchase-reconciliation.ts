/**
 * Provider-neutral, read-only DEMAND reconciliation candidate.
 * Callers must fetch both records independently from authenticated providers.
 * This never creates a launch receipt or certifies payment attribution.
 */
export type PaidOrderEvidence = Readonly<{
  provider: "hitpay"; orderId: string; paymentStatus: "paid";
  amountMinor: number; currency: "MYR"; paidAt: string;
  referenceNumber: string | null;
}>;
export type PurchaseEvidence = Readonly<{
  provider: "meta"; pixelId: string; eventName: "Purchase";
  eventId: string; valueMinor: number; currency: "MYR";
  eventAt: string; orderReference: string | null;
  deduplicationVerified: boolean;
}>;
const REF = /^[A-Za-z0-9_-]{3,100}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const timestamp = (v: unknown) => typeof v === "string" && UTC.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const record = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).length === keys.length &&
  keys.every(k => Object.hasOwn(v, k) && !!Object.getOwnPropertyDescriptor(v, k)?.enumerable &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(v, k)!, "value"));
const orderKeys = ["provider","orderId","paymentStatus","amountMinor","currency","paidAt","referenceNumber"];
const eventKeys = ["provider","pixelId","eventName","eventId","valueMinor","currency","eventAt","orderReference","deduplicationVerified"];
export function reconcileDemandPaidPurchaseCandidate(
  order: unknown, purchase: unknown, now: string,
): Readonly<{status: "MATCHED_UNATTESTED" | "REJECTED"; reason: string;
  independentlyVerified: false; launchAllowed: false}> {
  const fail = (reason: string) => Object.freeze({status:"REJECTED" as const, reason,
    independentlyVerified:false as const, launchAllowed:false as const});
  if (!timestamp(now) || !record(order, orderKeys) || !record(purchase, eventKeys))
    return fail("MALFORMED_PROVIDER_EVIDENCE");
  if (order.provider !== "hitpay" || purchase.provider !== "meta" ||
      order.paymentStatus !== "paid" || purchase.eventName !== "Purchase" ||
      order.currency !== "MYR" || purchase.currency !== "MYR" ||
      order.amountMinor !== 10000 || purchase.valueMinor !== 10000)
    return fail("PAID_PURCHASE_VALUE_MISMATCH");
  if (typeof order.orderId !== "string" || !REF.test(order.orderId) ||
      typeof purchase.eventId !== "string" || !REF.test(purchase.eventId) ||
      purchase.pixelId !== "1636131111400103" ||
      typeof order.referenceNumber !== "string" || !REF.test(order.referenceNumber) ||
      order.referenceNumber !== purchase.orderReference)
    return fail("PAID_PURCHASE_REFERENCE_MISMATCH");
  if (!timestamp(order.paidAt) || !timestamp(purchase.eventAt) ||
      Date.parse(order.paidAt) > Date.parse(now) ||
      Date.parse(purchase.eventAt) > Date.parse(now) ||
      Math.abs(Date.parse(order.paidAt) - Date.parse(purchase.eventAt)) > 86400000 ||
      Date.parse(now) - Date.parse(order.paidAt) > 86400000 ||
      Date.parse(now) - Date.parse(purchase.eventAt) > 86400000 ||
      Date.parse(purchase.eventAt) < Date.parse(order.paidAt) - 300000)
    return fail("STALE_OR_INCONSISTENT_PROVIDER_TIMES");
  if (purchase.deduplicationVerified !== true)
    return fail("PURCHASE_DEDUP_NOT_VERIFIED");
  // Independent API authentication, event/order ownership and UTM lineage
  // cannot be established by two caller-supplied JSON objects.
  return Object.freeze({status:"MATCHED_UNATTESTED" as const, reason:"PROVIDER_AUTH_AND_UTM_JOIN_REQUIRED",
    independentlyVerified:false as const, launchAllowed:false as const});
}
