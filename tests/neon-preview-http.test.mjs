import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createNeonDevMembershipLookup } from "../lib/bci/neon-dev-membership-rows.ts";
import { createNeonDevReadRows } from "../lib/bci/neon-dev-read-rows.ts";
import { createNeonPreviewHandler } from "../lib/bci/neon-preview-handler.ts";

// These exercise real Request/Response and signature verification with locally
// generated keys and synthetic DB rows. They are not hosted/provider JWT proof.
const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const EVIDENCE = "44444444-4444-4444-8444-444444444444";
const ISSUER = "https://auth.example.test";
const NOW = 1700000000;
const BRANCH = "feat/neon-bci-dev-ledger-20261025";
const key = generateKeyPairSync("ed25519");
const jwk = { ...key.publicKey.export({ format: "jwk" }),
  kid: "offline-preview", alg: "EdDSA", use: "sig" };
const enc = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(overrides = {}) {
  const payload = { iss: ISSUER, aud: ISSUER, sub: USER, iat: NOW - 20,
    exp: NOW + 300, email: "rasymokh@gmail.com", emailVerified: true,
    banned: false, ...overrides };
  const data = `${enc({ alg: "EdDSA", kid: jwk.kid, typ: "JWT" })}.${enc(payload)}`;
  return `${data}.${sign(null, Buffer.from(data), key.privateKey).toString("base64url")}`;
}
const grant = { principalId: USER, tenantId: TENANT, product: "content",
  active: true, revokedAt: null };
const evidence = { id: EVIDENCE, tenantId: TENANT, product: "content",
  provider: "manual", providerRecordKey: "offline-synthetic-only",
  metrics: { clicks: 0, purchases: null } };

function database(kind, rows, calls, error) {
  return async callback => {
    calls.push({ kind, step: "begin" });
    try {
      const result = await callback(async (sql, params) => {
        calls.push({ kind, sql, params });
        if (error) throw new Error(error);
        if (sql.includes("current_user AS role_name")) return { rows: [{
          role_name: kind === "membership" ? "bci_dev_membership_reader" : "bci_dev_private_reader",
          session_role_name: kind === "membership" ? "bci_dev_membership_reader" : "bci_dev_private_reader",
          bypass_rls: false, is_superuser: false, can_login: true,
          can_create_database: false, can_manage_roles: false,
          can_replicate: false, inherits_roles: false, parent_role_count: 0,
        }] };
        if (sql.includes("current_database() AS database_name")) return { rows: [{
          database_name: "bros_intelligence_dev", rls_enabled: true, rls_forced: true,
          can_read_memberships: kind === "membership", can_insert_memberships: false,
          can_update_memberships: false, can_delete_memberships: false,
          can_truncate_memberships: false,
          can_reference_memberships: false, can_trigger_memberships: false,
          can_maintain_memberships: false,
          can_read_evidence: kind === "evidence", can_insert_evidence: false,
          can_update_evidence: false, can_delete_evidence: false,
          can_truncate_evidence: false,
          can_reference_evidence: false, can_trigger_evidence: false,
          can_maintain_evidence: false,
          lineage_tables_readonly: true,
          can_create_schema_objects: false, can_create_database_objects: false,
          no_definer_exec: true, no_external_definer_exec: true, no_external_schema_create: true, no_external_table_access: true,
          other_bci_tables_denied: true,
        }] };
        if (sql.includes("set_config")) return { rows: [] };
        return { rows };
      });
      calls.push({ kind, step: "commit" });
      return result;
    } catch (error) {
      calls.push({ kind, step: "rollback" });
      throw error;
    }
  };
}

function harness({ env = {}, grants = [grant], rows = [evidence],
  membershipError, evidenceError, jwksError } = {}) {
  const calls = [];
  const verifierConfig = { issuer: ISSUER, audience: ISSUER,
    jwksUrl: `${ISSUER}/auth/.well-known/jwks.json`,
    approvedOperator: { email: "rasymokh@gmail.com" }, now: () => NOW,
    fetchJwks: async () => {
      calls.push({ kind: "jwks" });
      if (jwksError) throw new Error(jwksError);
      return { keys: [jwk] };
    },
  };
  const membershipsFor = createNeonDevMembershipLookup(database("membership", grants, calls, membershipError));
  const readRows = createNeonDevReadRows(database("evidence", rows, calls, evidenceError));
  const handler = createNeonPreviewHandler({ env: () => ({
    VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: BRANCH,
    BCI_NEON_DEV_PRIVATE_READS: "enabled", ...env,
  }), verifierConfig, membershipsFor, readRows });
  const request = (query = "product=content", jwt = token(), options = {}) => new Request(
    `https://preview.example.test/api/internal/neon-evidence?${query}`, {
      ...options, headers: { ...(jwt === null ? {} : { authorization: `Bearer ${jwt}` }),
        ...options.headers },
    });
  return { handler, request, calls };
}

async function denied(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("vary"), /Authorization/i);
  const raw = await response.text();
  assert.doesNotMatch(raw, /postgres|password|DATABASE_URL|rasymokh|11111111|secret-sentinel/i);
  if (status === 403) assert.deepEqual(JSON.parse(raw), {
    error: "BCI private evidence access denied.",
  });
  return raw;
}

test("HTTP Preview gate denies production, local, other branches and disabled flag before auth", async () => {
  for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { VERCEL_GIT_COMMIT_REF: "main" }, { BCI_NEON_DEV_PRIVATE_READS: "disabled" }]) {
    const f = harness({ env });
    await denied(await f.handler(f.request()), 404);
    assert.equal(f.calls.length, 0);
  }
});

