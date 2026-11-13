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
/** One explicit historical, PAUSED BROS SELL control, same protected account.
 * Server-owned exact scope; never accept arbitrary campaign IDs from callers. */
const historicalControl = Object.freeze({
  cohort: "historical_bros_sell_202610",
  campaignId: "120250864977630697",
  since: "2026-10-08",
  until: "2026-10-27",
});

/**
 * DEMAND-owned projection for the EXISTING BCI intake boundary.
 * BCI preflight requires exact keys, not DEMAND's larger internal candidate
 * and observation objects. Never pass tenant/principal/token/raw Meta JSON.
 * This is NOT a signed provider receipt or permission to append.
 *
 * An integrated BCI-owned runtime can inject this projection as its
 * observeServerMeta(scope) result after its OWN fresh authentication,
 * membership checks and server-side Meta GET.
 */
type DemandReadResult = NonNullable<Awaited<ReturnType<ReturnType<typeof createDemandDirectMetaReader>>>>;
export function projectDemandMetaBciIntake(result: DemandReadResult) {
  const candidate = result.readCandidate;
  const observation = result.observation;
  if (candidate.reportStatus !== result.status ||
      (result.status === "NO_ROWS_NOT_ZERO") !== (observation === null) ||
      (candidate.metrics === null) !== (observation === null)) {
    throw new Error("BROS_DEMAND_BCI_INTAKE_SHAPE_DENIED");
  }
  const bciCandidate = Object.freeze({
    candidateKey: candidate.candidateKey,
    stage: candidate.stage,
    reportStatus: candidate.reportStatus,
    windowStart: candidate.windowStart,
    windowEndInclusive: candidate.windowEndInclusive,
    collectedAt: candidate.collectedAt,
    metricsPresent: observation !== null,
    independentProviderReceiptRecorded: false as const,
    durableBciEvidenceRecorded: false as const,
    executionAllowed: false as const,
  });
  const bciReport = observation ? Object.freeze({
    campaignId: observation.campaignId,
    windowStart: observation.windowStart,
    windowEndInclusive: observation.windowEndInclusive,
    snapshotKey: observation.snapshotKey,
    currency: observation.currency,
    spendMinor: observation.spendMinor,
    inlineLinkClicks: observation.inlineLinkClicks,
    landingPageViews: observation.landingPageViews,
    metaAttributedPurchases: observation.metaAttributedPurchases,
    pixelPurchaseEvents: observation.pixelPurchaseEvents,
    actionAliasMismatch: observation.actionAliasMismatch,
  }) : null;
  return Object.freeze({ candidate: bciCandidate, report: bciReport });
}

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
    const historical = url.searchParams.get("cohort") === historicalControl.cohort;
    if (url.pathname !== "/api/internal/demand-meta" ||
        [...url.searchParams.keys()].some(k =>
          k !== "since" && k !== "until" && !(historical && k === "cohort")) ||
        url.searchParams.getAll("since").length !== 1 ||
        url.searchParams.getAll("until").length !== 1 ||
        (historical && (url.searchParams.getAll("cohort").length !== 1 ||
          url.searchParams.get("since") !== historicalControl.since ||
          url.searchParams.get("until") !== historicalControl.until)))
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
        accountId: deps.accountId,
        campaignId: historical ? historicalControl.campaignId : deps.campaignId,
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
      const bciIntake = projectDemandMetaBciIntake(result);
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
        readCandidate: bciIntake.candidate,
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
