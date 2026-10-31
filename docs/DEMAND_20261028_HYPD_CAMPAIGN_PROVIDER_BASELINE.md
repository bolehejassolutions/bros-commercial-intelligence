# BROS DEMAND — Real read-only acquisition baseline and HYPD campaign identity bridge

Checkpoint ID: DEMAND_HYPD_CAMPAIGN_OBJECT_BRIDGE_20261028_1911_V1
Status: INTERNAL DEV / PROVIDER-CONNECTOR OBSERVATIONS; NOT A VERIFIED EXPERIMENT
Observed: 2026-10-28 ~19:09–19:12 MYT (11:09–11:12 UTC)
Authority: Primary owner decision 25 Oct incl. addendum; DEMAND Issue #9. Owner's later portfolio priority (28 Oct ~19:04 MYT): prioritize provider-grounded acceptance work, not synthetic-only regressions.

## Fresh read-only provider evidence (not server-owned app credentials)

1. HYPD Meta Ads account discovery: BOLEHEJAS SOLUTIONS Ads, `act_1997776120879476`, MYR, Asia/Kuala_Lumpur.
2. HYPD `meta_get_campaigns(accountId)` returned three campaigns, **all PAUSED / effective PAUSED** at read time:
   - `120251158023300697` — ACQ-V2 7-day, lifetime budget RM140, remaining RM140 (no launch authorized here).
   - `120250864977630697` — historical Oct 8 campaign, lifetime budget RM1500, remaining RM1375.07.
   - `120250828102660697` — deprecated Oct 27 campaign, daily budget RM30, remaining RM30.
   These are **status snapshots**, not future-delivery guarantees; budgets are provider settings, not new spending approval.
3. HYPD `meta_insights({accountId,objectId:"120250864977630697",level:"campaign",since:"2026-10-08",until:"2026-10-27"})` returned **one** report row, with `date_start/date_stop` and `account_currency=MYR` but **without `campaign_id`**. The actual provider observation: spend **RM124.93**, 3,194 impressions, 2,041 reach, 84 clicks, 63 inline link clicks, 33 landing-page views, and **one overlapping set** of `purchase`, `omni_purchase`, and `offsite_conversion.fb_pixel_purchase` action labels (value 1 each, **not three purchases**). Meta action value RM50. `cost_per_action_type` and `purchase_roas` are **platform calculations, not verified CAC/ROAS**.
4. HYPD `meta_insights({accountId,level:"campaign",since:"2026-10-25",until:"2026-10-27"})` returned `rows=[]`, `nextPageToken=null`, `missingScopes=null`. **No rows != zero spend/sales/delivery**; the connector has not supplied affirmative zero metrics.
5. HitPay read-only `list_orders` and `list_charges` with `date_from=2026-10-25,date_to=2026-10-28,per_page=25` returned `data=[]`, `has_more=false` for that **bounded query**. Historical #1007 (9 Oct, RM50) remains an owner-confirmed **real Meta-sourced** BROS SELL customer order with independent paid HitPay evidence; exact pixel-event↔order join, bank payout-item allocation and entitlement are separate unverified claims. No payer PII retained here.
6. HYPD `google_analytics_list_account_summaries()` returned `accountSummaries=[]`: no GA4 property selected in **HYPD**. This does not negate the owner's confirmation of an existing GA4→Meta connection.

## Concrete integration gap and code-only fix

Existing `normalizeMetaCampaignFunnel` requires a row-level `campaign_id`; actual HYPD exact-object campaign report omits that field. Passing the provider row directly fails even though the read-only request was campaign-scoped. Never infer campaign identity from an **account-level** report.

