# BROS CONTENT Neon DEV — restricted-role activation gate

Status: **NOT ACTIVATED**. This is an implementation gate, not an authorization to provision roles.

## Verified 2026-11-07

- CONTENT draft reservation table is present on Neon DEV with FORCE RLS, zero policies.
- Existing CONTENT tables have FORCE RLS and zero policies.
- `bci_dev.tenant_memberships` has FORCE RLS and five policies, none scoped to `content_dev_reader` or `content_dev_draft_writer`.
- Neither restricted CONTENT login exists.
- Existing reader/writer SQL requires `content_dev_reader` / `content_dev_draft_writer`, direct login, NOINHERIT, NOBYPASSRLS, no inherited roles, no superuser/CREATEROLE.
- Application currently authenticates BCI operators with Supabase; this must not be treated as proof of Neon CONTENT identity.

## Required implementation before activating API

1. Create distinct non-inheriting, non-bypass, non-admin CONTENT-only login roles with securely managed credentials. Do not reuse Neon owner or BCI credentials.
2. Add narrowly scoped membership SELECT policies for these exact roles, using transaction-local verified principal context; ensure CONTENT product, active membership and non-revocation.
3. Add tenant/principal-bound SELECT policies for reader on workspaces, campaigns, content_items, scenes; for writer allow only required workspace/membership SELECT and campaign/reservation INSERT/SELECT/UPDATE. Deny generation_jobs, credit_ledger, staging and BCI approval/reservation access.
4. All application queries must use a single transaction, set authenticated principal with `set_config('bci.principal_id', verified_user_id, true)` before any membership query, and never derive that identity from request-controlled headers or JSON.
5. Test a valid owner and unrelated principal through the **actual restricted login**, including wrong tenant, revoked membership, wrong product, replayed idempotency key, rollback and privilege escalation attempts.
6. Implement and test a real Neon Auth session verifier. Do not use BCI Supabase operator sessions or email matching as identity proof.
7. Verify schema/permissions on DEV branch before enabling routes. Never use owner/MCP connection for application traffic.

## Critical gap

Current reader/writer adapters require membership SELECT but **do not set transaction-local principal context**. Existing BCI membership RLS uses `current_setting('bci.principal_id', true)`; merely passing principal UUID as a SQL parameter cannot satisfy that RLS. Integrate context-setting and regression tests before role provisioning.

No production cutover, credit minting, generation, payments or BCI privilege expansion is authorized by this document.
