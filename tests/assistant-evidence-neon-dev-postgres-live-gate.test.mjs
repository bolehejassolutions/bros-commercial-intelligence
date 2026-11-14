/** Offline safety checks for the opt-in restricted PostgreSQL DEV gate.
 * No database credentials, network access or pg dependency required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(dirname(fileURLToPath(import.meta.url)), "assistant-evidence-neon-dev-postgres-live-gate.mjs");
// Silence Node's typeless-package warning in isolated child processes only.
// Keep strict matching of the gate's own fail-closed diagnostic.
const safeEnv = { PATH: process.env.PATH || "", HOME: process.env.HOME || "", NODE_OPTIONS: "", NODE_NO_WARNINGS: "1" };

test("DEV PostgreSQL gate parses before any credentials are supplied", () => {
  const result = spawnSync(process.execPath, ["--check", script], {
    env: safeEnv, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, "DEV gate must be syntactically executable");
});

test("DEV PostgreSQL gate fails closed without all independent credentials and synthetic fixtures", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], {
    env: safeEnv, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 2, "Missing required DEV inputs must never certify integration");
  assert.match(result.stderr, /^SKIP: restricted DEV connection and synthetic fixture inputs required\.\n$/);
  assert.equal(result.stdout, "");
});

test("DEV PostgreSQL gate rejects malformed synthetic identifiers before loading pg", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], {
    env: {
      ...safeEnv,
      BOS_MEMBERSHIP_DSN: "synthetic-membership-not-a-dsn",
      BOS_EVIDENCE_DSN: "synthetic-evidence-not-a-dsn",
      BOS_TEST_SUBJECT: "not-a-uuid",
      BOS_TEST_TENANT: "00000000-0000-4000-8000-000000000001",
      BOS_OTHER_TENANT: "00000000-0000-4000-8000-000000000002",
      BOS_EXPECTED_EVIDENCE_ID: "00000000-0000-4000-8000-000000000003",
    }, encoding: "utf8", timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /synthetic-membership-not-a-dsn|synthetic-evidence-not-a-dsn/);
});