test("HTTP missing, malformed, forged, expired and unverified identities never reach membership", async () => {
  const forged = token().split(".");
  forged[1] = enc({ iss: ISSUER, aud: ISSUER, sub: USER, iat: NOW - 20,
    exp: NOW + 300, email: "rasymokh@gmail.com", emailVerified: true, banned: false, extra: "tampered" });
  for (const jwt of [null, "not-a-jwt", forged.join("."), token({ exp: NOW }),
    token({ emailVerified: false }), token({ email: "bolehejassolutions@gmail.com" }),
    token({ email: undefined }), token({ sub: undefined }), token({ banned: true })]) {
    const f = harness();
    await denied(await f.handler(f.request("product=content", jwt)),
      jwt === null || jwt === "not-a-jwt" ? 401 : 403);
    assert.equal(f.calls.some(c => c.kind === "membership" || c.kind === "evidence"), false);
  }
});

test("HTTP rejects tenant/principal spoofing, unknown keys and duplicate/invalid query values before DB", async () => {
  for (const query of [`product=content&tenantId=${OTHER}`, `product=content&userId=${OTHER}`,
    "product=content&scope=all", "product=content&product=demand", "product=sell",
    "product=content&limit=0", "product=content&limit=51", "product=content&limit=1.5",
    "product=content&limit=2&limit=1"]) {
    const f = harness();
    await denied(await f.handler(f.request(query)), 400);
    assert.equal(f.calls.some(c => c.kind === "membership" || c.kind === "evidence"), false);
  }
});

test("HTTP rejects identity override headers and mutation methods before database work", async () => {
  for (const header of ["x-tenant-id", "x-user-id", "x-principal-id", "x-bci-tenant-id",
    "x-admin", "x-role", "x-product", "x-operator-id"]) {
    const f = harness();
    await denied(await f.handler(f.request("product=content", token(), {
      headers: { [header]: OTHER },
    })), 400);
    assert.equal(f.calls.length, 0);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const f = harness();
    await denied(await f.handler(f.request("product=content", token(), { method })), 405);
    assert.equal(f.calls.length, 0);
  }
});

test("HTTP missing, revoked, ambiguous, cross-user and cross-product memberships deny evidence", async () => {
  for (const grants of [[], [{ ...grant, active: false, revokedAt: "2026-10-26T00:00:00Z" }],
    [grant, { ...grant, tenantId: OTHER }], [{ ...grant, principalId: OTHER }],
    [{ ...grant, product: "demand" }]]) {
    const f = harness({ grants });
    await denied(await f.handler(f.request()), 403);
    assert.equal(f.calls.some(c => c.kind === "evidence"), false);
  }
});

test("HTTP valid signature and authoritative membership return only scoped synthetic evidence", async () => {
  const f = harness();
  const response = await f.handler(f.request("product=content&limit=1"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("vary"), /Authorization/i);
  const result = await response.json();
  assert.deepEqual(result.evidence, [evidence]);
  assert.equal(result.scope, "internal-development");
  const scope = f.calls.find(c => c.kind === "evidence" && c.sql?.includes("set_config"));
  assert.deepEqual(scope.params, [TENANT, "content"]);
  const lookup = f.calls.find(c => c.kind === "membership" && c.sql?.includes("ORDER BY tenant_id"));
  assert.deepEqual(lookup.params, [USER, "content"]);
});

test("HTTP aborts the entire response for cross-tenant, cross-product or duplicate evidence", async () => {
  for (const rows of [[{ ...evidence, tenantId: OTHER }],
    [{ ...evidence, product: "demand" }], [evidence, evidence]]) {
    const f = harness({ rows });
    await denied(await f.handler(f.request()), 403);
  }
});

test("HTTP refreshes membership on every read and denies after revocation without caching grants", async () => {
  const grants = [grant];
  const f = harness({ grants });
  assert.equal((await f.handler(f.request())).status, 200);
  grants.splice(0);
  await denied(await f.handler(f.request()), 403);
  assert.equal(f.calls.filter(c => c.kind === "evidence" && c.step === "begin").length, 1);
  assert.equal(f.calls.filter(c => c.kind === "membership" && c.step === "begin").length, 2);
});

test("HTTP masks provider, membership and evidence failures and never returns partial data", async () => {
  for (const options of [{ jwksError: "postgres://user:secret-sentinel@host/db" },
    { membershipError: "postgres://user:secret-sentinel@host/db" },
    { evidenceError: "postgres://user:secret-sentinel@host/db" }]) {
    const f = harness(options);
    const response = await f.handler(f.request());
    assert.ok(response.status >= 400);
    await denied(response, response.status);
  }
});

test("HTTP direct handler reuse rejects wrong paths and encoded route lookalikes before auth", async () => {
  for (const path of ["/api/internal/bci/evidence", "/api/internal/neon-evidence/",
    "/api/internal/%6eon-evidence", "/api/public/neon-evidence"]) {
    const f = harness();
    const request = new Request(`https://preview.example.test${path}?product=content`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    await denied(await f.handler(request), 400);
    assert.equal(f.calls.length, 0);
  }
});

test("HTTP 403 does not reveal whether identity, membership or evidence failed", async () => {
  const cases = [
    { options: {}, jwt: token({ exp: NOW }) },
    { options: { grants: [] }, jwt: token() },
    { options: { evidenceError: "secret-sentinel" }, jwt: token() },
  ];
  const envelopes = [];
  for (const item of cases) {
    const f = harness(item.options);
    const response = await f.handler(f.request("product=content", item.jwt));
    envelopes.push(await denied(response, 403));
  }
  assert.equal(new Set(envelopes).size, 1);
  assert.equal(envelopes[0], JSON.stringify({
    error: "BCI private evidence access denied.",
  }));
});
