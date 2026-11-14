/**
 * Internal, read-only projection for future BROS Business OS integrations.
 *
 * SECURITY BOUNDARY: this pure module does not authenticate callers. Only a
 * trusted server adapter may construct VerifiedReadScope AFTER validating
 * session identity, tenant membership and product-specific authorization.
 * Never expose this function directly via an HTTP handler or accept scope
 * fields supplied by an untrusted request body or query string.
 */
export type BciProduct = "content" | "demand";
export type EvidenceProvider = "meta_ads" | "buffer" | "ga4" | "hitpay" | "manual";
export type EvidenceCompleteness = "complete" | "partial" | "unverified";

export interface VerifiedReadScope {
  readonly identityVerifiedByServer: true;
  readonly tenantMembershipVerifiedByServer: true;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly product: BciProduct;
  readonly scopes: readonly string[];
}

export interface EvidenceRow {
  readonly schemaVersion: 1;
  readonly evidenceId: string;
  readonly tenantId: string;
  readonly product: BciProduct;
  readonly category: string;
  readonly provenance: {
    readonly provider: EvidenceProvider;
    readonly providerObjectId: string | null;
    readonly collectedAt: string;
    readonly observedAt: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly sourceReference: string;
    readonly completeness: EvidenceCompleteness;
  };
  readonly metrics: Readonly<Record<string, number | null>>;
  // Raw evidence may contain business secrets; it must not be projected.
  readonly observedFacts?: readonly string[];
  readonly unknowns?: readonly string[];
  readonly internalPayload?: unknown;
}

export interface PublicEvidenceReceipt {
  readonly evidenceId: string;
  readonly category: string;
  readonly provider: EvidenceProvider;
  readonly collectedAt: string;
  readonly observedAt: string | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly sourceReference: string;
  readonly completeness: EvidenceCompleteness;
  readonly metrics: Readonly<Record<string, number | null>>;
}

export interface ReadOnlyEvidenceSnapshot {
  readonly schemaVersion: 1;
  readonly access: "read_only";
  readonly result: "observed_rows" | "NO_ROWS_NOT_ZERO";
  readonly tenantId: string;
  readonly product: BciProduct;
  readonly receipts: readonly PublicEvidenceReceipt[];
  readonly limitations: readonly string[];
}

const MAX_RECEIPTS = 20;
const KNOWN_METRICS = new Set([
  "spend_myr", "impressions", "clicks", "pixel_purchase_events",
  "paid_orders", "paid_revenue_myr", "content_posts_sent",
  "content_assets_verified", "content_clicks",
]);
const PROVIDERS = new Set<EvidenceProvider>(["meta_ads", "buffer", "ga4", "hitpay", "manual"]);
const COMPLETENESS = new Set<EvidenceCompleteness>(["complete", "partial", "unverified"]);
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
// Never return free-form URLs with query strings, tokens or other secrets.
const SAFE_REFERENCE = /^[A-Za-z0-9_.:/#-]{1,200}$/;

export class EvidenceAccessDenied extends Error {
  constructor() {
    super("Read-only evidence access denied");
    this.name = "EvidenceAccessDenied";
  }
}

function validIso(value: string | null): boolean {
  return value === null ||
    (typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
      Number.isFinite(Date.parse(value)));
}

function validScope(scope: VerifiedReadScope): boolean {
  return scope?.identityVerifiedByServer === true &&
    scope.tenantMembershipVerifiedByServer === true &&
    typeof scope.subjectId === "string" && ID.test(scope.subjectId) &&
    typeof scope.tenantId === "string" && ID.test(scope.tenantId) &&
    (scope.product === "content" || scope.product === "demand") &&
    Array.isArray(scope.scopes) && scope.scopes.includes("evidence:read");
}

function project(row: EvidenceRow): PublicEvidenceReceipt | null {
  const p = row.provenance;
  if (!p || row.schemaVersion !== 1 || !ID.test(row.evidenceId) ||
      typeof row.category !== "string" || !ID.test(row.category) ||
      !PROVIDERS.has(p.provider) || !COMPLETENESS.has(p.completeness) ||
      !validIso(p.collectedAt) || !p.collectedAt ||
      !validIso(p.observedAt) || !validIso(p.windowStart) || !validIso(p.windowEnd) ||
      !SAFE_REFERENCE.test(p.sourceReference) ||
      (p.windowStart !== null && p.windowEnd !== null &&
        Date.parse(p.windowStart) > Date.parse(p.windowEnd))) return null;

  const metrics: Record<string, number | null> = {};
  if (!row.metrics || typeof row.metrics !== "object" || Array.isArray(row.metrics)) return null;
  for (const [key, value] of Object.entries(row.metrics)) {
    if (!KNOWN_METRICS.has(key)) continue;
    // Reject malformed receipts, rather than converting invalid data into zero.
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return null;
    metrics[key] = value;
  }
  return {
    evidenceId: row.evidenceId,
    category: row.category,
    provider: p.provider,
    collectedAt: p.collectedAt,
    observedAt: p.observedAt,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    sourceReference: p.sourceReference,
    completeness: p.completeness,
    metrics,
  };
}

/**
 * A safe projection only, NOT an authorization service or provider connector.
 * The caller must obtain rows from an independently tenant-authorized read.
 * Deny absent/invalid trusted scope; never return other tenant/product rows.
 */
export function projectReadOnlyEvidence(
  scope: VerifiedReadScope,
  rows: readonly EvidenceRow[],
): ReadOnlyEvidenceSnapshot {
  if (!validScope(scope) || !Array.isArray(rows)) throw new EvidenceAccessDenied();
  const receipts: PublicEvidenceReceipt[] = [];
  for (const row of rows) {
    if (receipts.length >= MAX_RECEIPTS) break;
    if (!row || row.tenantId !== scope.tenantId || row.product !== scope.product) continue;
    const receipt = project(row);
    if (receipt) receipts.push(receipt);
  }
  return {
    schemaVersion: 1,
    access: "read_only",
    result: receipts.length ? "observed_rows" : "NO_ROWS_NOT_ZERO",
    tenantId: scope.tenantId,
    product: scope.product,
    receipts,
    limitations: [
      "Provider freshness, source authentication and payment reconciliation must be validated independently.",
      "No rows or missing metrics do not establish a numeric zero.",
      "Purchase tracking events do not prove settled or ad-attributed orders.",
      "This response is not permission to publish, change ads, or spend money.",
    ],
  };
}
