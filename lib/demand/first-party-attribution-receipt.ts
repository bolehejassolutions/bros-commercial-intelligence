import { createHash } from "node:crypto";

/**
 * DEMAND-only preflight for a future consented first-party click -> checkout ->
 * merchant-order receipt chain. All inputs are caller-supplied candidates.
 * No website capture, HitPay/Meta authentication, BCI persistence, or proof of
 * paid acquisition is performed here. Shared BCI owns trusted evidence writes.
 *
 * A production adapter must create opaque HMAC digests server-side with a
 * secret unavailable to browsers, and independently attest source/tenant,
 * consent, payment status, product, settlement and entitlement. Never send
 * raw click IDs, order IDs, payer identifiers or secrets into this function.
 */
export type DemandReceiptScope = Readonly<{
  tenantId: string;
  product: "demand";
  pilotProduct: "bros_sell";
  campaign: string;
  source: "facebook" | "instagram" | "tiktok" | "whatsapp";
  medium: "paid_social" | "organic_social";
}>;
export type DemandLandingReceipt = Readonly<{
  receiptId: string;
  occurredAt: string;
  correlationDigest: string;
  consent: "granted" | "denied" | "unknown";
  campaign: string;
  source: DemandReceiptScope["source"];
  medium: DemandReceiptScope["medium"];
}>;
export type DemandCheckoutReceipt = Readonly<{
  receiptId: string;
  occurredAt: string;
  correlationDigest: string;
  merchantOrderDigest: string;
}>;
export type DemandMerchantOrderReceipt = Readonly<{
  receiptId: string;
  occurredAt: string;
  merchantOrderDigest: string;
}>;
export type DemandAttributionReceiptCoverage = Readonly<{
  status: "NO_LANDING_RECEIPT" | "CONSENT_NOT_ATTESTED" |
    "NO_CHECKOUT_RECEIPT" | "NO_MERCHANT_ORDER_RECEIPT" |
    "REJECTED_CORRELATION" | "CORRELATED_UNATTESTED";
  candidateKey: string | null;
  nextEvidenceAction: string;
  receiptCount: number;
  consentVerifiedByTrustedServer: false;
  appProviderAuthenticationVerified: false;
  tenantAuthorizationVerified: false;
  metaEventToOrderJoinVerified: false;
  hitpayPaymentVerified: false;
  bankSettlementVerified: false;
  entitlementVerified: false;
  authorizedExperimentActionVerified: false;
  outcomeVerified: false;
  durableBciLearningVerified: false;
  verifiedPaidOrders: null;
  verifiedCpaMinor: null;
  verifiedCacMinor: null;
  verifiedConversionRate: null;
  causalLift: null;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^[a-z][a-z0-9_-]{7,95}$/;
const CAMPAIGN = /^[a-z][a-z0-9_]{2,63}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const invalid = (): never => { throw new Error("Invalid BROS DEMAND first-party attribution receipt"); };
const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const validUtc = (value: unknown): value is string => {
  if (typeof value !== "string" || !UTC.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
};
// Preserve v1 candidate IDs for canonical second-precision timestamps while
// treating equivalent UTC fractional spellings as the same event instant.
// Untrusted receipts remain unverified regardless of candidate identity.
const canonicalUtcForCandidate = (value: string): string =>
  new Date(value).toISOString().replace(/\.000Z$/, "Z");
const LANDING_KEYS = ["receiptId", "occurredAt", "correlationDigest", "consent", "campaign", "source", "medium"];
const CHECKOUT_KEYS = ["receiptId", "occurredAt", "correlationDigest", "merchantOrderDigest"];
const ORDER_KEYS = ["receiptId", "occurredAt", "merchantOrderDigest"];
const SCOPE_KEYS = ["tenantId", "product", "pilotProduct", "campaign", "source", "medium"];

export function assessDemandFirstPartyAttributionReceipt(
  scope: DemandReceiptScope,
  landing: DemandLandingReceipt | null,
  checkout: DemandCheckoutReceipt | null,
  merchantOrder: DemandMerchantOrderReceipt | null,
): DemandAttributionReceiptCoverage {
  if (!hasExactKeys(scope, SCOPE_KEYS) || typeof scope.tenantId !== "string" ||
      !UUID.test(scope.tenantId) || scope.product !== "demand" ||
      scope.pilotProduct !== "bros_sell" ||
      typeof scope.campaign !== "string" || !CAMPAIGN.test(scope.campaign) ||
      !["facebook", "instagram", "tiktok", "whatsapp"].includes(scope.source) ||
      !["paid_social", "organic_social"].includes(scope.medium)) invalid();
  if (landing !== null && (!hasExactKeys(landing, LANDING_KEYS) ||
      typeof landing.receiptId !== "string" || !RECEIPT_ID.test(landing.receiptId) ||
      !validUtc(landing.occurredAt) || typeof landing.correlationDigest !== "string" ||
      !DIGEST.test(landing.correlationDigest) ||
      !["granted", "denied", "unknown"].includes(landing.consent) ||
      landing.campaign !== scope.campaign || landing.source !== scope.source ||
      landing.medium !== scope.medium)) invalid();
  if (checkout !== null && (!hasExactKeys(checkout, CHECKOUT_KEYS) ||
      typeof checkout.receiptId !== "string" || !RECEIPT_ID.test(checkout.receiptId) ||
      !validUtc(checkout.occurredAt) ||
      typeof checkout.correlationDigest !== "string" || !DIGEST.test(checkout.correlationDigest) ||
      typeof checkout.merchantOrderDigest !== "string" || !DIGEST.test(checkout.merchantOrderDigest))) invalid();
  if (merchantOrder !== null && (!hasExactKeys(merchantOrder, ORDER_KEYS) ||
      typeof merchantOrder.receiptId !== "string" || !RECEIPT_ID.test(merchantOrder.receiptId) ||
      !validUtc(merchantOrder.occurredAt) ||
      typeof merchantOrder.merchantOrderDigest !== "string" || !DIGEST.test(merchantOrder.merchantOrderDigest))) invalid();
  const receipts = [landing, checkout, merchantOrder].filter(r => r !== null);
  if (new Set(receipts.map(r => r.receiptId)).size !== receipts.length) invalid();
  const status = !landing ? "NO_LANDING_RECEIPT" :
    landing.consent !== "granted" ? "CONSENT_NOT_ATTESTED" :
    !checkout ? "NO_CHECKOUT_RECEIPT" :
    !merchantOrder ? "NO_MERCHANT_ORDER_RECEIPT" :
    landing.correlationDigest !== checkout.correlationDigest ||
    checkout.merchantOrderDigest !== merchantOrder.merchantOrderDigest ||
    Date.parse(landing.occurredAt) > Date.parse(checkout.occurredAt) ||
    Date.parse(checkout.occurredAt) > Date.parse(merchantOrder.occurredAt) ||
    Date.parse(merchantOrder.occurredAt) - Date.parse(landing.occurredAt) > 30 * 86400000
      ? "REJECTED_CORRELATION" : "CORRELATED_UNATTESTED";
  const nextEvidenceAction = ({
    NO_LANDING_RECEIPT: "OBTAIN_CONSENTED_LANDING_SERVER_RECEIPT",
    CONSENT_NOT_ATTESTED: "VERIFY_CONSENT_AT_TRUSTED_SERVER",
    NO_CHECKOUT_RECEIPT: "OBTAIN_CHECKOUT_CORRELATION_RECEIPT",
    NO_MERCHANT_ORDER_RECEIPT: "OBTAIN_MERCHANT_ORDER_CORRELATION_RECEIPT",
    REJECTED_CORRELATION: "INVESTIGATE_RECEIPT_IDENTITY_OR_CHRONOLOGY",
    CORRELATED_UNATTESTED: "ATTEST_TENANT_CONSENT_META_HITPAY_AND_PAYMENT_IN_BCI",
  } as const)[status];
  // Candidate identity is content-bound and stable across repeat evaluations.
  // It is not an authenticated evidence ID. Never expose raw digest inputs.
  const candidateKey = status === "CORRELATED_UNATTESTED" && landing && checkout && merchantOrder
    ? "demand:first-party-receipt-candidate:sha256:" + createHash("sha256")
      .update(JSON.stringify(["v1", scope.tenantId.toLowerCase(), scope.product,
        scope.pilotProduct, scope.campaign, scope.source, scope.medium,
        landing.receiptId, canonicalUtcForCandidate(landing.occurredAt), landing.correlationDigest,
        checkout.receiptId, canonicalUtcForCandidate(checkout.occurredAt), checkout.merchantOrderDigest,
        merchantOrder.receiptId, canonicalUtcForCandidate(merchantOrder.occurredAt)]))
      .digest("hex") : null;
  return Object.freeze({
    status, candidateKey, nextEvidenceAction, receiptCount: receipts.length,
    consentVerifiedByTrustedServer: false as const,
    appProviderAuthenticationVerified: false as const,
    tenantAuthorizationVerified: false as const,
    metaEventToOrderJoinVerified: false as const,
    hitpayPaymentVerified: false as const,
    bankSettlementVerified: false as const,
    entitlementVerified: false as const,
    authorizedExperimentActionVerified: false as const,
    outcomeVerified: false as const,
    durableBciLearningVerified: false as const,
    verifiedPaidOrders: null, verifiedCpaMinor: null, verifiedCacMinor: null,
    verifiedConversionRate: null, causalLift: null,
  });
}
