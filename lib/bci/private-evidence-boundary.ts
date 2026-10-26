/**
 * Pure, offline-testable policy gate for a future PRIVATE BCI data adapter.
 * This is NOT a database connection or an authenticated API endpoint.
 * Caller-provided tenant IDs, session GUCs and admin database roles are forbidden.
 * The host server MUST verify the principal and membership from trusted sources.
 */

export type BciProduct = "content" | "demand";
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Membership = Readonly<{
  principalId: string;
  tenantId: string;
  product: BciProduct;
  active: true;
}>;
export type EvidenceRow = Readonly<{
  id: string;
  tenantId: string;
  product: BciProduct;
  provider: string;
  providerRecordKey: string;
  metrics: Readonly<Record<string, number | null>>;
}>;
export type EvidenceReadRequest = Readonly<{ product: BciProduct; limit?: number }>;

export type PrivateEvidenceDependencies = Readonly<{
  /**
   * MUST verify a server-side session cryptographically / via provider API.
   * Never trust a userId from an HTTP header, query parameter or JWT without verification.
   */
  authenticate: () => Promise<Principal | null>;
  /**
   * MUST query an authoritative, server-controlled membership store.
   * Never use membership data or tenantId claimed by the request.
   */
  membershipsFor: (verifiedUserId: string, product: BciProduct) => Promise<readonly Membership[]>;
  /**
   * MUST use parameterized SQL and a least-privileged database login.
   * The tenantId argument is server-derived, but app database identity and
   * DB-side policies must be independently verified before any deployment.
   */
  readRows: (scope: Readonly<{ tenantId: string; product: BciProduct; limit: number }>) => Promise<readonly EvidenceRow[]>;
}>;

export class PrivateEvidenceAccessDenied extends Error {
  constructor(message = "BCI private evidence access denied.") {
    super(message);
    this.name = "PrivateEvidenceAccessDenied";
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied = (): never => { throw new PrivateEvidenceAccessDenied(); };
const validUuid = (value: unknown) => typeof value === "string" && UUID.test(value);
const validProduct = (value: unknown): value is BciProduct => value === "content" || value === "demand";
const evidenceFields = new Set(["id", "tenantId", "product", "provider", "providerRecordKey", "metrics"]);
const metricKey = /^[a-z][a-z0-9_]{0,63}$/;
const validMetrics = (data: unknown): data is Record<string, number | null> =>
  data !== null && typeof data === "object" && !Array.isArray(data) &&
  Object.keys(data).length <= 100 &&
  Object.entries(data).every(([key, value]) =>
    metricKey.test(key) && value !== undefined &&
    (value === null || (typeof value === "number" && Number.isFinite(value))));

/**
 * Create a policy gate using ONLY server-injected dependencies.
 * No HTTP routes, secrets, Neon connection strings or public permissions.
 * A given verified principal must have exactly ONE active tenant membership
 * for the requested product; ambiguous membership fails rather than guessing.
 */
export function createPrivateEvidenceReader(deps: PrivateEvidenceDependencies) {
  if (!deps || typeof deps.authenticate !== "function" ||
      typeof deps.membershipsFor !== "function" || typeof deps.readRows !== "function") denied();

  return async (request: EvidenceReadRequest): Promise<readonly EvidenceRow[]> => {
    if (!request || typeof request !== "object" || Array.isArray(request)) denied();
    // Prevent an API adapter from accidentally accepting a client-declared
    // tenant/user or future unreviewed parameters.
    if (Object.keys(request).some(k => k !== "product" && k !== "limit")) denied();
    if (!validProduct(request.product)) denied();
    const limit = request.limit === undefined ? 25 : request.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) denied();

    const principal = await deps.authenticate();
    if (!principal) throw new PrivateEvidenceAccessDenied();
    if (principal.authenticated !== true || !validUuid(principal.userId)) denied();

    const grants = await deps.membershipsFor(principal.userId, request.product);
    if (!Array.isArray(grants) || grants.length !== 1) denied();
    const grant = grants[0];
    if (!grant || grant.active !== true || !validUuid(grant.tenantId) ||
        grant.principalId !== principal.userId || grant.product !== request.product) denied();

    // Scope must be derived exclusively from verified membership, never request.
    const rows = await deps.readRows({ tenantId: grant.tenantId, product: request.product, limit });
    if (!Array.isArray(rows) || rows.length > limit) denied();
    // The database schema enforces both keys. Recheck at the API boundary so a
    // buggy/mock adapter cannot replay one record as multiple independent facts.
    const seenIds = new Set<string>();
    const seenProviderKeys = new Set<string>();
    for (const row of rows) {
      // Fail the entire response rather than silently filtering DB cross-tenant leakage.
      // An adapter may accidentally return sensitive or unreviewed fields.
      // Reject the entire response instead of serializing extra DB columns.
      if (!row || Object.keys(row).length !== evidenceFields.size ||
          Object.keys(row).some(key => !evidenceFields.has(key)) ||
          !validUuid(row.id) || row.tenantId !== grant.tenantId ||
          row.product !== request.product || typeof row.provider !== "string" ||
          !row.provider || typeof row.providerRecordKey !== "string" ||
          !row.providerRecordKey || !validMetrics(row.metrics)) denied();
      const providerKey = JSON.stringify([row.provider, row.providerRecordKey]);
      if (seenIds.has(row.id) || seenProviderKeys.has(providerKey)) denied();
      seenIds.add(row.id);
      seenProviderKeys.add(providerKey);
    }
    return rows.map(row => Object.freeze({
      id: row.id, tenantId: row.tenantId, product: row.product,
      provider: row.provider, providerRecordKey: row.providerRecordKey,
      metrics: Object.freeze({ ...row.metrics }),
    }));
  };
}
