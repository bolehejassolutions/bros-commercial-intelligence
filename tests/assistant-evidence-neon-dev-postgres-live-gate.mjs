/**
 * Opt-in, local-only BROS Business OS restricted PostgreSQL integration gate.
 * Never run with admin/service_role connections or real customer identifiers.
 * Requires PRE-EXISTING independently restricted DEV logins and synthetic rows.
 * No schema/role/grant/policy changes, no HTTP routes, no data logging.
 *
 * Prerequisites: Node supporting TypeScript stripping, and locally installed
 * optional 'pg' driver. Do not add it to the application's runtime dependencies.
 * Set BOS_MEMBERSHIP_DSN, BOS_EVIDENCE_DSN, BOS_TEST_SUBJECT,
 * BOS_TEST_TENANT, BOS_OTHER_TENANT, BOS_EXPECTED_EVIDENCE_ID. All IDs must be synthetic UUIDs.
 * The synthetic subject must have an active CONTENT grant in BOS_TEST_TENANT;
 * no grant in BOS_OTHER_TENANT or DEMAND. At least one synthetic CONTENT\n * evidence row with BOS_EXPECTED_EVIDENCE_ID must exist in BOS_TEST_TENANT.\n * An empty authorized read is NOT sufficient to certify evidence integration.\n * No customer records.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createBusinessOsDevReadOnlyTransaction } from "../lib/bci/assistant-evidence-neon-dev-readonly-transaction.ts";
import { createBusinessOsDevMembershipChecker } from "../lib/bci/assistant-evidence-neon-dev-membership.ts";
import { createBusinessOsDevScopedEvidenceReader } from "../lib/bci/assistant-evidence-neon-dev-read.ts";

const required = ["BOS_MEMBERSHIP_DSN", "BOS_EVIDENCE_DSN",
  "BOS_TEST_SUBJECT", "BOS_TEST_TENANT", "BOS_OTHER_TENANT",\n  "BOS_EXPECTED_EVIDENCE_ID"];
if (required.some(k => !process.env[k])) {
  process.stderr.write("SKIP: restricted DEV connection and synthetic fixture inputs required.\n");
  process.exitCode = 2;
} else {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const k of required.slice(2)) assert.match(process.env[k]!, uuid);
  assert.notEqual(process.env.BOS_TEST_TENANT, process.env.BOS_OTHER_TENANT);
  assert.notEqual(process.env.BOS_MEMBERSHIP_DSN, process.env.BOS_EVIDENCE_DSN,
    "Readers must use separate direct restricted logins");
  const require = createRequire(import.meta.url);
  let Pg;
  try { Pg = require("pg"); }
  catch { throw new Error("Install pg locally for this opt-in integration gate"); }
  const { Pool } = Pg;
  const membershipPool = new Pool({
    connectionString: process.env.BOS_MEMBERSHIP_DSN,
    max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
    ssl: { rejectUnauthorized: true },
  });
  const evidencePool = new Pool({
    connectionString: process.env.BOS_EVIDENCE_DSN,
    max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
    ssl: { rejectUnauthorized: true },
  });
  try {
    const membership = createBusinessOsDevMembershipChecker(
      createBusinessOsDevReadOnlyTransaction(membershipPool));
    const evidence = createBusinessOsDevScopedEvidenceReader(
      createBusinessOsDevReadOnlyTransaction(evidencePool));
    const subject = process.env.BOS_TEST_SUBJECT!;
    const tenant = process.env.BOS_TEST_TENANT!;
    const other = process.env.BOS_OTHER_TENANT!;
    assert.equal(await membership(subject, { tenantId: tenant, product: "content" }), true);
    assert.equal(await membership(subject, { tenantId: tenant, product: "demand" }), false);
    assert.equal(await membership(subject, { tenantId: other, product: "content" }), false);
    const rows = await evidence({ tenantId: tenant, product: "content", maxRows: 20 });
    assert.ok(rows.length > 0 && rows.length <= 20,\n      "Positive synthetic evidence fixture is required; empty reads are inconclusive");\n    assert.ok(rows.some(row => row.evidenceId === process.env.BOS_EXPECTED_EVIDENCE_ID),\n      "Expected synthetic evidence must be returned from the authorized scope");
    assert.ok(rows.every(row => row.tenantId === tenant && row.product === "content"));
    const otherRows = await evidence({ tenantId: other, product: "content", maxRows: 20 });
    assert.equal(otherRows.length, 0, "Other tenant must have no synthetic evidence");
    const demandRows = await evidence({ tenantId: tenant, product: "demand", maxRows: 20 });
    assert.equal(demandRows.length, 0, "Other product must have no synthetic evidence");
    process.stdout.write("PASS: restricted role posture, membership and scoped evidence DEV gates.\n");
  } catch {
    // Never print driver errors, DSNs, rows or identifying scope.
    process.stderr.write("FAIL: restricted PostgreSQL integration gate; no access certified.\n");
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([membershipPool.end(), evidencePool.end()]);
  }
}
