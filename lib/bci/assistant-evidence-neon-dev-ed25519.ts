/**
 * BROS Business OS — offline, non-routed DEV Ed25519 access-token verification.
 *
 * This verifies a JWT signature against an explicit server-owned pinset of
 * public JWKs. Never fetch jku/jwk/x5u from a token or accept a key provided by
 * the caller. The pinset MUST come from independently authenticated issuer JWKS
 * discovery and must be refreshed/revoked by the future approved host.
 *
 * A valid signature is NOT a verified session: issuer, audience, client,
 * expiry and active/revoked status are enforced by the separate OAuth adapter.
 * No network, private key, token, route or provider activation is bundled.
 */
import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { KeyObject } from "node:crypto";

export type BusinessOsPinnedEd25519Key = Readonly<{
  kid: string;
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  alg?: "EdDSA";
  use?: "sig";
  key_ops?: readonly ["verify"];
}>;

const KID = /^[A-Za-z0-9_.:-]{1,256}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const KEY_FIELDS = new Set(["kid", "kty", "crv", "x", "alg", "use", "key_ops"]);
const HEADER_FIELDS = new Set(["alg", "kid", "typ"]);
const MAX_TOKEN_BYTES = 4096;

function canonicalBytes(input: unknown, maxBytes: number): Buffer | null {
  if (typeof input !== "string" || input.length > maxBytes * 2 ||
      !BASE64URL.test(input)) return null;
  const bytes = Buffer.from(input, "base64url");
  return bytes.length <= maxBytes && bytes.toString("base64url") === input ? bytes : null;
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function validKey(value: unknown): value is BusinessOsPinnedEd25519Key {
  if (!plainRecord(value) || Object.keys(value).some(field => !KEY_FIELDS.has(field)) ||
      typeof value.kid !== "string" || !KID.test(value.kid) ||
      value.kty !== "OKP" || value.crv !== "Ed25519" ||
      (value.alg !== undefined && value.alg !== "EdDSA") ||
      (value.use !== undefined && value.use !== "sig") ||
      (value.key_ops !== undefined && (!Array.isArray(value.key_ops) ||
        value.key_ops.length !== 1 || value.key_ops[0] !== "verify"))) return false;
  return canonicalBytes(value.x, 32)?.length === 32;
}

/**
 * The selected token type must be confirmed from the actual issuer before any
 * runtime wiring. Forbids confusing an ID token with a resource access token.
 */
export function createBusinessOsDevEd25519AccessTokenVerifier(
  pinnedPublicJwks: readonly BusinessOsPinnedEd25519Key[],
  expectedTokenType: "at+jwt" | "JWT",
): (bearer: string) => Promise<unknown> {
  if (!Array.isArray(pinnedPublicJwks) || pinnedPublicJwks.length < 1 ||
      pinnedPublicJwks.length > 16 ||
      (expectedTokenType !== "at+jwt" && expectedTokenType !== "JWT")) {
    throw Error("Business OS DEV signing keys unavailable");
  }
  const keys = new Map<string, KeyObject>();
  for (const jwk of pinnedPublicJwks) {
    if (!validKey(jwk) || keys.has(jwk.kid)) {
      throw Error("Business OS DEV signing keys unavailable");
    }
    try {
      // Pin a public KeyObject at construction, not mutable input objects.
      keys.set(jwk.kid, createPublicKey({
        format: "jwk", key: { kty: "OKP", crv: "Ed25519", x: jwk.x },
      }));
    } catch { throw Error("Business OS DEV signing keys unavailable"); }
  }
  return async bearer => {
    if (typeof bearer !== "string" || bearer.length < 1 ||
        Buffer.byteLength(bearer, "utf8") > MAX_TOKEN_BYTES) return null;
    const parts = bearer.split(".");
    if (parts.length !== 3) return null;
    const headerBytes = canonicalBytes(parts[0], 1024);
    const payloadBytes = canonicalBytes(parts[1], 3072);
    const signature = canonicalBytes(parts[2], 64);
    if (!headerBytes || !payloadBytes || !signature || signature.length !== 64) return null;
    try {
      const header: unknown = JSON.parse(headerBytes.toString("utf8"));
      if (!plainRecord(header) || Object.keys(header).some(field => !HEADER_FIELDS.has(field)) ||
          header.alg !== "EdDSA" || header.typ !== expectedTokenType ||
          typeof header.kid !== "string" || !KID.test(header.kid)) return null;
      const key = keys.get(header.kid);
      if (!key || !verifySignature(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) return null;
      const payload: unknown = JSON.parse(payloadBytes.toString("utf8"));
      return plainRecord(payload) ? Object.freeze(payload) : null;
    } catch { return null; }
  };
}
