/** Driver-neutral helpers for actual restricted direct logins, with no secret-bearing errors. */
type Value = string | number | boolean | null;
type Result = Readonly<{ rows: readonly unknown[] }>;
type Query = (sql: string, params: readonly Value[]) => Promise<Result>;
type Client = Readonly<{
  query: (sql: string, params?: Value[]) => Promise<Result>;
  release: (destroy?: boolean) => void;
}>;
export type ReadOnlyPool = Readonly<{ connect: () => Promise<Client> }>;
type RestrictedRole = "bci_dev_private_reader" | "bci_dev_membership_reader" | "bci_dev_lineage_writer";

export class NeonPreviewDatabaseDenied extends Error {
  constructor() { super("Neon development database access denied."); this.name = "NeonPreviewDatabaseDenied"; }
}

const hosts = new Set([
  "ep-fancy-queen-b30g0cjn.c-4.ap-southeast-1.aws.neon.tech",
  "ep-fancy-queen-b30g0cjn-pooler.c-4.ap-southeast-1.aws.neon.tech",
]);

/** Parse fields explicitly so URL sslmode/options cannot override required certificate validation. */
export function parseNeonDevConnection(value: unknown, role: RestrictedRole) {
  try {
    if (typeof value !== "string" || value.length > 4096 ||
        (role !== "bci_dev_private_reader" && role !== "bci_dev_membership_reader" && role !== "bci_dev_lineage_writer")) throw new Error();
    const url = new URL(value);
    if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
        !hosts.has(url.hostname) || (url.port && url.port !== "5432") ||
        url.username.length === 0 || url.password.length === 0 ||
        decodeURIComponent(url.username) !== role || !url.password || url.hash ||
        decodeURIComponent(url.pathname) !== "/bros_intelligence_dev") throw new Error();
    for (const key of url.searchParams.keys()) {
      if ((key !== "sslmode" && key !== "channel_binding") || url.searchParams.getAll(key).length !== 1) throw new Error();
    }
    if (url.searchParams.has("sslmode") && !["require", "verify-full"].includes(url.searchParams.get("sslmode")!)) throw new Error();
    if (url.searchParams.has("channel_binding") && url.searchParams.get("channel_binding") !== "require") throw new Error();
    return {
      host: url.hostname,
      port: 5432,
      database: "bros_intelligence_dev",
      user: role,
      password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: true as const, servername: url.hostname },
      enableChannelBinding: true,
    };
  } catch { throw new NeonPreviewDatabaseDenied(); }
}

/** Each callback owns one physical pool client until COMMIT/ROLLBACK; transaction-local GUCs cannot leak. */
export function createPgReadOnlyTransaction(pool: ReadOnlyPool) {
  return async <T>(fn: (query: Query) => Promise<T>): Promise<T> => {
    let client: Client | undefined;
    let destroy = false;
    let active = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN READ ONLY");
      // Pin built-in catalog resolution before any role/ACL checks. Explicit pg_temp
      // placement prevents temporary relations shadowing pg_catalog objects.
      await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
      const pinned = client;
      active = true;
      const result = await fn(async (sql, params) => {
        if (!active) throw new NeonPreviewDatabaseDenied();
        return pinned.query(sql, [...params]);
      });
      active = false;
      await client.query("COMMIT");
      return result;
    } catch {
      active = false;
      destroy = true;
      if (client) {
        try { await client.query("ROLLBACK"); } catch { /* Destroy below; never log driver errors. */ }
      }
      throw new NeonPreviewDatabaseDenied();
    } finally {
      active = false;
      client?.release(destroy);
    }
  };
}
