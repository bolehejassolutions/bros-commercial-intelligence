# BCI isolated deployment & Meta read-only onboarding

Status (2026-10-09 MY): **dedicated Supabase project created; schema deployed; Vercel preview and production builds READY behind SSO.** This runbook records the earlier read-only phase. The later Campaign Studio source is described in [CAMPAIGN_STUDIO_RELEASE.md](CAMPAIGN_STUDIO_RELEASE.md). Current continuation: first-pilot cap RM100 is recorded in Vercel; Meta app selection and server credentials remain pending. Local credential preflight is documented in [META_DEVELOPER_CONNECTION.md](META_DEVELOPER_CONNECTION.md), and has not been deployed by this continuation. Manual ingestion remains inactive until live credentials and the protected operator flow pass verification.

## Verified infrastructure state (9 October 2026)

- Supabase: **BROS Commercial Intelligence** / `guviwsclpiiqepctedsq` / Singapore (`ap-southeast-1`) / `ACTIVE_HEALTHY`. New project cost confirmation: 0/month on the existing Free organization; this does not imply future usage cannot incur costs on a changed plan.
- Migrations applied: `bci_core_initial_schema` (source `0001_bci_core.sql`), `bci_operator_members_and_meta_snapshots` (source `0003_bci_operator_members_and_meta_snapshots.sql`). **Legacy `0002` not applied.**
- All 13 BCI public tables have row-level security enabled and deny anonymous SELECT. `bci_operator_members` has no client policies/grants intentionally; the membership checker is a limited authenticated boolean `SECURITY DEFINER` RPC.
- Supabase Auth BCI operators: **1 verified administrator enrolled** following explicit account-owner approval. No account email, UUID or password is stored in this repository. Meta snapshots: **0 stored**.
- Vercel: `bros-commercial-intelligence` / project ID `prj_kawa3Vo7voUzAFdSfR8DWbHXy8Nw`. Team SSO protection: **all deployments**.
- Vercel `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: configured across production, preview, development; the key is encrypted in Vercel. No service-role credential provisioned.
- Protected production build `dpl_9LMLqpbKbKzTXT9iaAehtK9CXfF5`: `READY`, app code commit `09eece43319069fef36d3f13ca70eec9817d334f`. Protected preview `dpl_AA3kxk1Tz4b3eBjyMog5LtvDzfDu`: `READY`.
- CI on read-only integration: 15 automated tests passed, TypeScript and Next.js production build passed.
- **Access tests passed:** inside rollback-only SQL transactions, simulated authenticated JWT claims gave the enrolled administrator permission to read/insert BCI cases and Meta snapshots, while a non-member could not read the inserted records or insert new ones. Test records were rolled back; no cases or advertising snapshots remain. These database tests are not a substitute for a real browser sign-in test.
- **Not yet verified:** interactive sign-in with an actual BCI operator, private Meta data refresh, settled-order reconciliation. There is no scheduled ingestion or Meta write integration.
- Provider token `META_ADS_READ_TOKEN`: **not set**. Do not reuse third-party ChatGPT connector sessions/tokens as standalone server credentials.


## Boundary

- Dedicated **BROS Commercial Intelligence** Supabase project; do not reuse the customer-facing BROS SELL Web OS project.
- GitHub repository `bolehejassolutions/bros-commercial-intelligence`.
- Dedicated Vercel project `bros-commercial-intelligence`. All environments must use Vercel Authentication SSO protection (not merely app login).
- MYR / BROS SELL™ Malaysia, account allowlist `act_1997776120879476`.
- No `ads_management`, no Meta write functions, no automatic budget changes, no spend authority.
- No automatic scheduling in this phase. Manual authenticated refresh is the only request trigger.

## Database migration sequence

**Do not apply `0002_lock_down_bci_access.sql` in a newly provisioned BCI database.** It contains a historical user UUID and is superseded. Apply, in order:

1. `0001_bci_core.sql`
2. `0003_bci_operator_members_and_meta_snapshots.sql`

The second migration creates a verified-operator ACL, replaces all core RLS policies, and creates the Meta snapshot table with RLS. The public RPC `is_bci_operator()` returns only whether the logged-in user is a verified member.

**Applied to the isolated project.** This list is a reproducible baseline for new installations, not instructions to re-run it in production.

### Membership enrollment

An administrator must verify the identity and Supabase Auth user ID of the intended internal operator. Only then, from the protected SQL editor using owner privileges, execute:

```sql
insert into public.bci_operator_members (user_id, role, active)
values ('<VERIFIED_AUTH_USER_UUID>'::uuid, 'admin', true)
on conflict (user_id) do update set active = true;
```

Do not insert the historic UUID from `0002`; do not enroll users by public signup, guesswork, organization email string, or GitHub identity. SQL database membership is an **account-permission change** and must only be made with explicit user approval for the verified operator.

Until enrollment, Supabase sign-in may succeed but the app redirects to `/access-denied`; RLS denies app and snapshot data.

## Vercel environment variables

Set via the Vercel dashboard / encrypted environment store, never in source:

- `NEXT_PUBLIC_SUPABASE_URL` — API URL of the dedicated BCI Supabase instance.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — publishable key of that same instance.
- `META_ADS_READ_TOKEN` — *server-only* Meta Graph API access token with minimal ads_read access to the approved account. **Do not configure it until the credential source, issuance and revocation path have been verified.**
- `META_APP_ID` and `META_APP_SECRET` — private configuration for the verified existing Meta app and server-side token introspection. Never guess the app from its name or paste its secret into chat. The local preflight also verifies its business link.
- `NODE_ENV` — provided automatically.

The Meta token is never exposed by Next.js to the browser. No service-role key or Meta write scope is required for manual read-only ingestion.

## Read-only ingestion contract

- `GET /api/operator/meta`: authenticated, enrolled operators can inspect up to 20 recent saved snapshots.
- `POST /api/operator/meta`: same-origin request + authenticated, enrolled operator + present server-side token. Uses a GET request to the fixed Meta account's Insights endpoint for **yesterday in Asia/Kuala_Lumpur**. Inserts or updates verified observations through the operator's own Supabase JWT/RLS. No external Meta mutation is possible from the module.
- Campaigns not starting with BROS SELL / BROSSELL are skipped.
- Pagination is capped at 3 pages and cannot change host/path; no provider token in pagination URL.
- Missing conversions and action values remain null/unknown, not zero.
- Fail-closed on unavailable token, permission failure, rate limit, invalid dates/payload, database error and unverified identity.
- Reports are **attributed** observations, not verified HitPay settled orders or profitability.

**Known limitation:** The current authenticated manual refresh uses the prior Malaysia calendar day, but it is not scheduled and has no recovery/backfill queue. Do not claim a full production pipeline until backfill, refresh consistency and refund reconciliation are validated.

## Acceptance gate before use

- Dedicated Supabase project exists and is healthy; migration list and RLS validated.
- Vercel is linked to the correct GitHub repository and every deployment is SSO-protected.
- All eight dry-run safety tests + seven read-only tests, type-check, and production build pass on the **merged commit**.
- Auth and no-membership denial tested end to end.
- Test `/operator` with verified member in a protected environment.
- Read-only token added using server secret store and access verified without exposing credentials.
- Simulated Meta response yields accurate metrics while no Meta write APIs exist.

## Full autonomy is a separate decision

Automated scheduling, creative generation and Meta write scopes are **not enabled** by this runbook. Follow the activation gates in `docs/AI_MARKETING_OPERATOR.md`; the user must explicitly approve any future live advertising scope and spending limit.
