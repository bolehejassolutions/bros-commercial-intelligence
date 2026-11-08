/**
 * BROS Business OS: DEV-only SQL evidence reader CONTRACT. No routes, pools,
 * credentials, migrations or network connections are created here.
 * Supply a SERVER-owned, pinned BEGIN READ ONLY transaction from a direct
 * bci_dev_private_reader LOGIN (not an admin SET ROLE impersonation).
 * Caller must independently verify the principal and authoritative membership.
 * Self-settable Postgres GUCs are defense in depth, NEVER authentication.
 */
import type { BciProduct, EvidenceRow, EvidenceProvider, EvidenceCompleteness } from "./assistant-evidence-bridge.ts";

type SqlValue = string | number | boolean | null;
type SqlResult = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly SqlValue[]) => Promise<SqlResult>;
export type BusinessOsReadTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
export type BusinessOsReadSelection = Readonly<{ tenantId: string; product: BciProduct; maxRows: 20 }>;

export class BusinessOsDevSqlDenied extends Error {
  constructor() { super("BROS Business OS DEV evidence read denied"); this.name = "BusinessOsDevSqlDenied"; }
}
const deny = (): never => { throw new BusinessOsDevSqlDenied(); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const PROVIDERS = new Set<EvidenceProvider>(["meta_ads", "buffer", "ga4", "manual"]);
const COMPLETENESS = new Set<EvidenceCompleteness>(["complete", "partial", "unverified"]);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validTime = (value: unknown, optional = false): value is string | null =>
  (optional && value === null) || (typeof value === "string" &&
    ISO.test(value) && Number.isFinite(Date.parse(value)));

const ROLE_SQL = [
  "SELECT current_user AS role_name, session_user AS session_role_name,",
  "rolbypassrls AS bypass_rls, rolsuper AS is_superuser, rolcanlogin AS can_login,",
  "rolcreatedb AS can_create_database, rolcreaterole AS can_manage_roles,",
  "rolreplication AS can_replicate, rolinherit AS inherits_roles,",
  "(SELECT COUNT(*)::integer FROM pg_auth_members m WHERE m.member = pg_roles.oid) AS parent_role_count",
  "FROM pg_roles WHERE rolname = current_user",
].join(" ");

const POSTURE_SQL = [
  "SELECT current_database() AS database_name,",
  "c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,",
  "has_table_privilege(current_user, 'bci_dev.evidence', 'SELECT') AS can_read_evidence,",
  "has_table_privilege(current_user, 'bci_dev.evidence', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN') AS can_write_evidence,",
  "has_table_privilege(current_user, 'bci_dev.tenant_memberships', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN') AS can_access_memberships,",
  "has_schema_privilege(current_user, 'bci_dev', 'CREATE') AS can_create_schema_objects,",
  "has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,",
  "(SELECT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",
  "WHERE p.prosecdef AND has_function_privilege(current_user, p.oid, 'EXECUTE')",
  "AND n.nspname NOT IN ('pg_catalog','information_schema')",
  "AND LEFT(n.nspname,3)<>'pg_')) AS no_definer_exec,",
  "(SELECT NOT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace",
  "WHERE n.nspname <> 'bci_dev' AND n.nspname <> 'information_schema'",
  "AND LEFT(n.nspname,3)<>'pg_' AND t.relkind IN ('r','p','v','m','f')",
  "AND has_table_privilege(current_user, t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'))",
  ") AS no_external_table_access",
  "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
  "WHERE n.nspname='bci_dev' AND c.relname='evidence' AND c.relkind IN ('r','p')",
].join(" ");

// A fixed schema/table/column allowlist: only scope values and LIMIT are bound.
// Source reference, provider record keys, facts, unknowns and raw payloads
// remain INSIDE the database. They are never selected or echoed into ChatGPT.
const EVIDENCE_SQL = [
  'SELECT id::text AS "evidenceId", tenant_id::text AS "tenantId", product, provider,',
  'to_char(collected_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "collectedAt",',
  'to_char(observed_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "observedAt",',
  'to_char(period_start AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "windowStart",',
  'to_char(period_end AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "windowEnd",',
  'completeness, metrics FROM bci_dev.evidence',
  'WHERE tenant_id = $1::uuid AND product = $2::text',
  'ORDER BY observed_at DESC, id DESC LIMIT $3::integer',
].join(" ");

function validateRow(value: unknown, scope: BusinessOsReadSelection): EvidenceRow {
  if (!object(value) || value.tenantId !== scope.tenantId ||
      value.product !== scope.product || typeof value.evidenceId !== "string" ||
      !UUID.test(value.evidenceId) || !PROVIDERS.has(value.provider as EvidenceProvider) ||
      !COMPLETENESS.has(value.completeness as EvidenceCompleteness) ||
      !validTime(value.collectedAt) || !validTime(value.observedAt) ||
      !validTime(value.windowStart, true) || !validTime(value.windowEnd, true) ||
      (value.windowStart !== null && value.windowEnd !== null &&
        Date.parse(value.windowStart as string) > Date.parse(value.windowEnd as string)) ||
      !object(value.metrics)) return deny();
  const entries = Object.entries(value.metrics);
  if (entries.length > 100) deny();
  const metrics: Record<string, number | null> = {};
  for (const [key, val] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
        (val !== null && (typeof val !== "number" || !Number.isFinite(val) || val < 0))) deny();
    metrics[key] = val as number | null;
  }
  // A ledger row is not a provider receipt. The reference points to the
  // INTERNAL ledger UUID; no provider ID/URL or source_reference is disclosed.
  return {
    schemaVersion: 1, evidenceId: value.evidenceId as string,
    tenantId: scope.tenantId, product: scope.product, category: "evidence",
    provenance: {
      provider: value.provider as EvidenceProvider, providerObjectId: null,
      collectedAt: value.collectedAt as string, observedAt: value.observedAt as string,
      windowStart: value.windowStart as string | null, windowEnd: value.windowEnd as string | null,
      sourceReference: "bci:dev:evidence/" + (value.evidenceId as string),
      completeness: value.completeness as EvidenceCompleteness,
    },
    metrics,
  };
}

