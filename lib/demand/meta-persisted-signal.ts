/** DEMAND-owned interpretation of ONE immutable historical DEV receipt.
 * Counts remain UNVERIFIED platform observations. No provider request, paid
 * order, causal diagnosis, approval, experiment, outcome or learning is made.
 */
import { createHash } from "node:crypto";
import { reviewPersistedDemandMetaReceipt } from "./meta-persisted-diagnosis.ts";
import type { BciLineageRecord } from "../bci/internal-lineage.ts";

export const DEMAND_META_SIGNAL_VERSION = "DEMAND_META_OBSERVATION_V1";
export const DEMAND_META_SIGNAL_SOURCE_SHA256 = "bcffc79b2bbedcef0cbe5f505715493aad91fca17b039cb5be11e078fdee15a2";
type Source = Parameters<typeof reviewPersistedDemandMetaReceipt>[0];
const receiptId = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const sourceKey = "demand:meta-read:sha256:a31d0438050fc4745e4a8c8b8fd36a1ab2345937e7fa55bfa68076f08c1b5a16";
const metrics = ["spend_minor", "inline_link_clicks", "landing_page_views",
  "meta_attributed_purchases", "pixel_purchase_events"] as const;
const requiredUnknowns = ["campaign_impact_not_causal", "hitpay_paid_order_not_reconciled",
  "independent_provider_receipt_not_verified"];
const deny = (): never => { throw Error("DEMAND_META_SIGNAL_SOURCE_DENIED"); };
const dataKeys = (value: unknown, allowed: readonly string[]): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every(k => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return typeof k === "string" && allowed.includes(k) && d?.enumerable === true &&
      Object.hasOwn(d, "value");
  });
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Recomputable, versioned source binding; a changed fixed snapshot fails closed. */
export function interpretPersistedDemandMetaSignal(source: Source) {
  if (!dataKeys(source, ["id", "tenantId", "product", "provider", "completeness",
      "collectedAt", "periodStart", "periodEnd", "providerRecordKey", "metrics",
      "unknowns", "linkedCase"]) || source.id !== receiptId ||
      source.providerRecordKey !== sourceKey || !dataKeys(source.metrics, metrics) ||
      Reflect.ownKeys(source.metrics).length !== metrics.length ||
      !metrics.every(k => Number.isSafeInteger(source.metrics[k]) &&
        typeof source.metrics[k] === "number" && (source.metrics[k] as number) >= 0) ||
      !Array.isArray(source.unknowns) || source.unknowns.length !== requiredUnknowns.length ||
      Reflect.ownKeys(source.unknowns).length !== requiredUnknowns.length + 1) deny();
  for (let i = 0; i < source.unknowns.length; i++) {
    const d = Object.getOwnPropertyDescriptor(source.unknowns, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, "value") || typeof d.value !== "string") deny();
  }
  const unknowns = [...source.unknowns].sort();
  if (JSON.stringify(unknowns) !== JSON.stringify(requiredUnknowns)) deny();
  const review = reviewPersistedDemandMetaReceipt(source);
  const canonical = JSON.stringify([source.tenantId, receiptId, sourceKey,
    review.periodStart, review.periodEnd, review.collectedAt,
    metrics.map(k => source.metrics[k]), unknowns]);
  const sourceSha256 = digest("DEMAND_META_OBSERVATION_SOURCE_V1\n" + canonical);
  if (sourceSha256 !== DEMAND_META_SIGNAL_SOURCE_SHA256) deny();
  const interpretationSha256 = digest(DEMAND_META_SIGNAL_VERSION + "\n" + sourceSha256);
  const chars = interpretationSha256.slice(0, 32).split("");
  chars[12] = "8"; chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const id = chars.join("").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  const evidence: BciLineageRecord = Object.freeze({ id: receiptId,
    tenantId: source.tenantId, product: "demand", stage: "evidence",
    sourceSystem: "bci_dev.evidence", sourceRecordKey: receiptId,
    recordedAt: review.collectedAt, parentIds: Object.freeze([]), verification: "unverified" });
  const signal: BciLineageRecord = Object.freeze({ id, tenantId: source.tenantId,
    product: "demand", stage: "signal", sourceSystem: "demand.meta-observation.v1",
    sourceRecordKey: "demand:meta-observation:v1:sha256:" + interpretationSha256,
    recordedAt: review.collectedAt, parentIds: Object.freeze([receiptId]), verification: "unverified" });
  return Object.freeze({ version: DEMAND_META_SIGNAL_VERSION, sourceSha256,
    interpretationSha256, evidence, signal,
    periodStart: review.periodStart, periodEnd: review.periodEnd,
    observed: Object.freeze({ ...review.observed }), unknowns: Object.freeze(unknowns),
    statement: "Historical Meta link, landing-page and purchase counts were reported; independent provider receipt and first-party paid-order reconciliation remain unverified.",
    verification: "unverified" as const, providerAttested: false as const,
    verifiedPaidOrders: null, verifiedCpaMinor: null, causalLift: null,
    actionAuthorized: false as const, outcomeVerified: false as const, learningRecorded: false as const });
}
