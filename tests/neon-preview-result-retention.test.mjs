import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/internal/neon-preview/sign-in-client.tsx", import.meta.url), "utf8");
const section = (begin, end) => {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && finish > start, "Expected Preview handler exists");
  return source.slice(start, finish);
};

test("authenticated HTTP and empty-tenant reports use distinct, in-memory status slots", () => {
  assert.match(source, /const \[httpCheckResult, setHttpCheckResult\] = useState<string \| null>\(null\)/);
  assert.match(source, /const \[tenantCheckResult, setTenantCheckResult\] = useState<string \| null>\(null\)/);
  assert.match(source, /aria-label="HTTP rejection check result"/);
  assert.match(source, /aria-label="Empty-tenant isolation result"/);
  assert.match(source, /step === "ready" && httpCheckResult !== null/);
  assert.match(source, /step === "ready" && tenantCheckResult !== null/);
});

test("each rerun clears only its own earlier PASS and retains explicit failed status", () => {
  const http = section("async function checkNegativeAccess()", "async function checkEmptyTenantIsolation()");
  const isolation = section("async function checkEmptyTenantIsolation()", "async function signOut()");
  assert.match(http, /setHttpCheckResult\(null\)/);
  assert.match(http, /setHttpCheckResult\(`Authenticated CONTENT\/DEMAND controls:/);
  assert.match(http, /setHttpCheckResult\("Preview HTTP rejection probes could not complete/);
  assert.doesNotMatch(http, /setTenantCheckResult\(/);
  assert.match(isolation, /setTenantCheckResult\(null\)/);
  assert.match(isolation, /setTenantCheckResult\(`Empty-tenant isolation smoke:/);
  assert.match(isolation, /setTenantCheckResult\("Empty-tenant isolation smoke could not complete/);
  assert.doesNotMatch(isolation, /setHttpCheckResult\(/);
});

test("sign-out clears both summaries; browser never persists credentials or responses", () => {
  const signout = section("async function signOut()", "return (");
  assert.match(signout, /setHttpCheckResult\(null\)/);
  assert.match(signout, /setTenantCheckResult\(null\)/);
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/);
  assert.doesNotMatch(source, /document\.cookie/);
  // Only the bounded, sanitized report summaries can be rendered.
  assert.doesNotMatch(source, /setHttpCheckResult\(token\)|setTenantCheckResult\(token\)/);
});
