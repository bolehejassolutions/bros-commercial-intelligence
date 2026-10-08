# BCI isolated deployment & Meta read-only onboarding

Status: **source implementation ready; separate Supabase project not yet provisioned; provider credential not yet configured.** These are explicit activation gates. Never describe unscheduled manual ingestion as an autonomous live monitor.

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
- `NODE_ENV` — provided automatically.

The Meta token is never exposed by Next.js to the browser. No service-role key or Meta write scope is required for manual read-only ingestion.

## Read-only ingestion contract

- `GET /api/operator/meta`: authenticated, enrolled operators can inspect up to 20 recent saved snapshots.
- `POST /api/operator/meta`: same-origin request + authenticated, enrolled operator + present server-side token. Uses a GET request to the fixed Meta account's Insights endpoint for **yesterday** (UTC reporting boundary in current implementation). Inserts or updates verified observations through the operator's own Supabase JWT/RLS. No external Meta mutation is possible from the module.
- Campaigns not starting with BROS SELL / BROSSELL are skipped.
- Pagination is capped at 3 pages and cannot change host/path; no provider token in pagination URL.
- Missing conversions and action values remain null/unknown, not zero.
- Fail-closed on unavailable token, permission failure, rate limit, invalid dates/payload, database error and unverified identity.
- Reports are **attributed** observations, not verified HitPay settled orders or profitability.

**Known limitation:** Meta reporting dates should be aligned to the account timezone (Asia/Kuala_Lumpur) before activating scheduled ingestion. The current authenticated manual refresh uses the prior UTC day. Do not claim this is a full production data pipeline until the local reporting day, backfill and refund reconciliation are validated.

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
