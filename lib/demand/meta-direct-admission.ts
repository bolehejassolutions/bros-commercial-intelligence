import { readDirectMetaCampaignInsights } from "./meta-direct-readonly.ts";
import { prepareDemandMetaReadCandidate } from "./meta-direct-read-candidate.ts";
import type { ReadOnlyMetaFetch } from "./meta-direct-readonly.ts";
import type { MetaFunnelScope } from "./meta-insights-funnel.ts";

/**
 * DEMAND-only SERVER ADMISSION for first-party read-only Meta reporting.
 *
 * This is a server-side composition contract, NOT a public HTTP route,
 * JWT verifier, credential store, deployed worker or durable BCI receipt.
 * Bind authenticate() to BCI's createNeonAuthPrincipalVerifier with pinned
 * issuer/audience/JWKS; bind membershipsFor() to the existing authoritative
 * restricted Neon membership lookup. Never use browser-provided claims.
 *
 * Never instantiate this service with client-provided dependencies or config.
 * Credential lookup MUST be server-only, tenant/account-scoped and ads_read.
 * No ads_management permission, write method, or spend authorization exists.
 */
type Principal = Readonly<{ userId: string; authenticated: true }>;
type Membership = Readonly<{
  principalId: string;
  tenantId: string;
  product: "content" | "demand";
  active: true;
}>;
type Request = Readonly<{ since: string; until: string }>;
type ServerConfig = Readonly<{
  accountId: string;
  campaignId: string;
  apiVersion: string;
}>;
type Dependencies = Readonly<{
  /** Must verify cryptographic identity, expiry and approved operator. */
  authenticate: () => Promise<Principal | null>;
  /** Must query fresh, authoritative restricted-login membership records. */
  membershipsFor: (userId: string, product: "demand") => Promise<readonly Membership[]>;
  /** Return an authorized ads_read token from a protected server-side vault. */
  serverTokenFor: (tenantId: string, accountId: string) => Promise<string | null>;
  /** Server clock, not a caller-provided timestamp. */
  now: () => string;
  fetchImpl?: ReadOnlyMetaFetch;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const fail = (): never => { throw new Error("BROS_DEMAND_META_ADMISSION_DENIED"); };
const validDay = (d: unknown): d is string =>
  typeof d === "string" && DATE.test(d) &&
  Number.isFinite(Date.parse(d + "T00:00:00.000Z")) &&
  new Date(Date.parse(d + "T00:00:00.000Z")).toISOString().slice(0, 10) === d;
const membershipTenant = (grants: readonly Membership[], userId: string): string => {
  if (!Array.isArray(grants) || grants.length !== 1) fail();
  const m = grants[0];
  if (!m || m.active !== true || m.product !== "demand" ||
      m.principalId !== userId || typeof m.tenantId !== "string" ||
      !UUID.test(m.tenantId)) fail();
  return m.tenantId.toLowerCase();
};

export function createDemandDirectMetaReader(
  config: ServerConfig, deps: Dependencies,
) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      typeof config.accountId !== "string" || !/^act_\d+$/.test(config.accountId) ||
      typeof config.campaignId !== "string" || !/^\d+$/.test(config.campaignId) ||
      typeof config.apiVersion !== "string" || !/^v[1-9]\d?\.\d+$/.test(config.apiVersion) ||
      !deps || typeof deps.authenticate !== "function" ||
      typeof deps.membershipsFor !== "function" ||
      typeof deps.serverTokenFor !== "function" ||
      typeof deps.now !== "function" ||
      (deps.fetchImpl !== undefined && typeof deps.fetchImpl !== "function")) fail();

  // Bind exact server-authorized account/campaign, not request-supplied IDs.
  const binding = Object.freeze({
    accountId: config.accountId,
    campaignId: config.campaignId,
    apiVersion: config.apiVersion,
  });

  return async (request: Request) => {
    try {
      if (!request || typeof request !== "object" || Array.isArray(request) ||
          Object.keys(request).length !== 2 ||
          !Object.hasOwn(request, "since") || !Object.hasOwn(request, "until") ||
          !validDay(request.since) || !validDay(request.until) ||
          request.since > request.until) fail();
      // Guard against unbounded reporting/rate-limit usage.
      const span = (Date.parse(request.until + "T00:00:00Z") -
        Date.parse(request.since + "T00:00:00Z")) / 86400000;
      if (!Number.isInteger(span) || span > 30) fail();

      const principal = await deps.authenticate();
      if (!principal || principal.authenticated !== true ||
          typeof principal.userId !== "string" || !UUID.test(principal.userId)) return fail();
      const tenantId = membershipTenant(
        await deps.membershipsFor(principal.userId, "demand"), principal.userId,
      );
      const collectedAt = deps.now();
      if (typeof collectedAt !== "string" || !UTC.test(collectedAt) ||
          !Number.isFinite(Date.parse(collectedAt)) ||
          new Date(Date.parse(collectedAt)).toISOString().slice(0, 19) !==
            collectedAt.slice(0, 19)) fail();
      const accessToken = await deps.serverTokenFor(tenantId, binding.accountId);
      if (typeof accessToken !== "string" || !accessToken) return fail();

      const scope: MetaFunnelScope = {
        tenantId, product: "demand",
        accountId: binding.accountId, campaignId: binding.campaignId,
        currency: "MYR", since: request.since, until: request.until,
        collectedAt,
      };
      const result = await readDirectMetaCampaignInsights({
        scope, apiVersion: binding.apiVersion, accessToken,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      if (!result) return fail();

      // Fail closed if the membership was revoked or switched during HTTP.
      const tenantAfterRead = membershipTenant(
        await deps.membershipsFor(principal.userId, "demand"), principal.userId,
      );
      if (tenantAfterRead !== tenantId) fail();

      // Candidate handoff is non-persistent and cannot assert BCI attestation.
      const readCandidate = prepareDemandMetaReadCandidate(scope, result.status, result.observation);
      // Do not echo tokens, raw provider payload, principal, or tenant grants.
      return Object.freeze({
        readCandidate,
        status: result.status,
        source: "DIRECT_META_GRAPH_API" as const,
        observation: result.observation,
        // These only indicate checks executed using injected server deps.
        // Their independent authentication/provenance is not attested here.
        admissionChecksApplied: true as const,
        membershipRecheckedAfterRead: true as const,
        // Caller must still prove trusted deps, secret scope and BCI receipt.
        authenticatedProviderReceiptRecorded: false as const,
        durableBciEvidenceRecorded: false as const,
        verifiedPaidOrders: null,
        verifiedCpaMinor: null, verifiedCacMinor: null,
        causalLift: null, executionAllowed: false as const,
      });
    } catch {
      fail();
    }
  };
}
