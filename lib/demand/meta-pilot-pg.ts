import type { PilotTransaction } from "./meta-pilot-ledger.ts";

type Client = { query: (sql: string, params?: (string | null)[]) => Promise<{ rows: readonly unknown[] }>;
  release: (destroy?: boolean) => void };
export type PilotPool = { connect: () => Promise<Client> };

/** Existing restricted pool only. No credentials or secret-bearing driver errors escape. */
export function createPgPilotTransaction(pool: PilotPool): PilotTransaction {
  return async fn => {
    let client: Client | undefined, active = false, destroy = false;
    try {
      client = await pool.connect();
      // Advisory campaign locks serialize commands. READ COMMITTED sees a stop
      // committed while an external provider request was in flight.
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '4000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '45000ms'");
      const pinned = client;
      active = true;
      const output = await fn((sql, params) => {
        if (!active) throw Error("PILOT_TRANSACTION_CLOSED");
        return pinned.query(sql, [...params]);
      });
      active = false;
      await client.query("COMMIT");
      return output;
    } catch {
      active = false; destroy = true;
      if (client) { try { await client.query("ROLLBACK"); } catch { /* destroy */ } }
      throw Error("PILOT_TRANSACTION_UNAVAILABLE");
    } finally { active = false; client?.release(destroy); }
  };
}
