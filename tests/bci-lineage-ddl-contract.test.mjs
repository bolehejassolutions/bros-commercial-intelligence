import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static DESIGN contract only. These checks do NOT parse/execute PostgreSQL,
// verify restricted LOGIN, or prove an authenticated provider audit.
const ddl = readFileSync(
  new URL("../neon/design/BCI_APPEND_ONLY_LINEAGE_DRAFT_20261027.sql", import.meta.url),
  "utf8",
);
test("draft is isolated from migrations and cannot silently grant app access", () => {
  assert.match(ddl, /DESIGN ONLY\. NOT a migration/);
  assert.doesNotMatch(ddl, /^\s*GRANT\b/im);
  assert.doesNotMatch(ddl, /^\s*(?:CREATE|ALTER)\s+ROLE\b/im);
  assert.match(ddl, /REVOKE ALL ON bci_dev\.lineage_nodes FROM PUBLIC/);
  assert.match(ddl, /REVOKE ALL ON bci_dev\.lineage_edges FROM PUBLIC/);
});
test("both lineage relations are tenant/product scoped and forced RLS", () => {
  for (const table of ["lineage_nodes", "lineage_edges"]) {
    assert.match(ddl, new RegExp("CREATE TABLE bci_dev\\." + table));
    assert.match(ddl, new RegExp("ALTER TABLE bci_dev\\." + table + " FORCE ROW LEVEL SECURITY"));
    assert.match(ddl, new RegExp("ALTER TABLE bci_dev\\." + table + " ENABLE ROW LEVEL SECURITY"));
  }
  assert.equal((ddl.match(/FOREIGN KEY \((?:parent_id|child_id), tenant_id, product\)/g) ?? []).length, 2);
  assert.match(ddl, /UNIQUE \(tenant_id, product, stage, source_system, source_record_key\)/);
});
test("immutable parent set, strict predecessor stages and deferred commit checks", () => {
  assert.match(ddl, /parent_ids uuid\[\] NOT NULL/);
  assert.match(ddl, /CHECK \(\(stage = 'evidence'\) = \(cardinality\(parent_ids\) = 0\)\)/);
  assert.match(ddl, /edge_count <> cardinality\(target_node\.parent_ids\)/);
  assert.match(ddl, /NOT \(e\.parent_id = ANY\(target_node\.parent_ids\)\)/);
  assert.match(ddl, /p\.recorded_at > target_node\.recorded_at/);
  assert.equal((ddl.match(/DEFERRABLE INITIALLY DEFERRED/g) ?? []).length, 4);
  assert.equal((ddl.match(/BEFORE UPDATE OR DELETE OR TRUNCATE/g) ?? []).length, 2);
  assert.equal((ddl.match(/SECURITY INVOKER/g) ?? []).length, 2);
});
test("untrusted source cannot claim provider verification or persistent success", () => {
  assert.match(ddl, /CHECK \(assertion_status = 'unverified'\)/);
  assert.match(ddl, /no provider attestation or customer access/i);
  assert.match(ddl, /intentionally NOT\s*\n--\s*under neon\/migrations/);
});

test("draft rejects nonfinite timestamps and padded source identifiers before any DEV apply", () => {
  assert.match(ddl, /recorded_at timestamptz NOT NULL CHECK \(isfinite\(recorded_at\)\)/);
  for (const field of ["source_system", "source_record_key"]) {
    assert.match(ddl, new RegExp(field + " = btrim\\(" + field + "\\)"));
  }
});

test("both trigger functions explicitly revoke default PUBLIC EXECUTE", () => {
  for (const fn of ["reject_lineage_mutation", "check_lineage_integrity"]) {
    assert.match(ddl, new RegExp("REVOKE ALL ON FUNCTION bci_dev\\." + fn + "\\(\\) FROM PUBLIC"));
  }
  assert.equal((ddl.match(/REVOKE ALL ON FUNCTION bci_dev\./g) ?? []).length, 2);
  assert.doesNotMatch(ddl, /^\s*GRANT\s+EXECUTE\b/im);
});

test("draft PL/pgSQL trigger bodies close their dollar quotes before PUBLIC EXECUTE revocation", () => {
  // Static lexical guard only: PostgreSQL parsing/execution still requires a
  // separately authorized isolated DEV test, not a CI connection to Neon.
  assert.equal((ddl.match(/\bAS \$\$/g) ?? []).length, 2);
  assert.equal((ddl.match(/^\$\$;$/gm) ?? []).length, 2);
  assert.doesNotMatch(ddl, /^\$;$/gm);
  for (const fn of ["reject_lineage_mutation", "check_lineage_integrity"]) {
    const signature = `CREATE FUNCTION bci_dev.${fn}()`;
    const revoke = `REVOKE ALL ON FUNCTION bci_dev.${fn}() FROM PUBLIC;`;
    const begin = ddl.indexOf(signature);
    const end = ddl.indexOf(revoke, begin);
    assert.ok(begin >= 0 && end > begin, `${fn} function/revocation ordering`);
    const body = ddl.slice(begin, end);
    assert.match(body, /\bAS \$\$[\s\S]*\n\$\$;\s*$/);
    assert.equal((body.match(/\$\$/g) ?? []).length, 2);
  }
});
