# Existing BROS DEMAND Meta campaign pilot

The existing PR17 Preview now contains campaign readiness, bounded paused staging,
explicit launch and a fixed-parent stop control. It reuses the app, Neon Auth,
restricted Neon DEV pool and existing Meta write adapter. It never creates a new
campaign. Its financial authority is the existing owner-approved RM140 lifetime
budget for campaign `120251158023300697`, seven days, Malaysia21–45 and the two V5
Feed assets in the Primary campaign register:
https://docs.google.com/document/d/1XPD2sCnOJeFpXfXtwsu44kgrwhl2L03wfajpxOIck2I/edit

## Current acceptance: PARTIAL

The exact Preview branch currently has the reporting token only; the existing
Meta app ID has been configured. No management token, app-secret configuration,
verified Malaysia identity IDs or current real RM100 launch-QA receipt is
provisioned. No Meta POST, campaign activation, production change or new worker
was performed. The approved DEV grant is described below.
The owner approved the exact execution-ledger table and existing-writer
SELECT/INSERT grant on2November2026; that migration is now applied in the
existing Neon DEV database. Physical LOGIN/RLS acceptance is independently
checked through the Preview's existing restricted credential. Passing mocks and a
build do not establish end-to-end execution or independent paid-order tracking.

## Before enabling paused staging

1. Configure the business-owned `META_ADS_MANAGEMENT_TOKEN` (ads_management),
   `META_APP_ID=1315572270590189`, and `META_APP_SECRET` as protected server
   variables for `feat/demand-direct-meta-readonly-20261031`, Preview only.
   Never enter credentials in chat or reuse connected advertising-tool secrets.
   Preflight independently checks token metadata, app/business ownership,
   account access, MYR and Asia/Kuala_Lumpur. It fails closed on unknown fields.
2. Obtain actual verified identity IDs from Meta and configure
   `BROS_DEMAND_META_BENEFICIARY_ID` and `BROS_DEMAND_META_PAYER_ID`. Page,
   campaign, pixel and business IDs are rejected as substitutes. Shape checking
   does not certify verification; Meta must accept and return the actual IDs.
3. The owner has approved the scoped SELECT/INSERT grant in
   `neon/migrations/20261102_demand_meta_pilot_events_REVIEW_REQUIRED.sql`.
   It was applied only to the existing `bros_intelligence_dev` database. The existing
   restricted LOGIN is reused; no role, credential or backend is created.
   Verify physical LOGIN, forced RLS, append-only grants, wrong-tenant/product
   denial and rollback before setting `BROS_DEMAND_META_PILOT_LEDGER=reviewed-v1`.
   The install verification is opt-in through the exact-branch encrypted
   `BROS_DEMAND_META_PILOT_LEDGER_VERIFICATION` configuration (mode
   `rollback-install-v1` and the known approved principal). It uses the existing
   physical writer LOGIN and rolls back all probe rows. It does not assert a
   JWT-authenticated operator session. After the real proof passes, set this
   temporary verification configuration to `completed-v1`; later builds do not
   re-run installation probes against a campaign journal containing real actions.
4. Set `BROS_DEMAND_META_PILOT_STAGE=approved-v5` only after those real checks.
   The browser submits the two original JPEG files; the server pins their sizes
   and SHA256 hashes. New asset hashes are obtained from Meta, never inferred
   from temporary third-party upload references. All ads and the ad set start
   PAUSED under the existing parent CBO campaign, without an ad-set budget.

## Live launch is a separate acceptance gate

Verify the real current RM100 checkout, paid-provider order, Meta Purchase value
MYR100, event deduplication and UTM continuity. Record the actual evidence in a
Primary native Doc. Do not make a fake payment or manufacture a successful event.
Configure a protected `BROS_DEMAND_META_LAUNCH_QA_RECEIPT` JSON object with:
`policyDigest`, `campaign`, `amountMinor:10000`, `currency:MYR`, `pixel`,
`checkoutVerified:true`, `purchaseDedupVerified:true`, `utmVerified:true`,
`paidOrderReference`, `purchaseEventId`, canonical `evidenceUrl` and `verifiedAt`.
The timestamp must be within24hours. This is a SERVER OPERATOR ATTESTATION;
its shape validator is not independent evidence verification. A human/authorized
operator must verify the underlying provider facts before provisioning it.

`policyDigest` is exported by `lib/demand/meta-pilot-policy.ts`. Set
`BROS_DEMAND_META_PILOT_LAUNCH` to that digest only after real QA acceptance.
Do not turn on launch based on the synthetic fixtures in the tests.

Launch freshly reads the parent, exact budget, children, copy, images, pixel,
targeting, identity fields, review state and other active campaigns. It refreshes
the ad-set flight to a future seven-day window, enables two ads and the ad set,
then enables the parent LAST. It never modifies the RM140 campaign budget.
Meta accepting status ACTIVE does not prove delivery, attribution, CPA or lift.

## Failure and stop semantics

Each step commits an immutable intent BEFORE the Meta POST. Provider success is
confirmed in an append-only event. Concurrent requests use a campaign advisory
lock on the existing database. An unmatched intent blocks automatic replay,
including after a provider timeout or failed confirmation COMMIT. Independently
read Meta and the ledger before reconciling; never delete intents to force retry.
The browser advances only after a verified response and never retries a failed
POST automatically. One existing campaign/policy is supported, not repeated
campaign launches or general account management.

The stop control targets only the fixed parent, independent of launch/flight/QA
flags. It records a durable revocation when the ledger is available, requests
PAUSED and reads Meta back. It still attempts the stop if the ledger is down;
the response explicitly distinguishes a current provider readback from durable
revocation. In-flight distributed requests require reconciliation. Unknown
activation results trigger an additional best-effort parent pause.

## Evidence collected without live writes

Primary Drive JPEG readbacks on2November2026:
- A:465709bytes,1080×1350,SHA256`742aac6771fb834c151b38a4f2dbd3369206b3d8bddea172e10087122f0e4219`.
- B:452762bytes,1080×1350,SHA256`37845fa92439901e418623d09f9f9da32738a9ed25a6b8680210670c574018c7`.

Targeted tests cover expiry/app/account/scope rejection, budget/target/copy drift,
parent-last activation, uncertain-COMMIT stop, replay exclusion, durable stop,
same-origin HTTP admission, error redaction and fresh Neon sessions. Provider
fixtures and transaction fixtures are SYNTHETIC. Exact-head CI, Preview browser
readback and remaining real blockers are recorded in the PR checkpoint.
