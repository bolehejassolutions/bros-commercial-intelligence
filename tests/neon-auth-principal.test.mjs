import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createNeonAuthPrincipalVerifier, NeonAuthIdentityDenied } from "../lib/bci/neon-auth-principal.ts";

const ISSUER = "https://auth.example.test/auth";
const AUD = "bci-preview";
const URL = "https://auth.example.test/auth/.well-known/jwks.json";
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = 1700000000;
const pairs = {
  RS256: generateKeyPairSync("rsa", { modulusLength: 2048 }),
  ES256: generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
  EdDSA: generateKeyPairSync("ed25519"),
};
const enc = x => Buffer.from(JSON.stringify(x)).toString("base64url");
function jwt(alg="RS256", overrides={}, headerOverrides={}) {
  const pair = pairs[alg];
  const header = { alg, typ: "JWT", kid: `test-${alg}`, ...headerOverrides };
  const claims = { iss: ISSUER, aud: AUD, sub: USER, iat: NOW-20, exp: NOW+300, ...overrides };
  const body = `${enc(header)}.${enc(claims)}`;
  const signature = sign(alg === "EdDSA" ? null : "sha256", Buffer.from(body),
    alg === "ES256" ? { key: pair.privateKey, dsaEncoding: "ieee-p1363" } : pair.privateKey);
  return `${body}.${signature.toString("base64url")}`;
}
function verifier({ keys = Object.entries(pairs).map(([alg, pair]) => ({ ...pair.publicKey.export({ format: "jwk" }), kid: `test-${alg}`, use: "sig", alg })), fetchJwks, ...opts }={}) {
  return createNeonAuthPrincipalVerifier({ issuer: ISSUER, audience: AUD, jwksUrl: URL,
    now: () => NOW, fetchJwks: fetchJwks ?? (async () => ({ keys })), ...opts });
}
const denied = NeonAuthIdentityDenied;
test("accepts valid pinned RS256, ES256 and EdDSA signatures", async () => {
  for (const alg of Object.keys(pairs)) assert.deepEqual(await verifier()(jwt(alg)), { userId: USER, authenticated: true });
});
test("rejects unsigned, malformed, tampered and mismatched key tokens", async () => {
  const good = jwt();
  const tampered = good.split("."); tampered[1] = enc({ iss: ISSUER, aud: AUD, sub: USER, iat: NOW-20, exp: NOW+900 });
  for (const token of ["", "abc", "a.b.c", good+".extra", tampered.join("."), jwt("RS256", {}, { kid: "unknown" }), jwt("RS256", {}, { alg: "none" })]) {
    await assert.rejects(verifier()(token), denied);
  }
});
test("rejects expired, not-yet-valid, missing audience and wrong issuer", async () => {
  for (const claims of [{ exp: NOW }, { nbf: NOW+100 }, { iat: NOW+200 },
    { aud: "other" }, { iss: "https://evil.test" }, { sub: "attacker" }, { exp: NOW+90000 }]) {
    await assert.rejects(verifier()(jwt("RS256", claims)), denied);
  }
});
test("rejects duplicate kid, wrong key algorithm and JWKS retrieval failures", async () => {
  const rsa = pairs.RS256.publicKey.export({ format: "jwk" });
  const key = { ...rsa, kid: "test-RS256", alg: "RS256" };
  await assert.rejects(verifier({ keys: [key, key] })(jwt()), denied);
  await assert.rejects(verifier({ keys: [{ ...key, alg: "ES256" }] })(jwt()), denied);
  await assert.rejects(verifier({ fetchJwks: async () => { throw new Error("offline"); } })(jwt()), denied);
});
test("rejects unsafe JWKS source before fetching", () => {
  for (const url of ["http://auth.example.test/auth/.well-known/jwks.json", "https://user:pass@auth.example.test/.well-known/jwks.json", "https://auth.example.test/other"]) {
    assert.throws(() => verifier({ jwksUrl: url }), denied);
  }
});
