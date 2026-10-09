/** Server-side, GET-only credential preflight. Never log request URLs or provider bodies. */
export const FIXED_META_ACCOUNT = "act_1997776120879476";
export const FIXED_META_BUSINESS = "2091328444802994";
export const FIXED_META_APP = "1315572270590189";
const GRAPH = "https://graph.facebook.com/v24.0";
const APP_NAME = "BROS Commercial Intelligence";
export type MetaCredentialMode = "read" | "write";
type Reason = "VERIFIED" | "MISSING_SERVER_CONFIGURATION" | "INVALID_SERVER_CONFIGURATION" |
  "PROVIDER_REQUEST_FAILED" | "MALFORMED_PROVIDER_DATA" | "TOKEN_INVALID" |
  "TOKEN_APP_MISMATCH" | "TOKEN_EXPIRED" | "TOKEN_SCOPE_MISSING" | "TOKEN_TARGET_MISMATCH" |
  "APP_IDENTITY_MISMATCH" | "APP_BUSINESS_MISMATCH" | "ACCOUNT_IDENTITY_MISMATCH" |
  "ACCOUNT_BUSINESS_MISMATCH" | "ACCOUNT_SETTINGS_MISMATCH" | "ACCOUNT_WRITE_TASK_MISSING";
export type MetaConnectionStatus = {
  status: "READY" | "BLOCKED"; reason: Reason; mode: MetaCredentialMode;
  appId: string | null; accountId: string; businessPortfolioId: string;
  checks: { token: boolean; app: boolean; account: boolean };
  expiresAt: number | null; dataAccessExpiresAt: number | null;
};
class PreflightError extends Error {
  readonly reason: Reason;
  constructor(reason: Reason) { super("Meta connection blocked: " + reason + "."); this.reason = reason; }
}
function fail(reason: Reason): never { throw new PreflightError(reason); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MALFORMED_PROVIDER_DATA");
  return value as Record<string, unknown>;
}
function businessId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}
function verifyBusiness(data: Record<string, unknown>, reason: Reason) {
  const owners = [businessId(data.business), businessId(data.owner_business)].filter(id => id !== null);
  if (!owners.length || owners.some(id => id !== FIXED_META_BUSINESS)) fail(reason);
}
function timestamp(value: unknown, nowSeconds: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("MALFORMED_PROVIDER_DATA");
  // Meta uses an explicit zero for non-expiring credentials; omitted expiry is unknown.
  if (value !== 0 && value <= nowSeconds) fail("TOKEN_EXPIRED");
  return value;
}
export function validateMetaTokenMetadata(
  payload: unknown, appId: string, mode: MetaCredentialMode, now = Date.now(),
) {
  const outer = record(payload);
  if (outer.error) fail("PROVIDER_REQUEST_FAILED");
  const data = record(outer.data);
  if (data.error || data.is_valid !== true) fail("TOKEN_INVALID");
  if (data.app_id !== appId) fail("TOKEN_APP_MISMATCH");
  const expiresAt = timestamp(data.expires_at, Math.floor(now / 1000));
  const dataAccessExpiresAt = data.data_access_expires_at === undefined ? null :
    timestamp(data.data_access_expires_at, Math.floor(now / 1000));
  if (!Array.isArray(data.scopes) || data.scopes.length > 100 ||
      data.scopes.some(scope => typeof scope !== "string")) fail("MALFORMED_PROVIDER_DATA");
  const acceptable = mode === "write" ? ["ads_management"] : ["ads_read", "ads_management"];
  const granted = acceptable.filter(scope => (data.scopes as string[]).includes(scope));
  if (!granted.length) fail("TOKEN_SCOPE_MISSING");
  if (data.granular_scopes !== undefined) {
    if (!Array.isArray(data.granular_scopes) || data.granular_scopes.length > 100) fail("MALFORMED_PROVIDER_DATA");
    for (const raw of data.granular_scopes) {
      const grant = record(raw);
      if (typeof grant.scope !== "string") fail("MALFORMED_PROVIDER_DATA");
      if (!granted.includes(grant.scope) || grant.target_ids === undefined) continue;
      if (!Array.isArray(grant.target_ids) || grant.target_ids.some(id => typeof id !== "string"))
        fail("MALFORMED_PROVIDER_DATA");
      if (!grant.target_ids.some(id => id === FIXED_META_ACCOUNT || id === FIXED_META_ACCOUNT.slice(4)))
        fail("TOKEN_TARGET_MISMATCH");
    }
  }
  return { expiresAt, dataAccessExpiresAt };
}
async function providerGet(url: URL, credential: string, transport: typeof fetch) {
  // debug_token's documented input_token query is a narrow server-only exception.
  // Redirects, URL logging, raw errors and response passthrough are prohibited.
  try {
    const response = await transport(url.toString(), {
      method: "GET", headers: { Authorization: "Bearer " + credential, Accept: "application/json" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) fail("PROVIDER_REQUEST_FAILED");
    const data = record(await response.json());
    if (data.error) fail("PROVIDER_REQUEST_FAILED");
    return data;
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    fail("PROVIDER_REQUEST_FAILED");
  }
}
export async function inspectMetaConnection(
  mode: MetaCredentialMode, environment: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = fetch, now = Date.now(),
): Promise<MetaConnectionStatus> {
  const rawAppId = environment.META_APP_ID;
  const result: MetaConnectionStatus = {
    status: "BLOCKED", reason: "MISSING_SERVER_CONFIGURATION", mode,
    appId: rawAppId === FIXED_META_APP ? FIXED_META_APP : null,
    accountId: FIXED_META_ACCOUNT, businessPortfolioId: FIXED_META_BUSINESS,
    checks: { token: false, app: false, account: false }, expiresAt: null, dataAccessExpiresAt: null,
  };
  try {
    const secret = environment.META_APP_SECRET;
    const token = mode === "write" ? environment.META_ADS_MANAGEMENT_TOKEN : environment.META_ADS_READ_TOKEN;
    if (!rawAppId || !secret || !token) fail("MISSING_SERVER_CONFIGURATION");
    if (!/^\d{6,}$/.test(rawAppId) || secret.length < 16 || token.length < 16 ||
        /\s/.test(secret) || /\s/.test(token)) fail("INVALID_SERVER_CONFIGURATION");
    if (rawAppId !== FIXED_META_APP) fail("APP_IDENTITY_MISMATCH");
    const appId = rawAppId;
    const appCredential = appId + "|" + secret;
    const debug = new URL(GRAPH + "/debug_token");
    debug.searchParams.set("input_token", token);
    const metadata = validateMetaTokenMetadata(await providerGet(debug, appCredential, transport), appId, mode, now);
    result.expiresAt = metadata.expiresAt;
    result.dataAccessExpiresAt = metadata.dataAccessExpiresAt;
    result.checks.token = true;
    const appUrl = new URL(GRAPH + "/" + appId);
    appUrl.searchParams.set("fields", "id,name,business,owner_business");
    const app = await providerGet(appUrl, appCredential, transport);
    if (app.id !== appId || app.name !== APP_NAME) fail("APP_IDENTITY_MISMATCH");
    verifyBusiness(app, "APP_BUSINESS_MISMATCH");
    result.checks.app = true;
    const accountUrl = new URL(GRAPH + "/" + FIXED_META_ACCOUNT);
    accountUrl.searchParams.set("fields", "id,account_id,account_status,currency,timezone_name,business,owner_business,user_tasks");
    const account = await providerGet(accountUrl, token, transport);
    if (account.id !== FIXED_META_ACCOUNT || account.account_id !== FIXED_META_ACCOUNT.slice(4))
      fail("ACCOUNT_IDENTITY_MISMATCH");
    verifyBusiness(account, "ACCOUNT_BUSINESS_MISMATCH");
    if (account.account_status !== 1 || account.currency !== "MYR" || account.timezone_name !== "Asia/Kuala_Lumpur")
      fail("ACCOUNT_SETTINGS_MISMATCH");
    if (mode === "write" && (!Array.isArray(account.user_tasks) ||
        account.user_tasks.some(task => typeof task !== "string") ||
        !account.user_tasks.some(task => task === "ADVERTISE" || task === "MANAGE")))
      fail("ACCOUNT_WRITE_TASK_MISSING");
    result.checks.account = true;
    result.status = "READY";
    result.reason = "VERIFIED";
  } catch (error) {
    result.reason = error instanceof PreflightError ? error.reason : "PROVIDER_REQUEST_FAILED";
  }
  return result;
}
export async function requireVerifiedMetaCredential(
  mode: MetaCredentialMode, environment: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch,
) {
  const result = await inspectMetaConnection(mode, environment, transport);
  if (result.status !== "READY") fail(result.reason);
  return result;
}
