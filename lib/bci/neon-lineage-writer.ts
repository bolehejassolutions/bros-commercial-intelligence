/**
 * Private BCI shared-core lineage writer. NOT an HTTP endpoint.
 * A verified server principal + current authoritative membership determine scope.
 * Never expose the transaction dependency or database credentials to clients.
 * This module does not attest provider events or prove business outcomes.
 */
import { planUntrustedBciAuditAppend } from "./audit-append-plan.ts";
import type { BciLineageRecord, BciLineageProduct } from "./internal-lineage.ts";

type Value = string | number | boolean | readonly string[] | null;
type Result = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly Value[]) => Promise<Result>;
export type LineageTransaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Membership = Readonly<{ principalId: string; tenantId: string; product: BciLineageProduct; active: true }>;
type Dependencies = Readonly<{
  authenticate: () => Promise<Principal | null>;
  membershipsFor: (principalId: string, product: BciLineageProduct) => Promise<readonly Membership[]>;
  transaction: LineageTransaction;
}>;
type Request = Readonly<{ product: BciLineageProduct; records: readonly BciLineageRecord[] }>;
type Client = Readonly<{
  query: (sql: string, params?: Value[]) => Promise<Result>;
  release: (destroy?: boolean) => void;
}>;
type Pool = Readonly<{ connect: () => Promise<Client> }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw new BciLineageWriteDenied(); };
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x: unknown, names: readonly string[]): boolean => {
  if (!obj(x)) return false;
  const keys = Reflect.ownKeys(x);
  return keys.length === names.length && keys.every(k => {
    if (typeof k !== "string" || !names.includes(k)) return false;
    const d = Object.getOwnPropertyDescriptor(x, k);
    return !!d && d.enumerable && Object.prototype.hasOwnProperty.call(d, "value");
  });
};
const scopeOf = (grants: readonly Membership[], userId: string, product: BciLineageProduct): string => {
  if (!Array.isArray(grants) || grants.length !== 1 ||
      !exact(grants[0], ["principalId", "tenantId", "product", "active"])) deny();
  const g = grants[0];
  if (g.principalId !== userId || g.product !== product || g.active !== true ||
      typeof g.tenantId !== "string" || !UUID.test(g.tenantId)) deny();
  return g.tenantId;
};

export class BciLineageWriteDenied extends Error {
  constructor() { super("BCI private lineage write denied."); this.name = "BciLineageWriteDenied"; }
}

/** One physical, directly authenticated restricted LOGIN connection per transaction. */
export function createPgLineageWriteTransaction(pool: Pool): LineageTransaction {
  if (!pool || typeof pool.connect !== "function") deny();
  return async <T>(fn: (query: Query) => Promise<T>): Promise<T> => {
    let client: Client | undefined;
    let active = false;
    let destroy = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
      await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
      active = true;
      const pinned = client;
      const result = await fn((sql, params) => {
        if (!active) deny();
        return pinned.query(sql, [...params]);
      });
      active = false;
      await client.query("COMMIT");
      return result;
    } catch {
      active = false;
      destroy = true;
      if (client) { try { await client.query("ROLLBACK"); } catch { /* Never log SQL or credentials. */ } }
      return deny();
    } finally {
      active = false;
      client?.release(destroy);
    }
  };
}

/**
 * Authenticated application boundary. The request has NO tenant/user/role field.
 * Incoming records may carry tenant IDs only for equality validation against
 * the server-resolved scope; they cannot select the database scope.
 * A final membership recheck narrows, but does not eliminate, revocation races.
 */
