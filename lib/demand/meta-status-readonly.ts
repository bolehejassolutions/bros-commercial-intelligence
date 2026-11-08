/** Server-only, bounded, GET-only Meta object status observation. Never write authority. */
export type MetaStatusKind = "campaign" | "adset" | "ad";
export type MetaStatusBinding = Readonly<{ accountId: string; objectId: string; kind: MetaStatusKind; apiVersion: string }>;
export type MetaStatusTransport = (url: string, init: { method: "GET"; headers: Record<string,string>; signal: AbortSignal; redirect: "error"; cache: "no-store" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
const deny = (): never => { throw Error("BROS_DEMAND_META_STATUS_READ_FAILED"); };
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const statuses = new Set(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO"]);
/** Caller must independently bind verified principal, tenant and server-owned account/token. */
export async function readDemandMetaObjectStatus(binding: MetaStatusBinding, token: string, observedAt: string, transport: MetaStatusTransport) {
  try {
    if (!object(binding) || typeof binding.accountId !== "string" || !/^act_\d{5,30}$/.test(binding.accountId) ||
      typeof binding.objectId !== "string" || !/^\d{5,30}$/.test(binding.objectId) ||
      !["campaign", "adset", "ad"].includes(binding.kind) ||
      typeof binding.apiVersion !== "string" || !/^v[1-9]\d?\.\d+$/.test(binding.apiVersion) ||
      typeof token !== "string" || token.length < 20 || token.length > 4096 || /[^\x21-\x7e]/.test(token) ||
      typeof observedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(observedAt) ||
      !Number.isFinite(Date.parse(observedAt)) || new Date(Date.parse(observedAt)).toISOString().slice(0,19) !== observedAt.slice(0,19) ||
      typeof transport !== "function") deny();
    const url = "https://graph.facebook.com/" + binding.apiVersion + "/" + binding.objectId +
      "?fields=id,account_id,configured_status,effective_status";
    const response = await transport(url, { method: "GET",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store" });
    if (!response || response.ok !== true) deny();
    const body = await response.json();
    if (!object(body) || Object.hasOwn(body, "error") || body.id !== binding.objectId ||
      body.account_id !== binding.accountId.slice(4) ||
      typeof body.configured_status !== "string" || !statuses.has(body.configured_status) ||
      typeof body.effective_status !== "string" || !statuses.has(body.effective_status)) deny();
    return Object.freeze({ source: "META_GRAPH_API_UNATTESTED" as const, observedAt,
      accountId: binding.accountId, objectId: binding.objectId, kind: binding.kind,
      configuredStatus: body.configured_status, effectiveStatus: body.effective_status,
      executionAllowed: false as const, providerAuthorizationIndependentlyAttested: false as const });
  } catch { deny(); }
}