/**
 * Never pass a request-supplied tenant or token here. A verified server grant
 * must select scope first. Requires a real pinned READ ONLY transaction for
 * runtime use; passing a mock only proves deterministic contract behavior.
 */
export function createBusinessOsDevScopedEvidenceReader(transaction: BusinessOsReadTransaction) {
  if (typeof transaction !== "function") deny();
  return async (scope: BusinessOsReadSelection): Promise<readonly EvidenceRow[]> => {
    if (!scope || typeof scope.tenantId !== "string" || !UUID.test(scope.tenantId) ||
        (scope.product !== "content" && scope.product !== "demand") ||
        scope.maxRows !== 20) deny();
    try {
      return await transaction(async query => {
      const identity = await query(ROLE_SQL, []);
      if (!Array.isArray(identity?.rows) || identity.rows.length !== 1 ||
          !object(identity.rows[0])) deny();
      const role: Record<string, unknown> = identity.rows[0] as Record<string, unknown>;
      if (role.role_name !== "bci_dev_private_reader" ||
          role.session_role_name !== "bci_dev_private_reader" ||
          role.bypass_rls !== false || role.is_superuser !== false ||
          role.can_login !== true || role.can_create_database !== false ||
          role.can_manage_roles !== false || role.can_replicate !== false ||
          role.inherits_roles !== false || role.parent_role_count !== 0) deny();

      const posture = await query(POSTURE_SQL, []);
      if (!Array.isArray(posture?.rows) || posture.rows.length !== 1 ||
          !object(posture.rows[0])) deny();
      const p: Record<string, unknown> = posture.rows[0] as Record<string, unknown>;
      if (p.database_name !== "bros_intelligence_dev" ||
          p.rls_enabled !== true || p.rls_forced !== true ||
          p.can_read_evidence !== true || p.can_write_evidence !== false ||
          p.can_access_memberships !== false ||
          p.can_create_schema_objects !== false || p.can_create_database_objects !== false ||
          p.no_definer_exec !== true || p.no_external_table_access !== true) deny();

      // Scope is LOCAL to the pinned transaction, never a claim of identity.
      const set = await query(
        "SELECT set_config('bci.tenant_id', $1::text, true) AS tenant_scope, set_config('bci.product', $2::text, true) AS product_scope",
        [scope.tenantId, scope.product]
      );
      if (!Array.isArray(set?.rows) || set.rows.length !== 1 ||
          !object(set.rows[0]) || set.rows[0].tenant_scope !== scope.tenantId ||
          set.rows[0].product_scope !== scope.product) deny();
      const result = await query(EVIDENCE_SQL, [scope.tenantId, scope.product, 20]);
      if (!Array.isArray(result?.rows) || result.rows.length > 20) deny();
      const seen = new Set<string>();
      return result.rows.map(value => {
        const row = validateRow(value, scope);
        if (seen.has(row.evidenceId)) deny();
        seen.add(row.evidenceId);
        return row;
      });
      });
    } catch {
      // Do not expose a driver exception, connection secret, or SQL detail.
      throw new BusinessOsDevSqlDenied();
    }
  };
}
