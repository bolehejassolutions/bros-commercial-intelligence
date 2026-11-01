/** DEMAND product review of ONE already-persisted BCI DEV Meta receipt.
 * Never fetch Meta, write a row, authorize an ad, or treat purchase signals as paid orders.
 * Reuses the existing restricted evidence writer LOGIN only for a READ ONLY transaction;
 * this route adds no role, grant, database or service. BCI owns shared persistence.
 */
import { assertRestrictedEvidenceWriterPolicies } from "../bci/neon-evidence-writer-policy-fingerprint.ts";

type Value = string | number | boolean | null;
type Result = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly Value[]) => Promise<Result>;
export type ReadTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Grant = Readonly<{ principalId: string; tenantId: string; product: "demand"; active: true }>;
type Receipt = Readonly<{
  id: string; tenantId: string; product: "demand"; provider: "meta_ads";
  completeness: "unverified"; collectedAt: string; periodStart: string; periodEnd: string;
  providerRecordKey: string; metrics: Readonly<Record<string, unknown>>;
  unknowns: readonly string[];
  linkedCase?: null | Readonly<{ caseId: string; evidenceId: string; tenantId: string; product: "demand"; status: "REVIEW" }>;
}>;
type Deps = Readonly<{
  enabled: () => boolean;
  tenantId: string;
  verifyJwt: (token: string) => Promise<Principal | null>;
  membershipsFor: (principalId: string, product: "demand") => Promise<readonly Grant[]>;
  readReceipt: (tenantId: string, principalId: string) => Promise<Receipt | null>;
}>;
export const DEMAND_PILOT_RECEIPT_ID = "4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
  Vary: "Authorization", "X-Content-Type-Options": "nosniff" };
const respond = (body: unknown, status: number, extra?: Record<string,string>) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });
const deny = (status: number) => respond({ error: "BROS DEMAND private evidence review denied." }, status);
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const reject = (): never => { throw Error("DEMAND_EVIDENCE_REVIEW_DENIED"); };
const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number") return reject();
  if (!Number.isSafeInteger(v) || v < 0) return reject();
  return v;
};
const timestamp = (v: unknown): string => {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  if (d === null) return reject();
  if (!Number.isFinite(d.getTime())) return reject();
  return d.toISOString();
};

/** Explicit, bounded product-level diagnosis. Observation != verified sale. */
export function reviewPersistedDemandMetaReceipt(row: Receipt) {
  if (!object(row) || row.id !== DEMAND_PILOT_RECEIPT_ID || !uuid.test(row.tenantId) ||
      row.product !== "demand" || row.provider !== "meta_ads" ||
      row.completeness !== "unverified" ||
      typeof row.providerRecordKey !== "string" ||
      !/^demand:meta-read:sha256:[0-9a-f]{64}$/.test(row.providerRecordKey) ||
      !object(row.metrics) || !Array.isArray(row.unknowns) ||
      !row.unknowns.every(x => typeof x === "string" && x.length <= 120)) reject();
  const periodStart = timestamp(row.periodStart);
  const periodEnd = timestamp(row.periodEnd);
  const collectedAt = timestamp(row.collectedAt);
  if (periodStart >= periodEnd || collectedAt < periodEnd) reject();
  const spendMinor = numberOrNull(row.metrics.spend_minor);
  const inlineLinkClicks = numberOrNull(row.metrics.inline_link_clicks);
  const landingPageViews = numberOrNull(row.metrics.landing_page_views);
  const metaAttributedPurchases = numberOrNull(row.metrics.meta_attributed_purchases);
  const pixelPurchaseEvents = numberOrNull(row.metrics.pixel_purchase_events);
  const linkedCase = row.linkedCase ?? null;
  if (linkedCase !== null && (!object(linkedCase) || !uuid.test(linkedCase.caseId) ||
      linkedCase.evidenceId !== row.id || linkedCase.tenantId !== row.tenantId ||
      linkedCase.product !== "demand" || linkedCase.status !== "REVIEW")) reject();
  return Object.freeze({
    status: "REVIEWABLE_NOT_APPROVED" as const,
    source: "NEON_DEV_BCI_PERSISTED_META_EVIDENCE" as const,
    recordId: row.id, completeness: "unverified" as const,
    caseLink: linkedCase === null ? null : Object.freeze({
      caseId: linkedCase.caseId, evidenceId: row.id, status: "REVIEW" as const,
      actionAuthorized: false as const, outcomeVerified: false as const,
    }),
    periodStart, periodEnd, collectedAt,
    observed: { spendMinor, inlineLinkClicks, landingPageViews,
      metaAttributedPurchases, pixelPurchaseEvents },
    diagnosis: "Meta purchase and Pixel signals are platform observations, not independently joined or settled HitPay orders.",
    hypothesis: "First-party acquisition-to-order linkage may be incomplete; a verified checkout/order join is needed before attributing sales.",
    proposedAction: "Read-only audit of storefront UTM persistence and HitPay paid-charge/order identifiers; test stable joins in nonproduction, without changing live ads.",
    primaryKpi: "Independently verified first-party acquisition-to-paid-order joins (currently unknown).",
    guardrails: "No Meta writes or spend, no production checkout change, no amount/date-based joins, no CPA/CAC/ROAS or causal-lift claim without verified evidence.",
    actionAuthorized: false as const, actionExecuted: false as const,
    outcomeVerified: false as const, learningRecorded: false as const,
    independentlyAttestedProvider: false as const,
    firstPartyAttribution: "unknown" as const,
    verifiedPaidOrders: null, verifiedCpaMinor: null, causalLift: null,
  });
}

