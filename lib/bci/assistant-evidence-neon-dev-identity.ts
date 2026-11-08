/**
 * Private Business OS — non-routed DEV identity boundary.
 *
 * The injected introspector MUST be a trusted server-owned adapter to Neon
 * Auth's authenticated session verification/revocation endpoint. It must verify
 * the presented bearer cryptographically or via an authenticated IdP backchannel
 * BEFORE returning a result. No decode-only JWT, caller claims, cached membership,
 * client-supplied principal or unverified JWKS payload is acceptable.
 *
 * This module does not configure an IdP, issue tokens or register a route.
 */
export type VerifiedBusinessOsPrincipal = Readonly<{ subjectId: string; sessionId: string; expiresAt: string }>;
export type TrustedSession = Readonly<{
  subjectId: string;
  sessionId: string;
  issuer: string;
  audience: string;
  expiresAt: string;
  revoked: boolean;
}>;
export type TrustedIntrospection = (bearer: string) => Promise<TrustedSession | null>;
export type IdentityConfig = Readonly<{ issuer: string; audience: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER = /^[A-Za-z0-9._~+/-]+={0,2}$/;
const SAFE = /^[A-Za-z0-9_.:-]{1,256}$/;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

export function createBusinessOsDevIdentityVerifier(
  introspect: TrustedIntrospection,
  config: IdentityConfig,
  now: () => number = Date.now,
): (bearer: string) => Promise<VerifiedBusinessOsPrincipal | null> {
  if (typeof introspect !== "function" || !config ||
      typeof config.issuer !== "string" || !config.issuer.startsWith("https://") ||
      typeof config.audience !== "string" || !SAFE.test(config.audience) ||
      typeof now !== "function") throw Error("Business OS identity configuration unavailable");
  return async bearer => {
    if (typeof bearer !== "string" || bearer.length < 1 ||
        bearer.length > 4096 || !BEARER.test(bearer)) return null;
    try {
      // No caching: called again after SQL read to catch revocation.
      const session = await introspect(bearer);
      const clock = now();
      if (!session || typeof session !== "object" ||
          typeof session.subjectId !== "string" || !UUID.test(session.subjectId) ||
          typeof session.sessionId !== "string" || !SAFE.test(session.sessionId) ||
          session.issuer !== config.issuer || session.audience !== config.audience ||
          session.revoked !== false || typeof session.expiresAt !== "string" ||
          !Number.isFinite(clock)) return null;
      const expiry = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= clock ||
          expiry - clock > MAX_TTL_MS) return null;
      return Object.freeze({ subjectId: session.subjectId, sessionId: session.sessionId, expiresAt: session.expiresAt });
    } catch {
      // Fail closed; do not expose tokens, session identifiers or IdP diagnostics.
      return null;
    }
  };
}
