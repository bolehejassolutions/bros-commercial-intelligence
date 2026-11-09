import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import {
  createBusinessOsDevOAuthVerifier,
  createBusinessOsDevOAuthReadHandler,
} from "../lib/bci/assistant-evidence-neon-dev-oauth.ts";

const issuer = "https://branch.neonauth.example.test/neondb/auth";
const resource = "https://private.example.test/mcp";
const client = "https://approved-client.example.test/metadata.json";
const otherClient = "https://unapproved-client.example.test/client.json";
const sub = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-09T08:00:00Z");
const EXP = Math.floor(NOW / 1000) + 1200;
const config = { issuer, resource, allowedClientIds: [client] };
const claims = (overrides = {}) => ({
  iss: issuer, aud: [resource, issuer + "/oauth2/userinfo"], sub,
  client_id: client, scope: "openid", exp: EXP, iat: Math.floor(NOW / 1000) - 60,
  ...overrides,
});
function harness(overrides = {}) {
  let verified = 0, live = 0;
  const verifySignedAccessToken = async () => {
    verified++;
    if (overrides.failVerify) throw Error("SIGNED_TOKEN_PROVIDER_SECRET");
    return overrides.claims ?? claims();
  };
  const verifyLiveTokenStatus = async () => {
    live++;
    if (overrides.failLive) throw Error("STATUS_PROVIDER_SECRET");
    return overrides.active ?? true;
  };
  const verifyToken = createBusinessOsDevOAuthVerifier(
    config, verifySignedAccessToken, verifyLiveTokenStatus,
    () => overrides.now ?? NOW,
  );
  return { verifyToken, counts: () => ({ verified, live }) };
}

test("mapped principal has stable fingerprint, no credential disclosure, live status checked each time", async () => {
  const h = harness();
  const one = await h.verifyToken("fixture.jwt.signature");
  const two = await h.verifyToken("fixture.jwt.signature");
  assert.equal(one.subjectId, sub);
  assert.equal(two.sessionId, one.sessionId);
  assert.equal(one.sessionId,
    "oauth:" + createHash("sha256").update("fixture.jwt.signature").digest("hex"));
  assert.equal(one.expiresAt, new Date(EXP * 1000).toISOString());
  assert.ok(!JSON.stringify(one).includes("fixture.jwt.signature"));
  assert.deepEqual(h.counts(), { verified: 2, live: 2 });
});

test("real ephemeral EdDSA signature verification: signed claims pass, tampered and unsigned claims deny", async () => {
  // This is an isolated test key, NOT Neon Auth's JWKS or a genuine login.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims())).toString("base64url");
  const signed = header + "." + payload;
  const signature = sign(null, Buffer.from(signed), privateKey).toString("base64url");
  const token = signed + "." + signature;
  const cryptographicVerifier = async bearer => {
    const [h, p, s] = bearer.split(".");
    if (!h || !p || !s || !verify(null, Buffer.from(h + "." + p), publicKey,
      Buffer.from(s, "base64url"))) return null;
    const headerObject = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    if (headerObject.alg !== "EdDSA") return null;
    return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  };
  const check = createBusinessOsDevOAuthVerifier(config, cryptographicVerifier,
    async () => true, () => NOW);
  assert.equal((await check(token))?.subjectId, sub);
  assert.equal(await check(token.replace(payload, Buffer.from(
    JSON.stringify(claims({ sub: "22222222-2222-4222-8222-222222222222" }))
  ).toString("base64url"))), null);
  assert.equal(await check(header + "." + payload + "." + "A".repeat(86)), null);
});

test("shared signing keys cannot make tokens from another branch or resource valid", async () => {
  for (const bad of [
    { iss: "https://parent.neonauth.example.test/neondb/auth" },
    { aud: "https://some-other.example.test/mcp" },
    { aud: ["https://some-other.example.test/mcp"] },
    { aud: [resource, 123] },
    { aud: [] },
  ]) {
    const h = harness({ claims: claims(bad) });
    assert.equal(await h.verifyToken("fixture.jwt.signature"), null);
    assert.deepEqual(h.counts(), { verified: 1, live: 0 });
  }
});

test("explicit client allowlist is independent of JWT scope and product grant", async () => {
  for (const bad of [
    { client_id: otherClient }, { client_id: null }, { client_id: "" },
    { client_id: "../admin" }, { sub: "someone-not-a-uuid" },
    { scope: ["openid"] },
  ]) {
    const h = harness({ claims: claims(bad) });
    assert.equal(await h.verifyToken("fixture.jwt.signature"), null);
    assert.equal(h.counts().live, 0);
  }
  // Managed Better Auth currently exposes fixed OAuth scopes; evidence:read
  // must be established by a *separate* authoritative product membership.
  const good = harness({ claims: claims({ scope: "openid profile" }) });
  assert.ok(await good.verifyToken("fixture.jwt.signature"));
});

test("expiry, not-before, future issuance, oversized TTL and invalid clock deny", async () => {
  const now = Math.floor(NOW / 1000);
  for (const change of [
    { exp: now }, { exp: now - 1 }, { exp: now + 3601 },
    { exp: "future" }, { exp: 99999999999999 },
    { nbf: now + 1 }, { nbf: "future" },
    { iat: now + 1 }, { iat: null },
  ]) assert.equal(await harness({ claims: claims(change) }).verifyToken("fixture.jwt.signature"), null);
  assert.equal(await harness({ now: NaN }).verifyToken("fixture.jwt.signature"), null);
});

test("live revocation is mandatory and errors never become accepted sessions", async () => {
  for (const opts of [{ active: false }, { failLive: true }, { failVerify: true }]) {
    const h = harness(opts);
    assert.equal(await h.verifyToken("fixture.jwt.signature"), null);
  }
  assert.throws(() => createBusinessOsDevOAuthVerifier(config, async () => claims(), null));
});

test("invalid dependencies, untrusted client IDs or non-HTTPS resource fail at construction", () => {
  const f = async () => claims();
  const active = async () => true;
  for (const bad of [
    { ...config, allowedClientIds: [] },
    { ...config, allowedClientIds: [client, client] },
    { ...config, allowedClientIds: [otherClient + "#x"] },
    { ...config, issuer: "https://auth.example.test?x=1" },
    { ...config, resource: "http://localhost/mcp" },
    { ...config, resource: "https://user:pw@example.test/mcp" },
  ]) assert.throws(() => createBusinessOsDevOAuthVerifier(bad, f, active));
});

test("malformed bearer rejected before any verifier or status call", async () => {
  const h = harness();
  for (const bearer of ["", "Bearer abc", "with spaces", "..bad token", "x".repeat(4097), null]) {
    assert.equal(await h.verifyToken(bearer), null);
  }
  assert.deepEqual(h.counts(), { verified: 0, live: 0 });
});

test("non-routed HTTP OAuth composition denies revoked token BEFORE either restricted SQL transaction", async () => {
  let memberships = 0, evidence = 0;
  const handler = createBusinessOsDevOAuthReadHandler({
    config,
    now: () => NOW,
    verifySignedAccessToken: async () => claims(),
    verifyLiveTokenStatus: async () => false,
    membershipTransaction: async () => { memberships++; throw Error("must not run"); },
    evidenceTransaction: async () => { evidence++; throw Error("must not run"); },
  });
  const url = "https://dev.example.test/internal/dev/bros-business-os/evidence?tenant_id=" +
    sub + "&product=demand";
  const response = await handler(new Request(url, {
    headers: { authorization: "Bearer fixture.jwt.signature" },
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(memberships, 0);
  assert.equal(evidence, 0);
});
