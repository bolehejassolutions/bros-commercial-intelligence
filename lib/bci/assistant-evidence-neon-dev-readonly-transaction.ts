/**
 * BROS Business OS: private DEV-only, non-routed PostgreSQL transaction adapter.
 * A direct restricted LOGIN pool MUST be provided by trusted server code;
 * never use a pooled admin connection, SET ROLE, or user-supplied DSN.
 *
 * BEGIN READ ONLY pins a single client for the whole SQL contract. A ROLLBACK
 * is intentional even on success: this adapter never persists modifications.
 * Existing membership/evidence readers independently check direct role identity,
 * RLS posture, grants and fixed schema before any scoped data query.
 */
export type DevReadSqlValue = string | number | boolean | null;
export type DevReadSqlResult = Readonly<{ rows: readonly unknown[] }>;
export type DevReadClient = Readonly<{
  query: (sql: string, params?: readonly DevReadSqlValue[]) => Promise<DevReadSqlResult>;
  release: (error?: Error) => void;
}>;
export type DevReadPool = Readonly<{ connect: () => Promise<DevReadClient> }>;
export type DevReadTransaction = <T>(
  callback: (query: (sql: string, params: readonly DevReadSqlValue[]) =>
    Promise<DevReadSqlResult>) => Promise<T>
) => Promise<T>;

export class DevReadTransactionUnavailable extends Error {
  constructor() {
    super("BROS Business OS DEV read transaction unavailable");
    this.name = "DevReadTransactionUnavailable";
  }
}
const deny = (): never => { throw new DevReadTransactionUnavailable(); };

/**
 * Builds a transaction callback compatible with BOTH restricted SQL readers.
 * Pool identity/credentials must be independently provisioned and audited;
 * this does not establish a role, grant or authenticated principal.
 */
export function createBusinessOsDevReadOnlyTransaction(
  pool: DevReadPool,
): DevReadTransaction {
  if (!pool || typeof pool.connect !== "function") deny();
  return async callback => {
    if (typeof callback !== "function") deny();
    let client: DevReadClient | undefined;
    let began = false;
    let healthy = false;
    try {
      client = await pool.connect();
      if (!client || typeof client.query !== "function" ||
          typeof client.release !== "function") deny();
      // Pin transaction scope and bound runtime before invoking any reader.
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY", []);
      began = true;
      await client.query("SET LOCAL statement_timeout = '5000ms'", []);
      await client.query("SET LOCAL lock_timeout = '1000ms'", []);
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '7000ms'", []);
      const query = async (sql: string, params: readonly DevReadSqlValue[]) => {
        if (typeof sql !== "string" || !sql.trim() || !Array.isArray(params) ||
            params.some(p => p !== null &&
              typeof p !== "string" && typeof p !== "boolean" &&
              (typeof p !== "number" || !Number.isFinite(p)))) deny();
        // SQL is provided exclusively by server-owned allowlisted readers.
        // This guard does NOT sanitize arbitrary caller SQL or authorize it.
        return await client!.query(sql, params);
      };
      const value = await callback(query);
      await client.query("ROLLBACK", []);
      began = false;
      healthy = true;
      return value;
    } catch {
      throw new DevReadTransactionUnavailable();
    } finally {
      if (client) {
        if (began) {
          try {
            await client.query("ROLLBACK", []);
            healthy = true;
          } catch {
            healthy = false;
          }
        }
        try { client.release(healthy ? undefined : new Error("Discard failed DEV read transaction")); }
        catch { /* Never expose driver internals to the caller. */ }
      }
    }
  };
}
