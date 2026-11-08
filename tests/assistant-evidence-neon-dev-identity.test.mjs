import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessOsDevIdentityVerifier } from "../lib/bci/assistant-evidence-neon-dev-identity.ts";

const P = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-08T12:00:00Z");
const issuer = "https://auth.example.test";
const audience = "bros-business-os-dev";
const session = {
  subjectId: P, sessionId: "session-1", issuer, audience,
  expiresAt: "2026-11-08T12:10:00Z", revoked: false,
};
const fixture = (override = {}, options = {}) => {
  let calls = 0;
  const verify = createBusinessOsDevIdentityVerifier(async bearer => {
    calls++;
    assert.equal(bearer, "opaque-token");
    if (options.throwError) throw Error("SECRET_IDP_INTERNAL");
    return options.empty ? null : { ...session, ...override };
  }, { issuer, audience }, () => options.now ?? NOW);
  return { verify, count: () => calls };
};

test("verified opaque bearer maps to UUID principal only, no raw session data", async () => {
  const f = fixture();
  assert.deepEqual(await f.verify("opaque-token"), { subjectId: P, sessionId: "session-1", expiresAt: session.expiresAt });
  assert.equal(f.count(), 1);
  assert.ok(!JSON.stringify(await f.verify("opaque-token")).includes("opaque-token"));
});

test("introspection is invoked for every verification, never cached", async () => {
  const f = fixture();
  assert.ok(await f.verify("opaque-token"));
  assert.ok(await f.verify("opaque-token"));
  assert.equal(f.count(), 2);
});

test("revoked, absent, invalid issuer/audience, subject, session and expiration fail closed", async () => {
  for (const change of [
    { revoked: true }, { issuer: "https://evil.example" },
    { audience: "other-app" }, { subjectId: "user-1" },
    { sessionId: "" }, { expiresAt: "2026-11-08T11:59:59Z" },
    { expiresAt: "not-a-date" }, { expiresAt: "2026-11-10T12:00:00Z" },
  ]) assert.equal(await fixture(change).verify("opaque-token"), null);
  assert.equal(await fixture({}, { empty: true }).verify("opaque-token"), null);
});

test("untrusted or malformed bearer is rejected before introspection", async () => {
  const f = fixture();
  for (const bearer of ["", "Bearer opaque-token", "abc def", "x".repeat(4097), null]) {
    assert.equal(await f.verify(bearer), null);
  }
  assert.equal(f.count(), 0);
});

test("IdP failure is a generic denial with no leaked diagnostics", async () => {
  const f = fixture({}, { throwError: true });
  assert.equal(await f.verify("opaque-token"), null);
  assert.equal(f.count(), 1);
});

test("clock drift and expired session deny", async () => {
  const f = fixture({}, { now: Date.parse("2026-11-08T12:10:00Z") });
  assert.equal(await f.verify("opaque-token"), null);
});

test("misconfigured verifier fails during construction", () => {
  for (const config of [
    { issuer: "http://insecure.example", audience },
    { issuer, audience: "" },
    { issuer, audience: "a b" },
  ]) assert.throws(() => createBusinessOsDevIdentityVerifier(async () => session, config));
});
