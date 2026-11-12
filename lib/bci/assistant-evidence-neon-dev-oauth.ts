/**
 * BROS Business OS — PRIVATE, non-routed DEV OAuth 2.1 access-token boundary.
 *
 * Neon Managed Better Auth's OAuth Provider (currently DISABLED in our DEV
 * branch) issues EdDSA JWT access tokens when the OAuth flow supplies resource.
 * A server-owned verifier MUST cryptographically verify EdDSA signature, the
 * EXACT branch issuer, resource audience, expiry and token type *before*
 * returning claims. Never inject decoded/unverified JWT payloads.
 *
 * OAuth JWT signature validation does not establish immediate session/token
 * revocation: issued tokens may remain valid until expiry. A separate
 * independently authoritative live-status callback is MANDATORY. The Neon docs
 * do not supply such a callback for this existing deployment; consequently,
 * do not route/activate this code until a real one is approved and tested.
 *
 * No HTTP route, OAuth activation, key material, network client, DB connection,
 * JWT implementation, plugin change or provider permissions are provisioned.
 */
import { createHash } from "node:crypto";
import { createDevEvidenceReadHandler } from "./assistant-evidence-authenticated-read.ts";
import { createBusinessOsDevMembershipChecker } from "./assistant-evidence-neon-dev-membership.ts";
import { createBusinessOsDevScopedEvidenceReader } from "./assistant-evidence-neon-dev-read.ts";
import type { MembershipTransaction } from "./assistant-evidence-neon-dev-membership.ts";
import type { BusinessOsReadTransaction } from "./assistant-evidence-neon-dev-read.ts";

