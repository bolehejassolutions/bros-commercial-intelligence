import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createBusinessOsDevPinnedOAuthReadHandler } from "../lib/bci/assistant-evidence-neon-dev-oauth.ts";

// Synthetic, in-memory keys, principal, tenant and receipts; no real IdP/Neon.
const pair = generateKeyPairSync("ed25519");
const attacker = generateKeyPairSync("ed25519");
const publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "dev-test-1", alg: "EdDSA", use: "sig" };
const issuer = "https://branch.neonauth.example.test/neondb/auth";
const resource = "https://dev.example.test/mcp";
const client = "https://client.example.test/metadata.json";
const subject = "22222222-2222-4222-8222-222222222222";
const tenant = "11111111-1111-4111-8111-111111111111";
const foreignTenant = "33333333-3333-4333-8333-333333333333";
const now = Date.parse("2026-11-15T00:00:00Z");
const claims = { iss: issuer, aud: [resource], sub: subject, client_id: client,
  exp: Math.floor(now / 1000) + 1200, iat: Math.floor(now / 1000) - 60 };
const url = (t = tenant, product = "demand") =>
  "https://dev.example.test/internal/dev/bros-business-os/evidence?tenant_id=" +
  t + "&product=" + product;
const bearerRequest = (token, t = tenant, product = "demand") =>
  new Request(url(t, product), { headers: { authorization: "Bearer " + token } });

function signedToken(payload = claims, key = pair.privateKey, kid = publicJwk.kid) {
  const header = { alg: "EdDSA", typ: "at+jwt", kid };
  const signed = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
  return signed + "." + sign(null, Buffer.from(signed), key).toString("base64url");
}

function fixture({ revocationOnSecond = false, noGrant = false, foreignReceipt = false,
  failLive = false } = {}) {
  let live = 0, membershipTransactions = 0, membershipGrants = 0, evidenceTransactions = 0;
  const membershipTransaction = async callback => {
    membershipTransactions++;
    return callback(async (sql, params) => {
      if (sql.includes("FROM pg_roles")) return { rows: [{
        role_name: "bci_dev_membership_reader", session_role_name: "bci_dev_membership_reader",
        bypass_rls: false, superuser: false, can_login: true, inherits_roles: false,
        can_manage_roles: false, can_create_database: false, can_replicate: false, parent_role_count: 0,
      }] };
      if (sql.includes("FROM pg_class")) return { rows: [{
        database_name: "bros_intelligence_dev", read_only_mode: "on",
        rls_enabled: true, rls_forced: true, can_read_membership: true,
        can_write_membership: false, can_access_evidence: false,
        can_create_schema_objects: false, can_create_database_objects: false,
        no_definer_exec: true, no_external_table_access: true,
      }] };
      if (sql.includes("set_config")) return { rows: [{
        principal_scope: params[0], tenant_scope: params[1], product_scope: params[2],
      }] };
      if (sql.includes("FROM bci_dev.tenant_memberships")) {
        membershipGrants++;
        if (noGrant || params[0] !== subject || params[1] !== tenant || params[2] !== "demand")
          return { rows: [] };
        return { rows: [{
          principal_id: params[0], tenant_id: params[1], product: params[2],
          active: true, revoked_at: null,
        }] };
      }
      throw Error("Unexpected membership query");
    });
  };
  const evidenceTransaction = async callback => {
    evidenceTransactions++;
    return callback(async (sql, params) => {
      if (sql.includes("FROM pg_roles")) return { rows: [{
        role_name: "bci_dev_private_reader", session_role_name: "bci_dev_private_reader",
        bypass_rls: false, is_superuser: false, can_login: true,
        can_create_database: false, can_manage_roles: false, can_replicate: false,
        inherits_roles: false, parent_role_count: 0,
      }] };
      if (sql.includes("FROM pg_class")) return { rows: [{
        database_name: "bros_intelligence_dev", read_only_mode: "on",
        rls_enabled: true, rls_forced: true, can_read_evidence: true,
        can_write_evidence: false, can_access_memberships: false,
        can_create_schema_objects: false, can_create_database_objects: false,
        no_definer_exec: true, no_external_table_access: true,
      }] };
      if (sql.includes("set_config")) return { rows: [{
        tenant_scope: params[0], product_scope: params[1],
      }] };
      if (sql.includes("FROM bci_dev.evidence")) {
        assert.deepEqual(params, [tenant, "demand", 20]);
        return { rows: [{
          evidenceId: "44444444-4444-4444-8444-444444444444",
          tenantId: foreignReceipt ? foreignTenant : tenant, product: "demand",
          provider: "manual", collectedAt: "2026-11-15T00:00:00.000Z",
          observedAt: "2026-11-15T00:00:00.000Z", windowStart: null, windowEnd: null,
          completeness: "unverified", metrics: { spend_myr: null },
        }] };
      }
      throw Error("Unexpected evidence query");
    });
  };
  const handler = createBusinessOsDevPinnedOAuthReadHandler({
    config: { issuer, resource, allowedClientIds: [client] },
    pinnedPublicJwks: [publicJwk], expectedTokenType: "at+jwt",
    verifyLiveTokenStatus: async ({ subjectId, clientId, tokenDigest }) => {
      live++;
      assert.equal(subjectId, subject);
      assert.equal(clientId, client);
      assert.match(tokenDigest, /^[0-9a-f]{64}$/);
      if (failLive) throw Error("PRIVATE_STATUS_FAILURE");
      return !(revocationOnSecond && live === 2);
    },
    membershipTransaction, evidenceTransaction, now: () => now,
  });
  return { handler, calls: () => ({ live, membershipTransactions, membershipGrants, evidenceTransactions }) };
}

