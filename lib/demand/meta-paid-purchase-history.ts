/** Historical dedup gate for provider-attested identifier snapshots.
 * This is a preflight only: a clean result NEVER attests provider identity,
 * ownership, payment, attribution, or permission to stage/launch ads.
 * Caller must obtain historical identifiers from authenticated provider reads.
 */
import { reconcileDemandPaidPurchaseBatch } from "./meta-paid-purchase-batch.ts";

type HistoricalIds = Readonly<{orderIds: readonly string[]; eventIds: readonly string[]; references: readonly string[]}>;
type Gate = Readonly<{status: "REJECTED" | "CANDIDATES_UNATTESTED"; reason: string; acceptedCount: number; independentlyVerified: false; launchAllowed: false}>;

export function reconcileDemandPaidPurchaseWithHistory(pairs: unknown, now: string, history: unknown): Gate {
  const reject = (reason: string): Gate => Object.freeze({
    status: "REJECTED", reason, acceptedCount: 0, independentlyVerified: false, launchAllowed: false,
  });
  try {
    // Exact-shape, bounded input prevents silently skipping an untrusted ledger.
    if (history === null || typeof history !== "object" || Array.isArray(history) ||
        Object.getPrototypeOf(history) !== Object.prototype ||
        Reflect.ownKeys(history).length !== 3 ||
        !["orderIds", "eventIds", "references"].every(k => {
          const d = Object.getOwnPropertyDescriptor(history, k);
          return d?.enumerable === true && Object.hasOwn(d, "value");
        })) return reject("INVALID_HISTORICAL_LEDGER");
    const h = history as HistoricalIds;
    const keys = ["orderIds", "eventIds", "references"] as const;
    const sets = [] as Set<string>[];
    for (const key of keys) {
      const values = h[key];
      if (!Array.isArray(values) || values.length > 10000 ||
          Object.getPrototypeOf(values) !== Array.prototype ||
          Reflect.ownKeys(values).length !== values.length + 1)
        return reject("INVALID_HISTORICAL_LEDGER");
      const ids = new Set<string>();
      for (let i = 0; i < values.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(values, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
          return reject("INVALID_HISTORICAL_LEDGER");
        const id = descriptor.value;
        if (typeof id !== "string" || id.length < 1 || id.length > 256 || id.trim() !== id ||
            /[\u0000-\u001f\u007f]/.test(id) || ids.has(id))
          return reject("INVALID_HISTORICAL_LEDGER");
        ids.add(id);
      }
      if (ids.size !== values.length) return reject("INVALID_HISTORICAL_LEDGER");
      sets.push(ids);
    }
    const base = reconcileDemandPaidPurchaseBatch(pairs, now);
    if (base.status !== "CANDIDATES_UNATTESTED") return base;
    for (const pair of pairs as Array<{order: {orderId: string; referenceNumber: string}; purchase: {eventId: string}}>) {
      if (sets[0].has(pair.order.orderId) || sets[1].has(pair.purchase.eventId) ||
          sets[2].has(pair.order.referenceNumber))
        return reject("HISTORICAL_ORDER_EVENT_OR_REFERENCE_COLLISION");
    }
    return Object.freeze({...base, reason: "HISTORICAL_DEDUP_CLEAN_PROVIDER_ATTESTATION_STILL_REQUIRED"});
  } catch {
    return reject("UNREADABLE_HISTORICAL_EVIDENCE");
  }
}
