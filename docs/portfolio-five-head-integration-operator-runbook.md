# Portfolio five-head disposable integration — operator runbook

Scope: Coordinator PR #16 only. No production deployment, provider mutation, secrets, or new services. The existing workflow is `.github/workflows/portfolio-current-head-merge-smoke.yml`, run history `41159931933`.

## Preconditions (read-first; no repeated audit)

1. Read the **latest attempt**, its conclusion, and its jobs. An empty job list with `startup_failure` is a GitHub Actions scheduling/startup condition, **not** a passing or failing application test.
2. Resolve the **full 40-character head SHA** of PR #10 (BCI), #14 (DEMAND read-only), #17 (DEMAND pilot), #15 (CONTENT), and #16 (Coordinator). Record the five-tuple.
3. Compare against the last **successfully attested** five-tuple, not merely the last requested rerun. A migration-only commit already applied in DEV is not by itself a reason to rerun runtime compatibility.
4. Do not start another run if an existing queued/in-progress attempt is testing the same tuple, or if a completed attempt already tested that tuple. A rerun of an old workflow attempt is **not** proof that it fetched newly changed heads until its `MERGE_ATTESTED` lines are inspected.

## Execution decision

- **No material worker change:** Do not rerun. Deliver a coordinator-owned implementation/test/runbook improvement on PR #16.
- **Material worker change + no matching attempt:** Use the existing workflow only once. Record the requested run/attempt ID and wait for provider-confirmed completion.
- **startup_failure / no jobs:** Do not claim test results, do not blindly rerun. Inspect GitHub Actions status, repository workflow availability, account Actions restrictions, concurrency and whether the job was ever allocated. Preserve the five-tuple and choose independent PR #16 work until scheduling is available.
- **Job failed with tests:** Capture only failing test names/errors and exact attested tuple. Route BCI issuer issues to #10, CONTENT SENT/learning to #15, and DEMAND identity/Meta/purchase issues to #17/#14. Do not patch worker-owned files in #16.
- **Job success:** Confirm five distinct `MERGE_ATTESTED branch=... sha=...` lines, conflict-free merge, Node + Neon SDK + TypeScript + Next gates. Report source compatibility only; do not call it authenticated E2E.

## Acceptance evidence schema

For each material delta record: UTC timestamp, exact branch and immutable SHA, workflow run URL + attempt + job ID, attested five-tuple, conclusion and test totals, changed operational gate, and remaining provider-backed gaps. A queued request or green unit test is not provider acceptance.

## Release separation

DEV Preview first. BCI signed admission/issuer, restricted approval and reservation, CONTENT-owned SENT/learning, and DEMAND real RM100 paid Purchase reconciliation plus verified Meta identities and PAUSED staging require authenticated provider readback. The approved DEMAND pilot may advance independently of CONTENT, but must not bypass these checks. No Production promotion, customer-data edits, Meta POST/spend, extra Vercel deployment, or schedule changes from this workflow.

## Recovery / handoff

If an Actions run has `startup_failure`, preserve the run URL and its empty jobs result; do not manufacture an attestation. Recheck the existing run after GitHub Actions scheduling recovers. Keep PRs draft until release authority and provider-backed acceptance exist. Avoid storing tokens, customer identifiers, or raw provider payloads in logs.
