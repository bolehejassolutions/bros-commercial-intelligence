/** Fail-closed, provider-neutral batch admission for paid-order/Purchase evidence.
 * Call only after independently authenticated provider reads. This checks
 * uniqueness inside the supplied batch, not across historic provider records.
 * No return value constitutes a payment, attribution, or launch attestation.
 */
import { reconcileDemandPaidPurchaseCandidate } from "./meta-paid-purchase-reconciliation.ts";

export type PaidPurchasePair = Readonly<{order: unknown; purchase: unknown}>;
export type BatchDecision = Readonly<{
  status: "CANDIDATES_UNATTESTED" | "REJECTED";
  reason: string;
  acceptedCount: number;
  independentlyVerified: false;
  launchAllowed: false;
}>;

export function reconcileDemandPaidPurchaseBatch(pairs: unknown, now: string): BatchDecision {
  const reject = (reason: string): BatchDecision => Object.freeze({
    status: "REJECTED", reason, acceptedCount: 0,
    independentlyVerified: false, launchAllowed: false,
  });
  if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > 100)
    return reject("INVALID_BATCH_SIZE");
  const orders = new Set<string>();
  const events = new Set<string>();
  const references = new Set<string>();
  for (const pair of pairs) {
    if (pair === null || typeof pair !== "object" || Array.isArray(pair) ||
        Object.getPrototypeOf(pair) !== Object.prototype ||
        Reflect.ownKeys(pair).length !== 2 ||
        !Object.hasOwn(pair, "order") || !Object.hasOwn(pair, "purchase") ||
        !["order", "purchase"].every(k => {
          const d = Object.getOwnPropertyDescriptor(pair, k);
          return d?.enumerable === true && Object.hasOwn(d, "value");
        })) return reject("MALFORMED_PAIR");
    const { order, purchase } = pair as PaidPurchasePair;
    const decision = reconcileDemandPaidPurchaseCandidate(order, purchase, now);
    if (decision.status !== "MATCHED_UNATTESTED") return reject(decision.reason);
    // The individual validator guarantees plain, exact-shape records and
    // well-formed reference strings before any of these fields are read.
    const o = order as {orderId: string; referenceNumber: string};
    const p = purchase as {eventId: string};
    if (orders.has(o.orderId) || events.has(p.eventId) || references.has(o.referenceNumber))
      return reject("DUPLICATE_ORDER_EVENT_OR_REFERENCE");
    orders.add(o.orderId);
    events.add(p.eventId);
    references.add(o.referenceNumber);
  }
  return Object.freeze({
    status: "CANDIDATES_UNATTESTED", reason: "PROVIDER_AUTH_OWNERSHIP_UTM_AND_HISTORIC_DEDUP_REQUIRED",
    acceptedCount: pairs.length, independentlyVerified: false, launchAllowed: false,
  });
}