Added DEMAND-only `lib/demand/hypd-meta-campaign-report.ts` to bind a **single unpaginated row** to the exact `accountId/objectId/level=campaign/since/until` query envelope; validate currency, date range, explicit conflicting row campaign IDs, missing scopes, dropped fields and pagination; then project via existing normalizer. No rows return `NO_ROWS_NOT_ZERO` with `observation=null`. A content-addressed snapshot remains stable on identical rereads and changes on report revision. `providerAuthenticationVerified=false`, `tenantAuthorizationVerified=false`, `verifiedPaidOrders=null`, `verifiedCpaMinor=null`, `causalLift=null` are deliberate: caller-supplied query and HYPD connector data do **not** establish authenticated BCI app ingestion, merchant attribution, or experimental outcome.

Regression coverage: actual HYPD-shaped one-row response, no-row unknown semantics, account-vs-campaign mismatch, foreign campaign, wrong dates/currency, pagination/multiple rows, missing scopes/dropped fields, revision/idempotency and invalid scope. GitHub CI must pass independently before reporting technical PASS.

## Diagnosis, next safe action and experiment gate

- **Observed:** historical paid Meta funnel activity; all three campaigns currently paused; no provider rows for 25–27 Oct; HitPay bounded 25–28 Oct returned no orders/charges. These observations do **not** show causal effectiveness or ineffectiveness of a creative.
- **Diagnosis:** provider response-shape mismatch prevented reliable exact-campaign normalization. That adapter gap is now addressed in Draft PR #14; app-owned provider authentication, transaction-level join, qualified enquiries, outcome verification and durable BCI learning remain open.
- **Next action:** use authenticated, product-scoped read-only provider receipts and a separately authorized, preregistered **no-incremental-spend** BROS SELL educational acquisition experiment. Define primary KPI from **verified** qualified enquiries or paid orders with explicit source/denominator, compare a diagnostic seller-first theme with a pre-specified control using existing approved content workflow only if owner authorizes that change. Otherwise retain the plan unexecuted. A sequential comparison without randomized/controlled assignment is observational, **not causal lift**.
- **Owner approval required before any experiment that changes publisher assets, schedule, Meta ads, landing pages, provider permissions or spending.** No such action performed.
- **Gate:** DEMAND INTERNAL V1 **OPEN** until diagnosis → authorized action → provider-verified outcome → durable BCI learning, independently replayable. Historical #1007 is a baseline, not a new experiment outcome.

Boundaries: DEMAND product layer only. Shared core/auth/DB owned by BCI/Neon; media/publisher owned by CONTENT. No Neon DDL, Supabase resume, Meta write/spend, new cost, production deployment, merge, price/policy/entitlement changes, customer access, Buffer/Full Publisher modifications or BROS LABS.

References:
- Canonical owner decision: https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit
- DEMAND spec: https://docs.google.com/document/d/1jux469eMEGdwHh_0Wlf9lUnEH64QzwJ5pbj1mGog0BQ/edit
- Issue #9: https://github.com/bolehejassolutions/bros-commercial-intelligence/issues/9
- Draft PR #14: https://github.com/bolehejassolutions/bros-commercial-intelligence/pull/14

## DEMAND_HYPD_PROVIDER_REPLAY_STDIN_20261028_2010_V1 — real connector readback + privacy-minimized offline replay

Observed: 28 Oct 2026 ~20:10 MYT. Source: fresh HYPD Meta Ads connector calls, read-only. Account discovery again returned MYR/Asia-Kuala_Lumpur account act_1997776120879476. Exact campaign-object query for 120250864977630697, 8–27 Oct, again returned one row WITHOUT campaign_id: RM124.93 spend, 3,194 impressions, 2,041 reach, 84 clicks, 63 inline link clicks, 33 LPVs, and overlapping purchase/omni/Pixel aliases of 1 each. This is ONE platform-attributed purchase signal set, not three orders. Query for the same exact campaign, 25–27 Oct, returned rows=[]/nextPageToken=null/missingScopes=null: NO_ROWS_NOT_ZERO. Both are connected-provider observations, not an authenticated DEMAND application receipt.

