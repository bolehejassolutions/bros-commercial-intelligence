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
// Both fixed restricted readers execute exactly four SQL statements. Leave a
// small explicit budget for future reviewed reads, never unlimited queries.
const MAX_READER_QUERIES = 8;
const MAX_SQL_BYTES = 4096;
const MAX_BOUND_PARAMS = 3;

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
      // Do not inherit a pool/session's caller-controlled name resolution or
      // row-security posture. Both readers use schema-qualified bci_dev tables;
      // unqualified PostgreSQL built-ins must resolve from pg_catalog only.
      // SET LOCAL ensures these settings disappear at ROLLBACK.
      await client.query("SET LOCAL search_path = pg_catalog", []);
      await client.query("SET LOCAL row_security = on", []);
      // A reader may accidentally retain the query callback. Its authority
      // must expire when the transaction callback returns, before ROLLBACK.
      let accepting = true;
      const inFlight = new Set<Promise<DevReadSqlResult>>();
      // A callback can launch a query and return without awaiting it. Its
      // rejection must still invalidate the entire read, not become a success.
      let detachedQueryFailed = false;
      let readerQueries = 0;
      const query = async (sql: string, params: readonly DevReadSqlValue[]) => {
        if (!accepting) deny();
        if (typeof sql !== "string" || !sql.trim() ||
            Buffer.byteLength(sql, "utf8") > MAX_SQL_BYTES ||
            !Array.isArray(params) || params.length > MAX_BOUND_PARAMS ||
            params.some(p => p !== null &&
              typeof p !== "string" && typeof p !== "boolean" &&
              (typeof p !== "number" || !Number.isFinite(p)))) {
          detachedQueryFailed = true;
          deny();
        }
        // Count BEFORE dispatch: concurrent/detached calls share the same
        // transaction budget and cannot bypass it through races.
        if (++readerQueries > MAX_READER_QUERIES) {
          detachedQueryFailed = true;
          deny();
        }
        // SQL is provided exclusively by server-owned allowlisted readers.
        // This guard does NOT sanitize arbitrary caller SQL or authorize it.
        const pending = client!.query(sql, params);
        inFlight.add(pending);
        try { return await pending; }
        catch (error) { detachedQueryFailed = true; throw error; }
        finally { inFlight.delete(pending); }
      };
      let value: Awaited<ReturnType<typeof callback>>;
      try { value = await callback(query); }
      finally {
        // Stop all new queries before any rollback, even on callback failure.
        accepting = false;
        // Never return a connection to the pool while detached SQL is running.
        await Promise.allSettled([...inFlight]);
      }
      // Any SQL rejection (including a detached, later-settling query) poisons
      // the transaction result even when the callback returned a value.
      if (detachedQueryFailed) deny();
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
