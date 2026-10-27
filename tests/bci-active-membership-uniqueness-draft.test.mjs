import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const draft = readFileSync(
  new URL("../neon/design/BCI_ONE_ACTIVE_MEMBERSHIP_PER_PRODUCT_DRAFT_20261027.sql", import.meta.url),
  "utf8",
);
const sql = draft.split("\n").filter(line => !/^\s*--/.test(line)).join("\n");

test("one-active-membership proposal is an unapplied DEV-only design with explicit approval", () => {
  assert.match(draft, /DESIGN ONLY\. NOT a migration\. DO NOT EXECUTE without separate owner approval/);
  assert.match(draft, /Never apply to Production or managed neon_auth/);
  assert.match(draft, /backup\/restore point/);
  assert.match(draft, /Separate owner approval required for rollback/);
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE|CREATE\s+ROLE|ALTER\s+ROLE|DROP\s+INDEX|UPDATE|DELETE|INSERT)\b/i);
  assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|SCHEMA|FUNCTION|TRIGGER)\b/i);
  assert.doesNotMatch(sql, /\bneon_auth\s*\./i);
});

test("DEV index prevents multiple concurrently active tenant assignments for same principal/product", () => {
  assert.match(sql, /CREATE UNIQUE INDEX bci_membership_one_active_tenant_per_product_idx\s+ON bci_dev\.tenant_memberships\s*\(principal_id, product\)\s*WHERE active IS TRUE AND revoked_at IS NULL/i);
  assert.doesNotMatch(sql, /UNIQUE INDEX IF NOT EXISTS/i);
  assert.doesNotMatch(sql, /\(principal_id,\s*tenant_id,\s*product\)/i);
  assert.match(sql, /GROUP BY principal_id, product\s+HAVING count\(\*\) > 1/i);
  assert.match(sql, /RAISE EXCEPTION 'Ambiguous active BCI product membership; abort'/);
});

test("DEV-only change uses bounded locking and one atomic transaction, no implicit commit", () => {
  assert.match(sql, /^BEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '20s';\s*LOCK TABLE bci_dev\.tenant_memberships IN SHARE MODE;/m);
  assert.equal((sql.match(/^BEGIN;$/gm)??[]).length,1);
  assert.equal((sql.match(/^COMMIT;$/gm)??[]).length,1);
  assert.ok(sql.indexOf("LOCK TABLE") < sql.indexOf("GROUP BY principal_id, product"));
  assert.ok(sql.indexOf("GROUP BY principal_id, product") < sql.indexOf("CREATE UNIQUE INDEX"));
  assert.ok(sql.indexOf("CREATE UNIQUE INDEX") < sql.indexOf("COMMIT;"));
});

test("existing membership reader still denies ambiguous grants before a database index is applied", () => {
  const reader = readFileSync(new URL("../lib/bci/neon-dev-membership-rows.ts",import.meta.url),"utf8");
  assert.match(reader, /ORDER BY tenant_id LIMIT 2/);
  assert.match(reader, /if \(found\.rows\.length > 1\) deny\(\)/);
  assert.match(reader, /revoked_at IS NULL/);
  assert.match(reader, /active IS TRUE/);
});