Added scripts/demand-hypd-readback.mjs and tests/demand-hypd-readback.test.mjs to the existing DEMAND Draft PR #14. CLI accepts exactly one caller-provided JSON {scope,query,response} via stdin; reuses the strict existing HYPD exact-object adapter; emits only a minimal campaign observation/snapshot hash, explicit UNATTESTED status, and null verified paid orders/CPA/outcome/learning. It performs no network, DB, provider writes or ad changes, never echoes raw provider payload/tenant/merchant IDs, and fails closed for wrong scope, conflicting campaign, missing permissions and pagination. Regression uses the redacted metrics/shape observed from the connected provider and an observed no-row case; it is still a fixture replay, NOT a live authenticated BCI application E2E.

No acquisition experiment was executed. Existing Meta→HitPay #1007 identity, payout allocation, entitlement, qualified customer conversion and causal lift remain unverified; do not infer CPA/CAC/ROAS. Four INTERNAL V1 gates remain OPEN. No changes to BCI/Neon, CONTENT/publisher, production, pricing, spending, permissions, paid services or BROS LABS.

## DEMAND_HYPD_GA4_SOURCE_COVERAGE_20261028_2112_V1 — live selected-account coverage preflight

Observed: 28 Oct 2026 ~21:12 MYT. Fresh HYPD `hypd_list_connected_accounts({platforms:["google_analytics","meta_ads","google_tag_manager"]})` returned Meta Ads `state=ready` with selected `act_1997776120879476`, MYR, Asia/Kuala_Lumpur; GA4 `state=ready` but `accounts=[]`; GTM `state=ready` but `accounts=[]`. Meta campaign `120250864977630697` remains PAUSED/effective PAUSED at this readback. HitPay `list_orders(2026-10-25..2026-10-28)` returned an empty bounded page, NOT a global no-sales claim. These are connected-connector observations; the DEMAND application does NOT possess verified app-side provider authentication.

Finding: HYPD connection operational state `ready` is NOT the same as a selected GA4 property. No selected GA4 property is available for HYPD read-only UTM/checkout measurement, even though the owner has previously reported GA4 configured elsewhere. Do not infer GA4 is absent globally, that Meta→GA4 tracking is broken, or that sales were zero.

Implemented DEMAND-only `lib/demand/provider-source-coverage.ts` and `tests/demand-provider-source-coverage.test.mjs`: explicit `META_ONLY_GA4_NOT_SELECTED` status and `VERIFY_OR_SELECT_GA4_PROPERTY_IN_HYPD` next evidence action; content-addressed stable source-selection key includes property identity; malformed/duplicate inventory fails closed. Any selected property remains UNATTESTED and cannot prove UTM capture, authenticated BCI ingestion, HitPay attribution, settled orders, CAC/CPA, causal lift, verified outcome or learning. No shared BCI/Neon/auth/DB or CONTENT/publisher changes.

Local Node 22 strip-types regression: 4/4 PASS. GitHub Actions final-head status must be checked independently; the new code is a source-selection diagnostic, NOT the completed DEMAND acquisition experiment. No Meta/HitPay writes, spend, production, permission change, customer data or BROS LABS.


## DEMAND_HITPAY_ORDER_CHARGE_REFUND_PROVIDER_READBACK_20261029_0003_V1 — actual HitPay cross-endpoint readback

Observed: 29 Oct 2026 ~00:03–00:15 MYT. Source: connected HitPay read-only list_orders(keywords="#1007"), list_charges(8–10 Oct), get_charge_details and get_charge_refunds for the matched transaction; connected HYPD historical Meta Insights 8–28 Oct. This is provider-connector evidence, **NOT authenticated DEMAND application-to-provider ingestion**. No payer/card/merchant UUIDs retained in this document.

