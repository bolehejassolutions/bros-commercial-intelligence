import { createDemandDirectMetaReader } from "./meta-direct-admission.ts";
import type { ReadOnlyMetaFetch } from "./meta-direct-readonly.ts";

/**
 * Internal DEMAND HTTP policy (pure injection boundary, not an exposed route).
 * The hosting runtime owns verification, tenant membership and server secrets.
 * Never mount this handler without the locked Preview branch/flag policy.
 */
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Membership = Readonly<{
  principalId: string; tenantId: string; product: "content" | "demand"; active: true;
}>;
type Dependencies = Readonly<{
  enabled: () => boolean;
  accountId: string;
  campaignId: string;
  apiVersion: string;
  verifyJwt: (token: string) => Promise<Principal | null>;
  membershipsFor: (userId: string, product: "demand") => Promise<readonly Membership[]>;
  serverTokenFor: (tenantId: string, accountId: string) => Promise<string | null>;
  now: () => string;
  fetchImpl?: ReadOnlyMetaFetch;
}>;

const securityHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
} as const;
const json = (data: unknown, status: number, additional?: Record<string, string>) =>
  Response.json(data, { status, headers: { ...securityHeaders, ...additional } });
const deny = (status: number) => json({ error: "BROS DEMAND private Meta read denied." }, status);

export function createDemandMetaHttpHandler(deps: Dependencies) {
  if (!deps || typeof deps.enabled !== "function" ||
      typeof deps.verifyJwt !== "function" ||
      typeof deps.membershipsFor !== "function" ||
      typeof deps.serverTokenFor !== "function" ||
      typeof deps.now !== "function") {
    throw new Error("Invalid DEMAND private HTTP dependencies");
  }
  return async function handleDemandMetaHttp(request: Request): Promise<Response> {
    if (!deps.enabled()) return deny(404);
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (request.url.length > 2048 || request.headers.has("transfer-encoding") ||
        Number(request.headers.get("content-length") || 0) !== 0 ||
        ["x-tenant-id", "x-user-id", "x-bci-tenant-id", "x-admin",
         "x-role", "x-product", "x-operator-id", "x-meta-token"].some(k => request.headers.has(k)))
      return deny(400);
    let url: URL;
    try { url = new URL(request.url); } catch { return deny(400); }
    if (url.pathname !== "/api/internal/demand-meta" ||
        [...url.searchParams.keys()].some(k => k !== "since" && k !== "until") ||
        url.searchParams.getAll("since").length !== 1 ||
        url.searchParams.getAll("until").length !== 1)
      return deny(400);

    const authorization = request.headers.get("authorization");
    if (!authorization || authorization.length > 16007 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))
      return deny(401);
    const jwt = authorization.slice(7);
    // Fixed, non-identifying server-side diagnostic. Never log JWT, IDs or errors.
    let phase: "identity" | "membership" | "tenant_gate" | "provider" = "identity";
    try {
      // Request-local dependencies prohibit concurrent JWT cross-contamination.
      const reader = createDemandDirectMetaReader({
        accountId: deps.accountId, campaignId: deps.campaignId,
        apiVersion: deps.apiVersion,
      }, {
        authenticate: async () => {
          const principal = await deps.verifyJwt(jwt);
          if (principal?.authenticated === true) phase = "membership";
          return principal;
        },
        membershipsFor: async (userId, product) => {
          phase = "membership";
          return deps.membershipsFor(userId, product);
        },
        serverTokenFor: async (tenantId, accountId) => {
          phase = "tenant_gate";
          return deps.serverTokenFor(tenantId, accountId);
        },
        now: deps.now,
        fetchImpl: async (url, init) => {
          phase = "provider";
          return (deps.fetchImpl ?? (fetch as ReadOnlyMetaFetch))(url, init);
        },
      });
      const result = await reader({
        since: url.searchParams.get("since") ?? "",
        until: url.searchParams.get("until") ?? "",
      });
      if (!result) throw new Error("DEMAND_META_READ_DENIED");
      // Whitelist fields. Never expose JWT, server token, raw provider JSON,
      // tenant/private principal or provider error details.
      const observation = result.observation;
      return json({
        status: result.status,
        source: "DIRECT_META_GRAPH_API",
        report: observation ? {
          campaignId: observation.campaignId,
          windowStart: observation.windowStart,
          windowEndInclusive: observation.windowEndInclusive,
          snapshotKey: observation.snapshotKey,
          calendarWindowStatus: observation.calendarWindowStatus,
          currency: observation.currency,
          spendMinor: observation.spendMinor,
          inlineLinkClicks: observation.inlineLinkClicks,
          landingPageViews: observation.landingPageViews,
          metaAttributedPurchases: observation.metaAttributedPurchases,
          pixelPurchaseEvents: observation.pixelPurchaseEvents,
          actionAliasMismatch: observation.actionAliasMismatch,
        } : null,
        // Non-persistent candidate for future independently authenticated BCI
        // intake. No tenant, principal, token, or raw provider body is exposed.
        readCandidate: {
          candidateKey: result.readCandidate.candidateKey,
          stage: result.readCandidate.stage,
          reportStatus: result.readCandidate.reportStatus,
          windowStart: result.readCandidate.windowStart,
          windowEndInclusive: result.readCandidate.windowEndInclusive,
          collectedAt: result.readCandidate.collectedAt,
          metricsPresent: result.readCandidate.metrics !== null,
          independentProviderReceiptRecorded: false,
          durableBciEvidenceRecorded: false,
          executionAllowed: false,
        },
        verifiedPaidOrders: null, verifiedCpaMinor: null,
        durableBciEvidenceRecorded: false,
        campaignExecutionAllowed: false,
      }, 200);
    } catch {
      // Restricted fixed vocabulary only; never include secret-bearing exception.
      console.warn("demand_meta_read_denied", phase);
      return deny(403);
    }
  };
}