/** Uses existing BCI restricted writer SELECT privilege under READ ONLY.
 * The JWT + active membership are checked before and after this transaction.
 * PostgreSQL role, policy fingerprint, RLS and membership are rechecked inside.
 * No user-supplied tenant, receipt ID or provider payload is accepted.
 */
export function createDemandMetaReceiptReader(transaction: ReadTransaction) {
  if (typeof transaction !== "function") reject();
  return async (tenantId: string, principalId: string): Promise<Receipt | null> => {
    if (!uuid.test(tenantId) || !uuid.test(principalId)) reject();
    return transaction(async query => {
      const role = await query(
        "SELECT current_user AS role_name, session_user AS session_role_name, rolcanlogin AS can_login, rolbypassrls AS bypass_rls, rolsuper AS superuser, rolinherit AS inherits, (SELECT count(*)::integer FROM pg_auth_members WHERE member=pg_roles.oid) AS parent_roles FROM pg_roles WHERE rolname=current_user", []);
      const r = role.rows[0];
      if (role.rows.length !== 1 || !object(r) ||
          r.role_name !== "bci_dev_evidence_writer_restricted" ||
          r.session_role_name !== "bci_dev_evidence_writer_restricted" ||
          r.can_login !== true || r.bypass_rls !== false ||
          r.superuser !== false || r.inherits !== false || r.parent_roles !== 0) reject();
      const posture = await query(
        "SELECT current_database() AS database_name, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='bci_dev.evidence'::regclass) AS forced_rls, has_table_privilege(current_user,'bci_dev.evidence','SELECT') AS can_read, NOT has_table_privilege(current_user,'bci_dev.evidence','UPDATE,DELETE,TRUNCATE') AS no_mutation, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='bci_dev.cases'::regclass) AS cases_rls, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='bci_dev.case_evidence'::regclass) AS links_rls, has_table_privilege(current_user,'bci_dev.cases','SELECT') AS cases_read, has_table_privilege(current_user,'bci_dev.case_evidence','SELECT') AS links_read, NOT has_table_privilege(current_user,'bci_dev.cases','UPDATE,DELETE,TRUNCATE') AS cases_no_mutation, NOT has_table_privilege(current_user,'bci_dev.case_evidence','UPDATE,DELETE,TRUNCATE') AS links_no_mutation", []);
      const p = posture.rows[0];
      if (posture.rows.length !== 1 || !object(p) ||
          p.database_name !== "bros_intelligence_dev" ||
          p.forced_rls !== true || p.can_read !== true || p.no_mutation !== true ||
          p.cases_rls !== true || p.links_rls !== true || p.cases_read !== true ||
          p.links_read !== true || p.cases_no_mutation !== true || p.links_no_mutation !== true) reject();
      await assertRestrictedEvidenceWriterPolicies(query);
      await query("SELECT set_config('bci.tenant_id',$1,true),set_config('bci.product','demand',true),set_config('bci.principal_id',$2,true)", [tenantId, principalId]);
      const membership = async () => {
        const m = await query(
          "SELECT principal_id::text AS principal_id FROM bci_dev.tenant_memberships WHERE principal_id=$1::uuid AND tenant_id=$2::uuid AND product='demand' AND active=true AND revoked_at IS NULL",
          [principalId, tenantId]);
        if (m.rows.length !== 1 || !object(m.rows[0]) ||
            m.rows[0].principal_id !== principalId) reject();
      };
      await membership();
      const result = await query(
        "SELECT id::text AS id, tenant_id::text AS \"tenantId\", product, provider, provider_record_key AS \"providerRecordKey\", completeness, collected_at AS \"collectedAt\", period_start AS \"periodStart\", period_end AS \"periodEnd\", metrics, unknowns FROM bci_dev.evidence WHERE tenant_id=$1::uuid AND product='demand' AND provider='meta_ads' AND id=$2::uuid LIMIT 2",
        [tenantId, DEMAND_PILOT_RECEIPT_ID]);
      if (result.rows.length > 1) reject();
      const row = result.rows[0];
      if (row !== undefined && !object(row)) return reject();
      if (row !== undefined && (row.id !== DEMAND_PILOT_RECEIPT_ID ||
          row.tenantId !== tenantId || row.product !== "demand" || row.provider !== "meta_ads" ||
          row.completeness !== "unverified" || !object(row.metrics) ||
          !Array.isArray(row.unknowns))) return reject();
      if (row === undefined) { await membership(); return null; }
      const linked = await query(
        "SELECT c.id::text AS \"caseId\", ce.evidence_id::text AS \"evidenceId\", c.tenant_id::text AS \"tenantId\", c.product, c.status FROM bci_dev.case_evidence ce JOIN bci_dev.cases c ON c.id=ce.case_id AND c.tenant_id=ce.tenant_id AND c.product=ce.product WHERE ce.evidence_id=$1::uuid AND ce.tenant_id=$2::uuid AND ce.product='demand' LIMIT 2",
        [DEMAND_PILOT_RECEIPT_ID, tenantId]);
      if (linked.rows.length > 1) reject();
      const linkedCase = linked.rows[0] ?? null;
      if (linkedCase !== null && (!object(linkedCase) || !uuid.test(linkedCase.caseId) ||
          linkedCase.evidenceId !== DEMAND_PILOT_RECEIPT_ID || linkedCase.tenantId !== tenantId ||
          linkedCase.product !== "demand" || linkedCase.status !== "REVIEW")) reject();
      await membership();
      if (!object(row)) return reject();
      const normalized = { ...row, linkedCase, collectedAt: timestamp(row.collectedAt),
        periodStart: timestamp(row.periodStart), periodEnd: timestamp(row.periodEnd) } as Receipt;
      reviewPersistedDemandMetaReceipt(normalized);
      return Object.freeze(normalized);
    });
  };
}

