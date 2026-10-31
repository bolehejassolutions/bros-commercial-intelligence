import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createNeonAuthPrincipalVerifier, NeonAuthIdentityDenied } from "../lib/bci/neon-auth-principal.ts";

const issuer = "https://auth.example.test";
const audience = issuer;
const jwksUrl = issuer + "/auth/.well-known/jwks.json";
const userId = "11111111-1111-4111-8111-111111111111";
const owner = "rasymokh@gmail.com";
const now = 1793459000;
const keypair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keypair.publicKey.export({ format: "jwk" }), kid: "testkey", use: "sig", alg: "RS256" };
const claims = { iss: issuer, aud: audience, sub: userId, iat: now - 15, exp: now + 300, email: owner, emailVerified: true, banned: false };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(payload = claims) {
  const data = encode({ alg: "RS256", kid: "testkey", typ: "JWT" }) + "." + encode(payload);
  return data + "." + sign("sha256", Buffer.from(data), keypair.privateKey).toString("base64url");
}
function create(fetchJwks = async () => ({ keys: [jwk] })) {
  return createNeonAuthPrincipalVerifier({ issuer, audience, jwksUrl, now: () => now,
    approvedOperator: { email: owner }, fetchJwks });
}
test("optional JWT trace records fixed stages and unchanged approved principal result", async () => {
  const stages = [];
  const principal = await create()(token(), stage => stages.push(stage));
  assert.deepEqual(principal, { userId, authenticated: true });
  assert.deepEqual(stages, ["structure","claims","time","jwks","key","signature","operator","verified"]);
  for (const value of [token(), userId, owner, issuer]) assert.equal(stages.join(" ").includes(value), false);
  assert.deepEqual(await create()(token()), principal);
});
test("invalid JWT issuer/audience fails closed at claims without exposing token", async () => {
  const stages = [];
  await assert.rejects(create()(token({ ...claims, aud: "different" }), stage => stages.push(stage)), NeonAuthIdentityDenied);
  assert.equal(stages.at(-1), "claims");
  assert.equal(stages.join(" ").includes(userId), false);
});
test("invalid JWT signature fails closed at signature", async () => {
  const parts = token().split(".");
  const damaged = parts[0] + "." + parts[1] + "." + parts[2].slice(0, -3) + "AAA";
  const stages = [];
  await assert.rejects(create()(damaged, stage => stages.push(stage)), NeonAuthIdentityDenied);
  assert.equal(stages.at(-1), "signature");
});
test("provider JWKS failure fails closed at jwks", async () => {
  const stages = [];
  const verify = create(async () => { throw new Error("private"); });
  await assert.rejects(verify(token(), stage => stages.push(stage)), NeonAuthIdentityDenied);
  assert.equal(stages.at(-1), "jwks");
});
test("signed operator mismatch fails closed at operator", async () => {
  const stages = [];
  await assert.rejects(create()(token({ ...claims, emailVerified: false }), stage => stages.push(stage)), NeonAuthIdentityDenied);
  assert.equal(stages.at(-1), "operator");
});
test("expired signed token fails closed at time", async () => {
  const stages = [];
  await assert.rejects(create()(token({ ...claims, exp: now - 2 }), stage => stages.push(stage)), NeonAuthIdentityDenied);
  assert.equal(stages.at(-1), "time");
});
