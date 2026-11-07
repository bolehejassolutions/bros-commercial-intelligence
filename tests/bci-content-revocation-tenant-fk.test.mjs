import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static migration guard only; real PostgreSQL FK rejection is separately
// required and is NOT established by CI, RLS, or a passing source test.
const migration = readFileSync(
  new URL("../neon/migrations/0009_dev_content_revocation_tenant_fk.sql", import.meta.url),
  "utf8",
);
test("revocation is linked to the same approval tenant and product", () => {
  assert.match(migration, /UNIQUE \(approval_id, tenant_id, product\)/);
  assert.match(migration, /FOREIGN KEY \(approval_id, tenant_id, product\)/);
  assert.match(migration, /REFERENCES bci_dev\.content_dispatch_approvals \(approval_id, tenant_id, product\)/);
  assert.match(migration, /ON DELETE RESTRICT/);
});
test("DEV-only additive migration preserves append-only and least privilege", () => {
  assert.match(migration, /DEV ONLY/);
  assert.match(migration, /AFTER migration 0008/);
  assert.equal((migration.match(/^ALTER TABLE /gm) ?? []).length, 2);
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT|GRANT|CREATE ROLE|ALTER ROLE|CREATE POLICY)\b/im);
  assert.match(migration, /not trusted approval issuance or authorization/);
});
