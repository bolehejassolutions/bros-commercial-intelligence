import { createHash } from "node:crypto";

/**
 * DEMAND-only, privacy-minimized comparison of independently read HitPay and
 * BROS SELL Supabase entitlement aggregates. It does NOT query Supabase,
 * authenticate either provider, own auth/DB, grant access, or join buyers.
 *
 * The Supabase connector read is privileged and is NOT proof that the DEMAND
 * application can perform a tenant-authorized query. A missing external
 * reference is not proof that a customer lacks manual/offline fulfilment.
 */
export type SellEntitlementAggregateRow = Readonly<{
  productCode: string;
  status: string;
  source: string;
  accessLevel: string;
  hasExternalPurchaseReference: boolean;
  directOrderReferenceMatch: boolean;
  count: number;
}>;
export type SellEntitlementInventory = Readonly<{
  projectRef: string;
  products: ReadonlyArray<Readonly<{ code: string; active: boolean }>>;
  rows: ReadonlyArray<SellEntitlementAggregateRow>;
  totalEntitlements: number;
  totalEntitlementEvents: number;
  // This is a caller-declared read scope, NOT independently authenticated.
  queryScope: "FULL_TABLE_AGGREGATE";
}>;
export type PaidOrderReference = Readonly<{
  orderIdentityDigest: string;
  observation: "PROVIDER_REPORTED_PAID";
  orderDisplayNumber: number;
  currency: "MYR";
  // A paid charge alone never establishes bank settlement or buyer identity.
  bankSettlementVerified: false;
  entitlementVerified: false;
}>;

const fail = (): never => { throw new Error("Invalid BROS DEMAND entitlement coverage evidence"); };
const digestPattern = /^[a-f0-9]{64}$/;
const codePattern = /^[A-Z][A-Z0-9_]{2,79}$/;
const safeCount = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const assertKeys = (value: object, allowed: ReadonlyArray<string>): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
};

