import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createBusinessOsDevEd25519AccessTokenVerifier } from "../lib/bci/assistant-evidence-neon-dev-ed25519.ts";

// Ephemeral, in-process signing keys; no real auth secrets or provider access.
const one = generateKeyPairSync("ed25519");
const two = generateKeyPairSync("ed25519");
const publicKey = (pair, kid) => ({ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "EdDSA", use: "sig" });
const pinned = publicKey(one, "dev-signing-1");
const claims = { iss: "https://issuer.example.test", aud: "https://dev.example.test/mcp", sub: "22222222-2222-4222-8222-222222222222", exp: 1799999999, client_id: "dev-client" };
function jwt(key = one.privateKey, header = { alg: "EdDSA", kid: pinned.kid, typ: "at+jwt" }, payload = claims) {
  const parts = [header, payload].map(v => Buffer.from(JSON.stringify(v)).toString("base64url"));
  return `${parts.join(".")}.${sign(null, Buffer.from(parts.join(".")), key).toString("base64url")}`;
}

test("a correctly signed, pinned EdDSA access token yields claims for the separate live-status gate", async () => {
  const verify = createBusinessOsDevEd25519AccessTokenVerifier([pinned], "at+jwt");
  assert.deepEqual(await verify(jwt()), claims);
});

test("signature or payload tampering, attacker key and unknown kid never yield claims", async () => {
  const verify = createBusinessOsDevEd25519AccessTokenVerifier([pinned], "at+jwt");
  const valid = jwt();
  const bits = valid.split(".");
  const tampered = { ...claims, sub: "33333333-3333-4333-8333-333333333333" };
  const foreign = jwt(two.privateKey);
  for (const token of [
    `${bits[0]}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${bits[2]}`,
    foreign,
    jwt(one.privateKey, { alg: "EdDSA", kid: "untrusted", typ: "at+jwt" }),
    `${bits[0]}.${bits[1]}.${bits[2].slice(0, -1)}Z`,
  ]) assert.equal(await verify(token), null);
});

test("reject algorithm confusion, ID tokens and token-supplied key/URL overrides", async () => {
  const verify = createBusinessOsDevEd25519AccessTokenVerifier([pinned], "at+jwt");
  for (const header of [
    { alg: "none", kid: pinned.kid, typ: "at+jwt" },
    { alg: "HS256", kid: pinned.kid, typ: "at+jwt" },
    { alg: "EdDSA", kid: pinned.kid, typ: "JWT" },
    { alg: "EdDSA", kid: pinned.kid, typ: "at+jwt", jwk: pinned },
    { alg: "EdDSA", kid: pinned.kid, typ: "at+jwt", jku: "https://attacker.test/jwks.json" },
    { alg: "EdDSA", kid: pinned.kid, typ: "at+jwt", crit: ["b64"] },
  ]) assert.equal(await verify(jwt(one.privateKey, header)), null);
});

test("reject noncanonical base64url, invalid JSON payload, malformed segments and overlong bearer", async () => {
  const verify = createBusinessOsDevEd25519AccessTokenVerifier([pinned], "at+jwt");
  const signed = jwt(), parts = signed.split(".");
  for (const token of [
    "", "a.b", "a.b.c.d", signed + "=", signed + ".extra",
    `${parts[0]}=.${parts[1]}.${parts[2]}`,
    "a".repeat(4097),
    jwt(one.privateKey, { alg: "EdDSA", kid: pinned.kid, typ: "at+jwt" }, []),
  ]) assert.equal(await verify(token), null);
});

test("pinset rejects duplicate, untrusted, private or non-verification key material", () => {
  const setup = keys => createBusinessOsDevEd25519AccessTokenVerifier(keys, "at+jwt");
  for (const keys of [
    [], [pinned, pinned], [{ ...pinned, d: "not-public" }],
    [{ ...pinned, use: "enc" }], [{ ...pinned, alg: "RS256" }],
    [{ ...pinned, key_ops: ["sign"] }], [{ ...pinned, x: "AA" }],
  ]) assert.throws(() => setup(keys), /signing keys unavailable/);
});

test("rotation uses only explicitly pinned public keys, never network or header-provided material", async () => {
  const second = publicKey(two, "dev-signing-2");
  const verify = createBusinessOsDevEd25519AccessTokenVerifier([pinned, second], "at+jwt");
  const secondToken = jwt(two.privateKey, { alg: "EdDSA", kid: second.kid, typ: "at+jwt" });
  assert.deepEqual(await verify(secondToken), claims);
  assert.equal(await createBusinessOsDevEd25519AccessTokenVerifier([pinned], "at+jwt")(secondToken), null);
});