type Claims = Readonly<Record<string, unknown>>;
type LiveContext = Readonly<{
  bearer: string; subjectId: string; clientId: string; tokenDigest: string;
}>;
export type OAuthVerifiedClaimsAdapter = (bearer: string) => Promise<unknown>;
export type OAuthLiveStatusAdapter = (context: LiveContext) => Promise<boolean>;
export type BusinessOsDevOAuthConfig = Readonly<{
  /** Exact Neon branch Auth base URL; must match the JWT iss. */
  issuer: string;
  /** The registered, absolute HTTPS MCP/API resource URL: JWT aud. */
  resource: string;
  /** Explicit owner-approved client IDs, not user-requested IDs. */
  allowedClientIds: readonly string[];
}>;
export type BusinessOsDevOAuthDependencies = Readonly<{
  config: BusinessOsDevOAuthConfig;
  /** A real owner-owned EdDSA JWT/JWKS verifier, NOT JWT decoding. */
  verifySignedAccessToken: OAuthVerifiedClaimsAdapter;
  /** Fresh authoritative revocation/status check, NOT a constant or local cache. */
  verifyLiveTokenStatus: OAuthLiveStatusAdapter;
  membershipTransaction: MembershipTransaction;
  evidenceTransaction: BusinessOsReadTransaction;
  now?: () => number;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER = /^[A-Za-z0-9._~+/-]+={0,2}$/;
const MAX_TTL_S = 3600;
function httpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.href === value;
  } catch { return false; }
}
function clientId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 &&
    (httpsUrl(value) || /^[A-Za-z0-9_.:-]{1,256}$/.test(value));
}
function verifiedClaims(value: unknown): value is Claims {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function audIncludes(aud: unknown, expected: string): boolean {
  return aud === expected ||
    (Array.isArray(aud) && aud.every(v => typeof v === "string") &&
      aud.includes(expected));
}
function unixTime(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

export function createBusinessOsDevOAuthVerifier(
  config: BusinessOsDevOAuthConfig,
  verifySignedAccessToken: OAuthVerifiedClaimsAdapter,
  verifyLiveTokenStatus: OAuthLiveStatusAdapter,
  now: () => number = Date.now,
) {
  if (!config || !httpsUrl(config.issuer) || !httpsUrl(config.resource) ||
      !Array.isArray(config.allowedClientIds) ||
      config.allowedClientIds.length === 0 ||
      !config.allowedClientIds.every(clientId) ||
      new Set(config.allowedClientIds).size !== config.allowedClientIds.length ||
      typeof verifySignedAccessToken !== "function" ||
      typeof verifyLiveTokenStatus !== "function" ||
      typeof now !== "function") {
    throw Error("Business OS DEV OAuth dependencies unavailable");
  }
  // Pin caller-owned configuration before any asynchronous token verification.
  // Mutating config later must never retarget the trusted issuer or resource.
  const expectedIssuer = config.issuer;
  const expectedResource = config.resource;
  const allowedClients = new Set(config.allowedClientIds);
  return async (bearer: string) => {
    if (typeof bearer !== "string" || bearer.length > 4096 ||
        !BEARER.test(bearer)) return null;
    try {
      // MUST be a server-owned cryptographic verifier. No decode-only claims.
      const v = await verifySignedAccessToken(bearer);
      const clock = now();
      if (!verifiedClaims(v) || !Number.isFinite(clock)) return null;
      // Snapshot all security-relevant claims exactly once. A provider adapter
      // must not be able to change the authorized principal between validation
      // and the subsequent asynchronous live-status check.
      const { iss, aud, sub, client_id, exp, nbf, iat, scope } = v;
      if (iss !== expectedIssuer || !audIncludes(aud, expectedResource) ||
          typeof sub !== "string" || !UUID.test(sub) ||
          !clientId(client_id) || !allowedClients.has(client_id) ||
          !unixTime(exp) || exp * 1000 <= clock ||
          exp * 1000 - clock > MAX_TTL_S * 1000 ||
          (nbf !== undefined && (!unixTime(nbf) || nbf * 1000 > clock)) ||
          (iat !== undefined && (!unixTime(iat) || iat * 1000 > clock ||
            iat > exp || exp - iat > MAX_TTL_S)) ||
          (scope !== undefined && typeof scope !== "string")) return null;
      // A JWT can remain valid despite logout or resource disablement.
      // An independent LIVE check is required on EVERY call, including the
      // handler's post-SQL verification. Until available, this MUST remain off.
      // Snapshot verified claims before awaiting the external live-status adapter.
      // The adapter must not be able to mutate the authorized principal.
      const subjectId = sub;
      const verifiedClientId = client_id;
      const expiryMillis = exp * 1000;
      const expiresAt = new Date(expiryMillis).toISOString();
      const tokenDigest = createHash("sha256").update(bearer).digest("hex");
      const active = await verifyLiveTokenStatus({
        bearer, subjectId, clientId: verifiedClientId, tokenDigest,
      });
      // The live-status check is asynchronous: expiry can occur while awaiting it.
      // Re-check the clock immediately before returning an authorized principal.
      const disclosureClock = now();
      if (active !== true || !Number.isFinite(disclosureClock) ||
          expiryMillis <= disclosureClock) return null;
      return Object.freeze({
        subjectId,
        sessionId: "oauth:" + tokenDigest,
        expiresAt,
      });
    } catch { return null; }
  };
}

/** Non-routed DEV-only alternative composition for a future approved OAuth host. */
export function createBusinessOsDevOAuthReadHandler(deps: BusinessOsDevOAuthDependencies) {
  if (!deps || typeof deps.membershipTransaction !== "function" ||
      typeof deps.evidenceTransaction !== "function") {
    throw Error("Business OS DEV OAuth dependencies unavailable");
  }
  const verifyBearerToken = createBusinessOsDevOAuthVerifier(
    deps.config, deps.verifySignedAccessToken, deps.verifyLiveTokenStatus, deps.now,
  );
  return createDevEvidenceReadHandler({
    verifyBearerToken,
    hasEvidenceReadGrant: createBusinessOsDevMembershipChecker(deps.membershipTransaction),
    listScopedReceipts: createBusinessOsDevScopedEvidenceReader(deps.evidenceTransaction),
    now: deps.now,
  });
}