export function createAuthenticatedBciLineageWriter(deps: Dependencies) {
  if (!deps || typeof deps.authenticate !== "function" ||
      typeof deps.membershipsFor !== "function" || typeof deps.transaction !== "function") deny();
  return async (request: Request): Promise<Readonly<{ insertedIds: readonly string[]; replayedIds: readonly string[] }>> => {
    try {
      if (!exact(request, ["product", "records"]) ||
          (request.product !== "content" && request.product !== "demand") ||
          !Array.isArray(request.records) || request.records.length < 1 || request.records.length > 100) deny();
      const principal = await deps.authenticate();
      if (!principal || !exact(principal, ["userId", "authenticated"]) ||
          principal.authenticated !== true || !UUID.test(principal.userId)) deny();
      const tenantId = scopeOf(await deps.membershipsFor(principal.userId, request.product),
        principal.userId, request.product);
      const scope = { tenantId, product: request.product };
      return await deps.transaction(async query => {
        const role = await query(
          `SELECT current_user AS "roleName", session_user AS "sessionRoleName",
                  rolcanlogin AS "canLogin", rolbypassrls AS "bypassRls",
                  rolsuper AS "superuser", rolcreaterole AS "canCreateRole",
                  rolcreatedb AS "canCreateDb", rolinherit AS "inherits",
                  (SELECT count(*)::integer FROM pg_auth_members WHERE member = pg_roles.oid) AS "parentRoles"
           FROM pg_roles WHERE rolname = current_user`, []);
        const r = role.rows[0];
        if (role.rows.length !== 1 || !obj(r) ||
            r.roleName !== "bci_dev_lineage_writer" ||
            r.sessionRoleName !== "bci_dev_lineage_writer" ||
            r.canLogin !== true || r.bypassRls !== false || r.superuser !== false ||
            r.canCreateRole !== false || r.canCreateDb !== false ||
            r.inherits !== false || r.parentRoles !== 0) deny();
        const posture = await query(
          `SELECT current_database() AS "databaseName",
                  bool_and(c.relrowsecurity AND c.relforcerowsecurity) AS "forcedRls",
                  bool_and(has_table_privilege(current_user,c.oid,'SELECT') AND
                    has_table_privilege(current_user,c.oid,'INSERT') AND
                    NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) AS "lineageOnly",
                  NOT has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT,INSERT,UPDATE,DELETE') AS "membershipDenied",
                  NOT has_table_privilege(current_user,'bci_dev.evidence','SELECT,INSERT,UPDATE,DELETE') AS "evidenceDenied",
                  NOT has_schema_privilege(current_user,'bci_dev','CREATE') AS "schemaCreateDenied",
                  NOT has_database_privilege(current_user,current_database(),'CREATE') AS "dbCreateDenied"
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='bci_dev' AND c.relname IN ('lineage_nodes','lineage_edges')
             AND c.relkind='r' HAVING count(*)=2`, []);
        const p = posture.rows[0];
        if (posture.rows.length !== 1 || !obj(p) ||
            p.databaseName !== "bros_intelligence_dev" || p.forcedRls !== true ||
            p.lineageOnly !== true || p.membershipDenied !== true ||
            p.evidenceDenied !== true || p.schemaCreateDenied !== true ||
            p.dbCreateDenied !== true) deny();
        await query(
          "SELECT set_config('bci.tenant_id',$1::text,true), set_config('bci.product',$2::text,true)",
          [tenantId, request.product]);
        const found = await query(
          `SELECT id::text AS "id", tenant_id::text AS "tenantId", product, stage,
                  source_system AS "sourceSystem", source_record_key AS "sourceRecordKey",
                  to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "recordedAt",
                  parent_ids::text[] AS "parentIds", assertion_status AS "verification"
           FROM bci_dev.lineage_nodes WHERE tenant_id=$1::uuid AND product=$2::text
           ORDER BY id LIMIT 1001`, [tenantId, request.product]);
        if (found.rows.length > 1000) deny();
        // PostgreSQL preserves the instant but not the input's fractional-second
        // spelling. Canonicalize only after rejecting accessors/unknown fields,
        // otherwise an exact idempotent replay could falsely conflict.
        const fields = ["id", "tenantId", "product", "stage", "sourceSystem",
          "sourceRecordKey", "recordedAt", "parentIds", "verification"];
        const canonical = request.records.map(record => {
          if (!exact(record, fields) || typeof record.recordedAt !== "string" ||
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(record.recordedAt)) deny();
          const instant = new Date(record.recordedAt);
          if (!Number.isFinite(instant.getTime()) ||
              instant.toISOString().slice(0, 19) !== record.recordedAt.slice(0, 19)) deny();
          return { ...record, recordedAt: instant.toISOString() };
        });
        const persisted = found.rows as readonly BciLineageRecord[];
        const plan = planUntrustedBciAuditAppend(scope, persisted, canonical);
        for (const node of plan.toInsert) {
          const inserted = await query(
            `INSERT INTO bci_dev.lineage_nodes
             (id,tenant_id,product,stage,source_system,source_record_key,recorded_at,parent_ids,assertion_status)
             VALUES ($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::timestamptz,$8::uuid[],'unverified')
             RETURNING id::text AS "id"`,
            [node.id, tenantId, request.product, node.stage, node.sourceSystem,
              node.sourceRecordKey, node.recordedAt, node.parentIds]);
          if (inserted.rows.length !== 1 || !obj(inserted.rows[0]) ||
              inserted.rows[0].id !== node.id) deny();
        }
        for (const node of plan.toInsert) {
          for (const parentId of node.parentIds) {
            const inserted = await query(
              `INSERT INTO bci_dev.lineage_edges (tenant_id,product,parent_id,child_id)
               VALUES ($1::uuid,$2::text,$3::uuid,$4::uuid)
               RETURNING child_id::text AS "childId"`,
              [tenantId, request.product, parentId, node.id]);
            if (inserted.rows.length !== 1 || !obj(inserted.rows[0]) ||
                inserted.rows[0].childId !== node.id) deny();
          }
        }
        await query("SET CONSTRAINTS ALL IMMEDIATE", []);
        // Revocation between initial membership lookup and append must roll back.
        const fresh = scopeOf(await deps.membershipsFor(principal.userId, request.product),
          principal.userId, request.product);
        if (fresh !== tenantId) deny();
        return Object.freeze({
          insertedIds: Object.freeze(plan.toInsert.map(node => node.id)),
          replayedIds: Object.freeze([...plan.replayedIds]),
        });
      });
    } catch { return deny(); }
  };
}
