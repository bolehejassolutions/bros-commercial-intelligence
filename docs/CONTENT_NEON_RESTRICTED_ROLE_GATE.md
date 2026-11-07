# BROS CONTENT Neon DEV — restricted-role activation gate

Status: **DATABASE POLICY CONFIGURED; APPLICATION NOT ACTIVATED** (verified 2026-11-07).

## Verified live state

- Neon DEV: project `empty-tooth-43040036`, branch `br-broad-math-b3f4d2r4`, database `bros_intelligence_dev`.
- Both `content_dev_reader` and `content_dev_draft_writer` exist as LOGIN, NOINHERIT, non-superuser, non-RLS-bypass roles, with no database CREATE privilege.
- Both roles are denied source-import schema access, credit-ledger SELECT and generation-job INSERT.
- Ten CONTENT RLS policies and two membership RLS policies are present; owner and foreign-principal behavior was simulated on an isolated temporary branch using SET ROLE, **not tested using actual restricted logins**.
- **Neither role has a password** (live `pg_authid` readback). Neon password reset for SQL-created roles failed; automated secret provisioning was blocked. Do not report connection readiness.
- The reader/writer adapters bind verified principal to `bci.principal_id` transaction-locally before membership queries; the earlier missing-context gap is fixed.
- HTTP boundaries and adapters exist as injected modules, but **no verified CONTENT session implementation or live API route is wired**.
- The dedicated Vercel `bros-content` project is configured, but no application has been deployed and no domain has been cut over.
- Recovery branch CI passed at commit `3ec7ebdad095e77b727b46ef3b1b128f9fbb93e9` (CONTENT recovery and Marketing Operator Dry-Run).

## Activation requirements

1. Provision distinct strong passwords for existing restricted roles using an approved secure administrative channel. Store each full connection URL as a sensitive secret only in the dedicated CONTENT application environment. Never print credentials or use BROS owner credentials for application traffic.
2. Verify real TLS connections as each exact restricted login, including role posture, membership RLS, owner/foreign tenant isolation, revoked memberships, credit/job denial and idempotent draft transaction rollback.
3. Implement a server-side **CONTENT** session verifier bound to a real identity provider and principal mapping. Do not substitute BCI operator Supabase sessions, email matching, request headers or request bodies as identity proof.
4. Connect protected workspace read and draft-write routes to the verified session and restricted adapters; test authenticated end-to-end requests.
5. Deploy to dedicated Vercel project, verify deployment and functional parity before requesting production DNS cutover.

Do not merge, cut over production, mint credits, run generation, activate billing, or expand BCI permissions merely because CI is green.
