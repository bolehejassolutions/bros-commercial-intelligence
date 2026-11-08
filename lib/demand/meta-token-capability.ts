import { metaProviderRequest, metaProviderJson } from "../marketing-operator/meta-provider.ts";

const GRAPH = "https://graph.facebook.com/v24.0";
const ACCOUNT = "act_1997776120879476";
type Grant = "GRANTED" | "NOT_GRANTED" | "UNVERIFIED";
type Readback = { body: Record<string, unknown> | null; code: number | null; subcode: number | null };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safeCode = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1000000000 ? v : null;

/**
 * Explicit GET-only audit of the EXISTING business-owned server credential.
 * It never promotes a reporting credential to a writer, changes a token,
 * relaxes management preflight, or exposes provider bodies or secret values.
 */
export async function inspectExistingDemandMetaToken(token: unknown, transport: typeof fetch = fetch, now = Date.now()) {
  const empty = { permissionReadbackVerified: false, debugReadbackVerified: false,
    appBindingVerified: false, fixedAccountReadVerified: false,
    adsRead: "UNVERIFIED" as Grant, adsManagement: "UNVERIFIED" as Grant,
    permissionCode: null as number | null, permissionSubcode: null as number | null,
    debugCode: null as number | null, debugSubcode: null as number | null,
    accountCode: null as number | null, accountSubcode: null as number | null,
    managementConnectionVerified: false, credentialChanged: false, executionAllowed: false };
  if (typeof token !== "string" || token.length < 20 || token.length > 16000 || /\s/.test(token))
    return { status: "MISSING_SERVER_CREDENTIAL", ...empty };
  async function get(path: string, params: Record<string, string> = {}): Promise<Readback> {
    const url = new URL(GRAPH + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    try {
      const response = await metaProviderRequest(url.toString(), { method: "GET", redirect: "error", cache: "no-store",
        headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: AbortSignal.timeout(10000) }, transport);
      const body = await metaProviderJson(response);
      if (!response.ok || body.error) {
        const e = object(body.error) ? body.error : {};
        return { body: null, code: safeCode(e.code), subcode: safeCode(e.error_subcode) };
      }
      return { body, code: null, subcode: null };
    } catch { return { body: null, code: null, subcode: null }; }
  }
  // Self-introspection is attempted with the existing token. If Meta requires
  // a separate app/developer credential, return UNVERIFIED; never infer scopes.
  const permission = await get("/me/permissions", { limit: "100" });
  // Never put bearer credentials in URL query strings: they can be retained by
  // intermediary logs, tracing systems and provider request telemetry.
  // Meta debug_token requires input_token in the URL for GET. Until a reviewed
  // non-URL transport is available, app binding remains UNVERIFIED.
  const debug: Readback = { body: null, code: null, subcode: null };
  const account = await get("/" + ACCOUNT, { fields: "id,account_id,account_status,currency,timezone_name" });
  const r = { ...empty, permissionCode: permission.code, permissionSubcode: permission.subcode,
    debugCode: debug.code, debugSubcode: debug.subcode, accountCode: account.code, accountSubcode: account.subcode };
  let permissionScopes: string[] | null = null, debugScopes: string[] | null = null;
  const permissions = permission.body?.data;
  if (Array.isArray(permissions) && permissions.length > 0 && permissions.length <= 100 &&
      !(object(permission.body?.paging) && permission.body.paging.next) &&
      permissions.every(x => object(x) && typeof x.permission === "string" &&
        ["granted", "declined", "expired"].includes(String(x.status)))) {
    permissionScopes = permissions.filter(x => x.status === "granted").map(x => x.permission as string);
    if (new Set(permissions.map(x => x.permission)).size === permissions.length) r.permissionReadbackVerified = true;
    else permissionScopes = null;
  }
  const d = debug.body?.data;
  if (object(d) && d.is_valid === true && typeof d.app_id === "string" &&
      typeof d.expires_at === "number" && Number.isSafeInteger(d.expires_at) && d.expires_at >= 0 &&
      (d.expires_at === 0 || d.expires_at * 1000 > now) && Array.isArray(d.scopes) &&
      d.scopes.length > 0 && d.scopes.length <= 100 && d.scopes.every(s => typeof s === "string") &&
      new Set(d.scopes).size === d.scopes.length) {
    debugScopes = d.scopes as string[]; r.debugReadbackVerified = true; r.appBindingVerified = false;
  }
  const grant = (name: string): Grant => {
    if (permissionScopes && debugScopes && permissionScopes.includes(name) !== debugScopes.includes(name)) return "UNVERIFIED";
    const scopes = debugScopes ?? permissionScopes;
    return scopes ? scopes.includes(name) ? "GRANTED" : "NOT_GRANTED" : "UNVERIFIED";
  };
  r.adsRead = grant("ads_read"); r.adsManagement = grant("ads_management");
  const a = account.body;
  r.fixedAccountReadVerified = !!a && a.id === ACCOUNT && a.account_id === ACCOUNT.slice(4) &&
    a.account_status === 1 && a.currency === "MYR" && a.timezone_name === "Asia/Kuala_Lumpur";
  return { status: "CAPABILITY_READBACK", ...r };
}
