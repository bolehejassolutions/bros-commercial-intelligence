/**
 * Parameterized, transactional SQL adapter for BCI's internal Neon DEV evidence.
 *
 * Not a public API. The caller MUST supply a server-only transaction executor
 * authenticated as SQL-created bci_dev_private_reader (not admin/BROS).
 * A caller-supplied tenant ID is not acceptable: compose ONLY after a
 * verified principal + authoritative tenant-membership check.
 */
import {
  PrivateEvidenceAccessDenied,
  type BciProduct,
  type EvidenceRow,
} from "./private-evidence-boundary";

type SqlValue = string | number | boolean | null;
type SqlResult = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly SqlValue[]) => Promise<SqlResult>;
export type ScopedTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;

type Scope = Readonly<{ tenantId: string; product: BciProduct; limit: number }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw new PrivateEvidenceAccessDenied(); };
const isObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/** Requires a single pinned physical Postgres transaction; no HTTP one-shot driver. */
export function createNeonDevReadRows(transaction: ScopedTransaction) {
  if (typeof transaction !== "function") deny();
  return async (scope: Scope): Promise<readonly EvidenceRow[]> => {
    if (!scope || !UUID.test(scope.tenantId) ||
        (scope.product !== "content" && scope.product !== "demand") ||
        !Number.isInteger(scope.limit) || scope.limit < 1 || scope.limit > 50) deny();

    return transaction(async (query) => {
      const role = await query(
        "SELECT current_user AS role_name, rolbypassrls AS bypass_rls FROM pg_roles WHERE rolname = current_user",
        []
      );
      if (role.rows.length !== 1 || !isObject(role.rows[0]) ||
          role.rows[0].role_name !== "bci_dev_private_reader" ||
          role.rows[0].bypass_rls !== false) deny();

      // Scope is derived upstream from trusted membership, not request data.
      // set_config(...,true) is transactional; never share the session with a
      // second request or run this on an unpinned connection/pooled HTTP call.
      await query("SELECT set_config('bci.tenant_id', $1::text, true) AS scope", [scope.tenantId]);
      const response = await query(
        `SELECT id::text AS "id", tenant_id::text AS "tenantId", product, provider,
                provider_record_key AS "providerRecordKey", metrics
         FROM bci_dev.evidence
         WHERE tenant_id = $1::uuid AND product = $2::text
         ORDER BY observed_at DESC, id DESC LIMIT $3::integer`,
        [scope.tenantId, scope.product, scope.limit]
      );
      if (response.rows.length > scope.limit) deny();
      return response.rows.map((value) => {
        if (!isObject(value) || value.tenantId !== scope.tenantId ||
            value.product !== scope.product || typeof value.id !== "string" ||
            !UUID.test(value.id) || typeof value.provider !== "string" ||
            typeof value.providerRecordKey !== "string" || !isObject(value.metrics)) deny();
        const metrics: Record<string, number | null> = {};
        for (const [key, raw] of Object.entries(value.metrics)) {
          if (raw !== null && (typeof raw !== "number" || !Number.isFinite(raw))) deny();
          metrics[key] = raw;
        }
        return {
          id: value.id,
          tenantId: value.tenantId,
          product: scope.product,
          provider: value.provider,
          providerRecordKey: value.providerRecordKey,
          metrics,
        };
      });
    });
  };
}
