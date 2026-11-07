# BCI DEV eight-stage durable audit — live schema gap (28 Oct 2026)

Checkpoint: `BCI_DEV_DURABLE_LINEAGE_SCHEMA_GAP_20261028_V1`

## Source of truth / scope
- Owner 25 Oct canonical decision and addendum: BCI is ONE private shared auditable core for CONTENT and DEMAND; no duplicate product backend.
- Existing Draft PR #10, Issue #11; Neon Free DEV project `empty-tooth-43040036`, branch `br-broad-math-b3f4d2r4`, database `bros_intelligence_dev`.
- Live, read-only `pg_catalog` schema inspection using provider connection `current_user=session_user=BROS`. This is **administrator catalog evidence**, not independent restricted LOGIN, RLS negative proof, or authenticated Preview E2E.

## Verified deployed tables (not proposed)
| table | scope-bearing columns / purpose | RLS | custom triggers |
| --- | --- | --- | --- |
| `bci_dev.tenant_memberships` | `principal_id, tenant_id, product, active, revoked_at` | enabled + forced | 0 |
| `bci_dev.evidence` | `id, tenant_id, product, provider, provider_record_key, observed_at, collected_at, metrics, facts, unknowns` | enabled + forced | 0 |
| `bci_dev.cases` | `id, tenant_id, product, case_key, status, created_at, updated_at` | enabled + forced | 0 |
| `bci_dev.case_evidence` | `case_id, evidence_id, tenant_id, product, linked_at` | enabled + forced | 0 |
| `bci_dev.proposals` | `id, case_id, tenant_id, product, hypothesis, proposed_action, proposed_success_metric, status, confidence` | enabled + forced | 0 |

The live `bci_dev` relation inventory contains **five** base tables. There are **no deployed** `bci_dev.lineage_nodes` or `bci_dev.lineage_edges` tables. No custom triggers exist on the five deployed tables. This proves a missing durable lineage storage substrate, not that application-layer validation or proposed migration files are absent. It does not prove the contents or row counts of any table.

## Missing proof / safe implementation order
1. **Draft only, not execute:** design additive `lineage_nodes` and `lineage_edges` schema for evidence → signal → case → diagnosis → decision → action → outcome → learning. Require stable tenant/product/identity scope, stage enum/check, source provenance and verification state, deterministic idempotency key, timestamp, parent linkage, and a tamper-evident append-only audit policy. Do not conflate an untrusted provider report with a provider-verified outcome.
2. Add offline migration/contract tests that reject cross-tenant/product edges, absent parents, unauthorized admin impersonation, duplicate/replayed IDs, stage skipping, forged verification, and attempted mutation. Passing tests alone is NOT deployment or authenticated proof.
3. **Approval gate:** any Neon DDL/migration, role grant/revoke, or change to credential policy requires explicit owner approval. Before that, keep schema design and tests in Draft PR only.
4. After approved DEV migration, independently verify restricted **password LOGIN** (not BROS `SET ROLE`), RLS negative SQL and real signed owner JWT hosted HTTP negative matrix on an exact-current-commit protected Preview. CI green and GUC filters alone do not satisfy this gate.
5. Only then test actual CONTENT and DEMAND tenant-safe reuse, authorized evidence→decision→action, provider-attested outcome, and durable learning with readback. Never manufacture SENT, purchases, attribution or verified outcomes.

## Release classification
All four INTERNAL V1 gates remain **OPEN**. This checkpoint is live schema/catalog preflight + implementation plan only. No Neon writes/DDL, migration, role changes, credential access, Vercel/alternate-host deployment, merge, paid upgrade, BROS SELL Full Publisher/other automation changes or BROS LABS.