export function assessDemandSellEntitlementCoverage(
  order: PaidOrderReference,
  inventory: SellEntitlementInventory,
) {
  if (!order || !inventory || typeof order !== "object" ||
      typeof inventory !== "object" || Array.isArray(order) || Array.isArray(inventory)) fail();
  assertKeys(order, ["orderIdentityDigest", "observation", "orderDisplayNumber",
    "currency", "bankSettlementVerified", "entitlementVerified"]);
  assertKeys(inventory, ["projectRef", "products", "rows", "totalEntitlements",
    "totalEntitlementEvents", "queryScope"]);
  if (typeof order.orderIdentityDigest !== "string" ||
      !digestPattern.test(order.orderIdentityDigest) ||
      order.observation !== "PROVIDER_REPORTED_PAID" ||
      !Number.isSafeInteger(order.orderDisplayNumber) || order.orderDisplayNumber <= 0 ||
      order.currency !== "MYR" || order.bankSettlementVerified !== false ||
      order.entitlementVerified !== false ||
      inventory.projectRef !== "cyryoirzxpvummckegyh" ||
      inventory.queryScope !== "FULL_TABLE_AGGREGATE" ||
      !Array.isArray(inventory.products) || !Array.isArray(inventory.rows) ||
      inventory.products.length < 1 || inventory.products.length > 50 ||
      inventory.rows.length > 200 || !safeCount(inventory.totalEntitlements) ||
      !safeCount(inventory.totalEntitlementEvents)) fail();

  const products = new Map<string, boolean>();
  for (const product of inventory.products) {
    if (!product || typeof product !== "object" || Array.isArray(product)) fail();
    assertKeys(product, ["code", "active"]);
    if (typeof product.code !== "string" || !codePattern.test(product.code) ||
        typeof product.active !== "boolean" || products.has(product.code)) fail();
    products.set(product.code, product.active);
  }
  if (products.get("BROS_SELL_CORE") !== true ||
      products.get("BROS_SELL_WEB_OS") !== true) fail();

  const groupKeys = new Set<string>();
  let aggregateCount = 0;
  let explicitReferenceCount = 0;
  let activeExplicitReferenceCount = 0;
  let activeCoreCount = 0;
  let activeWebOsCount = 0;
  let activeManualCount = 0;
  const stableRows: Array<readonly [string, string, string, string, boolean, boolean, number]> = [];
  for (const row of inventory.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail();
    assertKeys(row, ["productCode", "status", "source", "accessLevel",
      "hasExternalPurchaseReference", "directOrderReferenceMatch", "count"]);
    if (typeof row.productCode !== "string" || !products.has(row.productCode) ||
        !["active", "revoked", "expired"].includes(row.status) ||
        !["hitpay", "manual", "admin", "migration"].includes(row.source) ||
        typeof row.accessLevel !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(row.accessLevel) ||
        typeof row.hasExternalPurchaseReference !== "boolean" ||
        typeof row.directOrderReferenceMatch !== "boolean" ||
        (row.directOrderReferenceMatch && !row.hasExternalPurchaseReference) ||
        !safeCount(row.count) || row.count === 0) fail();
    const tuple = [row.productCode, row.status, row.source, row.accessLevel,
      row.hasExternalPurchaseReference, row.directOrderReferenceMatch, row.count] as const;
    const key = JSON.stringify(tuple.slice(0, 6));
    if (groupKeys.has(key)) fail();
    groupKeys.add(key);
    aggregateCount += row.count;
    if (!Number.isSafeInteger(aggregateCount)) fail();
    if (row.directOrderReferenceMatch) {
      explicitReferenceCount += row.count;
      if (row.status === "active") activeExplicitReferenceCount += row.count;
    }
    if (row.status === "active") {
      if (row.productCode === "BROS_SELL_CORE") activeCoreCount += row.count;
      if (row.productCode === "BROS_SELL_WEB_OS") activeWebOsCount += row.count;
      if (row.source === "manual") activeManualCount += row.count;
    }
    stableRows.push(tuple);
  }
  if (aggregateCount !== inventory.totalEntitlements) fail();
  stableRows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const candidateStatus = explicitReferenceCount === 0
    ? "NO_EXPLICIT_ORDER_REFERENCE_IN_OBSERVED_ENTITLEMENTS" as const
    : "EXPLICIT_ORDER_REFERENCE_CANDIDATE_UNVERIFIED" as const;
  const snapshotKey = "demand:sell-entitlement-coverage:sha256:" + createHash("sha256")
    .update(JSON.stringify(["v1", inventory.projectRef, order.orderIdentityDigest,
      order.orderDisplayNumber, [...products.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      stableRows, inventory.totalEntitlementEvents])).digest("hex");
  return Object.freeze({
    snapshotKey, candidateStatus, orderIdentityDigest: order.orderIdentityDigest,
    product: "bros_sell" as const, totalEntitlementsObserved: inventory.totalEntitlements,
    totalEntitlementEventsObserved: inventory.totalEntitlementEvents,
    explicitReferenceCandidates: explicitReferenceCount,
    activeExplicitReferenceCandidates: activeExplicitReferenceCount,
    activeCoreEntitlementsObserved: activeCoreCount,
    activeWebOsEntitlementsObserved: activeWebOsCount,
    activeManualEntitlementsObserved: activeManualCount,
    // Even a matching order UUID alone does not verify buyer account mapping,
    // product entitlement or customer access; no personal identifiers emitted.
    purchaserAccountMatchVerified: false as const,
    entitlementVerifiedForOrder: false as const,
    appOwnedSupabaseAuthenticationVerified: false as const,
    tenantAuthorizationVerifiedForDemandApp: false as const,
    metaEventToOrderJoinVerified: false as const,
    bankSettlementVerified: false as const,
    verifiedAcquisitionOutcome: null,
    verifiedCpaMinor: null,
    verifiedCacMinor: null,
    verifiedConversionRate: null,
    causalLift: null,
    durableBciLearningVerified: false as const,
    nextEvidenceAction: "VERIFY_PRIVATE_BUYER_ACCOUNT_MAPPING_WITH_SELL_AUTH_OWNER" as const,
  });
}