test("signed JWT plus live status and two separate restricted SQL readers permits scoped, null-preserving receipt", async () => {
  const h = fixture();
  const token = signedToken();
  const response = await h.handler(bearerRequest(token));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.access, "read_only");
  assert.equal(body.receipts.length, 1);
  assert.equal(body.receipts[0].metrics.spend_myr, null);
  assert.ok(!JSON.stringify(body).includes(token));
  assert.deepEqual(h.calls(), { live: 2, membershipTransactions: 2, membershipGrants: 2, evidenceTransactions: 1 });
});

test("forged signatures, unknown signing keys and modified claims are denied before SQL or status", async () => {
  for (const token of [
    signedToken(claims, attacker.privateKey),
    signedToken(claims, attacker.privateKey, "unknown"),
    signedToken({ ...claims, sub: foreignTenant }, attacker.privateKey),
  ]) {
    const h = fixture();
    const response = await h.handler(bearerRequest(token));
    assert.equal(response.status, 401);
    assert.deepEqual(h.calls(), { live: 0, membershipTransactions: 0, membershipGrants: 0, evidenceTransactions: 0 });
  }
});

test("wrong signed issuer, audience or OAuth client are rejected before membership and evidence SQL", async () => {
  for (const bad of [
    { iss: "https://other-branch.example.test/auth" },
    { aud: "https://other-resource.example.test/mcp" },
    { client_id: "untrusted-client" },
  ]) {
    const h = fixture();
    assert.equal((await h.handler(bearerRequest(signedToken({ ...claims, ...bad })))).status, 401);
    assert.deepEqual(h.calls(), { live: 0, membershipTransactions: 0, membershipGrants: 0, evidenceTransactions: 0 });
  }
});

test("post-read live revocation blocks disclosure; revoked grant and wrong-scope requests never reach evidence SQL", async () => {
  const revoked = fixture({ revocationOnSecond: true });
  const response = await revoked.handler(bearerRequest(signedToken()));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(revoked.calls().evidenceTransactions, 1);
  assert.equal(revoked.calls().membershipGrants, 1);
  for (const req of [
    bearerRequest(signedToken()),
    bearerRequest(signedToken(), foreignTenant),
    bearerRequest(signedToken(), tenant, "content"),
  ]) {
    const h = fixture({ noGrant: req.url === url() });
    const result = await h.handler(req);
    assert.equal(result.status, 403);
    assert.equal(h.calls().evidenceTransactions, 0);
  }
});

test("a mis-scoped SQL row is a generic 503 rather than a misleading empty result", async () => {
  const h = fixture({ foreignReceipt: true });
  const response = await h.handler(bearerRequest(signedToken()));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "read_unavailable" });
});

test("live status errors fail closed and missing status or signing key prevents initialization", async () => {
  const h = fixture({ failLive: true });
  const response = await h.handler(bearerRequest(signedToken()));
  assert.equal(response.status, 401);
  assert.equal(h.calls().membershipTransactions, 0);
  assert.equal(h.calls().evidenceTransactions, 0);
  assert.throws(() => createBusinessOsDevPinnedOAuthReadHandler({
    config: { issuer, resource, allowedClientIds: [client] },
    pinnedPublicJwks: [], expectedTokenType: "at+jwt",
    verifyLiveTokenStatus: async () => true,
    membershipTransaction: async () => { throw Error("unused"); },
    evidenceTransaction: async () => { throw Error("unused"); },
  }), /signing keys unavailable/);
});
