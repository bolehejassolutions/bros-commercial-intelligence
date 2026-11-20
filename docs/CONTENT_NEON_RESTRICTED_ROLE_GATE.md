# BROS CONTENT DEV acceptance and release handoff

Updated November 20, 2026. The customer site still serves the Supabase v3.6.1 application. Its 341,592 bytes matched the audited original, SHA-256 `0ba614cef9eb847a6d26a8fd375255de532a38492a0237d2361e6a49f41c91cd`. [Customer site](https://broscontent.bolehejas.com/) · [Audited original](https://drive.google.com/file/d/1ckDAWQJFsuyA6XRcYOptQgrPDWQi5rhT/view?usp=drivesdk)

## What works in disposable DEV

The integration starts from `371b2db4444982ae3e10ed13949807ac5cc29f61`, which includes the ownership fixes from #191. The submission route and deterministic output contracts were reconciled with the parallel #188/#190 work. The existing branches retain their history. [Integration base](https://github.com/bolehejassolutions/bros-commercial-intelligence/commit/371b2db4444982ae3e10ed13949807ac5cc29f61) · [Parallel submission work](https://github.com/bolehejassolutions/bros-commercial-intelligence/pull/190)

On disposable PostgreSQL, Chromium saves an authenticated campaign from the workspace, retries a lost submission acknowledgement and gets a single job. A restricted worker reads that draft and Business DNA, accepts an injected planner and review, and commits the seven layers and completion together. An independent connection reads back the data. The owner can reopen the output, see job history after signing in again, preview captions and download a scoped JSON handoff. Image and publication verification flags remain false in the export.

The local tests use synthetic identities and a deterministic planner transport. They cover duplicate requests, foreign tenants, revoked membership or ownership, stale leases, low-quality plans and rollback after a late child write. The checked-in visual fixture is separately verifiable. Both PNGs in `content-review-sources/sell-diagnosis-20261106` decoded at 1080 × 1350 and matched the manifest's file and RGB digests. No customer credits or external generation were used.

Run the repository workflow against a fresh disposable database. It provisions local-only roles, runs the suites sequentially and launches the real Next app in Chromium. [PostgreSQL workflow](../.github/workflows/content-postgres-integration.yml) · [Browser acceptance](../tests/browser/content-dev.browser.test.mjs)

## Run one job locally

Use Node 24 and the [disposable PostgreSQL setup](../.github/workflows/content-postgres-integration.yml). In the worker shell set `CONTENT_PG_INTEGRATION_CI=disposable_only` and `CONTENT_JOB_PLAN_DB_URL` to the fixture’s loopback login for `content_dev_job_plan_worker_v1`. Submit an empty draft through the local CONTENT workspace. Use the fixture tenant UUID and the job UUID from the submission receipt.

```sh
npm run content:dev-job -- "$tenant_id" "$job_id"
```

The bundled synthetic plan targets Instagram on day one. To use a different plan and its review, append a JSON file following the [fixture format](../scripts/fixtures/content-dev-reviewed-plan.json). Its platforms and plan dates must fit the saved draft. The command reads the saved brief and runs the existing reviewed worker once, using the supplied fixture as its planner transport. Reopen the campaign via **Sejarah penjanaan → Muatkan hasil kempen**.

On success the command prints a JSON receipt with `state=completed`. A completed replay or another unclaimable job returns `unavailable` and exits zero. An unsuccessful processing attempt exits one. Invalid arguments, fixture or target configuration exit two. Use campaign history to check the stored outcome.

## Hosted gate and rollback

Neon DEV project `empty-tooth-43040036`, branch `br-broad-math-b3f4d2r4`, has FORCE RLS on seven CONTENT tables. Direct restricted reader and draft-writer logins returned zero unscoped data. At inspection, generation jobs had zero hosted policies and the submitter, fixture worker and reviewed-plan worker roles were absent. The existing reader lacked SELECT on generation jobs. The approved scope covers disposable roles. Connected role changes, operator enrollment and any production switch require separate authorization.

The November 7 import matched the source cohort for one campaign, nine items and seven scenes. The aggregate eligibility check found one verified identity, two without a matching Neon identity and one with unverified source identity. It matched one workspace and all 17 historical campaign, item and scene rows through their parent chain. [Read-only import check](sql-proposals/CONTENT_DEV_IMPORT_LINEAGE_PREFLIGHT.sql) Current Supabase holds two campaigns, 16 items and 12 scenes. Refresh identity mapping and reconcile that delta before considering a cutover. [Materialization SQL](https://github.com/bolehejassolutions/bros-commercial-intelligence/commit/0469326195e8c7871cd68ef04fb2dd34ccd681b9)

For rollback before integration, close the draft. For a later DEV rollback, disable the Preview job flags and restore the previous DEV deployment. Original Supabase continues serving customers. The reviewed worker has no hosted scheduler. Authenticated hosted acceptance, live credit behavior and commercial release remain open.

## Related product handoff

- SELL keeps manual fulfillment for RM100. HitPay order 1008 and its charge were paid, but the accessible provider records lacked a signed per-order product line. The draft verifies buyer claim and protected book access in DEV. The canonical offline ZIP passed its 19-entry manifest and opened offline. HitPay marked the order fulfilled. The merchant receipt and the scoped business Sent search did not establish customer dispatch or download. [SELL #25 and CI](https://github.com/bolehejassolutions/bros-sell-web-os/pull/25) · [Offline release register](https://drive.google.com/file/d/1EgIuRaLBxmh9vMtg_khSIB5yi3eJ85C8/view)
- DEMAND can save a dated report with an operator's selected next action. Its approved pilot returned no rows for November 12–18. The historical control returned overlapping Meta purchase signals. Settled orders remain unknown. The protected alias serves the earlier #17 head. [DEMAND #192 and CI](https://github.com/bolehejassolutions/bros-commercial-intelligence/pull/192)
- BCI #40's scoped read adapter passed 189 contract tests and a separate disposable signed-session/SQL readback. Hosted OAuth and positive tenant readback remain open. The November 19 evening publishing receipt was rechecked against Buffer. Facebook and Instagram were sent, and TikTok recorded a media-URL error. [BCI #40](https://github.com/bolehejassolutions/bros-commercial-intelligence/pull/40) · [Publishing receipt](https://docs.google.com/spreadsheets/d/1P7lP7quZ8sJIs98bpzd2DaHwEnkRg6hxwBKdCqPewyU/edit#gid=1588529959&range=A294:M294)
