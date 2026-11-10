/** Offline regression: reject ambiguous DEV isolation fixtures before opening PostgreSQL. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(dirname(fileURLToPath(import.meta.url)), "assistant-evidence-neon-dev-postgres-live-gate.mjs");
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const c = "00000000-0000-4000-8000-000000000003";
const fixture = {
  PATH: process.env.PATH || "", HOME: process.env.HOME || "", NODE_OPTIONS: "", NODE_NO_WARNINGS: "1",
  BOS_MEMBERSHIP_DSN: "synthetic-membership-placeholder",
  BOS_EVIDENCE_DSN: "synthetic-evidence-placeholder",
  BOS_TEST_SUBJECT: a, BOS_TEST_TENANT: b, BOS_OTHER_TENANT: c,
  BOS_EXPECTED_EVIDENCE_ID: a,
};
function rejectBeforeDatabase(overrides) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], {
    env: { ...fixture, ...overrides }, encoding: "utf8", timeout: 10000,
  });
  assert.notEqual(result.status, 0, "Ambiguous isolation must never certify DEV access");
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /synthetic-(membership|evidence)-placeholder/);
  assert.doesNotMatch(result.stderr, /PASS: restricted role posture/);
  assert.doesNotMatch(result.stderr, /Install pg locally/, "Preflight must reject before driver load");
}

test("rejects identical synthetic tenant and cross-tenant scope", () => {
  rejectBeforeDatabase({ BOS_OTHER_TENANT: b });
});

test("rejects reused membership/evidence database login configuration", () => {
  rejectBeforeDatabase({ BOS_EVIDENCE_DSN: fixture.BOS_MEMBERSHIP_DSN });
});
