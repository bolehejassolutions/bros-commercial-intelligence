import test from "node:test";
import assert from "node:assert/strict";
import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/auth/vanilla/adapters";
import { requestNeonPreviewToken } from "../../lib/bci/neon-preview-client-token.ts";

// Actual installed SDK, synthetic transport only. No provider request, user
// session, OTP, credential or real JWT is used or displayed by this regression.
test("installed Neon SDK obtains a fresh token after getSession populated its cache", async t => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const syntheticToken = "offline.jwt.fixture";
  const session = {
    session: { id: "offline-session", userId: "11111111-1111-4111-8111-111111111111",
      token: "offline-session-token-not-a-jwt", expiresAt: new Date(Date.now() + 3600000).toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    user: { id: "11111111-1111-4111-8111-111111111111", name: "Offline fixture",
      email: "fixture@example.test", emailVerified: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };
  let tokenResponse = () => Response.json({ token: syntheticToken });
  globalThis.fetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, credentials: init?.credentials,
      forceHeaderSent: new Headers(init?.headers).has("X-Force-Fetch") });
    if (pathname.endsWith("/get-session")) return Response.json(session);
    if (pathname.endsWith("/token")) return tokenResponse();
    throw new Error("Unexpected offline test request");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = createAuthClient("https://offline.example.test/database/auth", {
    adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: "include" } }),
  });
  assert.ok((await client.getSession()).data?.session);
  const countAfterSession = calls.length;
  assert.equal(await requestNeonPreviewToken(client), syntheticToken);
  assert.equal(calls.length, countAfterSession + 1,
    "must make a /token request instead of accepting the SDK cached session shape");
  assert.deepEqual(calls.at(-1), {
    pathname: "/database/auth/token", credentials: "include", forceHeaderSent: false,
  }, "SDK-local force-fetch header must be removed before the provider request");

  await t.test("missing, empty and non-string token responses fail closed without session fallback", async () => {
    for (const data of [{}, { token: null }, { token: "" }, { token: 7 },
      { token: "x".repeat(16001) }, session]) {
      tokenResponse = () => Response.json(data);
      await assert.rejects(requestNeonPreviewToken(client), error => {
        assert.doesNotMatch(error.message, /offline-session|fixture@example|sensitive-provider-detail/);
        return true;
      });
      assert.equal(calls.at(-1).pathname, "/database/auth/token");
    }
  });

  await t.test("provider and transport errors reveal no provider details", async () => {
    for (const response of [
      () => Response.json({ code: "fixture_error", message: "sensitive-provider-detail" }, { status: 403 }),
      () => { throw new Error("sensitive-provider-detail"); },
    ]) {
      tokenResponse = response;
      await assert.rejects(requestNeonPreviewToken(client), error => {
        assert.doesNotMatch(error.message, /sensitive-provider-detail|fixture_error/);
        return true;
      });
    }
  });
});