export function createDemandMetaPersistedDiagnosisHandler(deps: Deps) {
  if (!deps || typeof deps.enabled !== "function" || typeof deps.verifyJwt !== "function" ||
      typeof deps.membershipsFor !== "function" || typeof deps.readReceipt !== "function") reject();
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return deny(404);
    if (request.method !== "GET") return respond({ error: "Method not allowed." }, 405, { Allow: "GET" });
    let url: URL;
    try { url = new URL(request.url); } catch { return deny(400); }
    if (request.url.length > 2048 || url.pathname !== "/api/internal/demand-meta-diagnosis" ||
        url.search !== "" || request.body !== null ||
        Number(request.headers.get("content-length") || 0) !== 0 ||
        request.headers.has("transfer-encoding") ||
        ["x-tenant-id","x-user-id","x-principal-id","x-bci-tenant-id","x-admin",
         "x-role","x-product","x-meta-token"].some(k => request.headers.has(k))) return deny(400);
    const authorization = request.headers.get("authorization");
    if (!authorization || authorization.length > 16007 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) return deny(401);
    try {
      const principal = await deps.verifyJwt(authorization.slice(7));
      if (!principal) return deny(403);
      if (principal.authenticated !== true || !uuid.test(principal.userId) ||
          !uuid.test(deps.tenantId)) return deny(403);
      const tenantId = deps.tenantId.toLowerCase();
      const membership = async () => {
        const grants = await deps.membershipsFor(principal.userId, "demand");
        if (grants.length !== 1 || grants[0].principalId !== principal.userId ||
            grants[0].tenantId.toLowerCase() !== tenantId ||
            grants[0].product !== "demand" || grants[0].active !== true) reject();
      };
      await membership();
      const row = await deps.readReceipt(tenantId, principal.userId);
      await membership();
      if (!row) return deny(404);
      if (row.tenantId !== tenantId) reject();
      return respond(reviewPersistedDemandMetaReceipt(row), 200);
    } catch {
      return deny(403);
    }
  };
}