- HitPay order **#1007**: provider order status completed, fulfilment completed, payment status paid; created 9 Oct 2026 07:53 MYT; gross **RM50.00**.
- Independently fetched HitPay charge: succeeded; explicit `remark=Order #<order UUID>` and charge-detail `order_reference_number=1007` reconcile to the exact order, not just coincident date/amount. Charge details: gross **RM50.00**, combined processing/plugin fee **RM1.70**, net after fees **RM48.30**, refunded amount **RM0.00**. Refund endpoint independently returned **0 refunds**, total refunded RM0.00 at readback. Charge `payout=null`: **bank settlement and payout allocation NOT verified**.
- HYPD exact historical Meta campaign (8–28 Oct) still reports RM124.93 spend, 63 inline link clicks, 33 LPVs and overlapping purchase aliases with Meta-attributed value RM50. **Same value and overlapping date do not establish pixel-event↔order identity, attribution, verified CPA/CAC/ROAS, experiment action, outcome or learning.**
- Fresh day-specific HYPD Meta follow-up requests were denied by daily plan allowance (`plan_denied`), so no daily campaign join or day-specific outcome was obtained; no paid plan upgrade.
- Implemented DEMAND-only `lib/demand/hitpay-provider-readback.ts` and `tests/demand-hitpay-provider-readback.test.mjs` on Draft PR #14. Enforces complete single-candidate pages, explicit cross-endpoint order/charge identity, exact refund-charge reconciliation, cent-precision monetary agreement and PII-free stable snapshot identity. Test fixtures use fabricated UUIDs with actual observed status/amount shape. Refund revision triggers review; never promotes paid charge to settled order, product entitlement, marketing attribution, verified CPA or BCI learning.
- This validates a real merchant payment observation, **not a new acquisition experiment**. Product identity, independent app credential/tenant scope, event-to-order join, payout settlement and entitlement remain open. No BCI/Neon/core, CONTENT/publisher, Meta/HitPay writes, spend, pricing, permissions, production or BROS LABS.


## DEMAND_HITPAY_PAID_PAYOUT_UNLINKED_20261029_0110_V1 — 29 Oct 2026 ~01:10 MYT

Provider-backed, read-only **negative allocation acceptance**: HitPay `list_payouts(date_from=2026-10-01,date_to=2026-10-29,per_page=25)` returned one row, `has_more=false`. Its status is `paid`, provider `stripe_my`, amount **MYR48.30**, created `2026-10-11T16:03:10Z`, with payout remark referring to 12 Oct. Independently reconciled historical order #1007 has gross **MYR50.00**, fees **MYR1.70**, net **MYR48.30**. The amounts match **numerically only**. Payout inventory contains no charge allocation or bank receipt, and charge detail reported `payout=null`; therefore no verified charge→payout link, bank receipt, settled-order count, Meta attribution, CPA/CAC, conversion, causal lift, experiment outcome or durable BCI learning. Payout provider's `paid` status is reported as a provider observation, not proof of bank deposit.

HYPD GA4 `accountSummaries=[]` and selected `google_analytics.accounts=[]` at readback, despite connector state `ready`; Meta selected account remains `act_1997776120879476`. HitPay `list_orders(2026-10-25..2026-10-29)` returned `data=[]`, `has_more=false`: bounded-query result only, NOT global zero sales.

Implemented DEMAND-only `lib/demand/hitpay-payout-candidate.ts` and `tests/demand-hitpay-payout-candidate.test.mjs`. It enforces complete pagination, strict MYR cent precision, valid IDs/status/timestamps, stable content-addressed snapshot, privacy-minimized output and fail-closed paid-order candidate input. The provider-shaped historical payout yields `ONE_NET_AMOUNT_MATCH_UNLINKED`; it never upgrades provider or bank authentication, settlement, outcome or BCI learning. Four local Node regression cases PASS; exact-head CI must be verified separately. No Neon/BCI core, CONTENT/publisher, provider write/spend, production, pricing/policy, permissions, customer access or automations modified. DEMAND and all four INTERNAL V1 gates remain OPEN.
