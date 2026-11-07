import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// OFFLINE DESIGN CONTRACT ONLY. No Neon SQL, role grant, migration, provider
// attestation, signed-JWT access, or durable audit is performed by this test.
const sql = readFileSync(
  new URL("../neon/design/BCI_APPEND_ONLY_LINEAGE_DRAFT_20261027.sql", import.meta.url),
  "utf8",
);
const lineage = readFileSync(
  new URL("../lib/bci/internal-lineage.ts", import.meta.url), "utf8",
);
const planner = readFileSync(
  new URL("../lib/bci/audit-append-plan.ts", import.meta.url), "utf8",
);

function captured(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Missing ${label}; review contract before changing schema`);
  return match[1];
}
const sqlStages = captured(
  sql, /stage text NOT NULL CHECK \(stage IN \(([\s\S]*?)\)\)/,
  "SQL stage allowlist",
).match(/'[^']+'/g)?.map(s => s.slice(1, -1));
const tsStages = captured(
  lineage, /const stages: readonly BciLineageStage\[\] = \[([\s\S]*?)\];/,
  "lineage validator stage allowlist",
).match(/"[^"]+"/g)?.map(s => s.slice(1, -1));
const planStages = captured(
  planner, /const stages: readonly BciLineageStage\[\] = \[([\s\S]*?)\];/,
  "audit planner stage allowlist",
).match(/"[^"]+"/g)?.map(s => s.slice(1, -1));

test("draft SQL, shared validator and append planner preserve the same eight ordered stages", () => {
  const canonical = [
    "evidence", "signal", "case", "diagnosis",
    "decision", "action", "outcome", "learning",
  ];
  assert.deepEqual(sqlStages, canonical);
  assert.deepEqual(tsStages, canonical);
  assert.deepEqual(planStages, canonical);
});

test("draft SQL and shared validator preserve the same product scope", () => {
  const sqlProducts = captured(
    sql, /product text NOT NULL CHECK \(product IN \(([^)]*)\)\)/,
    "SQL product allowlist",
  ).match(/'[^']+'/g)?.map(s => s.slice(1, -1));
  const appProducts = captured(
    lineage, /export type BciLineageProduct = ([^;]+);/,
    "shared product allowlist",
  ).match(/"[^"]+"/g)?.map(s => s.slice(1, -1));
  assert.deepEqual(sqlProducts, ["content", "demand"]);
  assert.deepEqual(appProducts, sqlProducts);
  assert.equal((sql.match(/product text NOT NULL CHECK \(product IN/g) ?? []).length, 2);
});

test("draft remains untrusted, ungranted and isolated from deployed migrations", () => {
  assert.match(sql, /DESIGN ONLY\. NOT a migration/);
  assert.match(sql, /CHECK \(assertion_status = 'unverified'\)/);
  assert.match(planner, /incoming\.some\(record => record\.verification !== "unverified"\)/);
  assert.doesNotMatch(sql, /^\s*GRANT\b/im);
  assert.doesNotMatch(sql, /^\s*(?:CREATE|ALTER)\s+ROLE\b/im);
  for (const relation of ["lineage_nodes", "lineage_edges"]) {
    assert.match(sql, new RegExp(`ALTER TABLE bci_dev\\.${relation} FORCE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL ON bci_dev\\.${relation} FROM PUBLIC`));
  }
});

test("draft parent scoping and stage adjacency must remain enforced at the database layer", () => {
  assert.equal(
    (sql.match(/FOREIGN KEY \((?:parent_id|child_id), tenant_id, product\)/g) ?? []).length,
    2,
  );
  assert.match(sql, /edge_count <> cardinality\(target_node\.parent_ids\)/);
  assert.match(sql, /NOT \(e\.parent_id = ANY\(target_node\.parent_ids\)\)/);
  assert.match(sql, /p\.recorded_at > target_node\.recorded_at/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(lineage, /stages\.indexOf\(parent\.stage\) !== position - 1/);
});
