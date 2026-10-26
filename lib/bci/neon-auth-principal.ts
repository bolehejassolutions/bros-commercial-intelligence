/**
 * Preview-only, server-side verification of Neon Auth JWT identity.
 * This is a verifier, NOT an HTTP route, tenant membership authority or DB login.
 * Only configure issuer/audience/JWKS from trusted server environment, never a request.
 */
import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";

export class NeonAuthIdentityDenied extends Error {
  constructor() { super("Neon Auth identity verification denied."); this.name = "NeonAuthIdentityDenied"; }
}

export type VerifiedNeonPrincipal = Readonly<{ userId: string; authenticated: true }>;
export type NeonAuthVerifierConfig = Readonly<{
  issuer: string;
  audience: string;
  jwksUrl: string;
  /** Internal Preview policy, configured by the server; never by a request. */
  approvedOperator?: Readonly<{
    email: "rasymokh@gmail.com";
    /** Defaults to Managed Better Auth's 15-minute token lifetime; may only tighten it. */
    maxTokenLifetimeSeconds?: number;
  }>;
  fetchJwks?: (url: string) => Promise<unknown>;
  now?: () => number;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw new NeonAuthIdentityDenied(); };
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const b64url = (v: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(v) || v.length % 4 === 1) deny();
  const bytes = Buffer.from(v, "base64url");
  if (bytes.toString("base64url") !== v) deny();
  return bytes;
};
const parse = (part: string): unknown => {
  if (part.length > 16384) deny();
  try { return JSON.parse(b64url(part).toString("utf8")); } catch { return deny(); }
};
const acceptedAlgorithms = new Set(["RS256", "ES256", "EdDSA"]);

/** Requires a cryptographically verified, time-valid JWT and a pinned issuer + audience. */
export function createNeonAuthPrincipalVerifier(config: NeonAuthVerifierConfig) {
  if (!config || typeof config.issuer !== "string" || !config.issuer ||
      typeof config.audience !== "string" || !config.audience ||
      typeof config.jwksUrl !== "string") deny();
  const operator = config.approvedOperator;
  const maxOperatorLifetime = operator?.maxTokenLifetimeSeconds ?? 900;
  if (operator !== undefined &&
      (!record(operator) || operator.email !== "rasymokh@gmail.com" ||
       !Number.isInteger(maxOperatorLifetime) ||
       maxOperatorLifetime < 1 || maxOperatorLifetime > 900)) deny();
  let endpoint: URL;
  try { endpoint = new URL(config.jwksUrl); } catch { return deny(); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || !endpoint.pathname.endsWith("/.well-known/jwks.json")) deny();
  const load = config.fetchJwks ?? (async (url: string) => {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > 65536) deny();
    const raw = await response.text();
    if (raw.length > 65536) deny();
    return JSON.parse(raw);
  });
  const clock = config.now ?? (() => Math.floor(Date.now() / 1000));

  return async (token: unknown): Promise<VerifiedNeonPrincipal> => {
    if (typeof token !== "string" || token.length > 16000) return deny();
    const parts = token.split(".");
    if (parts.length !== 3) deny();
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = parse(encodedHeader);
    const payload = parse(encodedPayload);
    if (!record(header)) return deny();
    if (!record(payload)) return deny();
    if (typeof header.kid !== "string" || !header.kid ||
        typeof header.alg !== "string" || !acceptedAlgorithms.has(header.alg) ||
        (header.typ !== undefined && header.typ !== "JWT") || header.crit !== undefined) deny();
    if (payload.iss !== config.issuer ||
        !(payload.aud === config.audience ||
          (Array.isArray(payload.aud) && payload.aud.includes(config.audience))) ||
        typeof payload.sub !== "string" || !uuid.test(payload.sub)) deny();
    // A future not-before claim is never valid, even within issuance clock-skew allowance.
    const now = clock();
    if (!Number.isFinite(now) || typeof payload.exp !== "number" ||
        !Number.isSafeInteger(payload.exp) || payload.exp <= now ||
        payload.exp > now + 86400 ||
        typeof payload.iat !== "number" || !Number.isSafeInteger(payload.iat) ||
        payload.iat > now + 60 || payload.iat > payload.exp ||
        (payload.nbf !== undefined &&
          (typeof payload.nbf !== "number" || !Number.isSafeInteger(payload.nbf) || payload.nbf > now))) deny();
    const verifiedSubject = payload.sub;
    if (typeof verifiedSubject !== "string") return deny();
    // Network failure is deny, never fall back to trusting decoded claims.
    let jwks: unknown;
    try { jwks = await load(endpoint.toString()); } catch { return deny(); }
    if (!record(jwks)) return deny();
    if (!Array.isArray(jwks.keys) || jwks.keys.length > 32) return deny();
    const keys = jwks.keys.filter((k: unknown) => record(k) && k.kid === header.kid);
    if (keys.length !== 1) deny();
    const key = keys[0] as Record<string, unknown>;
    if ((key.use !== undefined && key.use !== "sig") ||
        (key.alg !== undefined && key.alg !== header.alg) ||
        (key.key_ops !== undefined &&
          (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify")))) deny();
    if ((header.alg === "RS256" && key.kty !== "RSA") ||
        (header.alg === "ES256" && (key.kty !== "EC" || key.crv !== "P-256")) ||
        (header.alg === "EdDSA" && (key.kty !== "OKP" || key.crv !== "Ed25519"))) deny();
    let valid = false;
    try {
      const publicKey = createPublicKey({ key: key as JsonWebKey, format: "jwk" });
      const data = Buffer.from(`${encodedHeader}.${encodedPayload}`);
      const signature = b64url(encodedSignature);
      valid = header.alg === "EdDSA"
        ? verifySignature(null, data, publicKey, signature)
        : verifySignature("sha256", data,
            header.alg === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey,
            signature);
    } catch { return deny(); }
    if (!valid) deny();
    // Authorize only signed claims. A Neon project admin or matching email
    // without verified mailbox ownership is not an approved app identity.
    // JWT validity ends at exp; this does not replace live session revocation.
    if (operator && (payload.email !== operator.email ||
        payload.emailVerified !== true ||
        (payload.banned !== undefined && payload.banned !== false) ||
        (payload.exp as number) - (payload.iat as number) > maxOperatorLifetime)) deny();
    return Object.freeze({ userId: verifiedSubject, authenticated: true });
  };
}
